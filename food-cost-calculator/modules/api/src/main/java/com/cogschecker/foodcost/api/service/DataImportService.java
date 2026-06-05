package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Ingredient;
import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.domain.RecipeIngredientLine;
import com.cogschecker.foodcost.api.domain.SystemConfig;
import com.cogschecker.foodcost.api.dto.VenueExportData;
import com.cogschecker.foodcost.api.dto.VenueExportData.IngredientExportData;
import com.cogschecker.foodcost.api.dto.VenueExportData.IngredientLineExportData;
import com.cogschecker.foodcost.api.dto.VenueExportData.RecipeExportData;
import com.cogschecker.foodcost.api.exception.InvalidImportSchemaException;
import com.cogschecker.foodcost.api.repository.IngredientRepository;
import com.cogschecker.foodcost.api.repository.RecipeIngredientLineRepository;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.api.repository.SystemConfigRepository;
import com.cogschecker.foodcost.shared.UomEnum;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

/**
 * Service for importing venue data from JSON.
 * Requirements: 7.5, 7.6
 */
@Service
public class DataImportService {
    
    private static final Logger logger = LoggerFactory.getLogger(DataImportService.class);
    
    private final IngredientRepository ingredientRepository;
    private final RecipeRepository recipeRepository;
    private final RecipeIngredientLineRepository ingredientLineRepository;
    private final SystemConfigRepository systemConfigRepository;
    private final ObjectMapper objectMapper;
    
    public DataImportService(IngredientRepository ingredientRepository,
                            RecipeRepository recipeRepository,
                            RecipeIngredientLineRepository ingredientLineRepository,
                            SystemConfigRepository systemConfigRepository,
                            ObjectMapper objectMapper) {
        this.ingredientRepository = ingredientRepository;
        this.recipeRepository = recipeRepository;
        this.ingredientLineRepository = ingredientLineRepository;
        this.systemConfigRepository = systemConfigRepository;
        this.objectMapper = objectMapper;
    }
    
    /**
     * Import venue data from JSON, atomically replacing all existing venue data.
     * 
     * Validates the JSON against the expected schema, and if valid, deletes all existing
     * ingredients and recipes for the venue, then inserts the imported data within a single
     * transaction. If validation fails, throws InvalidImportSchemaException and leaves
     * existing data unchanged.
     * 
     * Requirements: 7.5, 7.6
     * 
     * @param venueId the venue ID to import data into
     * @param json the JSON string containing venue export data
     * @throws InvalidImportSchemaException if the JSON is malformed or doesn't conform to schema
     */
    @Transactional
    public void importData(UUID venueId, String json) {
        logger.info("Starting data import for venueId: {}", venueId);
        
        // Parse and validate JSON schema
        VenueExportData exportData = parseAndValidate(json);
        
        logger.info("JSON schema validation passed for venueId: {}", venueId);
        
        // Delete all existing venue data
        deleteExistingVenueData(venueId);
        
        logger.info("Deleted existing venue data for venueId: {}", venueId);
        
        // Import ingredients first (since recipes reference them)
        Map<String, UUID> oldToNewIngredientIds = importIngredients(venueId, exportData.getVenue().getIngredients());
        
        logger.info("Imported {} ingredients for venueId: {}", oldToNewIngredientIds.size(), venueId);
        
        // Import recipes (with ingredient lines)
        Map<String, UUID> oldToNewRecipeIds = importRecipes(venueId, exportData.getVenue().getRecipes(), oldToNewIngredientIds);
        
        logger.info("Imported {} recipes for venueId: {}", oldToNewRecipeIds.size(), venueId);
        
        // Import ingredient lines with updated IDs
        importIngredientLines(exportData.getVenue().getRecipes(), oldToNewRecipeIds, oldToNewIngredientIds);
        
        logger.info("Imported ingredient lines for venueId: {}", venueId);
        
        // Import system config
        importSystemConfig(venueId, exportData.getVenue().getTargetFoodCostPercentage());
        
        logger.info("Successfully imported all data for venueId: {}", venueId);
    }
    
    /**
     * Parse JSON and validate against schema using Jackson.
     * Throws InvalidImportSchemaException on any parsing or validation error.
     */
    private VenueExportData parseAndValidate(String json) {
        try {
            // Parse JSON to VenueExportData
            VenueExportData data = objectMapper.readValue(json, VenueExportData.class);
            
            // Validate required top-level fields
            if (data.getVersion() == null) {
                throw new InvalidImportSchemaException("Missing required field: version");
            }
            
            if (data.getVenue() == null) {
                throw new InvalidImportSchemaException("Missing required field: venue");
            }
            
            // Validate venue data fields
            VenueExportData.VenueData venue = data.getVenue();
            
            if (venue.getIngredients() == null) {
                throw new InvalidImportSchemaException("Missing required field: venue.ingredients");
            }
            
            if (venue.getRecipes() == null) {
                throw new InvalidImportSchemaException("Missing required field: venue.recipes");
            }
            
            if (venue.getTargetFoodCostPercentage() == null) {
                throw new InvalidImportSchemaException("Missing required field: venue.targetFoodCostPercentage");
            }
            
            // Validate each ingredient
            for (int i = 0; i < venue.getIngredients().size(); i++) {
                validateIngredient(venue.getIngredients().get(i), i);
            }
            
            // Validate each recipe
            for (int i = 0; i < venue.getRecipes().size(); i++) {
                validateRecipe(venue.getRecipes().get(i), i);
            }
            
            return data;
            
        } catch (InvalidImportSchemaException e) {
            // Re-throw our validation exceptions
            throw e;
        } catch (Exception e) {
            // Catch JSON parsing errors
            logger.error("JSON parsing failed", e);
            throw new InvalidImportSchemaException(
                "Invalid JSON format: " + e.getMessage(),
                Map.of("error", e.getClass().getSimpleName())
            );
        }
    }
    
    /**
     * Validate ingredient data structure and required fields.
     */
    private void validateIngredient(IngredientExportData ingredient, int index) {
        String prefix = "venue.ingredients[" + index + "]";
        
        if (ingredient.getId() == null || ingredient.getId().isBlank()) {
            throw new InvalidImportSchemaException("Missing required field: " + prefix + ".id");
        }
        
        if (ingredient.getName() == null || ingredient.getName().isBlank()) {
            throw new InvalidImportSchemaException("Missing required field: " + prefix + ".name");
        }
        
        if (ingredient.getPurchasePrice() == null) {
            throw new InvalidImportSchemaException("Missing required field: " + prefix + ".purchasePrice");
        }
        
        if (ingredient.getPurchaseQuantity() == null) {
            throw new InvalidImportSchemaException("Missing required field: " + prefix + ".purchaseQuantity");
        }
        
        if (ingredient.getUnitOfMeasure() == null || ingredient.getUnitOfMeasure().isBlank()) {
            throw new InvalidImportSchemaException("Missing required field: " + prefix + ".unitOfMeasure");
        }
        
        // Validate UOM is a valid enum value
        try {
            UomEnum.valueOf(ingredient.getUnitOfMeasure());
        } catch (IllegalArgumentException e) {
            throw new InvalidImportSchemaException(
                "Invalid unitOfMeasure at " + prefix + ": " + ingredient.getUnitOfMeasure(),
                Map.of("validValues", Arrays.toString(UomEnum.values()))
            );
        }
        
        if (ingredient.getYieldPercentage() == null) {
            throw new InvalidImportSchemaException("Missing required field: " + prefix + ".yieldPercentage");
        }
    }
    
    /**
     * Validate recipe data structure and required fields.
     */
    private void validateRecipe(RecipeExportData recipe, int index) {
        String prefix = "venue.recipes[" + index + "]";
        
        if (recipe.getId() == null || recipe.getId().isBlank()) {
            throw new InvalidImportSchemaException("Missing required field: " + prefix + ".id");
        }
        
        if (recipe.getName() == null || recipe.getName().isBlank()) {
            throw new InvalidImportSchemaException("Missing required field: " + prefix + ".name");
        }
        
        if (recipe.getPortionCount() == null) {
            throw new InvalidImportSchemaException("Missing required field: " + prefix + ".portionCount");
        }
        
        if (recipe.getIngredientLines() == null) {
            throw new InvalidImportSchemaException("Missing required field: " + prefix + ".ingredientLines");
        }
        
        // Validate each ingredient line
        for (int i = 0; i < recipe.getIngredientLines().size(); i++) {
            validateIngredientLine(recipe.getIngredientLines().get(i), index, i);
        }
    }
    
    /**
     * Validate ingredient line data structure and required fields.
     */
    private void validateIngredientLine(IngredientLineExportData line, int recipeIndex, int lineIndex) {
        String prefix = "venue.recipes[" + recipeIndex + "].ingredientLines[" + lineIndex + "]";
        
        if (line.getId() == null || line.getId().isBlank()) {
            throw new InvalidImportSchemaException("Missing required field: " + prefix + ".id");
        }
        
        // Must have either ingredientId or subRecipeId (but not both)
        boolean hasIngredientId = line.getIngredientId() != null && !line.getIngredientId().isBlank();
        boolean hasSubRecipeId = line.getSubRecipeId() != null && !line.getSubRecipeId().isBlank();
        
        if (!hasIngredientId && !hasSubRecipeId) {
            throw new InvalidImportSchemaException(
                "Missing required field: " + prefix + " must have either ingredientId or subRecipeId"
            );
        }
        
        if (hasIngredientId && hasSubRecipeId) {
            throw new InvalidImportSchemaException(
                "Invalid data at " + prefix + ": cannot have both ingredientId and subRecipeId"
            );
        }
        
        if (line.getQuantityUsed() == null) {
            throw new InvalidImportSchemaException("Missing required field: " + prefix + ".quantityUsed");
        }
        
        if (line.getUnitOfMeasure() == null || line.getUnitOfMeasure().isBlank()) {
            throw new InvalidImportSchemaException("Missing required field: " + prefix + ".unitOfMeasure");
        }
        
        // Validate UOM is a valid enum value
        try {
            UomEnum.valueOf(line.getUnitOfMeasure());
        } catch (IllegalArgumentException e) {
            throw new InvalidImportSchemaException(
                "Invalid unitOfMeasure at " + prefix + ": " + line.getUnitOfMeasure(),
                Map.of("validValues", Arrays.toString(UomEnum.values()))
            );
        }
    }
    
    /**
     * Delete all existing ingredients and recipes for the venue.
     * Cascading delete will also remove recipe ingredient lines.
     */
    private void deleteExistingVenueData(UUID venueId) {
        // Delete ingredient lines first (to avoid foreign key issues)
        List<Recipe> recipes = recipeRepository.findByVenueId(venueId);
        for (Recipe recipe : recipes) {
            ingredientLineRepository.deleteByRecipeId(recipe.getId());
        }
        
        // Delete recipes
        recipeRepository.deleteByVenueId(venueId);
        
        // Delete ingredients
        ingredientRepository.deleteByVenueId(venueId);
        
        logger.debug("Deleted {} recipes and their lines for venue {}", recipes.size(), venueId);
    }
    
    /**
     * Import ingredients and return a mapping of old IDs to new IDs.
     */
    private Map<String, UUID> importIngredients(UUID venueId, List<IngredientExportData> ingredientsData) {
        Map<String, UUID> idMapping = new HashMap<>();
        
        for (IngredientExportData data : ingredientsData) {
            Ingredient ingredient = new Ingredient();
            
            // Generate new UUID for this venue
            UUID newId = UUID.randomUUID();
            ingredient.setId(newId);
            ingredient.setVenueId(venueId);
            ingredient.setName(data.getName());
            ingredient.setPurchasePrice(data.getPurchasePrice());
            ingredient.setPurchaseQuantity(data.getPurchaseQuantity());
            ingredient.setUnitOfMeasure(UomEnum.valueOf(data.getUnitOfMeasure()));
            ingredient.setYieldPercentage(data.getYieldPercentage());
            ingredient.setCostPerUnit(data.getCostPerUnit());
            ingredient.setEffectiveCostPerUsableUnit(data.getEffectiveCostPerUsableUnit());
            
            // Set timestamps
            if (data.getCreatedAt() != null && !data.getCreatedAt().isBlank()) {
                try {
                    ingredient.setCreatedAt(Instant.parse(data.getCreatedAt()));
                } catch (Exception e) {
                    ingredient.setCreatedAt(Instant.now());
                }
            } else {
                ingredient.setCreatedAt(Instant.now());
            }
            
            if (data.getUpdatedAt() != null && !data.getUpdatedAt().isBlank()) {
                try {
                    ingredient.setUpdatedAt(Instant.parse(data.getUpdatedAt()));
                } catch (Exception e) {
                    ingredient.setUpdatedAt(Instant.now());
                }
            } else {
                ingredient.setUpdatedAt(Instant.now());
            }
            
            ingredientRepository.save(ingredient);
            idMapping.put(data.getId(), newId);
        }
        
        return idMapping;
    }
    
    /**
     * Import recipes and return a mapping of old IDs to new IDs.
     */
    private Map<String, UUID> importRecipes(UUID venueId, List<RecipeExportData> recipesData, 
                                            Map<String, UUID> ingredientIdMapping) {
        Map<String, UUID> idMapping = new HashMap<>();
        
        for (RecipeExportData data : recipesData) {
            Recipe recipe = new Recipe();
            
            // Generate new UUID for this venue
            UUID newId = UUID.randomUUID();
            recipe.setId(newId);
            recipe.setVenueId(venueId);
            recipe.setName(data.getName());
            recipe.setPortionCount(data.getPortionCount());
            recipe.setMenuSellingPrice(data.getMenuSellingPrice());
            recipe.setTotalBatchCost(data.getTotalBatchCost());
            recipe.setFoodCostPerPortion(data.getFoodCostPerPortion());
            recipe.setFoodCostPercentage(data.getFoodCostPercentage());
            
            // Set timestamps
            if (data.getCreatedAt() != null && !data.getCreatedAt().isBlank()) {
                try {
                    recipe.setCreatedAt(Instant.parse(data.getCreatedAt()));
                } catch (Exception e) {
                    recipe.setCreatedAt(Instant.now());
                }
            } else {
                recipe.setCreatedAt(Instant.now());
            }
            
            if (data.getUpdatedAt() != null && !data.getUpdatedAt().isBlank()) {
                try {
                    recipe.setUpdatedAt(Instant.parse(data.getUpdatedAt()));
                } catch (Exception e) {
                    recipe.setUpdatedAt(Instant.now());
                }
            } else {
                recipe.setUpdatedAt(Instant.now());
            }
            
            recipeRepository.save(recipe);
            idMapping.put(data.getId(), newId);
        }
        
        return idMapping;
    }
    
    /**
     * Import ingredient lines with updated recipe and ingredient IDs.
     */
    private void importIngredientLines(List<RecipeExportData> recipesData,
                                      Map<String, UUID> recipeIdMapping,
                                      Map<String, UUID> ingredientIdMapping) {
        for (RecipeExportData recipeData : recipesData) {
            UUID newRecipeId = recipeIdMapping.get(recipeData.getId());
            
            for (IngredientLineExportData lineData : recipeData.getIngredientLines()) {
                RecipeIngredientLine line = new RecipeIngredientLine();
                
                // Generate new UUID
                line.setId(UUID.randomUUID());
                line.setRecipeId(newRecipeId);
                
                // Map old ingredient/sub-recipe IDs to new ones
                if (lineData.getIngredientId() != null && !lineData.getIngredientId().isBlank()) {
                    UUID newIngredientId = ingredientIdMapping.get(lineData.getIngredientId());
                    line.setIngredientId(newIngredientId);
                }
                
                if (lineData.getSubRecipeId() != null && !lineData.getSubRecipeId().isBlank()) {
                    UUID newSubRecipeId = recipeIdMapping.get(lineData.getSubRecipeId());
                    line.setSubRecipeId(newSubRecipeId);
                }
                
                line.setQuantityUsed(lineData.getQuantityUsed());
                line.setUnitOfMeasure(UomEnum.valueOf(lineData.getUnitOfMeasure()));
                line.setLineCost(lineData.getLineCost());
                
                // Set timestamps
                if (lineData.getCreatedAt() != null && !lineData.getCreatedAt().isBlank()) {
                    try {
                        line.setCreatedAt(Instant.parse(lineData.getCreatedAt()));
                    } catch (Exception e) {
                        line.setCreatedAt(Instant.now());
                    }
                } else {
                    line.setCreatedAt(Instant.now());
                }
                
                if (lineData.getUpdatedAt() != null && !lineData.getUpdatedAt().isBlank()) {
                    try {
                        line.setUpdatedAt(Instant.parse(lineData.getUpdatedAt()));
                    } catch (Exception e) {
                        line.setUpdatedAt(Instant.now());
                    }
                } else {
                    line.setUpdatedAt(Instant.now());
                }
                
                ingredientLineRepository.save(line);
            }
        }
    }
    
    /**
     * Import system config (target food cost percentage).
     */
    private void importSystemConfig(UUID venueId, BigDecimal targetFoodCostPercentage) {
        SystemConfig config = systemConfigRepository.findById(venueId)
                .orElse(new SystemConfig(venueId, targetFoodCostPercentage));
        
        config.setTargetFoodCostPercentage(targetFoodCostPercentage);
        systemConfigRepository.save(config);
    }
}
