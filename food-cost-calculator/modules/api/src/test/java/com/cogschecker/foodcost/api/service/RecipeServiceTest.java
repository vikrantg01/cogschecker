package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.domain.RecipeIngredientLine;
import com.cogschecker.foodcost.api.exception.*;
import com.cogschecker.foodcost.api.repository.RecipeIngredientLineRepository;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.shared.UomEnum;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for RecipeService.
 * Tests Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12
 */
@ExtendWith(MockitoExtension.class)
class RecipeServiceTest {
    
    @Mock
    private RecipeRepository recipeRepository;
    
    @Mock
    private RecipeIngredientLineRepository recipeIngredientLineRepository;
    
    @InjectMocks
    private RecipeService recipeService;
    
    private UUID venueId;
    private UUID recipeId;
    
    @BeforeEach
    void setUp() {
        venueId = UUID.randomUUID();
        recipeId = UUID.randomUUID();
    }
    
    // Create tests - Requirements 2.1, 2.10, 2.11, 2.12
    
    @Test
    void createRecipe_ValidInputs_SuccessfullyCreates() {
        // Given
        String name = "Chicken Curry";
        Integer portionCount = 4;
        List<RecipeIngredientLine> lines = createValidIngredientLines();
        
        when(recipeRepository.existsByVenueIdAndNameIgnoreCase(venueId, name)).thenReturn(false);
        when(recipeRepository.countByVenueId(venueId)).thenReturn(10L);
        when(recipeRepository.save(any(Recipe.class))).thenAnswer(invocation -> {
            Recipe recipe = invocation.getArgument(0);
            recipe.setId(recipeId);
            return recipe;
        });
        
        // When
        Recipe result = recipeService.createRecipe(venueId, name, portionCount, lines, true);
        
        // Then
        assertThat(result).isNotNull();
        assertThat(result.getName()).isEqualTo(name.trim());
        assertThat(result.getPortionCount()).isEqualTo(portionCount);
        assertThat(result.getVenueId()).isEqualTo(venueId);
        
        verify(recipeRepository).existsByVenueIdAndNameIgnoreCase(venueId, name);
        verify(recipeRepository).countByVenueId(venueId);
        verify(recipeRepository).save(any(Recipe.class));
    }
    
    @Test
    void createRecipe_InvalidName_ThrowsValidationException() {
        // Given - empty name
        String emptyName = "";
        Integer portionCount = 4;
        
        // When/Then - Requirement 2.10
        assertThatThrownBy(() -> recipeService.createRecipe(
            venueId, emptyName, portionCount, new ArrayList<>(), false
        ))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("Recipe name cannot be empty");
    }
    
    @Test
    void createRecipe_WhitespaceName_ThrowsValidationException() {
        // Given - whitespace-only name
        String whitespaceName = "   ";
        Integer portionCount = 4;
        
        // When/Then - Requirement 2.10
        assertThatThrownBy(() -> recipeService.createRecipe(
            venueId, whitespaceName, portionCount, new ArrayList<>(), false
        ))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("Recipe name cannot be empty");
    }
    
    @Test
    void createRecipe_InvalidPortionCount_ThrowsValidationException() {
        // Given - portion count out of range
        String name = "Test Recipe";
        
        // When/Then - Requirement 2.10
        // Below minimum (< 1)
        assertThatThrownBy(() -> recipeService.createRecipe(
            venueId, name, 0, new ArrayList<>(), false
        ))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("Portion count must be between");
        
        // Above maximum (> 9999)
        assertThatThrownBy(() -> recipeService.createRecipe(
            venueId, name, 10000, new ArrayList<>(), false
        ))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("Portion count must be between");
    }
    
    @Test
    void createRecipe_InvalidLineQuantity_ThrowsValidationException() {
        // Given
        String name = "Test Recipe";
        Integer portionCount = 4;
        List<RecipeIngredientLine> lines = new ArrayList<>();
        
        // Create line with zero quantity
        RecipeIngredientLine line = new RecipeIngredientLine();
        line.setQuantityUsed(BigDecimal.ZERO);
        line.setUnitOfMeasure(UomEnum.GRAM);
        lines.add(line);
        
        // When/Then - Requirement 2.10
        assertThatThrownBy(() -> recipeService.createRecipe(
            venueId, name, portionCount, lines, false
        ))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("quantity must be greater than 0");
    }
    
    @Test
    void createRecipe_MultipleValidationErrors_CollectsAllErrors() {
        // Given - multiple invalid fields
        String emptyName = "";
        Integer invalidPortionCount = 0;
        List<RecipeIngredientLine> lines = new ArrayList<>();
        
        RecipeIngredientLine invalidLine = new RecipeIngredientLine();
        invalidLine.setQuantityUsed(new BigDecimal("-5"));
        lines.add(invalidLine);
        
        // When/Then - Requirement 2.11
        assertThatThrownBy(() -> recipeService.createRecipe(
            venueId, emptyName, invalidPortionCount, lines, false
        ))
            .isInstanceOf(ValidationException.class)
            .satisfies(ex -> {
                ValidationException ve = (ValidationException) ex;
                assertThat(ve.getDetails()).isNotEmpty();
                assertThat(ve.getDetails().size()).isGreaterThan(1);
            });
    }
    
    @Test
    void createRecipe_DuplicateName_ThrowsDuplicateResourceException() {
        // Given
        String name = "Existing Recipe";
        when(recipeRepository.existsByVenueIdAndNameIgnoreCase(venueId, name)).thenReturn(true);
        
        // When/Then
        assertThatThrownBy(() -> recipeService.createRecipe(
            venueId, name, 4, new ArrayList<>(), false
        ))
            .isInstanceOf(DuplicateResourceException.class)
            .hasMessageContaining("already exists");
        
        verify(recipeRepository, never()).save(any(Recipe.class));
    }
    
    @Test
    void createRecipe_FreeTierLimitExceeded_ThrowsTierLimitExceededException() {
        // Given
        String name = "New Recipe";
        when(recipeRepository.existsByVenueIdAndNameIgnoreCase(venueId, name)).thenReturn(false);
        when(recipeRepository.countByVenueId(venueId)).thenReturn(25L); // Already at limit
        
        // When/Then - Requirement 2.12
        assertThatThrownBy(() -> recipeService.createRecipe(
            venueId, name, 4, new ArrayList<>(), true
        ))
            .isInstanceOf(TierLimitExceededException.class)
            .hasMessageContaining("Free tier limit")
            .hasMessageContaining("25 recipes");
        
        verify(recipeRepository, never()).save(any(Recipe.class));
    }
    
    @Test
    void createRecipe_ProTierNotLimited_AllowsMoreThan25Recipes() {
        // Given
        String name = "Recipe 26";
        when(recipeRepository.existsByVenueIdAndNameIgnoreCase(venueId, name)).thenReturn(false);
        // Count check should not happen for Pro tier
        when(recipeRepository.save(any(Recipe.class))).thenAnswer(inv -> {
            Recipe r = inv.getArgument(0);
            r.setId(recipeId);
            return r;
        });
        
        // When - isFreeTier = false
        Recipe result = recipeService.createRecipe(venueId, name, 4, new ArrayList<>(), false);
        
        // Then - should succeed
        assertThat(result).isNotNull();
        verify(recipeRepository, never()).countByVenueId(any()); // Count not checked
        verify(recipeRepository).save(any(Recipe.class));
    }
    
    // Read tests - Requirement 2.5
    
    @Test
    void getRecipe_ExistingRecipe_ReturnsRecipe() {
        // Given
        Recipe recipe = createTestRecipe();
        when(recipeRepository.findByVenueIdAndId(venueId, recipeId))
            .thenReturn(Optional.of(recipe));
        
        // When
        Recipe result = recipeService.getRecipe(venueId, recipeId);
        
        // Then
        assertThat(result).isEqualTo(recipe);
        verify(recipeRepository).findByVenueIdAndId(venueId, recipeId);
    }
    
    @Test
    void getRecipe_NonExistent_ThrowsResourceNotFoundException() {
        // Given
        when(recipeRepository.findByVenueIdAndId(venueId, recipeId))
            .thenReturn(Optional.empty());
        
        // When/Then
        assertThatThrownBy(() -> recipeService.getRecipe(venueId, recipeId))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("not found");
    }
    
    @Test
    void getAllRecipes_ReturnsAllForVenue() {
        // Given
        List<Recipe> recipes = Arrays.asList(
            createTestRecipe(),
            createTestRecipe()
        );
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        
        // When
        List<Recipe> result = recipeService.getAllRecipes(venueId);
        
        // Then
        assertThat(result).hasSize(2);
        verify(recipeRepository).findByVenueId(venueId);
    }
    
    // Update tests - Requirements 2.5, 2.10, 2.11
    
    @Test
    void updateRecipe_ValidName_UpdatesSuccessfully() {
        // Given
        Recipe existing = createTestRecipe();
        existing.setId(recipeId);
        existing.setName("Old Name");
        
        String newName = "New Name";
        
        when(recipeRepository.findByVenueIdAndId(venueId, recipeId))
            .thenReturn(Optional.of(existing));
        when(recipeRepository.existsByVenueIdAndNameIgnoreCaseExcludingId(
            venueId, newName.trim(), recipeId)).thenReturn(false);
        when(recipeRepository.save(any(Recipe.class))).thenAnswer(inv -> inv.getArgument(0));
        
        // When
        Recipe result = recipeService.updateRecipe(venueId, recipeId, newName, null, null);
        
        // Then
        assertThat(result.getName()).isEqualTo(newName.trim());
        verify(recipeRepository).save(any(Recipe.class));
    }
    
    @Test
    void updateRecipe_ValidPortionCount_UpdatesSuccessfully() {
        // Given
        Recipe existing = createTestRecipe();
        existing.setId(recipeId);
        existing.setPortionCount(4);
        
        Integer newPortionCount = 8;
        
        when(recipeRepository.findByVenueIdAndId(venueId, recipeId))
            .thenReturn(Optional.of(existing));
        when(recipeRepository.save(any(Recipe.class))).thenAnswer(inv -> inv.getArgument(0));
        
        // When
        Recipe result = recipeService.updateRecipe(venueId, recipeId, null, newPortionCount, null);
        
        // Then
        assertThat(result.getPortionCount()).isEqualTo(newPortionCount);
        verify(recipeRepository).save(any(Recipe.class));
    }
    
    @Test
    void updateRecipe_DuplicateName_ThrowsDuplicateResourceException() {
        // Given
        Recipe existing = createTestRecipe();
        existing.setId(recipeId);
        existing.setName("Old Name");
        
        String duplicateName = "Existing Recipe";
        
        when(recipeRepository.findByVenueIdAndId(venueId, recipeId))
            .thenReturn(Optional.of(existing));
        when(recipeRepository.existsByVenueIdAndNameIgnoreCaseExcludingId(
            venueId, duplicateName.trim(), recipeId)).thenReturn(true);
        
        // When/Then
        assertThatThrownBy(() -> recipeService.updateRecipe(
            venueId, recipeId, duplicateName, null, null
        ))
            .isInstanceOf(DuplicateResourceException.class)
            .hasMessageContaining("already exists");
        
        verify(recipeRepository, never()).save(any(Recipe.class));
    }
    
    @Test
    void updateRecipe_InvalidPortionCount_ThrowsValidationException() {
        // Given
        Recipe existing = createTestRecipe();
        existing.setId(recipeId);
        
        when(recipeRepository.findByVenueIdAndId(venueId, recipeId))
            .thenReturn(Optional.of(existing));
        
        // When/Then - Requirement 2.10
        assertThatThrownBy(() -> recipeService.updateRecipe(
            venueId, recipeId, null, 10000, null
        ))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("Portion count must be between");
    }
    
    // Duplicate tests - Requirement 2.6
    
    @Test
    void duplicateRecipe_ValidRecipe_CreatesCopyWithPrefix() {
        // Given
        Recipe source = createTestRecipe();
        source.setId(recipeId);
        source.setName("Original Recipe");
        source.setPortionCount(4);
        source.setMenuSellingPrice(new BigDecimal("25.00"));
        
        when(recipeRepository.findByVenueIdAndId(venueId, recipeId))
            .thenReturn(Optional.of(source));
        when(recipeRepository.existsByVenueIdAndNameIgnoreCase(venueId, "Copy of Original Recipe"))
            .thenReturn(false);
        when(recipeRepository.countByVenueId(venueId)).thenReturn(10L);
        when(recipeRepository.save(any(Recipe.class))).thenAnswer(inv -> {
            Recipe r = inv.getArgument(0);
            r.setId(UUID.randomUUID());
            return r;
        });
        
        // When - Requirement 2.6
        Recipe result = recipeService.duplicateRecipe(venueId, recipeId, true);
        
        // Then
        assertThat(result.getName()).isEqualTo("Copy of Original Recipe");
        assertThat(result.getPortionCount()).isEqualTo(source.getPortionCount());
        assertThat(result.getMenuSellingPrice()).isEqualTo(source.getMenuSellingPrice());
        assertThat(result.getId()).isNotEqualTo(source.getId());
        
        verify(recipeRepository).save(any(Recipe.class));
    }
    
    @Test
    void duplicateRecipe_NameAlreadyExists_AppendsNumber() {
        // Given
        Recipe source = createTestRecipe();
        source.setId(recipeId);
        source.setName("Original Recipe");
        
        when(recipeRepository.findByVenueIdAndId(venueId, recipeId))
            .thenReturn(Optional.of(source));
        when(recipeRepository.existsByVenueIdAndNameIgnoreCase(venueId, "Copy of Original Recipe"))
            .thenReturn(true);
        when(recipeRepository.existsByVenueIdAndNameIgnoreCase(venueId, "Copy of Original Recipe (1)"))
            .thenReturn(false);
        when(recipeRepository.countByVenueId(venueId)).thenReturn(10L);
        when(recipeRepository.save(any(Recipe.class))).thenAnswer(inv -> {
            Recipe r = inv.getArgument(0);
            r.setId(UUID.randomUUID());
            return r;
        });
        
        // When
        Recipe result = recipeService.duplicateRecipe(venueId, recipeId, true);
        
        // Then
        assertThat(result.getName()).isEqualTo("Copy of Original Recipe (1)");
    }
    
    @Test
    void duplicateRecipe_FreeTierLimitExceeded_ThrowsTierLimitExceededException() {
        // Given
        Recipe source = createTestRecipe();
        source.setId(recipeId);
        
        when(recipeRepository.findByVenueIdAndId(venueId, recipeId))
            .thenReturn(Optional.of(source));
        when(recipeRepository.countByVenueId(venueId)).thenReturn(25L);
        
        // When/Then - Requirement 2.12
        assertThatThrownBy(() -> recipeService.duplicateRecipe(venueId, recipeId, true))
            .isInstanceOf(TierLimitExceededException.class)
            .hasMessageContaining("Free tier limit");
        
        verify(recipeRepository, never()).save(any(Recipe.class));
    }
    
    // Delete tests - Requirements 2.7, 2.8
    
    @Test
    void deleteRecipe_NotReferencedConfirmed_DeletesSuccessfully() {
        // Given
        Recipe recipe = createTestRecipe();
        recipe.setId(recipeId);
        
        when(recipeRepository.findByVenueIdAndId(venueId, recipeId))
            .thenReturn(Optional.of(recipe));
        when(recipeRepository.findParentRecipeNamesBySubRecipeId(recipeId))
            .thenReturn(List.of());
        
        // When
        recipeService.deleteRecipe(venueId, recipeId, true);
        
        // Then
        verify(recipeRepository).delete(recipe);
    }
    
    @Test
    void deleteRecipe_UsedAsSubRecipeNotConfirmed_ThrowsDeleteConflictException() {
        // Given
        Recipe recipe = createTestRecipe();
        recipe.setId(recipeId);
        recipe.setName("Base Sauce");
        
        List<String> affectedRecipes = Arrays.asList("Pasta Dish", "Pizza", "Lasagna");
        
        when(recipeRepository.findByVenueIdAndId(venueId, recipeId))
            .thenReturn(Optional.of(recipe));
        when(recipeRepository.findParentRecipeNamesBySubRecipeId(recipeId))
            .thenReturn(affectedRecipes);
        
        // When/Then - Requirement 2.8
        assertThatThrownBy(() -> recipeService.deleteRecipe(venueId, recipeId, false))
            .isInstanceOf(DeleteConflictException.class)
            .hasMessageContaining("is used as a sub-recipe")
            .hasMessageContaining("3 recipe(s)")
            .satisfies(ex -> {
                DeleteConflictException dce = (DeleteConflictException) ex;
                assertThat(dce.getDetails()).containsKey("affected_resources");
                @SuppressWarnings("unchecked")
                List<String> affected = (List<String>) dce.getDetails().get("affected_resources");
                assertThat(affected).containsExactlyInAnyOrder("Pasta Dish", "Pizza", "Lasagna");
            });
        
        verify(recipeRepository, never()).delete(any());
    }
    
    @Test
    void deleteRecipe_UsedAsSubRecipeAndConfirmed_DeletesSuccessfully() {
        // Given
        Recipe recipe = createTestRecipe();
        recipe.setId(recipeId);
        
        List<String> affectedRecipes = Arrays.asList("Pasta Dish");
        
        when(recipeRepository.findByVenueIdAndId(venueId, recipeId))
            .thenReturn(Optional.of(recipe));
        when(recipeRepository.findParentRecipeNamesBySubRecipeId(recipeId))
            .thenReturn(affectedRecipes);
        
        // When - confirmed=true allows deletion
        recipeService.deleteRecipe(venueId, recipeId, true);
        
        // Then
        verify(recipeRepository).delete(recipe);
    }
    
    // Search tests - Requirement 2.9
    
    @Test
    void searchRecipes_WithQuery_ReturnsMatchingRecipes() {
        // Given
        String query = "curry";
        List<Recipe> matchingRecipes = Arrays.asList(
            createTestRecipe(),
            createTestRecipe()
        );
        
        when(recipeRepository.findByVenueIdAndNameContainingIgnoreCase(venueId, query))
            .thenReturn(matchingRecipes);
        
        // When
        List<Recipe> result = recipeService.searchRecipes(venueId, query);
        
        // Then
        assertThat(result).hasSize(2);
        verify(recipeRepository).findByVenueIdAndNameContainingIgnoreCase(venueId, query);
    }
    
    @Test
    void searchRecipes_EmptyQuery_ReturnsAllRecipes() {
        // Given
        List<Recipe> allRecipes = Arrays.asList(
            createTestRecipe(),
            createTestRecipe(),
            createTestRecipe()
        );
        
        when(recipeRepository.findByVenueId(venueId)).thenReturn(allRecipes);
        
        // When
        List<Recipe> result = recipeService.searchRecipes(venueId, "");
        
        // Then
        assertThat(result).hasSize(3);
        verify(recipeRepository).findByVenueId(venueId);
        verify(recipeRepository, never()).findByVenueIdAndNameContainingIgnoreCase(any(), any());
    }
    
    // Helper methods
    
    private Recipe createTestRecipe() {
        Recipe recipe = new Recipe();
        recipe.setVenueId(venueId);
        recipe.setName("Test Recipe");
        recipe.setPortionCount(4);
        recipe.setTotalBatchCost(BigDecimal.ZERO);
        recipe.setFoodCostPerPortion(BigDecimal.ZERO);
        return recipe;
    }
    
    private List<RecipeIngredientLine> createValidIngredientLines() {
        List<RecipeIngredientLine> lines = new ArrayList<>();
        
        RecipeIngredientLine line1 = new RecipeIngredientLine();
        line1.setQuantityUsed(new BigDecimal("500"));
        line1.setUnitOfMeasure(UomEnum.GRAM);
        lines.add(line1);
        
        RecipeIngredientLine line2 = new RecipeIngredientLine();
        line2.setQuantityUsed(new BigDecimal("2.5"));
        line2.setUnitOfMeasure(UomEnum.LITRE);
        lines.add(line2);
        
        return lines;
    }
}
