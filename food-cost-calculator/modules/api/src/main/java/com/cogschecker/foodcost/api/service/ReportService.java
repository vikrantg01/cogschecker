package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.dto.RecipeResponse;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.shared.ThresholdEvaluator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Service for generating recipe costing reports.
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */
@Service
@Transactional(readOnly = true)
public class ReportService {
    
    private static final Logger logger = LoggerFactory.getLogger(ReportService.class);
    
    private final RecipeRepository recipeRepository;
    private final SystemConfigService systemConfigService;
    
    public ReportService(RecipeRepository recipeRepository, SystemConfigService systemConfigService) {
        this.recipeRepository = recipeRepository;
        this.systemConfigService = systemConfigService;
    }
    
    /**
     * Get costing report with server-side sorting and filtering.
     * 
     * Requirements:
     * - 5.1: Pre-inclusion validation (non-empty name, non-negative costs)
     * - 5.2: Sort by specified column and direction
     * - 5.3: Default sort by recipe name ASC
     * - 5.4: "Exceeds threshold" filter excludes recipes without menu price, 
     *        includes only where food_cost_percentage > threshold
     * - 5.5: Return empty list if no recipes match filter
     * 
     * @param venueId the venue ID
     * @param sortColumn the column to sort by (name, foodCostPerPortion, menuSellingPrice, foodCostPercentage)
     *                   null or empty defaults to "name"
     * @param sortDir the sort direction (asc, desc), null or empty defaults to "asc"
     * @param filter the filter type ("exceedsThreshold" or null for no filter)
     * @return list of recipe responses matching the criteria
     */
    public List<RecipeResponse> getCostingReport(
            UUID venueId,
            String sortColumn,
            String sortDir,
            String filter) {
        
        logger.info("Generating costing report for venue {}: sortColumn={}, sortDir={}, filter={}",
                venueId, sortColumn, sortDir, filter);
        
        // Get all recipes for the venue
        List<Recipe> recipes = recipeRepository.findByVenueId(venueId);
        
        // Get the threshold for filtering (if needed)
        BigDecimal threshold = systemConfigService.getConfig(venueId).getTargetFoodCostPercentage();
        
        // Apply pre-inclusion validation and filter - Requirement 5.1
        List<RecipeResponse> responses = recipes.stream()
                .filter(this::passesPreInclusionValidation)
                .map(recipe -> toRecipeResponse(recipe, threshold))
                .collect(Collectors.toList());
        
        // Apply "exceeds threshold" filter if requested - Requirement 5.4
        if ("exceedsThreshold".equals(filter)) {
            responses = responses.stream()
                    .filter(r -> r.getMenuSellingPrice() != null && r.getMenuSellingPrice().compareTo(BigDecimal.ZERO) > 0)
                    .filter(r -> r.getFoodCostPercentage() != null && r.getFoodCostPercentage().compareTo(threshold) > 0)
                    .collect(Collectors.toList());
        }
        
        // Apply sorting - Requirements 5.2, 5.3
        Comparator<RecipeResponse> comparator = getComparator(sortColumn);
        boolean ascending = sortDir == null || sortDir.trim().isEmpty() || "asc".equalsIgnoreCase(sortDir);
        
        if (!ascending) {
            comparator = comparator.reversed();
        }
        
        responses.sort(comparator);
        
        logger.info("Returning {} recipes in costing report", responses.size());
        return responses;
    }
    
    /**
     * Validate that a recipe passes pre-inclusion criteria.
     * Requirement 5.1: non-empty name, non-negative food cost and menu selling price
     */
    private boolean passesPreInclusionValidation(Recipe recipe) {
        // Non-empty name
        if (recipe.getName() == null || recipe.getName().trim().isEmpty()) {
            logger.warn("Recipe {} excluded from report: empty name", recipe.getId());
            return false;
        }
        
        // Non-negative food cost per portion (can be null, but if set must be >= 0)
        if (recipe.getFoodCostPerPortion() != null && recipe.getFoodCostPerPortion().compareTo(BigDecimal.ZERO) < 0) {
            logger.warn("Recipe {} excluded from report: negative food cost per portion", recipe.getId());
            return false;
        }
        
        // Non-negative menu selling price (can be null, but if set must be >= 0)
        if (recipe.getMenuSellingPrice() != null && recipe.getMenuSellingPrice().compareTo(BigDecimal.ZERO) < 0) {
            logger.warn("Recipe {} excluded from report: negative menu selling price", recipe.getId());
            return false;
        }
        
        return true;
    }
    
    /**
     * Convert Recipe entity to RecipeResponse DTO with threshold status.
     */
    private RecipeResponse toRecipeResponse(Recipe recipe, BigDecimal threshold) {
        RecipeResponse response = new RecipeResponse();
        response.setId(recipe.getId());
        response.setVenueId(recipe.getVenueId());
        response.setName(recipe.getName());
        response.setPortionCount(recipe.getPortionCount());
        response.setMenuSellingPrice(recipe.getMenuSellingPrice());
        response.setTotalBatchCost(recipe.getTotalBatchCost());
        response.setFoodCostPerPortion(recipe.getFoodCostPerPortion());
        response.setFoodCostPercentage(recipe.getFoodCostPercentage());
        response.setCreatedAt(recipe.getCreatedAt());
        response.setUpdatedAt(recipe.getUpdatedAt());
        
        // Evaluate threshold status - Requirements 4.7, 4.8
        response.setThresholdStatus(ThresholdEvaluator.evaluate(recipe.getFoodCostPercentage(), threshold));
        
        return response;
    }
    
    /**
     * Get the comparator for the specified sort column.
     * Requirement 5.3: default to recipe name
     */
    private Comparator<RecipeResponse> getComparator(String sortColumn) {
        if (sortColumn == null || sortColumn.trim().isEmpty()) {
            sortColumn = "name";
        }
        
        return switch (sortColumn.toLowerCase()) {
            case "foodcostperportion" -> Comparator.comparing(
                    RecipeResponse::getFoodCostPerPortion,
                    Comparator.nullsLast(Comparator.naturalOrder())
            );
            case "menusellingprice" -> Comparator.comparing(
                    RecipeResponse::getMenuSellingPrice,
                    Comparator.nullsLast(Comparator.naturalOrder())
            );
            case "foodcostpercentage" -> Comparator.comparing(
                    RecipeResponse::getFoodCostPercentage,
                    Comparator.nullsLast(Comparator.naturalOrder())
            );
            default -> Comparator.comparing(
                    RecipeResponse::getName,
                    Comparator.nullsLast(String.CASE_INSENSITIVE_ORDER)
            );
        };
    }
}
