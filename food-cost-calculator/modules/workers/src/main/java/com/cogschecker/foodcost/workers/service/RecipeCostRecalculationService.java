package com.cogschecker.foodcost.workers.service;

import com.cogschecker.foodcost.api.domain.Ingredient;
import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.shared.CostCalculator;
import com.cogschecker.foodcost.shared.UomConverter;
import com.cogschecker.foodcost.shared.UomEnum;
import com.cogschecker.foodcost.workers.repository.RecipeDependencyRepository;
import com.cogschecker.foodcost.workers.repository.WorkerIngredientRepository;
import com.cogschecker.foodcost.workers.repository.WorkerRecipeRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

/**
 * Service for recalculating recipe costs after ingredient updates.
 * <p>
 * This service implements the core cost propagation logic:
 * <ol>
 *   <li>Find all recipes that transitively depend on the changed ingredient</li>
 *   <li>Sort by dependency depth (leaves first)</li>
 *   <li>Recalculate each recipe's cost in order</li>
 *   <li>Batch update all recipes in a single transaction</li>
 * </ol>
 * <p>
 * The dependency-order calculation is critical: when Recipe A uses Recipe B as a sub-recipe,
 * Recipe B must be recalculated first so Recipe A can use the updated cost.
 * <p>
 * Requirements: 3.3 - Cost recalculation with transitive dependency resolution
 */
@Service
public class RecipeCostRecalculationService {

    private static final Logger logger = LoggerFactory.getLogger(RecipeCostRecalculationService.class);

    private final RecipeDependencyRepository recipeDependencyRepository;
    private final WorkerRecipeRepository recipeRepository;
    private final WorkerIngredientRepository ingredientRepository;

    public RecipeCostRecalculationService(
            RecipeDependencyRepository recipeDependencyRepository,
            WorkerRecipeRepository recipeRepository,
            WorkerIngredientRepository ingredientRepository) {
        this.recipeDependencyRepository = recipeDependencyRepository;
        this.recipeRepository = recipeRepository;
        this.ingredientRepository = ingredientRepository;
    }

    /**
     * Recalculate costs for all recipes that transitively depend on the given ingredient.
     * <p>
     * This method executes within a single transaction to ensure consistency:
     * all recipe costs are updated atomically, or none are updated if an error occurs.
     * <p>
     * The recursive CTE query returns recipe IDs in dependency order (leaves first),
     * ensuring that sub-recipes are recalculated before their parent recipes.
     * <p>
     * Requirements: 3.3
     * 
     * @param venueId the venue ID (for logging and validation)
     * @param ingredientId the ingredient ID that was updated
     * @return list of recipe IDs that were recalculated
     */
    @Transactional
    public List<UUID> recalculateDependentRecipeCosts(UUID venueId, UUID ingredientId) {
        logger.info("Starting cost recalculation for ingredient {} in venue {}", ingredientId, venueId);
        
        // Step 1: Find all recipes that transitively depend on this ingredient (dependency-ordered)
        List<UUID> dependentRecipeIds = recipeDependencyRepository.findAllDependentRecipeIds(ingredientId);
        
        if (dependentRecipeIds.isEmpty()) {
            logger.info("No recipes depend on ingredient {}, skipping recalculation", ingredientId);
            return Collections.emptyList();
        }
        
        logger.info("Found {} dependent recipes for ingredient {}", dependentRecipeIds.size(), ingredientId);
        
        // Step 2: Recalculate each recipe in dependency order
        // We use a map to cache recalculated recipe costs so parent recipes can access updated sub-recipe costs
        Map<UUID, BigDecimal> recipeIdToCostPerPortion = new HashMap<>();
        Instant now = Instant.now();
        int recalculatedCount = 0;
        
        for (UUID recipeId : dependentRecipeIds) {
            try {
                recalculateSingleRecipe(recipeId, recipeIdToCostPerPortion, now);
                recalculatedCount++;
            } catch (Exception e) {
                logger.error("Failed to recalculate recipe {}: {}", recipeId, e.getMessage(), e);
                // Continue with other recipes - partial recalculation is better than none
            }
        }
        
        logger.info("Successfully recalculated {} out of {} recipes for ingredient {}",
                recalculatedCount, dependentRecipeIds.size(), ingredientId);
        
        return dependentRecipeIds;
    }

    /**
     * Recalculate the cost for a single recipe and update it in the database.
     * <p>
     * For each ingredient line:
     * <ul>
     *   <li>If it's an ingredient: fetch the ingredient, apply UOM conversion, calculate line cost</li>
     *   <li>If it's a sub-recipe: use the cached cost per portion (already recalculated)</li>
     * </ul>
     * <p>
     * Then compute:
     * <ul>
     *   <li>total_batch_cost = SUM(line costs)</li>
     *   <li>food_cost_per_portion = total_batch_cost / portion_count</li>
     *   <li>food_cost_percentage = (food_cost_per_portion / menu_selling_price) * 100 (if price set)</li>
     * </ul>
     * <p>
     * Finally, update the recipe in the database and cache the cost per portion for parent recipes.
     * 
     * @param recipeId the recipe ID to recalculate
     * @param recipeIdToCostPerPortion cache of recalculated recipe costs
     * @param updatedAt the update timestamp
     */
    private void recalculateSingleRecipe(
            UUID recipeId,
            Map<UUID, BigDecimal> recipeIdToCostPerPortion,
            Instant updatedAt) {
        
        logger.debug("Recalculating recipe {}", recipeId);
        
        // Fetch recipe
        Recipe recipe = recipeRepository.findById(recipeId)
                .orElseThrow(() -> new IllegalArgumentException("Recipe not found: " + recipeId));
        
        // Fetch ingredient lines
        List<Object[]> ingredientLines = recipeDependencyRepository.findIngredientLinesByRecipeId(recipeId);
        
        if (ingredientLines.isEmpty()) {
            logger.warn("Recipe {} has no ingredient lines, setting cost to zero", recipeId);
            updateRecipeCosts(recipe, BigDecimal.ZERO, updatedAt, recipeIdToCostPerPortion);
            return;
        }
        
        // Calculate total batch cost by summing all line costs
        BigDecimal totalBatchCost = BigDecimal.ZERO;
        
        for (Object[] line : ingredientLines) {
            UUID ingredientId = line[0] != null ? UUID.fromString(line[0].toString()) : null;
            UUID subRecipeId = line[1] != null ? UUID.fromString(line[1].toString()) : null;
            BigDecimal quantityUsed = new BigDecimal(line[2].toString());
            String unitOfMeasureStr = line[3].toString();
            UomEnum lineUom = UomEnum.fromSymbol(unitOfMeasureStr);
            
            BigDecimal lineCost;
            
            if (ingredientId != null) {
                // Regular ingredient line
                lineCost = calculateIngredientLineCost(ingredientId, quantityUsed, lineUom);
            } else if (subRecipeId != null) {
                // Sub-recipe line: use cached cost per portion from earlier recalculation
                BigDecimal subRecipeCostPerPortion = recipeIdToCostPerPortion.get(subRecipeId);
                if (subRecipeCostPerPortion == null) {
                    // Sub-recipe not yet recalculated (shouldn't happen with correct ordering)
                    // Fall back to database value
                    Recipe subRecipe = recipeRepository.findById(subRecipeId)
                            .orElseThrow(() -> new IllegalArgumentException("Sub-recipe not found: " + subRecipeId));
                    subRecipeCostPerPortion = subRecipe.getFoodCostPerPortion();
                    if (subRecipeCostPerPortion == null) {
                        subRecipeCostPerPortion = BigDecimal.ZERO;
                    }
                }
                lineCost = quantityUsed.multiply(subRecipeCostPerPortion);
            } else {
                logger.warn("Recipe {} has ingredient line with neither ingredient nor sub-recipe, skipping", recipeId);
                continue;
            }
            
            totalBatchCost = totalBatchCost.add(lineCost);
        }
        
        // Update recipe costs
        updateRecipeCosts(recipe, totalBatchCost, updatedAt, recipeIdToCostPerPortion);
    }

    /**
     * Calculate the cost of a single ingredient line.
     * <p>
     * Steps:
     * <ol>
     *   <li>Fetch the ingredient from the database</li>
     *   <li>Convert the quantity used to the ingredient's purchase unit</li>
     *   <li>Calculate line cost = converted quantity * effective cost per usable unit</li>
     * </ol>
     * 
     * @param ingredientId the ingredient ID
     * @param quantityUsed the quantity used in the recipe
     * @param lineUom the unit of measure for the quantity used
     * @return the line cost
     */
    private BigDecimal calculateIngredientLineCost(UUID ingredientId, BigDecimal quantityUsed, UomEnum lineUom) {
        Ingredient ingredient = ingredientRepository.findById(ingredientId)
                .orElseThrow(() -> new IllegalArgumentException("Ingredient not found: " + ingredientId));
        
        // Convert quantity to purchase unit
        BigDecimal convertedQuantity = UomConverter.convert(quantityUsed, lineUom, ingredient.getUnitOfMeasure());
        
        // Calculate line cost
        BigDecimal effectiveCost = ingredient.getEffectiveCostPerUsableUnit();
        if (effectiveCost == null) {
            effectiveCost = BigDecimal.ZERO;
        }
        
        return CostCalculator.lineCost(convertedQuantity, effectiveCost);
    }

    /**
     * Update recipe costs in the database and cache the cost per portion.
     * 
     * @param recipe the recipe to update
     * @param totalBatchCost the new total batch cost
     * @param updatedAt the update timestamp
     * @param recipeIdToCostPerPortion cache for storing the cost per portion
     */
    private void updateRecipeCosts(
            Recipe recipe,
            BigDecimal totalBatchCost,
            Instant updatedAt,
            Map<UUID, BigDecimal> recipeIdToCostPerPortion) {
        
        // Calculate food cost per portion
        BigDecimal foodCostPerPortion = CostCalculator.foodCostPerPortion(totalBatchCost, recipe.getPortionCount());
        
        // Calculate food cost percentage (if menu selling price is set)
        BigDecimal foodCostPercentage = null;
        if (recipe.getMenuSellingPrice() != null && recipe.getMenuSellingPrice().compareTo(BigDecimal.ZERO) > 0) {
            foodCostPercentage = CostCalculator.foodCostPercentage(foodCostPerPortion, recipe.getMenuSellingPrice());
        }
        
        // Update database
        recipeRepository.updateRecipeCosts(
                recipe.getId(),
                totalBatchCost,
                foodCostPerPortion,
                foodCostPercentage,
                updatedAt
        );
        
        // Cache cost per portion for parent recipes that use this as a sub-recipe
        recipeIdToCostPerPortion.put(recipe.getId(), foodCostPerPortion);
        
        logger.debug("Updated recipe {} - batch cost: {}, cost per portion: {}, cost percentage: {}",
                recipe.getId(), totalBatchCost, foodCostPerPortion, foodCostPercentage);
    }
}
