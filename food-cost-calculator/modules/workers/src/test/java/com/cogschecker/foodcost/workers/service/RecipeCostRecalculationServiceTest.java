package com.cogschecker.foodcost.workers.service;

import com.cogschecker.foodcost.api.domain.Ingredient;
import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.shared.UomEnum;
import com.cogschecker.foodcost.workers.repository.RecipeDependencyRepository;
import com.cogschecker.foodcost.workers.repository.WorkerIngredientRepository;
import com.cogschecker.foodcost.workers.repository.WorkerRecipeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Unit tests for RecipeCostRecalculationService.
 * <p>
 * Tests:
 * - Transitive dependency resolution
 * - Cost recalculation logic
 * - Dependency order (leaves first)
 * - Sub-recipe cost propagation
 * - Batch updates within transaction
 */
@ExtendWith(MockitoExtension.class)
class RecipeCostRecalculationServiceTest {

    @Mock
    private RecipeDependencyRepository recipeDependencyRepository;

    @Mock
    private WorkerRecipeRepository recipeRepository;

    @Mock
    private WorkerIngredientRepository ingredientRepository;

    private RecipeCostRecalculationService service;

    @BeforeEach
    void setUp() {
        service = new RecipeCostRecalculationService(
                recipeDependencyRepository,
                recipeRepository,
                ingredientRepository
        );
    }

    @Test
    void recalculateDependentRecipeCosts_noDependentRecipes_shouldReturnEmptyList() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        UUID ingredientId = UUID.randomUUID();
        
        when(recipeDependencyRepository.findAllDependentRecipeIds(ingredientId))
                .thenReturn(Collections.emptyList());
        
        // Act
        List<UUID> result = service.recalculateDependentRecipeCosts(venueId, ingredientId);
        
        // Assert
        assertTrue(result.isEmpty());
        verify(recipeRepository, never()).findById(any());
        verify(recipeRepository, never()).updateRecipeCosts(any(), any(), any(), any(), any());
    }

    @Test
    void recalculateDependentRecipeCosts_singleRecipeWithOneIngredient_shouldRecalculate() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        UUID ingredientId = UUID.randomUUID();
        UUID recipeId = UUID.randomUUID();
        
        // Mock dependency query
        when(recipeDependencyRepository.findAllDependentRecipeIds(ingredientId))
                .thenReturn(Collections.singletonList(recipeId));
        
        // Mock recipe
        Recipe recipe = new Recipe();
        recipe.setId(recipeId);
        recipe.setVenueId(venueId);
        recipe.setName("Test Recipe");
        recipe.setPortionCount(4);
        recipe.setMenuSellingPrice(new BigDecimal("20.00"));
        
        when(recipeRepository.findById(recipeId)).thenReturn(Optional.of(recipe));
        
        // Mock ingredient line data: [ingredientId, subRecipeId, quantityUsed, unitOfMeasure]
        Object[] ingredientLine = new Object[]{
                ingredientId.toString(),
                null,
                new BigDecimal("500"),
                "g"
        };
        when(recipeDependencyRepository.findIngredientLinesByRecipeId(recipeId))
                .thenReturn(Collections.singletonList(ingredientLine));
        
        // Mock ingredient
        Ingredient ingredient = new Ingredient();
        ingredient.setId(ingredientId);
        ingredient.setVenueId(venueId);
        ingredient.setName("Flour");
        ingredient.setUnitOfMeasure(UomEnum.GRAM);
        ingredient.setPurchasePrice(new BigDecimal("5.00"));
        ingredient.setPurchaseQuantity(new BigDecimal("1000"));
        ingredient.setYieldPercentage(new BigDecimal("100"));
        ingredient.setCostPerUnit(new BigDecimal("0.0050")); // 5.00 / 1000
        ingredient.setEffectiveCostPerUsableUnit(new BigDecimal("0.0050")); // 0.0050 / 1.00
        
        when(ingredientRepository.findById(ingredientId)).thenReturn(Optional.of(ingredient));
        
        // Act
        List<UUID> result = service.recalculateDependentRecipeCosts(venueId, ingredientId);
        
        // Assert
        assertEquals(1, result.size());
        assertEquals(recipeId, result.get(0));
        
        // Verify batch update was called with correct costs
        ArgumentCaptor<BigDecimal> batchCostCaptor = ArgumentCaptor.forClass(BigDecimal.class);
        ArgumentCaptor<BigDecimal> portionCostCaptor = ArgumentCaptor.forClass(BigDecimal.class);
        ArgumentCaptor<BigDecimal> percentageCaptor = ArgumentCaptor.forClass(BigDecimal.class);
        
        verify(recipeRepository).updateRecipeCosts(
                eq(recipeId),
                batchCostCaptor.capture(),
                portionCostCaptor.capture(),
                percentageCaptor.capture(),
                any(Instant.class)
        );
        
        // Total batch cost = 500g * 0.0050 = 2.50
        assertTrue(batchCostCaptor.getValue().compareTo(new BigDecimal("2.50")) == 0);
        
        // Food cost per portion = 2.50 / 4 = 0.62 (rounded to 2 d.p.)
        assertTrue(portionCostCaptor.getValue().compareTo(new BigDecimal("0.62")) == 0 ||
                   portionCostCaptor.getValue().compareTo(new BigDecimal("0.63")) == 0); // Allow for rounding
        
        // Food cost percentage = (0.62 / 20.00) * 100 = 3.1%
        assertTrue(percentageCaptor.getValue().compareTo(new BigDecimal("3.0")) >= 0 &&
                   percentageCaptor.getValue().compareTo(new BigDecimal("3.2")) <= 0);
    }

    @Test
    void recalculateDependentRecipeCosts_recipeWithSubRecipe_shouldUseSubRecipeCost() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        UUID ingredientId = UUID.randomUUID();
        UUID subRecipeId = UUID.randomUUID();
        UUID parentRecipeId = UUID.randomUUID();
        
        // Mock dependency query - sub-recipe first, then parent (leaves-first ordering)
        when(recipeDependencyRepository.findAllDependentRecipeIds(ingredientId))
                .thenReturn(Arrays.asList(subRecipeId, parentRecipeId));
        
        // Mock sub-recipe
        Recipe subRecipe = new Recipe();
        subRecipe.setId(subRecipeId);
        subRecipe.setVenueId(venueId);
        subRecipe.setName("Sub Recipe");
        subRecipe.setPortionCount(1);
        subRecipe.setFoodCostPerPortion(new BigDecimal("5.00")); // Initial cost
        
        when(recipeRepository.findById(subRecipeId)).thenReturn(Optional.of(subRecipe));
        
        // Mock sub-recipe ingredient line
        Object[] subRecipeIngredientLine = new Object[]{
                ingredientId.toString(),
                null,
                new BigDecimal("100"),
                "g"
        };
        when(recipeDependencyRepository.findIngredientLinesByRecipeId(subRecipeId))
                .thenReturn(Collections.singletonList(subRecipeIngredientLine));
        
        // Mock ingredient
        Ingredient ingredient = new Ingredient();
        ingredient.setId(ingredientId);
        ingredient.setVenueId(venueId);
        ingredient.setName("Sugar");
        ingredient.setUnitOfMeasure(UomEnum.GRAM);
        ingredient.setEffectiveCostPerUsableUnit(new BigDecimal("0.0100")); // $0.01 per gram
        
        when(ingredientRepository.findById(ingredientId)).thenReturn(Optional.of(ingredient));
        
        // Mock parent recipe
        Recipe parentRecipe = new Recipe();
        parentRecipe.setId(parentRecipeId);
        parentRecipe.setVenueId(venueId);
        parentRecipe.setName("Parent Recipe");
        parentRecipe.setPortionCount(2);
        
        when(recipeRepository.findById(parentRecipeId)).thenReturn(Optional.of(parentRecipe));
        
        // Mock parent recipe ingredient line - uses sub-recipe as ingredient
        Object[] parentIngredientLine = new Object[]{
                null,
                subRecipeId.toString(),
                new BigDecimal("3"), // 3 portions of sub-recipe
                "each"
        };
        when(recipeDependencyRepository.findIngredientLinesByRecipeId(parentRecipeId))
                .thenReturn(Collections.singletonList(parentIngredientLine));
        
        // Act
        List<UUID> result = service.recalculateDependentRecipeCosts(venueId, ingredientId);
        
        // Assert
        assertEquals(2, result.size());
        assertEquals(subRecipeId, result.get(0)); // Sub-recipe recalculated first
        assertEquals(parentRecipeId, result.get(1)); // Then parent
        
        // Verify sub-recipe update was called
        ArgumentCaptor<BigDecimal> subBatchCostCaptor = ArgumentCaptor.forClass(BigDecimal.class);
        ArgumentCaptor<BigDecimal> subPortionCostCaptor = ArgumentCaptor.forClass(BigDecimal.class);
        
        verify(recipeRepository).updateRecipeCosts(
                eq(subRecipeId),
                subBatchCostCaptor.capture(),
                subPortionCostCaptor.capture(),
                any(), // No menu price, so percentage is null
                any(Instant.class)
        );
        
        // Sub-recipe: 100g * 0.01 = 1.00, per portion = 1.00
        assertTrue(subBatchCostCaptor.getValue().compareTo(new BigDecimal("1.00")) == 0);
        assertTrue(subPortionCostCaptor.getValue().compareTo(new BigDecimal("1.00")) == 0);
        
        // Verify parent recipe update was called
        ArgumentCaptor<BigDecimal> parentBatchCostCaptor = ArgumentCaptor.forClass(BigDecimal.class);
        ArgumentCaptor<BigDecimal> parentPortionCostCaptor = ArgumentCaptor.forClass(BigDecimal.class);
        
        verify(recipeRepository).updateRecipeCosts(
                eq(parentRecipeId),
                parentBatchCostCaptor.capture(),
                parentPortionCostCaptor.capture(),
                any(), // No menu price
                any(Instant.class)
        );
        
        // Parent uses UPDATED sub-recipe cost: 3 portions * 1.00 = 3.00, per portion = 1.50
        assertTrue(parentBatchCostCaptor.getValue().compareTo(new BigDecimal("3.00")) == 0);
        assertTrue(parentPortionCostCaptor.getValue().compareTo(new BigDecimal("1.50")) == 0);
    }

    @Test
    void recalculateDependentRecipeCosts_multipleDependentRecipes_shouldRecalculateAll() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        UUID ingredientId = UUID.randomUUID();
        UUID recipe1 = UUID.randomUUID();
        UUID recipe2 = UUID.randomUUID();
        UUID recipe3 = UUID.randomUUID();
        
        when(recipeDependencyRepository.findAllDependentRecipeIds(ingredientId))
                .thenReturn(Arrays.asList(recipe1, recipe2, recipe3));
        
        // Mock recipes with minimal data
        for (UUID recipeId : Arrays.asList(recipe1, recipe2, recipe3)) {
            Recipe recipe = new Recipe();
            recipe.setId(recipeId);
            recipe.setVenueId(venueId);
            recipe.setPortionCount(1);
            when(recipeRepository.findById(recipeId)).thenReturn(Optional.of(recipe));
            when(recipeDependencyRepository.findIngredientLinesByRecipeId(recipeId))
                    .thenReturn(Collections.emptyList());
        }
        
        // Act
        List<UUID> result = service.recalculateDependentRecipeCosts(venueId, ingredientId);
        
        // Assert
        assertEquals(3, result.size());
        verify(recipeRepository, times(3)).updateRecipeCosts(any(), any(), any(), any(), any());
    }

    @Test
    void recalculateDependentRecipeCosts_recipeNotFound_shouldContinueWithOthers() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        UUID ingredientId = UUID.randomUUID();
        UUID missingRecipe = UUID.randomUUID();
        UUID validRecipe = UUID.randomUUID();
        
        when(recipeDependencyRepository.findAllDependentRecipeIds(ingredientId))
                .thenReturn(Arrays.asList(missingRecipe, validRecipe));
        
        // First recipe not found
        when(recipeRepository.findById(missingRecipe))
                .thenReturn(Optional.empty());
        
        // Second recipe valid
        Recipe recipe = new Recipe();
        recipe.setId(validRecipe);
        recipe.setVenueId(venueId);
        recipe.setPortionCount(1);
        when(recipeRepository.findById(validRecipe)).thenReturn(Optional.of(recipe));
        when(recipeDependencyRepository.findIngredientLinesByRecipeId(validRecipe))
                .thenReturn(Collections.emptyList());
        
        // Act
        List<UUID> result = service.recalculateDependentRecipeCosts(venueId, ingredientId);
        
        // Assert
        assertEquals(2, result.size()); // Returns all attempted recipe IDs
        verify(recipeRepository, times(1)).updateRecipeCosts(any(), any(), any(), any(), any());
    }
}
