package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Ingredient;
import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.domain.RecipeIngredientLine;
import com.cogschecker.foodcost.api.exception.ValidationException;
import com.cogschecker.foodcost.api.repository.IngredientRepository;
import com.cogschecker.foodcost.api.repository.RecipeIngredientLineRepository;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.shared.UomEnum;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Unit tests for CostingService.
 * Validates Requirements 3.1, 3.2, 3.4, 3.5, 3.6, 3.7
 */
@ExtendWith(MockitoExtension.class)
class CostingServiceTest {
    
    @Mock
    private RecipeIngredientLineRepository recipeIngredientLineRepository;
    
    @Mock
    private IngredientRepository ingredientRepository;
    
    @Mock
    private RecipeRepository recipeRepository;
    
    private CostingService costingService;
    
    @BeforeEach
    void setUp() {
        costingService = new CostingService(
            recipeIngredientLineRepository,
            ingredientRepository,
            recipeRepository
        );
    }
    
    @Test
    void testCalculateBatchCost_withSingleIngredient_sameUom() {
        // Requirement 3.1: Calculate batch cost with UOM conversion
        UUID venueId = UUID.randomUUID();
        UUID recipeId = UUID.randomUUID();
        UUID ingredientId = UUID.randomUUID();
        
        Recipe recipe = new Recipe();
        recipe.setId(recipeId);
        recipe.setVenueId(venueId);
        recipe.setPortionCount(4);
        
        Ingredient ingredient = new Ingredient();
        ingredient.setId(ingredientId);
        ingredient.setVenueId(venueId);
        ingredient.setName("Flour");
        ingredient.setUnitOfMeasure(UomEnum.GRAM);
        ingredient.setEffectiveCostPerUsableUnit(new BigDecimal("0.0050")); // $0.005 per gram
        
        RecipeIngredientLine line = new RecipeIngredientLine();
        line.setId(UUID.randomUUID());
        line.setRecipeId(recipeId);
        line.setIngredientId(ingredientId);
        line.setQuantityUsed(new BigDecimal("200")); // 200 grams
        line.setUnitOfMeasure(UomEnum.GRAM);
        
        when(recipeIngredientLineRepository.findByRecipeId(recipeId))
            .thenReturn(List.of(line));
        when(ingredientRepository.findById(ingredientId))
            .thenReturn(Optional.of(ingredient));
        
        CostingService.BatchCostResult result = costingService.calculateBatchCost(recipe);
        
        // 200 grams * $0.005/gram = $1.00
        assertEquals(new BigDecimal("1.0000"), result.getTotalBatchCost());
        // $1.00 / 4 portions = $0.25
        assertEquals(new BigDecimal("0.25"), result.getFoodCostPerPortion());
        assertFalse(result.isMissingPrice());
        assertFalse(result.isIncomplete());
    }
    
    @Test
    void testCalculateBatchCost_withUomConversion() {
        // Requirement 3.1: Apply UOM conversion
        UUID venueId = UUID.randomUUID();
        UUID recipeId = UUID.randomUUID();
        UUID ingredientId = UUID.randomUUID();
        
        Recipe recipe = new Recipe();
        recipe.setId(recipeId);
        recipe.setVenueId(venueId);
        recipe.setPortionCount(2);
        
        Ingredient ingredient = new Ingredient();
        ingredient.setId(ingredientId);
        ingredient.setVenueId(venueId);
        ingredient.setName("Sugar");
        ingredient.setUnitOfMeasure(UomEnum.KILOGRAM);
        ingredient.setEffectiveCostPerUsableUnit(new BigDecimal("2.5000")); // $2.50 per kg
        
        RecipeIngredientLine line = new RecipeIngredientLine();
        line.setId(UUID.randomUUID());
        line.setRecipeId(recipeId);
        line.setIngredientId(ingredientId);
        line.setQuantityUsed(new BigDecimal("500")); // 500 grams
        line.setUnitOfMeasure(UomEnum.GRAM); // Different from ingredient UOM
        
        when(recipeIngredientLineRepository.findByRecipeId(recipeId))
            .thenReturn(List.of(line));
        when(ingredientRepository.findById(ingredientId))
            .thenReturn(Optional.of(ingredient));
        
        CostingService.BatchCostResult result = costingService.calculateBatchCost(recipe);
        
        // 500g = 0.5kg, 0.5kg * $2.50/kg = $1.25
        assertEquals(new BigDecimal("1.2500"), result.getTotalBatchCost());
        // $1.25 / 2 portions = $0.62 (rounds to 0.62, not 0.63)
        assertEquals(new BigDecimal("0.62"), result.getFoodCostPerPortion());
        assertFalse(result.isMissingPrice());
        assertFalse(result.isIncomplete());
    }
    
    @Test
    void testCalculateBatchCost_withSubRecipe() {
        // Requirement 3.4: Handle sub-recipe lines using sub-recipe's food_cost_per_portion
        UUID venueId = UUID.randomUUID();
        UUID parentRecipeId = UUID.randomUUID();
        UUID subRecipeId = UUID.randomUUID();
        
        Recipe parentRecipe = new Recipe();
        parentRecipe.setId(parentRecipeId);
        parentRecipe.setVenueId(venueId);
        parentRecipe.setPortionCount(4);
        
        Recipe subRecipe = new Recipe();
        subRecipe.setId(subRecipeId);
        subRecipe.setVenueId(venueId);
        subRecipe.setFoodCostPerPortion(new BigDecimal("3.50")); // $3.50 per portion
        
        RecipeIngredientLine line = new RecipeIngredientLine();
        line.setId(UUID.randomUUID());
        line.setRecipeId(parentRecipeId);
        line.setSubRecipeId(subRecipeId);
        line.setQuantityUsed(new BigDecimal("2")); // 2 portions of sub-recipe
        line.setUnitOfMeasure(UomEnum.EACH);
        
        when(recipeIngredientLineRepository.findByRecipeId(parentRecipeId))
            .thenReturn(List.of(line));
        when(recipeRepository.findById(subRecipeId))
            .thenReturn(Optional.of(subRecipe));
        
        CostingService.BatchCostResult result = costingService.calculateBatchCost(parentRecipe);
        
        // 2 portions * $3.50/portion = $7.00
        assertEquals(new BigDecimal("7.0000"), result.getTotalBatchCost());
        // $7.00 / 4 portions = $1.75
        assertEquals(new BigDecimal("1.75"), result.getFoodCostPerPortion());
        assertFalse(result.isMissingPrice());
        assertFalse(result.isIncomplete());
    }
    
    @Test
    void testCalculateBatchCost_withMissingIngredientPrice() {
        // Requirement 3.6: Flag ingredient with missing price, exclude from total
        UUID venueId = UUID.randomUUID();
        UUID recipeId = UUID.randomUUID();
        UUID ingredientId = UUID.randomUUID();
        
        Recipe recipe = new Recipe();
        recipe.setId(recipeId);
        recipe.setVenueId(venueId);
        recipe.setPortionCount(1);
        
        Ingredient ingredient = new Ingredient();
        ingredient.setId(ingredientId);
        ingredient.setVenueId(venueId);
        ingredient.setName("Expensive Spice");
        ingredient.setUnitOfMeasure(UomEnum.GRAM);
        ingredient.setEffectiveCostPerUsableUnit(null); // Missing price
        
        RecipeIngredientLine line = new RecipeIngredientLine();
        line.setId(UUID.randomUUID());
        line.setRecipeId(recipeId);
        line.setIngredientId(ingredientId);
        line.setQuantityUsed(new BigDecimal("10"));
        line.setUnitOfMeasure(UomEnum.GRAM);
        
        when(recipeIngredientLineRepository.findByRecipeId(recipeId))
            .thenReturn(List.of(line));
        when(ingredientRepository.findById(ingredientId))
            .thenReturn(Optional.of(ingredient));
        
        CostingService.BatchCostResult result = costingService.calculateBatchCost(recipe);
        
        // Line excluded from sum
        assertEquals(BigDecimal.ZERO, result.getTotalBatchCost());
        assertTrue(result.isMissingPrice());
        assertTrue(result.isIncomplete()); // All lines missing price
    }
    
    @Test
    void testCalculateBatchCost_withAllLinesMissingPrice() {
        // Requirement 3.7: If all lines missing price, return incomplete
        UUID venueId = UUID.randomUUID();
        UUID recipeId = UUID.randomUUID();
        UUID ingredient1Id = UUID.randomUUID();
        UUID ingredient2Id = UUID.randomUUID();
        
        Recipe recipe = new Recipe();
        recipe.setId(recipeId);
        recipe.setVenueId(venueId);
        recipe.setPortionCount(2);
        
        Ingredient ingredient1 = new Ingredient();
        ingredient1.setId(ingredient1Id);
        ingredient1.setEffectiveCostPerUsableUnit(null);
        ingredient1.setUnitOfMeasure(UomEnum.GRAM);
        
        Ingredient ingredient2 = new Ingredient();
        ingredient2.setId(ingredient2Id);
        ingredient2.setEffectiveCostPerUsableUnit(null);
        ingredient2.setUnitOfMeasure(UomEnum.MILLILITRE);
        
        RecipeIngredientLine line1 = new RecipeIngredientLine();
        line1.setId(UUID.randomUUID());
        line1.setRecipeId(recipeId);
        line1.setIngredientId(ingredient1Id);
        line1.setQuantityUsed(new BigDecimal("100"));
        line1.setUnitOfMeasure(UomEnum.GRAM);
        
        RecipeIngredientLine line2 = new RecipeIngredientLine();
        line2.setId(UUID.randomUUID());
        line2.setRecipeId(recipeId);
        line2.setIngredientId(ingredient2Id);
        line2.setQuantityUsed(new BigDecimal("50"));
        line2.setUnitOfMeasure(UomEnum.MILLILITRE);
        
        when(recipeIngredientLineRepository.findByRecipeId(recipeId))
            .thenReturn(List.of(line1, line2));
        when(ingredientRepository.findById(ingredient1Id))
            .thenReturn(Optional.of(ingredient1));
        when(ingredientRepository.findById(ingredient2Id))
            .thenReturn(Optional.of(ingredient2));
        
        CostingService.BatchCostResult result = costingService.calculateBatchCost(recipe);
        
        assertEquals(BigDecimal.ZERO, result.getTotalBatchCost());
        assertNull(result.getFoodCostPerPortion());
        assertTrue(result.isMissingPrice());
        assertTrue(result.isIncomplete());
    }
    
    @Test
    void testCalculateBatchCost_withSomeMissingPrices() {
        // Requirement 3.6: Some lines missing, others included
        UUID venueId = UUID.randomUUID();
        UUID recipeId = UUID.randomUUID();
        UUID ingredient1Id = UUID.randomUUID();
        UUID ingredient2Id = UUID.randomUUID();
        
        Recipe recipe = new Recipe();
        recipe.setId(recipeId);
        recipe.setVenueId(venueId);
        recipe.setPortionCount(2);
        
        Ingredient ingredient1 = new Ingredient();
        ingredient1.setId(ingredient1Id);
        ingredient1.setEffectiveCostPerUsableUnit(new BigDecimal("0.10"));
        ingredient1.setUnitOfMeasure(UomEnum.GRAM);
        
        Ingredient ingredient2 = new Ingredient();
        ingredient2.setId(ingredient2Id);
        ingredient2.setEffectiveCostPerUsableUnit(null); // Missing
        ingredient2.setUnitOfMeasure(UomEnum.MILLILITRE);
        
        RecipeIngredientLine line1 = new RecipeIngredientLine();
        line1.setId(UUID.randomUUID());
        line1.setRecipeId(recipeId);
        line1.setIngredientId(ingredient1Id);
        line1.setQuantityUsed(new BigDecimal("100"));
        line1.setUnitOfMeasure(UomEnum.GRAM);
        
        RecipeIngredientLine line2 = new RecipeIngredientLine();
        line2.setId(UUID.randomUUID());
        line2.setRecipeId(recipeId);
        line2.setIngredientId(ingredient2Id);
        line2.setQuantityUsed(new BigDecimal("50"));
        line2.setUnitOfMeasure(UomEnum.MILLILITRE);
        
        when(recipeIngredientLineRepository.findByRecipeId(recipeId))
            .thenReturn(List.of(line1, line2));
        when(ingredientRepository.findById(ingredient1Id))
            .thenReturn(Optional.of(ingredient1));
        when(ingredientRepository.findById(ingredient2Id))
            .thenReturn(Optional.of(ingredient2));
        
        CostingService.BatchCostResult result = costingService.calculateBatchCost(recipe);
        
        // Only line1 included: 100 * 0.10 = 10.00
        assertEquals(new BigDecimal("10.0000"), result.getTotalBatchCost());
        assertEquals(new BigDecimal("5.00"), result.getFoodCostPerPortion());
        assertTrue(result.isMissingPrice());
        assertFalse(result.isIncomplete()); // At least one line has price
    }
    
    @Test
    void testCalculateBatchCost_withIncompatibleUom_throwsValidationException() {
        // Catch IncompatibleUomException and surface as 422
        UUID venueId = UUID.randomUUID();
        UUID recipeId = UUID.randomUUID();
        UUID ingredientId = UUID.randomUUID();
        
        Recipe recipe = new Recipe();
        recipe.setId(recipeId);
        recipe.setVenueId(venueId);
        recipe.setPortionCount(1);
        
        Ingredient ingredient = new Ingredient();
        ingredient.setId(ingredientId);
        ingredient.setUnitOfMeasure(UomEnum.GRAM); // Weight
        ingredient.setEffectiveCostPerUsableUnit(new BigDecimal("1.00"));
        
        RecipeIngredientLine line = new RecipeIngredientLine();
        line.setId(UUID.randomUUID());
        line.setRecipeId(recipeId);
        line.setIngredientId(ingredientId);
        line.setQuantityUsed(new BigDecimal("100"));
        line.setUnitOfMeasure(UomEnum.MILLILITRE); // Volume - incompatible!
        
        when(recipeIngredientLineRepository.findByRecipeId(recipeId))
            .thenReturn(List.of(line));
        when(ingredientRepository.findById(ingredientId))
            .thenReturn(Optional.of(ingredient));
        
        ValidationException exception = assertThrows(
            ValidationException.class,
            () -> costingService.calculateBatchCost(recipe)
        );
        
        assertEquals("INCOMPATIBLE_UOM", exception.getErrorCode());
        assertTrue(exception.getMessage().contains("Cannot convert units"));
    }
    
    @Test
    void testCalculateBatchCost_withEmptyRecipe() {
        // Empty recipe should return zero cost
        UUID venueId = UUID.randomUUID();
        UUID recipeId = UUID.randomUUID();
        
        Recipe recipe = new Recipe();
        recipe.setId(recipeId);
        recipe.setVenueId(venueId);
        recipe.setPortionCount(1);
        
        when(recipeIngredientLineRepository.findByRecipeId(recipeId))
            .thenReturn(new ArrayList<>());
        
        CostingService.BatchCostResult result = costingService.calculateBatchCost(recipe);
        
        assertEquals(BigDecimal.ZERO, result.getTotalBatchCost());
        assertEquals(BigDecimal.ZERO, result.getFoodCostPerPortion());
        assertFalse(result.isMissingPrice());
        assertFalse(result.isIncomplete());
    }
    
    @Test
    void testCalculateBatchCost_withSubRecipeMissingCost() {
        // Requirement 3.6: Sub-recipe with null food_cost_per_portion treated as missing
        UUID venueId = UUID.randomUUID();
        UUID parentRecipeId = UUID.randomUUID();
        UUID subRecipeId = UUID.randomUUID();
        
        Recipe parentRecipe = new Recipe();
        parentRecipe.setId(parentRecipeId);
        parentRecipe.setVenueId(venueId);
        parentRecipe.setPortionCount(1);
        
        Recipe subRecipe = new Recipe();
        subRecipe.setId(subRecipeId);
        subRecipe.setVenueId(venueId);
        subRecipe.setFoodCostPerPortion(null); // Missing cost
        
        RecipeIngredientLine line = new RecipeIngredientLine();
        line.setId(UUID.randomUUID());
        line.setRecipeId(parentRecipeId);
        line.setSubRecipeId(subRecipeId);
        line.setQuantityUsed(new BigDecimal("1"));
        line.setUnitOfMeasure(UomEnum.EACH);
        
        when(recipeIngredientLineRepository.findByRecipeId(parentRecipeId))
            .thenReturn(List.of(line));
        when(recipeRepository.findById(subRecipeId))
            .thenReturn(Optional.of(subRecipe));
        
        CostingService.BatchCostResult result = costingService.calculateBatchCost(parentRecipe);
        
        assertEquals(BigDecimal.ZERO, result.getTotalBatchCost());
        assertTrue(result.isMissingPrice());
        assertTrue(result.isIncomplete());
    }
    
    // Tests for calculateFoodCostPercentage (Requirements 4.1, 4.2, 4.3)
    
    @Test
    void testCalculateFoodCostPercentage_withValidInputs() {
        // Requirement 4.2: Calculate (foodCostPerPortion / menuSellingPrice) × 100
        BigDecimal foodCostPerPortion = new BigDecimal("3.00");
        BigDecimal menuSellingPrice = new BigDecimal("10.00");
        
        BigDecimal percentage = costingService.calculateFoodCostPercentage(
            foodCostPerPortion, 
            menuSellingPrice
        );
        
        // 3.00 / 10.00 * 100 = 30.0
        assertEquals(new BigDecimal("30.0"), percentage);
    }
    
    @Test
    void testCalculateFoodCostPercentage_roundsToOneDecimalPlace() {
        // Requirement 4.2: Rounded to 1 decimal place
        BigDecimal foodCostPerPortion = new BigDecimal("3.33");
        BigDecimal menuSellingPrice = new BigDecimal("10.00");
        
        BigDecimal percentage = costingService.calculateFoodCostPercentage(
            foodCostPerPortion, 
            menuSellingPrice
        );
        
        // 3.33 / 10.00 * 100 = 33.3
        assertEquals(new BigDecimal("33.3"), percentage);
    }
    
    @Test
    void testCalculateFoodCostPercentage_roundsHalfUp() {
        // Requirement 4.2: Uses HALF_UP rounding mode
        BigDecimal foodCostPerPortion = new BigDecimal("3.35");
        BigDecimal menuSellingPrice = new BigDecimal("10.00");
        
        BigDecimal percentage = costingService.calculateFoodCostPercentage(
            foodCostPerPortion, 
            menuSellingPrice
        );
        
        // 3.35 / 10.00 * 100 = 33.5 (exactly)
        assertEquals(new BigDecimal("33.5"), percentage);
        
        // Test rounding up
        foodCostPerPortion = new BigDecimal("3.36");
        percentage = costingService.calculateFoodCostPercentage(
            foodCostPerPortion, 
            menuSellingPrice
        );
        
        // 3.36 / 10.00 * 100 = 33.6
        assertEquals(new BigDecimal("33.6"), percentage);
    }
    
    @Test
    void testCalculateFoodCostPercentage_withNullMenuSellingPrice() {
        // Requirement 4.3: Return null if menuSellingPrice is null
        BigDecimal foodCostPerPortion = new BigDecimal("3.00");
        BigDecimal menuSellingPrice = null;
        
        BigDecimal percentage = costingService.calculateFoodCostPercentage(
            foodCostPerPortion, 
            menuSellingPrice
        );
        
        assertNull(percentage);
    }
    
    @Test
    void testCalculateFoodCostPercentage_withZeroMenuSellingPrice() {
        // Requirement 4.3: Return null if menuSellingPrice is 0 (prevent division by zero)
        BigDecimal foodCostPerPortion = new BigDecimal("3.00");
        BigDecimal menuSellingPrice = BigDecimal.ZERO;
        
        BigDecimal percentage = costingService.calculateFoodCostPercentage(
            foodCostPerPortion, 
            menuSellingPrice
        );
        
        assertNull(percentage);
    }
    
    @Test
    void testCalculateFoodCostPercentage_withNullFoodCostPerPortion() {
        // Cannot calculate percentage if foodCostPerPortion is null
        BigDecimal foodCostPerPortion = null;
        BigDecimal menuSellingPrice = new BigDecimal("10.00");
        
        BigDecimal percentage = costingService.calculateFoodCostPercentage(
            foodCostPerPortion, 
            menuSellingPrice
        );
        
        assertNull(percentage);
    }
    
    @Test
    void testCalculateFoodCostPercentage_withBothNull() {
        // Both null should return null
        BigDecimal foodCostPerPortion = null;
        BigDecimal menuSellingPrice = null;
        
        BigDecimal percentage = costingService.calculateFoodCostPercentage(
            foodCostPerPortion, 
            menuSellingPrice
        );
        
        assertNull(percentage);
    }
    
    @Test
    void testCalculateFoodCostPercentage_withHighPercentage() {
        // Test when food cost is higher than selling price (> 100%)
        BigDecimal foodCostPerPortion = new BigDecimal("15.00");
        BigDecimal menuSellingPrice = new BigDecimal("10.00");
        
        BigDecimal percentage = costingService.calculateFoodCostPercentage(
            foodCostPerPortion, 
            menuSellingPrice
        );
        
        // 15.00 / 10.00 * 100 = 150.0
        assertEquals(new BigDecimal("150.0"), percentage);
    }
    
    @Test
    void testCalculateFoodCostPercentage_withZeroFoodCost() {
        // Zero food cost should return 0.0%
        BigDecimal foodCostPerPortion = BigDecimal.ZERO;
        BigDecimal menuSellingPrice = new BigDecimal("10.00");
        
        BigDecimal percentage = costingService.calculateFoodCostPercentage(
            foodCostPerPortion, 
            menuSellingPrice
        );
        
        assertEquals(new BigDecimal("0.0"), percentage);
    }
    
    @Test
    void testCalculateFoodCostPercentage_withVerySmallValues() {
        // Test precision with very small values
        BigDecimal foodCostPerPortion = new BigDecimal("0.01");
        BigDecimal menuSellingPrice = new BigDecimal("0.10");
        
        BigDecimal percentage = costingService.calculateFoodCostPercentage(
            foodCostPerPortion, 
            menuSellingPrice
        );
        
        // 0.01 / 0.10 * 100 = 10.0
        assertEquals(new BigDecimal("10.0"), percentage);
    }
}
