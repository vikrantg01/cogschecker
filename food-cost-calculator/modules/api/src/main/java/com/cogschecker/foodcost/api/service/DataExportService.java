package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Ingredient;
import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.domain.RecipeIngredientLine;
import com.cogschecker.foodcost.api.domain.SystemConfig;
import com.cogschecker.foodcost.api.dto.VenueExportData;
import com.cogschecker.foodcost.api.dto.VenueExportData.IngredientExportData;
import com.cogschecker.foodcost.api.dto.VenueExportData.IngredientLineExportData;
import com.cogschecker.foodcost.api.dto.VenueExportData.RecipeExportData;
import com.cogschecker.foodcost.api.dto.VenueExportData.VenueData;
import com.cogschecker.foodcost.api.repository.IngredientRepository;
import com.cogschecker.foodcost.api.repository.RecipeIngredientLineRepository;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.api.repository.SystemConfigRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Service for exporting venue data to JSON.
 * Requirements: 7.4
 */
@Service
public class DataExportService {
    
    private static final Logger logger = LoggerFactory.getLogger(DataExportService.class);
    private static final Integer EXPORT_VERSION = 1;
    
    private final IngredientRepository ingredientRepository;
    private final RecipeRepository recipeRepository;
    private final RecipeIngredientLineRepository ingredientLineRepository;
    private final SystemConfigRepository systemConfigRepository;
    
    public DataExportService(IngredientRepository ingredientRepository,
                            RecipeRepository recipeRepository,
                            RecipeIngredientLineRepository ingredientLineRepository,
                            SystemConfigRepository systemConfigRepository) {
        this.ingredientRepository = ingredientRepository;
        this.recipeRepository = recipeRepository;
        this.ingredientLineRepository = ingredientLineRepository;
        this.systemConfigRepository = systemConfigRepository;
    }
    
    /**
     * Export all venue data as a versioned JSON document.
     * 
     * Exports all ingredients, recipes (with ingredient lines), and the target food cost percentage
     * in a versioned envelope format to support future schema evolution.
     * 
     * Requirements: 7.4
     * 
     * @param venueId the venue ID to export
     * @return VenueExportData containing the complete venue state
     */
    @Transactional(readOnly = true)
    public VenueExportData export(UUID venueId) {
        logger.info("Starting data export for venueId: {}", venueId);
        
        // Fetch all ingredients for the venue
        List<Ingredient> ingredients = ingredientRepository.findByVenueId(venueId);
        logger.debug("Found {} ingredients for venue {}", ingredients.size(), venueId);
        
        // Fetch all recipes for the venue
        List<Recipe> recipes = recipeRepository.findByVenueId(venueId);
        logger.debug("Found {} recipes for venue {}", recipes.size(), venueId);
        
        // Fetch all ingredient lines for all recipes
        Map<UUID, List<RecipeIngredientLine>> recipeToLines = new HashMap<>();
        for (Recipe recipe : recipes) {
            List<RecipeIngredientLine> lines = ingredientLineRepository.findByRecipeId(recipe.getId());
            recipeToLines.put(recipe.getId(), lines);
        }
        logger.debug("Loaded ingredient lines for {} recipes", recipeToLines.size());
        
        // Fetch system config (target food cost percentage)
        SystemConfig config = systemConfigRepository.findById(venueId)
                .orElse(new SystemConfig(venueId, new BigDecimal("30.0")));
        logger.debug("Loaded system config with target percentage: {}", config.getTargetFoodCostPercentage());
        
        // Convert entities to export DTOs
        List<IngredientExportData> ingredientExports = ingredients.stream()
                .map(this::mapIngredientToExport)
                .collect(Collectors.toList());
        
        List<RecipeExportData> recipeExports = recipes.stream()
                .map(recipe -> mapRecipeToExport(recipe, recipeToLines.get(recipe.getId())))
                .collect(Collectors.toList());
        
        // Build the export structure
        VenueData venueData = new VenueData(
                ingredientExports,
                recipeExports,
                config.getTargetFoodCostPercentage()
        );
        
        VenueExportData exportData = new VenueExportData(
                EXPORT_VERSION,
                Instant.now().toString(),
                venueData
        );
        
        logger.info("Successfully exported data for venueId: {} - {} ingredients, {} recipes", 
                venueId, ingredientExports.size(), recipeExports.size());
        
        return exportData;
    }
    
    /**
     * Map Ingredient entity to IngredientExportData.
     */
    private IngredientExportData mapIngredientToExport(Ingredient ingredient) {
        IngredientExportData data = new IngredientExportData();
        data.setId(ingredient.getId().toString());
        data.setName(ingredient.getName());
        data.setPurchasePrice(ingredient.getPurchasePrice());
        data.setPurchaseQuantity(ingredient.getPurchaseQuantity());
        data.setUnitOfMeasure(ingredient.getUnitOfMeasure().name());
        data.setYieldPercentage(ingredient.getYieldPercentage());
        data.setCostPerUnit(ingredient.getCostPerUnit());
        data.setEffectiveCostPerUsableUnit(ingredient.getEffectiveCostPerUsableUnit());
        data.setCreatedAt(ingredient.getCreatedAt() != null ? ingredient.getCreatedAt().toString() : null);
        data.setUpdatedAt(ingredient.getUpdatedAt() != null ? ingredient.getUpdatedAt().toString() : null);
        return data;
    }
    
    /**
     * Map Recipe entity to RecipeExportData with its ingredient lines.
     */
    private RecipeExportData mapRecipeToExport(Recipe recipe, List<RecipeIngredientLine> lines) {
        RecipeExportData data = new RecipeExportData();
        data.setId(recipe.getId().toString());
        data.setName(recipe.getName());
        data.setPortionCount(recipe.getPortionCount());
        data.setMenuSellingPrice(recipe.getMenuSellingPrice());
        data.setTotalBatchCost(recipe.getTotalBatchCost());
        data.setFoodCostPerPortion(recipe.getFoodCostPerPortion());
        data.setFoodCostPercentage(recipe.getFoodCostPercentage());
        data.setCreatedAt(recipe.getCreatedAt() != null ? recipe.getCreatedAt().toString() : null);
        data.setUpdatedAt(recipe.getUpdatedAt() != null ? recipe.getUpdatedAt().toString() : null);
        
        // Map ingredient lines
        List<IngredientLineExportData> lineExports = lines != null 
                ? lines.stream()
                        .map(this::mapIngredientLineToExport)
                        .collect(Collectors.toList())
                : List.of();
        data.setIngredientLines(lineExports);
        
        return data;
    }
    
    /**
     * Map RecipeIngredientLine entity to IngredientLineExportData.
     */
    private IngredientLineExportData mapIngredientLineToExport(RecipeIngredientLine line) {
        IngredientLineExportData data = new IngredientLineExportData();
        data.setId(line.getId().toString());
        data.setIngredientId(line.getIngredientId() != null ? line.getIngredientId().toString() : null);
        data.setSubRecipeId(line.getSubRecipeId() != null ? line.getSubRecipeId().toString() : null);
        data.setQuantityUsed(line.getQuantityUsed());
        data.setUnitOfMeasure(line.getUnitOfMeasure().name());
        data.setLineCost(line.getLineCost());
        data.setCreatedAt(line.getCreatedAt() != null ? line.getCreatedAt().toString() : null);
        data.setUpdatedAt(line.getUpdatedAt() != null ? line.getUpdatedAt().toString() : null);
        return data;
    }
}
