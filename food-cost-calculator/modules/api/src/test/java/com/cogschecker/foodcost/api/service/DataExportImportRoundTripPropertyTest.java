package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Ingredient;
import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.domain.RecipeIngredientLine;
import com.cogschecker.foodcost.api.domain.SystemConfig;
import com.cogschecker.foodcost.api.dto.VenueExportData;
import com.cogschecker.foodcost.api.repository.IngredientRepository;
import com.cogschecker.foodcost.api.repository.RecipeIngredientLineRepository;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.api.repository.SystemConfigRepository;
import com.cogschecker.foodcost.shared.UomEnum;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import net.jqwik.api.*;
import org.junit.jupiter.api.BeforeEach;
import org.mockito.ArgumentCaptor;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Property-based test for JSON export/import round-trip integrity.
 * 
 * **Property 18: JSON Export/Import Round-Trip Preserves All Data Exactly**
 * **Validates: Requirements 7.4, 7.5, 7.7**
 * 
 * Requirements 7.7: WHEN a user exports data and then imports that same exported file
 * on the same or a different instance of the application, THE System SHALL restore
 * all ingredients (all fields), all recipes (all fields and ingredient lines),
 * all menu selling prices, and the target threshold to values identical to those
 * present at the time of export.
 */
class DataExportImportRoundTripPropertyTest {
    
    /**
     * Property 18: JSON export/import round-trip preserves all data exactly.
     * 
     * Generate arbitrary full venue state; export to JSON; import; 
     * compare every field of every entity for exact equality.
     */
    @Property(tries = 500)
    @Label("P18: JSON export/import round-trip preserves all data exactly")
    void jsonExportImportRoundTripPreservesAllDataExactly(
            @ForAll("venueState") VenueState venueState) throws Exception {
        
        // Create ObjectMapper for this test iteration
        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.configure(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS, false);
        
        // ===== Phase 1: Export =====
        
        // Setup export mocks
        IngredientRepository exportIngredientRepo = mock(IngredientRepository.class);
        RecipeRepository exportRecipeRepo = mock(RecipeRepository.class);
        RecipeIngredientLineRepository exportLineRepo = mock(RecipeIngredientLineRepository.class);
        SystemConfigRepository exportConfigRepo = mock(SystemConfigRepository.class);
        
        when(exportIngredientRepo.findByVenueId(venueState.venueId))
            .thenReturn(venueState.ingredients);
        when(exportRecipeRepo.findByVenueId(venueState.venueId))
            .thenReturn(venueState.recipes);
        
        // Mock ingredient lines for each recipe
        for (Recipe recipe : venueState.recipes) {
            List<RecipeIngredientLine> linesForRecipe = venueState.ingredientLines.stream()
                .filter(line -> line.getRecipeId().equals(recipe.getId()))
                .collect(Collectors.toList());
            when(exportLineRepo.findByRecipeId(recipe.getId()))
                .thenReturn(linesForRecipe);
        }
        
        when(exportConfigRepo.findById(venueState.venueId))
            .thenReturn(Optional.of(venueState.systemConfig));
        
        // Export data
        DataExportService exportService = new DataExportService(
            exportIngredientRepo, exportRecipeRepo, exportLineRepo, exportConfigRepo);
        
        VenueExportData exportedData = exportService.export(venueState.venueId);
        
        // Convert to JSON string (simulating file save/load)
        String jsonString = objectMapper.writeValueAsString(exportedData);
        
        // ===== Phase 2: Import =====
        
        // Setup import mocks for a fresh venue (different UUID to simulate different instance)
        UUID importVenueId = UUID.randomUUID();
        
        IngredientRepository importIngredientRepo = mock(IngredientRepository.class);
        RecipeRepository importRecipeRepo = mock(RecipeRepository.class);
        RecipeIngredientLineRepository importLineRepo = mock(RecipeIngredientLineRepository.class);
        SystemConfigRepository importConfigRepo = mock(SystemConfigRepository.class);
        
        // Mock existing data (will be deleted)
        when(importRecipeRepo.findByVenueId(importVenueId))
            .thenReturn(Collections.emptyList());
        when(importConfigRepo.findById(importVenueId))
            .thenReturn(Optional.empty());
        
        // Capture saved entities
        ArgumentCaptor<Ingredient> ingredientCaptor = ArgumentCaptor.forClass(Ingredient.class);
        ArgumentCaptor<Recipe> recipeCaptor = ArgumentCaptor.forClass(Recipe.class);
        ArgumentCaptor<RecipeIngredientLine> lineCaptor = ArgumentCaptor.forClass(RecipeIngredientLine.class);
        ArgumentCaptor<SystemConfig> configCaptor = ArgumentCaptor.forClass(SystemConfig.class);
        
        when(importIngredientRepo.save(ingredientCaptor.capture()))
            .thenAnswer(inv -> inv.getArgument(0));
        when(importRecipeRepo.save(recipeCaptor.capture()))
            .thenAnswer(inv -> inv.getArgument(0));
        when(importLineRepo.save(lineCaptor.capture()))
            .thenAnswer(inv -> inv.getArgument(0));
        when(importConfigRepo.save(configCaptor.capture()))
            .thenAnswer(inv -> inv.getArgument(0));
        
        // Import data
        DataImportService importService = new DataImportService(
            importIngredientRepo, importRecipeRepo, importLineRepo, importConfigRepo, objectMapper);
        
        importService.importData(importVenueId, jsonString);
        
        // ===== Phase 3: Verify Round-Trip Integrity =====
        
        List<Ingredient> importedIngredients = ingredientCaptor.getAllValues();
        List<Recipe> importedRecipes = recipeCaptor.getAllValues();
        List<RecipeIngredientLine> importedLines = lineCaptor.getAllValues();
        List<SystemConfig> importedConfigs = configCaptor.getAllValues();
        
        // Verify counts match
        assertThat(importedIngredients)
            .as("Imported ingredient count should match exported count")
            .hasSize(venueState.ingredients.size());
        
        assertThat(importedRecipes)
            .as("Imported recipe count should match exported count")
            .hasSize(venueState.recipes.size());
        
        assertThat(importedLines)
            .as("Imported ingredient line count should match exported count")
            .hasSize(venueState.ingredientLines.size());
        
        assertThat(importedConfigs)
            .as("System config should be imported")
            .hasSize(1);
        
        // Build maps for comparison (by name since IDs will be regenerated)
        Map<String, Ingredient> originalIngredientsByName = venueState.ingredients.stream()
            .collect(Collectors.toMap(Ingredient::getName, i -> i));
        Map<String, Ingredient> importedIngredientsByName = importedIngredients.stream()
            .collect(Collectors.toMap(Ingredient::getName, i -> i));
        
        Map<String, Recipe> originalRecipesByName = venueState.recipes.stream()
            .collect(Collectors.toMap(Recipe::getName, r -> r));
        Map<String, Recipe> importedRecipesByName = importedRecipes.stream()
            .collect(Collectors.toMap(Recipe::getName, r -> r));
        
        // Verify all ingredient fields match (except venueId and IDs)
        for (String ingredientName : originalIngredientsByName.keySet()) {
            Ingredient original = originalIngredientsByName.get(ingredientName);
            Ingredient imported = importedIngredientsByName.get(ingredientName);
            
            assertThat(imported)
                .as("Imported ingredient '%s' should exist", ingredientName)
                .isNotNull();
            
            assertIngredientsEqualIgnoringIds(original, imported, ingredientName);
        }
        
        // Verify all recipe fields match (except venueId and IDs)
        for (String recipeName : originalRecipesByName.keySet()) {
            Recipe original = originalRecipesByName.get(recipeName);
            Recipe imported = importedRecipesByName.get(recipeName);
            
            assertThat(imported)
                .as("Imported recipe '%s' should exist", recipeName)
                .isNotNull();
            
            assertRecipesEqualIgnoringIds(original, imported, recipeName);
        }
        
        // Verify ingredient lines match (by comparing recipe and ingredient names)
        Map<UUID, String> originalRecipeIdToName = venueState.recipes.stream()
            .collect(Collectors.toMap(Recipe::getId, Recipe::getName));
        Map<UUID, String> originalIngredientIdToName = venueState.ingredients.stream()
            .collect(Collectors.toMap(Ingredient::getId, Ingredient::getName));
        
        Map<String, Recipe> importedRecipesByNameMap = importedRecipes.stream()
            .collect(Collectors.toMap(Recipe::getName, r -> r));
        Map<String, Ingredient> importedIngredientsByNameMap = importedIngredients.stream()
            .collect(Collectors.toMap(Ingredient::getName, i -> i));
        
        // Group original lines by recipe name
        Map<String, List<RecipeIngredientLine>> originalLinesByRecipeName = new HashMap<>();
        for (RecipeIngredientLine line : venueState.ingredientLines) {
            String recipeName = originalRecipeIdToName.get(line.getRecipeId());
            originalLinesByRecipeName.computeIfAbsent(recipeName, k -> new ArrayList<>()).add(line);
        }
        
        // Group imported lines by recipe ID (then convert to recipe name)
        Map<UUID, List<RecipeIngredientLine>> importedLinesByRecipeId = importedLines.stream()
            .collect(Collectors.groupingBy(RecipeIngredientLine::getRecipeId));
        
        // Verify lines for each recipe
        for (String recipeName : originalLinesByRecipeName.keySet()) {
            List<RecipeIngredientLine> originalLines = originalLinesByRecipeName.get(recipeName);
            Recipe importedRecipe = importedRecipesByNameMap.get(recipeName);
            List<RecipeIngredientLine> importedLinesForRecipe = 
                importedLinesByRecipeId.getOrDefault(importedRecipe.getId(), Collections.emptyList());
            
            assertThat(importedLinesForRecipe)
                .as("Imported line count for recipe '%s' should match", recipeName)
                .hasSize(originalLines.size());
            
            // Sort both lists by quantity and UOM for stable comparison
            List<RecipeIngredientLine> sortedOriginal = new ArrayList<>(originalLines);
            sortedOriginal.sort(Comparator
                .comparing(RecipeIngredientLine::getQuantityUsed)
                .thenComparing(l -> l.getUnitOfMeasure().name()));
            
            List<RecipeIngredientLine> sortedImported = new ArrayList<>(importedLinesForRecipe);
            sortedImported.sort(Comparator
                .comparing(RecipeIngredientLine::getQuantityUsed)
                .thenComparing(l -> l.getUnitOfMeasure().name()));
            
            for (int i = 0; i < sortedOriginal.size(); i++) {
                RecipeIngredientLine originalLine = sortedOriginal.get(i);
                RecipeIngredientLine importedLine = sortedImported.get(i);
                
                assertIngredientLinesEqualIgnoringIds(
                    originalLine, importedLine, recipeName, i,
                    originalIngredientIdToName, originalRecipeIdToName,
                    importedIngredientsByNameMap, importedRecipesByNameMap);
            }
        }
        
        // Verify system config matches
        SystemConfig originalConfig = venueState.systemConfig;
        SystemConfig importedConfig = importedConfigs.get(0);
        
        assertThat(importedConfig.getTargetFoodCostPercentage())
            .as("Imported target food cost percentage should match")
            .isEqualByComparingTo(originalConfig.getTargetFoodCostPercentage());
    }
    
    /**
     * Assert that two ingredients are equal, ignoring venue ID and entity IDs.
     */
    private void assertIngredientsEqualIgnoringIds(Ingredient original, Ingredient imported, String name) {
        assertThat(imported.getName())
            .as("Ingredient '%s' name should match", name)
            .isEqualTo(original.getName());
        
        assertThat(imported.getPurchasePrice())
            .as("Ingredient '%s' purchase price should match", name)
            .isEqualByComparingTo(original.getPurchasePrice());
        
        assertThat(imported.getPurchaseQuantity())
            .as("Ingredient '%s' purchase quantity should match", name)
            .isEqualByComparingTo(original.getPurchaseQuantity());
        
        assertThat(imported.getUnitOfMeasure())
            .as("Ingredient '%s' unit of measure should match", name)
            .isEqualTo(original.getUnitOfMeasure());
        
        assertThat(imported.getYieldPercentage())
            .as("Ingredient '%s' yield percentage should match", name)
            .isEqualByComparingTo(original.getYieldPercentage());
        
        assertThat(imported.getCostPerUnit())
            .as("Ingredient '%s' cost per unit should match", name)
            .isEqualByComparingTo(original.getCostPerUnit());
        
        assertThat(imported.getEffectiveCostPerUsableUnit())
            .as("Ingredient '%s' effective cost per usable unit should match", name)
            .isEqualByComparingTo(original.getEffectiveCostPerUsableUnit());
        
        // Timestamps should be preserved through export/import
        assertThat(imported.getCreatedAt())
            .as("Ingredient '%s' created timestamp should match", name)
            .isEqualTo(original.getCreatedAt());
        
        assertThat(imported.getUpdatedAt())
            .as("Ingredient '%s' updated timestamp should match", name)
            .isEqualTo(original.getUpdatedAt());
    }
    
    /**
     * Assert that two recipes are equal, ignoring venue ID and entity IDs.
     */
    private void assertRecipesEqualIgnoringIds(Recipe original, Recipe imported, String name) {
        assertThat(imported.getName())
            .as("Recipe '%s' name should match", name)
            .isEqualTo(original.getName());
        
        assertThat(imported.getPortionCount())
            .as("Recipe '%s' portion count should match", name)
            .isEqualTo(original.getPortionCount());
        
        // Handle nullable menu selling price
        if (original.getMenuSellingPrice() == null) {
            assertThat(imported.getMenuSellingPrice())
                .as("Recipe '%s' menu selling price should be null", name)
                .isNull();
        } else {
            assertThat(imported.getMenuSellingPrice())
                .as("Recipe '%s' menu selling price should match", name)
                .isNotNull()
                .isEqualByComparingTo(original.getMenuSellingPrice());
        }
        
        // Handle nullable total batch cost
        if (original.getTotalBatchCost() == null) {
            assertThat(imported.getTotalBatchCost())
                .as("Recipe '%s' total batch cost should be null", name)
                .isNull();
        } else {
            assertThat(imported.getTotalBatchCost())
                .as("Recipe '%s' total batch cost should match", name)
                .isNotNull()
                .isEqualByComparingTo(original.getTotalBatchCost());
        }
        
        // Handle nullable food cost per portion
        if (original.getFoodCostPerPortion() == null) {
            assertThat(imported.getFoodCostPerPortion())
                .as("Recipe '%s' food cost per portion should be null", name)
                .isNull();
        } else {
            assertThat(imported.getFoodCostPerPortion())
                .as("Recipe '%s' food cost per portion should match", name)
                .isNotNull()
                .isEqualByComparingTo(original.getFoodCostPerPortion());
        }
        
        // Handle nullable food cost percentage
        if (original.getFoodCostPercentage() == null) {
            assertThat(imported.getFoodCostPercentage())
                .as("Recipe '%s' food cost percentage should be null", name)
                .isNull();
        } else {
            assertThat(imported.getFoodCostPercentage())
                .as("Recipe '%s' food cost percentage should match", name)
                .isNotNull()
                .isEqualByComparingTo(original.getFoodCostPercentage());
        }
        
        // Timestamps should be preserved through export/import
        assertThat(imported.getCreatedAt())
            .as("Recipe '%s' created timestamp should match", name)
            .isEqualTo(original.getCreatedAt());
        
        assertThat(imported.getUpdatedAt())
            .as("Recipe '%s' updated timestamp should match", name)
            .isEqualTo(original.getUpdatedAt());
    }
    
    /**
     * Assert that two ingredient lines are equal, ignoring IDs.
     */
    private void assertIngredientLinesEqualIgnoringIds(
            RecipeIngredientLine original, RecipeIngredientLine imported,
            String recipeName, int lineIndex,
            Map<UUID, String> originalIngredientIdToName,
            Map<UUID, String> originalRecipeIdToName,
            Map<String, Ingredient> importedIngredientsByName,
            Map<String, Recipe> importedRecipesByName) {
        
        String context = String.format("Recipe '%s' line %d", recipeName, lineIndex);
        
        // Check ingredient reference (if present)
        if (original.getIngredientId() != null) {
            String ingredientName = originalIngredientIdToName.get(original.getIngredientId());
            Ingredient importedIngredient = importedIngredientsByName.get(ingredientName);
            
            assertThat(imported.getIngredientId())
                .as("%s should reference ingredient '%s'", context, ingredientName)
                .isNotNull()
                .isEqualTo(importedIngredient.getId());
        } else {
            assertThat(imported.getIngredientId())
                .as("%s should not have ingredient ID", context)
                .isNull();
        }
        
        // Check sub-recipe reference (if present)
        if (original.getSubRecipeId() != null) {
            String subRecipeName = originalRecipeIdToName.get(original.getSubRecipeId());
            Recipe importedSubRecipe = importedRecipesByName.get(subRecipeName);
            
            assertThat(imported.getSubRecipeId())
                .as("%s should reference sub-recipe '%s'", context, subRecipeName)
                .isNotNull()
                .isEqualTo(importedSubRecipe.getId());
        } else {
            assertThat(imported.getSubRecipeId())
                .as("%s should not have sub-recipe ID", context)
                .isNull();
        }
        
        assertThat(imported.getQuantityUsed())
            .as("%s quantity used should match", context)
            .isEqualByComparingTo(original.getQuantityUsed());
        
        assertThat(imported.getUnitOfMeasure())
            .as("%s unit of measure should match", context)
            .isEqualTo(original.getUnitOfMeasure());
        
        // Handle nullable line cost
        if (original.getLineCost() == null) {
            assertThat(imported.getLineCost())
                .as("%s line cost should be null", context)
                .isNull();
        } else {
            assertThat(imported.getLineCost())
                .as("%s line cost should match", context)
                .isNotNull()
                .isEqualByComparingTo(original.getLineCost());
        }
        
        // Timestamps should be preserved through export/import
        assertThat(imported.getCreatedAt())
            .as("%s created timestamp should match", context)
            .isEqualTo(original.getCreatedAt());
        
        assertThat(imported.getUpdatedAt())
            .as("%s updated timestamp should match", context)
            .isEqualTo(original.getUpdatedAt());
    }
    
    /**
     * Arbitrary generator for complete venue state.
     * Generates ingredients, recipes (with ingredient lines), and system config.
     */
    @Provide
    Arbitrary<VenueState> venueState() {
        return Combinators.combine(
            Arbitraries.integers().between(1, 10),  // Number of ingredients
            Arbitraries.integers().between(1, 10),  // Number of recipes
            Arbitraries.bigDecimals()              // Target food cost percentage
                .between(BigDecimal.ONE, new BigDecimal("100.0"))
                .ofScale(1)
        ).flatAs((ingredientCount, recipeCount, targetPercentage) -> {
            UUID venueId = UUID.randomUUID();
            
            // Generate ingredients
            List<Arbitrary<Ingredient>> ingredientArbitraries = new ArrayList<>();
            for (int i = 0; i < ingredientCount; i++) {
                ingredientArbitraries.add(ingredientArbitrary(venueId, i));
            }
            
            return Combinators.combine(ingredientArbitraries)
                .as(ingredients -> {
                    List<Ingredient> ingredientList = new ArrayList<>(ingredients);
                    
                    // Generate recipes with ingredient lines
                    List<Recipe> recipes = new ArrayList<>();
                    List<RecipeIngredientLine> allLines = new ArrayList<>();
                    
                    for (int i = 0; i < recipeCount; i++) {
                        Recipe recipe = createRecipe(venueId, i);
                        recipes.add(recipe);
                        
                        // Generate 1-5 ingredient lines per recipe
                        int lineCount = Math.min(1 + (i % 5), ingredientList.size());
                        for (int j = 0; j < lineCount; j++) {
                            Ingredient ingredient = ingredientList.get(j % ingredientList.size());
                            RecipeIngredientLine line = createIngredientLine(recipe.getId(), ingredient);
                            allLines.add(line);
                        }
                    }
                    
                    SystemConfig config = new SystemConfig(venueId, targetPercentage);
                    
                    return new VenueState(venueId, ingredientList, recipes, allLines, config);
                });
        });
    }
    
    /**
     * Generate an arbitrary ingredient.
     */
    @Provide
    Arbitrary<Ingredient> ingredientArbitrary(UUID venueId, int index) {
        return Combinators.combine(
            Arbitraries.bigDecimals()
                .between(new BigDecimal("0.01"), new BigDecimal("999.99"))
                .ofScale(2),
            Arbitraries.bigDecimals()
                .between(new BigDecimal("0.01"), new BigDecimal("100.00"))
                .ofScale(4),
            Arbitraries.of(UomEnum.values()),
            Arbitraries.bigDecimals()
                .between(BigDecimal.ONE, new BigDecimal("100.00"))
                .ofScale(2)
        ).as((purchasePrice, purchaseQuantity, uom, yieldPercentage) -> {
            Ingredient ingredient = new Ingredient();
            ingredient.setId(UUID.randomUUID());
            ingredient.setVenueId(venueId);
            ingredient.setName("Ingredient " + index + " " + UUID.randomUUID().toString().substring(0, 8));
            ingredient.setPurchasePrice(purchasePrice);
            ingredient.setPurchaseQuantity(purchaseQuantity);
            ingredient.setUnitOfMeasure(uom);
            ingredient.setYieldPercentage(yieldPercentage);
            
            // Calculate derived fields
            BigDecimal costPerUnit = purchasePrice.divide(purchaseQuantity, 4, RoundingMode.HALF_UP);
            ingredient.setCostPerUnit(costPerUnit);
            
            BigDecimal yieldFactor = yieldPercentage.divide(new BigDecimal("100"), 4, RoundingMode.HALF_UP);
            BigDecimal effectiveCost = costPerUnit.divide(yieldFactor, 4, RoundingMode.HALF_UP);
            ingredient.setEffectiveCostPerUsableUnit(effectiveCost);
            
            ingredient.setCreatedAt(Instant.now().minusSeconds(3600));
            ingredient.setUpdatedAt(Instant.now().minusSeconds(1800));
            
            return ingredient;
        });
    }
    
    /**
     * Create a recipe with calculated costs.
     */
    private Recipe createRecipe(UUID venueId, int index) {
        Recipe recipe = new Recipe();
        recipe.setId(UUID.randomUUID());
        recipe.setVenueId(venueId);
        recipe.setName("Recipe " + index + " " + UUID.randomUUID().toString().substring(0, 8));
        recipe.setPortionCount(1 + (index % 10));
        
        // Generate menu price (50% of recipes have a price)
        if (index % 2 == 0) {
            BigDecimal menuPrice = new BigDecimal("10.00").add(new BigDecimal(index));
            recipe.setMenuSellingPrice(menuPrice);
        }
        
        // Set some computed costs (these would normally be calculated by the service)
        BigDecimal batchCost = new BigDecimal("5.50").add(new BigDecimal(index * 0.5));
        recipe.setTotalBatchCost(batchCost.setScale(2, RoundingMode.HALF_UP));
        
        BigDecimal costPerPortion = batchCost.divide(
            new BigDecimal(recipe.getPortionCount()), 2, RoundingMode.HALF_UP);
        recipe.setFoodCostPerPortion(costPerPortion);
        
        if (recipe.getMenuSellingPrice() != null) {
            BigDecimal percentage = costPerPortion
                .divide(recipe.getMenuSellingPrice(), 3, RoundingMode.HALF_UP)
                .multiply(new BigDecimal("100"))
                .setScale(1, RoundingMode.HALF_UP);
            recipe.setFoodCostPercentage(percentage);
        }
        
        recipe.setCreatedAt(Instant.now().minusSeconds(3600));
        recipe.setUpdatedAt(Instant.now().minusSeconds(1800));
        
        return recipe;
    }
    
    /**
     * Create an ingredient line referencing an ingredient.
     */
    private RecipeIngredientLine createIngredientLine(UUID recipeId, Ingredient ingredient) {
        RecipeIngredientLine line = new RecipeIngredientLine();
        line.setId(UUID.randomUUID());
        line.setRecipeId(recipeId);
        line.setIngredientId(ingredient.getId());
        line.setSubRecipeId(null);
        
        BigDecimal quantity = new BigDecimal("0.5000");
        line.setQuantityUsed(quantity);
        line.setUnitOfMeasure(ingredient.getUnitOfMeasure());
        
        BigDecimal lineCost = quantity.multiply(ingredient.getEffectiveCostPerUsableUnit())
            .setScale(4, RoundingMode.HALF_UP);
        line.setLineCost(lineCost);
        
        line.setCreatedAt(Instant.now().minusSeconds(3600));
        line.setUpdatedAt(Instant.now().minusSeconds(1800));
        
        return line;
    }
    
    /**
     * Helper class to hold complete venue state.
     */
    private static class VenueState {
        final UUID venueId;
        final List<Ingredient> ingredients;
        final List<Recipe> recipes;
        final List<RecipeIngredientLine> ingredientLines;
        final SystemConfig systemConfig;
        
        VenueState(UUID venueId, List<Ingredient> ingredients, List<Recipe> recipes,
                   List<RecipeIngredientLine> ingredientLines, SystemConfig systemConfig) {
            this.venueId = venueId;
            this.ingredients = ingredients;
            this.recipes = recipes;
            this.ingredientLines = ingredientLines;
            this.systemConfig = systemConfig;
        }
    }
}
