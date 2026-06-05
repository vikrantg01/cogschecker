package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Ingredient;
import com.cogschecker.foodcost.api.exception.DeleteConflictException;
import com.cogschecker.foodcost.api.exception.DuplicateResourceException;
import com.cogschecker.foodcost.api.exception.ResourceNotFoundException;
import com.cogschecker.foodcost.api.repository.IngredientRepository;
import com.cogschecker.foodcost.api.repository.RecipeIngredientLineRepository;
import com.cogschecker.foodcost.shared.UomEnum;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for IngredientService.
 * Tests Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10
 */
@ExtendWith(MockitoExtension.class)
class IngredientServiceTest {
    
    @Mock
    private IngredientRepository ingredientRepository;
    
    @Mock
    private RecipeIngredientLineRepository recipeIngredientLineRepository;
    
    @Mock
    private CostPropagationService costPropagationService;
    
    @InjectMocks
    private IngredientService ingredientService;
    
    private UUID venueId;
    private UUID ingredientId;
    
    @BeforeEach
    void setUp() {
        venueId = UUID.randomUUID();
        ingredientId = UUID.randomUUID();
    }
    
    // Create tests - Requirements 1.1, 1.2, 1.5, 1.10
    
    @Test
    void createIngredient_ValidInputs_SuccessfullyCreatesWithComputedFields() {
        // Given
        String name = "Chicken Breast";
        BigDecimal purchasePrice = new BigDecimal("50.00");
        BigDecimal purchaseQuantity = new BigDecimal("5.0000");
        UomEnum uom = UomEnum.KILOGRAM;
        BigDecimal yieldPercentage = new BigDecimal("85.00");
        
        when(ingredientRepository.existsByVenueIdAndNameIgnoreCase(venueId, name)).thenReturn(false);
        when(ingredientRepository.save(any(Ingredient.class))).thenAnswer(invocation -> {
            Ingredient ing = invocation.getArgument(0);
            ing.setId(ingredientId);
            return ing;
        });
        
        // When
        Ingredient result = ingredientService.createIngredient(
            venueId, name, purchasePrice, purchaseQuantity, uom, yieldPercentage
        );
        
        // Then
        assertThat(result).isNotNull();
        assertThat(result.getName()).isEqualTo(name);
        assertThat(result.getPurchasePrice()).isEqualByComparingTo(purchasePrice);
        assertThat(result.getPurchaseQuantity()).isEqualByComparingTo(purchaseQuantity);
        assertThat(result.getUnitOfMeasure()).isEqualTo(uom);
        assertThat(result.getYieldPercentage()).isEqualByComparingTo(yieldPercentage);
        
        // Verify computed fields - Requirement 1.2, 1.5
        // cost_per_unit = 50.00 / 5.0000 = 10.0000
        assertThat(result.getCostPerUnit()).isEqualByComparingTo(new BigDecimal("10.0000"));
        
        // effective_cost_per_usable_unit = 10.0000 / (85.00 / 100) = 11.7647
        assertThat(result.getEffectiveCostPerUsableUnit()).isEqualByComparingTo(new BigDecimal("11.7647"));
        
        verify(ingredientRepository).existsByVenueIdAndNameIgnoreCase(venueId, name);
        verify(ingredientRepository).save(any(Ingredient.class));
    }
    
    @Test
    void createIngredient_DefaultYieldPercentage_SetsTo100() {
        // Given
        String name = "Sugar";
        BigDecimal purchasePrice = new BigDecimal("10.00");
        BigDecimal purchaseQuantity = new BigDecimal("2.0000");
        
        when(ingredientRepository.existsByVenueIdAndNameIgnoreCase(venueId, name)).thenReturn(false);
        when(ingredientRepository.save(any(Ingredient.class))).thenAnswer(invocation -> {
            Ingredient ing = invocation.getArgument(0);
            ing.setId(ingredientId);
            return ing;
        });
        
        // When - null yield percentage
        Ingredient result = ingredientService.createIngredient(
            venueId, name, purchasePrice, purchaseQuantity, UomEnum.KILOGRAM, null
        );
        
        // Then
        assertThat(result.getYieldPercentage()).isEqualByComparingTo(new BigDecimal("100.00"));
        
        // With 100% yield, effective cost equals cost per unit
        // cost_per_unit = 10.00 / 2.0000 = 5.0000
        assertThat(result.getCostPerUnit()).isEqualByComparingTo(new BigDecimal("5.0000"));
        assertThat(result.getEffectiveCostPerUsableUnit()).isEqualByComparingTo(new BigDecimal("5.0000"));
    }
    
    @Test
    void createIngredient_DuplicateName_ThrowsDuplicateResourceException() {
        // Given
        String name = "Chicken Breast";
        when(ingredientRepository.existsByVenueIdAndNameIgnoreCase(venueId, name)).thenReturn(true);
        
        // When/Then - Requirement 1.10
        assertThatThrownBy(() -> ingredientService.createIngredient(
            venueId, name, new BigDecimal("50.00"), new BigDecimal("5.0000"), 
            UomEnum.KILOGRAM, new BigDecimal("85.00")
        ))
            .isInstanceOf(DuplicateResourceException.class)
            .hasMessageContaining("already exists");
        
        verify(ingredientRepository).existsByVenueIdAndNameIgnoreCase(venueId, name);
        verify(ingredientRepository, never()).save(any(Ingredient.class));
    }
    
    @Test
    void createIngredient_InvalidInputs_ThrowsIllegalArgumentException() {
        // Empty name
        assertThatThrownBy(() -> ingredientService.createIngredient(
            venueId, "", new BigDecimal("50.00"), new BigDecimal("5.0000"), 
            UomEnum.KILOGRAM, null
        )).isInstanceOf(IllegalArgumentException.class);
        
        // Negative purchase price
        assertThatThrownBy(() -> ingredientService.createIngredient(
            venueId, "Chicken", new BigDecimal("-50.00"), new BigDecimal("5.0000"), 
            UomEnum.KILOGRAM, null
        )).isInstanceOf(IllegalArgumentException.class);
        
        // Zero purchase quantity
        assertThatThrownBy(() -> ingredientService.createIngredient(
            venueId, "Chicken", new BigDecimal("50.00"), BigDecimal.ZERO, 
            UomEnum.KILOGRAM, null
        )).isInstanceOf(IllegalArgumentException.class);
        
        // Yield percentage out of range
        assertThatThrownBy(() -> ingredientService.createIngredient(
            venueId, "Chicken", new BigDecimal("50.00"), new BigDecimal("5.0000"), 
            UomEnum.KILOGRAM, new BigDecimal("150.00")
        )).isInstanceOf(IllegalArgumentException.class);
    }
    
    // Read tests - Requirement 1.6
    
    @Test
    void getIngredient_ExistingIngredient_ReturnsIngredient() {
        // Given
        Ingredient ingredient = createTestIngredient();
        when(ingredientRepository.findByVenueIdAndId(venueId, ingredientId))
            .thenReturn(Optional.of(ingredient));
        
        // When
        Ingredient result = ingredientService.getIngredient(venueId, ingredientId);
        
        // Then
        assertThat(result).isEqualTo(ingredient);
        verify(ingredientRepository).findByVenueIdAndId(venueId, ingredientId);
    }
    
    @Test
    void getIngredient_NonExistent_ThrowsResourceNotFoundException() {
        // Given
        when(ingredientRepository.findByVenueIdAndId(venueId, ingredientId))
            .thenReturn(Optional.empty());
        
        // When/Then
        assertThatThrownBy(() -> ingredientService.getIngredient(venueId, ingredientId))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("not found");
    }
    
    @Test
    void getAllIngredients_ReturnsAllForVenue() {
        // Given
        List<Ingredient> ingredients = Arrays.asList(
            createTestIngredient(),
            createTestIngredient()
        );
        when(ingredientRepository.findByVenueId(venueId)).thenReturn(ingredients);
        
        // When
        List<Ingredient> result = ingredientService.getAllIngredients(venueId);
        
        // Then
        assertThat(result).hasSize(2);
        verify(ingredientRepository).findByVenueId(venueId);
    }
    
    // Update tests - Requirements 1.2, 1.3, 1.5, 1.6, 1.10
    
    @Test
    void updateIngredient_ChangePriceAndQuantity_RecalculatesCosts() {
        // Given
        Ingredient existing = createTestIngredient();
        existing.setId(ingredientId);
        existing.setPurchasePrice(new BigDecimal("50.00"));
        existing.setPurchaseQuantity(new BigDecimal("5.0000"));
        existing.setYieldPercentage(new BigDecimal("85.00"));
        
        when(ingredientRepository.findByVenueIdAndId(venueId, ingredientId))
            .thenReturn(Optional.of(existing));
        when(ingredientRepository.save(any(Ingredient.class))).thenAnswer(inv -> inv.getArgument(0));
        
        // When - update price and quantity
        BigDecimal newPrice = new BigDecimal("60.00");
        BigDecimal newQuantity = new BigDecimal("4.0000");
        
        Ingredient result = ingredientService.updateIngredient(
            venueId, ingredientId, null, newPrice, newQuantity, null, null
        );
        
        // Then - Requirements 1.2, 1.3
        assertThat(result.getPurchasePrice()).isEqualByComparingTo(newPrice);
        assertThat(result.getPurchaseQuantity()).isEqualByComparingTo(newQuantity);
        
        // New cost_per_unit = 60.00 / 4.0000 = 15.0000
        assertThat(result.getCostPerUnit()).isEqualByComparingTo(new BigDecimal("15.0000"));
        
        // New effective_cost = 15.0000 / 0.85 = 17.6471
        assertThat(result.getEffectiveCostPerUsableUnit()).isEqualByComparingTo(new BigDecimal("17.6471"));
        
        verify(ingredientRepository).save(any(Ingredient.class));
    }
    
    @Test
    void updateIngredient_ChangeYieldPercentage_RecalculatesEffectiveCost() {
        // Given
        Ingredient existing = createTestIngredient();
        existing.setId(ingredientId);
        existing.setPurchasePrice(new BigDecimal("100.00"));
        existing.setPurchaseQuantity(new BigDecimal("10.0000"));
        existing.setYieldPercentage(new BigDecimal("100.00"));
        
        when(ingredientRepository.findByVenueIdAndId(venueId, ingredientId))
            .thenReturn(Optional.of(existing));
        when(ingredientRepository.save(any(Ingredient.class))).thenAnswer(inv -> inv.getArgument(0));
        
        // When - change yield to 80%
        BigDecimal newYield = new BigDecimal("80.00");
        Ingredient result = ingredientService.updateIngredient(
            venueId, ingredientId, null, null, null, null, newYield
        );
        
        // Then - Requirement 1.5
        // cost_per_unit = 100.00 / 10.0000 = 10.0000 (unchanged)
        assertThat(result.getCostPerUnit()).isEqualByComparingTo(new BigDecimal("10.0000"));
        
        // effective_cost = 10.0000 / 0.80 = 12.5000
        assertThat(result.getEffectiveCostPerUsableUnit()).isEqualByComparingTo(new BigDecimal("12.5000"));
    }
    
    @Test
    void updateIngredient_ChangeCostAffectingFields_TriggersCostPropagation() {
        // Given
        Ingredient existing = createTestIngredient();
        existing.setId(ingredientId);
        
        when(ingredientRepository.findByVenueIdAndId(venueId, ingredientId))
            .thenReturn(Optional.of(existing));
        when(ingredientRepository.save(any(Ingredient.class))).thenAnswer(inv -> inv.getArgument(0));
        
        // When - update price (cost-affecting field)
        ingredientService.updateIngredient(
            venueId, ingredientId, null, new BigDecimal("100.00"), null, null, null
        );
        
        // Then - Requirements 1.3, 3.3
        verify(costPropagationService).enqueue(venueId, ingredientId);
        
        // When - update quantity (cost-affecting field)
        ingredientService.updateIngredient(
            venueId, ingredientId, null, null, new BigDecimal("10.0000"), null, null
        );
        
        // Then
        verify(costPropagationService, times(2)).enqueue(venueId, ingredientId);
        
        // When - update yield (cost-affecting field)
        ingredientService.updateIngredient(
            venueId, ingredientId, null, null, null, null, new BigDecimal("90.00")
        );
        
        // Then
        verify(costPropagationService, times(3)).enqueue(venueId, ingredientId);
    }
    
    @Test
    void updateIngredient_ChangeNameOnly_DoesNotTriggerCostPropagation() {
        // Given
        Ingredient existing = createTestIngredient();
        existing.setId(ingredientId);
        existing.setName("Old Name");
        
        when(ingredientRepository.findByVenueIdAndId(venueId, ingredientId))
            .thenReturn(Optional.of(existing));
        when(ingredientRepository.existsByVenueIdAndNameIgnoreCaseExcludingId(venueId, "New Name", ingredientId))
            .thenReturn(false);
        when(ingredientRepository.save(any(Ingredient.class))).thenAnswer(inv -> inv.getArgument(0));
        
        // When - update only name (non-cost-affecting field)
        ingredientService.updateIngredient(
            venueId, ingredientId, "New Name", null, null, null, null
        );
        
        // Then - no cost propagation should be triggered
        verify(costPropagationService, never()).enqueue(any(), any());
    }
    
    @Test
    void updateIngredient_DuplicateName_ThrowsDuplicateResourceException() {
        // Given
        Ingredient existing = createTestIngredient();
        existing.setId(ingredientId);
        existing.setName("Old Name");
        
        String newName = "Existing Name";
        
        when(ingredientRepository.findByVenueIdAndId(venueId, ingredientId))
            .thenReturn(Optional.of(existing));
        when(ingredientRepository.existsByVenueIdAndNameIgnoreCaseExcludingId(venueId, newName, ingredientId))
            .thenReturn(true);
        
        // When/Then - Requirement 1.10
        assertThatThrownBy(() -> ingredientService.updateIngredient(
            venueId, ingredientId, newName, null, null, null, null
        ))
            .isInstanceOf(DuplicateResourceException.class)
            .hasMessageContaining("already exists");
        
        verify(ingredientRepository, never()).save(any(Ingredient.class));
    }
    
    // Delete tests - Requirements 1.7, 1.8
    
    @Test
    void deleteIngredient_NotReferencedConfirmed_DeletesSuccessfully() {
        // Given
        Ingredient ingredient = createTestIngredient();
        ingredient.setId(ingredientId);
        
        when(ingredientRepository.findByVenueIdAndId(venueId, ingredientId))
            .thenReturn(Optional.of(ingredient));
        when(recipeIngredientLineRepository.findRecipeNamesByIngredientId(ingredientId))
            .thenReturn(List.of());
        
        // When
        ingredientService.deleteIngredient(venueId, ingredientId, true);
        
        // Then
        verify(ingredientRepository).delete(ingredient);
    }
    
    @Test
    void deleteIngredient_ReferencedNotConfirmed_ThrowsDeleteConflictException() {
        // Given
        Ingredient ingredient = createTestIngredient();
        ingredient.setId(ingredientId);
        ingredient.setName("Chicken Breast");
        
        List<String> affectedRecipes = Arrays.asList("Chicken Curry", "Grilled Chicken", "Chicken Soup");
        
        when(ingredientRepository.findByVenueIdAndId(venueId, ingredientId))
            .thenReturn(Optional.of(ingredient));
        when(recipeIngredientLineRepository.findRecipeNamesByIngredientId(ingredientId))
            .thenReturn(affectedRecipes);
        
        // When/Then - Requirement 1.8
        assertThatThrownBy(() -> ingredientService.deleteIngredient(venueId, ingredientId, false))
            .isInstanceOf(DeleteConflictException.class)
            .hasMessageContaining("is used in")
            .hasMessageContaining("3 recipe(s)")
            .satisfies(ex -> {
                DeleteConflictException dce = (DeleteConflictException) ex;
                assertThat(dce.getDetails()).containsKey("affected_resources");
                @SuppressWarnings("unchecked")
                List<String> affected = (List<String>) dce.getDetails().get("affected_resources");
                assertThat(affected).containsExactlyInAnyOrder("Chicken Curry", "Grilled Chicken", "Chicken Soup");
            });
        
        verify(ingredientRepository, never()).delete(any());
    }
    
    @Test
    void deleteIngredient_ReferencedAndConfirmed_DeletesSuccessfully() {
        // Given
        Ingredient ingredient = createTestIngredient();
        ingredient.setId(ingredientId);
        
        List<String> affectedRecipes = Arrays.asList("Chicken Curry");
        
        when(ingredientRepository.findByVenueIdAndId(venueId, ingredientId))
            .thenReturn(Optional.of(ingredient));
        when(recipeIngredientLineRepository.findRecipeNamesByIngredientId(ingredientId))
            .thenReturn(affectedRecipes);
        
        // When - confirmed=true allows deletion
        ingredientService.deleteIngredient(venueId, ingredientId, true);
        
        // Then
        verify(ingredientRepository).delete(ingredient);
    }
    
    // Search tests - Requirement 1.9
    
    @Test
    void searchIngredients_WithQuery_ReturnsMatchingIngredients() {
        // Given
        String query = "chicken";
        List<Ingredient> matchingIngredients = Arrays.asList(
            createTestIngredient(),
            createTestIngredient()
        );
        
        when(ingredientRepository.findByVenueIdAndNameContainingIgnoreCase(venueId, query))
            .thenReturn(matchingIngredients);
        
        // When
        List<Ingredient> result = ingredientService.searchIngredients(venueId, query);
        
        // Then
        assertThat(result).hasSize(2);
        verify(ingredientRepository).findByVenueIdAndNameContainingIgnoreCase(venueId, query);
    }
    
    @Test
    void searchIngredients_EmptyQuery_ReturnsAllIngredients() {
        // Given
        List<Ingredient> allIngredients = Arrays.asList(
            createTestIngredient(),
            createTestIngredient(),
            createTestIngredient()
        );
        
        when(ingredientRepository.findByVenueId(venueId)).thenReturn(allIngredients);
        
        // When
        List<Ingredient> result = ingredientService.searchIngredients(venueId, "");
        
        // Then
        assertThat(result).hasSize(3);
        verify(ingredientRepository).findByVenueId(venueId);
        verify(ingredientRepository, never()).findByVenueIdAndNameContainingIgnoreCase(any(), any());
    }
    
    // Helper methods
    
    private Ingredient createTestIngredient() {
        Ingredient ingredient = new Ingredient();
        ingredient.setVenueId(venueId);
        ingredient.setName("Test Ingredient");
        ingredient.setPurchasePrice(new BigDecimal("50.00"));
        ingredient.setPurchaseQuantity(new BigDecimal("5.0000"));
        ingredient.setUnitOfMeasure(UomEnum.KILOGRAM);
        ingredient.setYieldPercentage(new BigDecimal("100.00"));
        ingredient.setCostPerUnit(new BigDecimal("10.0000"));
        ingredient.setEffectiveCostPerUsableUnit(new BigDecimal("10.0000"));
        return ingredient;
    }
}
