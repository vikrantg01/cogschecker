package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Ingredient;
import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.domain.RecipeIngredientLine;
import com.cogschecker.foodcost.api.exception.ValidationException;
import com.cogschecker.foodcost.api.repository.IngredientRepository;
import com.cogschecker.foodcost.api.repository.RecipeIngredientLineRepository;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.shared.IncompatibleUomException;
import com.cogschecker.foodcost.shared.UomConverter;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Service for calculating recipe food costs.
 * Requirements: 3.1, 3.2, 3.4, 3.5, 3.6, 3.7
 */
@Service
public class CostingService {
    
    private final RecipeIngredientLineRepository recipeIngredientLineRepository;
    private final IngredientRepository ingredientRepository;
    private final RecipeRepository recipeRepository;
    
    public CostingService(
            RecipeIngredientLineRepository recipeIngredientLineRepository,
            IngredientRepository ingredientRepository,
            RecipeRepository recipeRepository) {
        this.recipeIngredientLineRepository = recipeIngredientLineRepository;
        this.ingredientRepository = ingredientRepository;
        this.recipeRepository = recipeRepository;
    }
    
    /**
     * Calculate and return the batch cost result for a recipe.
     * 
     * This method iterates through ingredient lines, applies UOM conversion,
     * and accumulates line costs. It handles sub-recipe lines using the 
     * sub-recipe's food_cost_per_portion.
     * 
     * Requirements:
     * - 3.1: Iterate ingredient lines, apply UOM conversion, accumulate line_cost
     * - 3.2: Calculate food cost per portion = total_batch_cost / portion_count
     * - 3.4: Handle sub-recipe lines using sub-recipe's food_cost_per_portion
     * - 3.5: Display cost breakdown structure even when prices missing
     * - 3.6: Flag ingredient lines with missing prices, exclude from total
     * - 3.7: If all lines missing price, return incomplete status
     * 
     * @param recipe the recipe to calculate costs for
     * @return BatchCostResult containing total cost, per-portion cost, and flags
     * @throws ValidationException with 422 status if UOM conversion fails
     */
    @Transactional(readOnly = true)
    public BatchCostResult calculateBatchCost(Recipe recipe) {
        if (recipe == null) {
            throw new IllegalArgumentException("Recipe cannot be null");
        }
        
        List<RecipeIngredientLine> lines = recipeIngredientLineRepository.findByRecipeId(recipe.getId());
        
        if (lines.isEmpty()) {
            // Empty recipe has zero cost
            return new BatchCostResult(
                BigDecimal.ZERO,
                BigDecimal.ZERO,
                false,
                false
            );
        }
        
        BigDecimal totalBatchCost = BigDecimal.ZERO;
        boolean anyMissingPrice = false;
        int linesWithPrice = 0;
        
        for (RecipeIngredientLine line : lines) {
            try {
                LineCostResult lineCostResult = calculateLineCost(line);
                
                if (lineCostResult.missingPrice) {
                    anyMissingPrice = true;
                } else {
                    totalBatchCost = totalBatchCost.add(lineCostResult.cost);
                    linesWithPrice++;
                }
                
            } catch (IncompatibleUomException e) {
                // Surface UOM incompatibility as 422 validation error
                throw new ValidationException(
                    "INCOMPATIBLE_UOM",
                    "Cannot convert units for recipe line: " + e.getMessage(),
                    Map.of(
                        "lineId", line.getId(),
                        "fromUnit", e.getFromUnit().getSymbol(),
                        "toUnit", e.getToUnit().getSymbol(),
                        "fromDimension", e.getFromUnit().getDimension().toString(),
                        "toDimension", e.getToUnit().getDimension().toString()
                    )
                );
            }
        }
        
        // Requirement 3.7: If all lines are missing price, return incomplete
        boolean incomplete = (linesWithPrice == 0 && anyMissingPrice);
        
        // Requirement 3.2: Calculate food cost per portion
        BigDecimal foodCostPerPortion = null;
        if (!incomplete && recipe.getPortionCount() != null && recipe.getPortionCount() > 0) {
            foodCostPerPortion = totalBatchCost
                .divide(BigDecimal.valueOf(recipe.getPortionCount()), 2, RoundingMode.HALF_UP);
        }
        
        return new BatchCostResult(
            totalBatchCost,
            foodCostPerPortion,
            anyMissingPrice,
            incomplete
        );
    }
    
    /**
     * Calculate the cost for a single ingredient line.
     * 
     * @param line the ingredient line
     * @return LineCostResult with cost and missing price flag
     * @throws IncompatibleUomException if UOM conversion fails
     */
    private LineCostResult calculateLineCost(RecipeIngredientLine line) {
        // Handle sub-recipe lines (Requirement 3.4)
        if (line.getSubRecipeId() != null) {
            return calculateSubRecipeLineCost(line);
        }
        
        // Handle regular ingredient lines
        if (line.getIngredientId() != null) {
            return calculateIngredientLineCost(line);
        }
        
        // Should not happen due to DB constraint, but handle gracefully
        return new LineCostResult(BigDecimal.ZERO, true);
    }
    
    /**
     * Calculate cost for a sub-recipe line using the sub-recipe's food_cost_per_portion.
     * 
     * Requirement 3.4: Use sub-recipe's calculated food cost per portion as unit cost
     */
    private LineCostResult calculateSubRecipeLineCost(RecipeIngredientLine line) {
        Recipe subRecipe = recipeRepository.findById(line.getSubRecipeId())
            .orElse(null);
        
        if (subRecipe == null) {
            // Sub-recipe not found - treat as missing price
            return new LineCostResult(BigDecimal.ZERO, true);
        }
        
        // Requirement 3.6: If sub-recipe has no food cost per portion, flag as missing
        if (subRecipe.getFoodCostPerPortion() == null) {
            return new LineCostResult(BigDecimal.ZERO, true);
        }
        
        // line_cost = quantity_of_sub_recipe_portions * sub_recipe.food_cost_per_portion
        BigDecimal lineCost = line.getQuantityUsed()
            .multiply(subRecipe.getFoodCostPerPortion())
            .setScale(4, RoundingMode.HALF_UP);
        
        return new LineCostResult(lineCost, false);
    }
    
    /**
     * Calculate cost for a regular ingredient line with UOM conversion.
     * 
     * Requirement 3.1: Apply UOM conversion and accumulate line_cost
     */
    private LineCostResult calculateIngredientLineCost(RecipeIngredientLine line) {
        Ingredient ingredient = ingredientRepository.findById(line.getIngredientId())
            .orElse(null);
        
        if (ingredient == null) {
            // Ingredient not found - treat as missing price
            return new LineCostResult(BigDecimal.ZERO, true);
        }
        
        // Requirement 3.6: If effective_cost_per_usable_unit is null, flag as missing
        if (ingredient.getEffectiveCostPerUsableUnit() == null) {
            return new LineCostResult(BigDecimal.ZERO, true);
        }
        
        // Requirement 3.1: Apply UOM conversion
        // Convert quantity from line's UOM to ingredient's purchase UOM
        BigDecimal convertedQuantity = UomConverter.convert(
            line.getQuantityUsed(),
            line.getUnitOfMeasure(),
            ingredient.getUnitOfMeasure()
        );
        
        // Calculate line cost
        BigDecimal lineCost = convertedQuantity
            .multiply(ingredient.getEffectiveCostPerUsableUnit())
            .setScale(4, RoundingMode.HALF_UP);
        
        return new LineCostResult(lineCost, false);
    }
    
    /**
     * Result of calculating batch cost for a recipe.
     */
    public static class BatchCostResult {
        private final BigDecimal totalBatchCost;
        private final BigDecimal foodCostPerPortion;
        private final boolean missingPrice;
        private final boolean incomplete;
        
        public BatchCostResult(
                BigDecimal totalBatchCost,
                BigDecimal foodCostPerPortion,
                boolean missingPrice,
                boolean incomplete) {
            this.totalBatchCost = totalBatchCost;
            this.foodCostPerPortion = foodCostPerPortion;
            this.missingPrice = missingPrice;
            this.incomplete = incomplete;
        }
        
        public BigDecimal getTotalBatchCost() {
            return totalBatchCost;
        }
        
        public BigDecimal getFoodCostPerPortion() {
            return foodCostPerPortion;
        }
        
        public boolean isMissingPrice() {
            return missingPrice;
        }
        
        public boolean isIncomplete() {
            return incomplete;
        }
    }
    
    /**
     * Calculate food cost percentage.
     * 
     * Requirements:
     * - 4.1: Accept positive menu selling price > 0
     * - 4.2: Calculate (foodCostPerPortion / menuSellingPrice) × 100, rounded to 1 d.p.
     * - 4.3: Return null if menuSellingPrice is 0 or not set to prevent division by zero
     * 
     * @param foodCostPerPortion the food cost per portion (can be null)
     * @param menuSellingPrice the menu selling price (can be null)
     * @return food cost percentage rounded to 1 decimal place, or null if calculation not possible
     */
    public BigDecimal calculateFoodCostPercentage(BigDecimal foodCostPerPortion, BigDecimal menuSellingPrice) {
        // Requirement 4.3: Return null if menuSellingPrice is null or 0
        if (menuSellingPrice == null || menuSellingPrice.compareTo(BigDecimal.ZERO) == 0) {
            return null;
        }
        
        // If foodCostPerPortion is null, cannot calculate percentage
        if (foodCostPerPortion == null) {
            return null;
        }
        
        // Requirement 4.2: Calculate (foodCostPerPortion / menuSellingPrice) × 100
        // Rounded to 1 decimal place
        BigDecimal percentage = foodCostPerPortion
            .divide(menuSellingPrice, 3, RoundingMode.HALF_UP)  // First divide with extra precision
            .multiply(BigDecimal.valueOf(100))
            .setScale(1, RoundingMode.HALF_UP);  // Then round to 1 d.p.
        
        return percentage;
    }
    
    /**
     * Internal result of calculating a single line cost.
     */
    private static class LineCostResult {
        private final BigDecimal cost;
        private final boolean missingPrice;
        
        public LineCostResult(BigDecimal cost, boolean missingPrice) {
            this.cost = cost;
            this.missingPrice = missingPrice;
        }
    }
}
