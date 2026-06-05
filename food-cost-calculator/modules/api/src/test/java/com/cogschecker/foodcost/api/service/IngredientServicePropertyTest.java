package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Ingredient;
import com.cogschecker.foodcost.api.exception.DeleteConflictException;
import com.cogschecker.foodcost.api.exception.DuplicateResourceException;
import com.cogschecker.foodcost.api.repository.IngredientRepository;
import com.cogschecker.foodcost.api.repository.RecipeIngredientLineRepository;
import com.cogschecker.foodcost.shared.UomEnum;
import net.jqwik.api.*;

import java.math.BigDecimal;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

/**
 * Property-based tests for IngredientService using jqwik.
 * These tests validate universal invariants across a wide input space.
 * 
 * **Validates: Requirements 1.8, 1.10**
 */
class IngredientServicePropertyTest {
    
    /**
     * Property 3: Referenced Entity Deletion Requires Confirmation
     * **Validates: Requirements 1.8**
     * 
     * Given an ingredient that is referenced by one or more recipes,
     * attempting to delete it WITHOUT confirmation must throw DeleteConflictException
     * with the list of affected recipe names.
     * 
     * Attempting to delete it WITH confirmation must succeed.
     */
    @Property(tries = 1000)
    @Label("P3: Referenced ingredient deletion requires explicit confirmation")
    void referencedIngredientDeletionRequiresExplicitConfirmation(
            @ForAll("referencedIngredient") IngredientWithReferences ingredientWithRefs) {
        
        // Setup mocks for this property test iteration
        IngredientRepository ingredientRepository = mock(IngredientRepository.class);
        RecipeIngredientLineRepository recipeIngredientLineRepository = mock(RecipeIngredientLineRepository.class);
        CostPropagationService costPropagationService = mock(CostPropagationService.class);
        IngredientService ingredientService = new IngredientService(ingredientRepository, recipeIngredientLineRepository, costPropagationService);
        
        UUID venueId = ingredientWithRefs.ingredient.getVenueId();
        UUID ingredientId = ingredientWithRefs.ingredient.getId();
        List<String> affectedRecipes = ingredientWithRefs.affectedRecipeNames;
        
        // Mock repository to return the ingredient
        when(ingredientRepository.findByVenueIdAndId(venueId, ingredientId))
            .thenReturn(Optional.of(ingredientWithRefs.ingredient));
        
        // Mock repository to return affected recipe names
        when(recipeIngredientLineRepository.findRecipeNamesByIngredientId(ingredientId))
            .thenReturn(affectedRecipes);
        
        // Test 1: DELETE without confirmation should throw DeleteConflictException
        assertThatThrownBy(() -> ingredientService.deleteIngredient(venueId, ingredientId, false))
            .isInstanceOf(DeleteConflictException.class)
            .satisfies(ex -> {
                DeleteConflictException dce = (DeleteConflictException) ex;
                // Verify the exception contains affected recipe names
                assertThat(dce.getDetails())
                    .as("Exception should contain details with affected_resources")
                    .isNotNull()
                    .containsKey("affected_resources");
                
                @SuppressWarnings("unchecked")
                List<String> returnedRecipes = (List<String>) dce.getDetails().get("affected_resources");
                
                assertThat(returnedRecipes)
                    .as("Exception should list all affected recipe names")
                    .isNotNull()
                    .containsExactlyInAnyOrderElementsOf(affectedRecipes);
                
                assertThat(dce.getMessage())
                    .as("Exception message should mention the ingredient is in use")
                    .containsIgnoringCase("used")
                    .containsIgnoringCase("recipe");
            });
        
        // Verify delete was NOT called
        verify(ingredientRepository, never()).delete(any());
        
        // Test 2: DELETE with confirmation should succeed
        // Reset mocks for second call
        reset(ingredientRepository);
        when(ingredientRepository.findByVenueIdAndId(venueId, ingredientId))
            .thenReturn(Optional.of(ingredientWithRefs.ingredient));
        when(recipeIngredientLineRepository.findRecipeNamesByIngredientId(ingredientId))
            .thenReturn(affectedRecipes);
        
        // Should not throw when confirmed
        ingredientService.deleteIngredient(venueId, ingredientId, true);
        
        // Verify delete WAS called this time
        verify(ingredientRepository, times(1)).delete(ingredientWithRefs.ingredient);
    }
    
    /**
     * Provides an ingredient that is referenced by 1 or more recipes.
     */
    @Provide
    Arbitrary<IngredientWithReferences> referencedIngredient() {
        Arbitrary<Integer> recipeCount = Arbitraries.integers().between(1, 10);
        
        return recipeCount.flatMap(count -> {
            UUID venueId = UUID.randomUUID();
            Ingredient ingredient = createIngredient(venueId, "Test Ingredient " + UUID.randomUUID());
            
            // Generate recipe names that reference this ingredient
            List<String> recipeNames = new ArrayList<>();
            for (int i = 0; i < count; i++) {
                recipeNames.add("Recipe " + UUID.randomUUID());
            }
            
            return Arbitraries.just(new IngredientWithReferences(ingredient, recipeNames));
        });
    }
    
    /**
     * Property 5: Duplicate Name Rejection Is Case-Insensitive
     * **Validates: Requirements 1.10**
     * 
     * Generate arbitrary name, generate all-caps/all-lower/mixed permutations;
     * assert each permutation is rejected when the original name already exists.
     */
    @Property(tries = 1000)
    @Label("P5: Duplicate ingredient name rejection is case-insensitive")
    void duplicateIngredientNameRejectionIsCaseInsensitive(
            @ForAll("validIngredientName") String originalName) {
        
        // Setup mocks for this property test iteration
        IngredientRepository ingredientRepository = mock(IngredientRepository.class);
        RecipeIngredientLineRepository recipeIngredientLineRepository = mock(RecipeIngredientLineRepository.class);
        CostPropagationService costPropagationService = mock(CostPropagationService.class);
        IngredientService ingredientService = new IngredientService(ingredientRepository, recipeIngredientLineRepository, costPropagationService);
        UUID venueId = UUID.randomUUID();
        
        // Given: an ingredient with originalName already exists in the venue
        when(ingredientRepository.existsByVenueIdAndNameIgnoreCase(eq(venueId), anyString()))
            .thenAnswer(invocation -> {
                String nameToCheck = invocation.getArgument(1);
                // Return true if the name matches originalName (case-insensitive)
                return originalName.equalsIgnoreCase(nameToCheck);
            });
        
        // Generate case permutations of the original name
        String allLowerCase = originalName.toLowerCase(Locale.ROOT);
        String allUpperCase = originalName.toUpperCase(Locale.ROOT);
        String mixedCase1 = toggleCase(originalName, 0); // Toggle first character
        String mixedCase2 = toggleCase(originalName, originalName.length() / 2); // Toggle middle character
        
        String[] permutations = {originalName, allLowerCase, allUpperCase, mixedCase1, mixedCase2};
        
        // When/Then: attempt to create ingredient with each permutation
        // All should be rejected with DuplicateResourceException
        for (String permutation : permutations) {
            assertThatThrownBy(() -> ingredientService.createIngredient(
                venueId,
                permutation,
                new BigDecimal("10.00"),
                new BigDecimal("1.0000"),
                UomEnum.KILOGRAM,
                new BigDecimal("100.00")
            ))
                .isInstanceOf(DuplicateResourceException.class)
                .hasMessageContaining("already exists")
                .as("Permutation '%s' of original name '%s' should be rejected", permutation, originalName);
            
            // Verify repository was checked with case-insensitive query
            verify(ingredientRepository, atLeastOnce()).existsByVenueIdAndNameIgnoreCase(venueId, permutation);
            
            // Verify no save was attempted
            verify(ingredientRepository, never()).save(any(Ingredient.class));
            
            // Reset the save verification for next permutation
            clearInvocations(ingredientRepository);
        }
    }
    
    /**
     * Arbitrary generator for valid ingredient names.
     * Generates names that:
     * - Are 1-100 characters long
     * - Contain at least one alphabetic character
     * - Are not blank
     */
    @Provide
    Arbitrary<String> validIngredientName() {
        return Arbitraries.strings()
            .withCharRange('a', 'z')
            .withCharRange('A', 'Z')
            .withChars(' ', '-', '_', '\'')
            .ofMinLength(1)
            .ofMaxLength(100)
            .filter(s -> !s.trim().isEmpty())
            .filter(s -> s.chars().anyMatch(Character::isLetter));
    }
    
    /**
     * Helper method to create an Ingredient with a given name.
     */
    private Ingredient createIngredient(UUID venueId, String name) {
        Ingredient ingredient = new Ingredient();
        ingredient.setId(UUID.randomUUID());
        ingredient.setVenueId(venueId);
        ingredient.setName(name);
        ingredient.setPurchasePrice(new BigDecimal("10.00"));
        ingredient.setPurchaseQuantity(new BigDecimal("1.0000"));
        ingredient.setUnitOfMeasure(UomEnum.KILOGRAM);
        ingredient.setYieldPercentage(new BigDecimal("100.00"));
        ingredient.setCostPerUnit(new BigDecimal("10.0000"));
        ingredient.setEffectiveCostPerUsableUnit(new BigDecimal("10.0000"));
        return ingredient;
    }
    
    /**
     * Helper method to toggle the case of a character at the specified index.
     * If index is out of bounds or character is not a letter, returns original string.
     */
    private String toggleCase(String str, int index) {
        if (index < 0 || index >= str.length()) {
            return str;
        }
        
        char[] chars = str.toCharArray();
        char c = chars[index];
        
        if (Character.isUpperCase(c)) {
            chars[index] = Character.toLowerCase(c);
        } else if (Character.isLowerCase(c)) {
            chars[index] = Character.toUpperCase(c);
        }
        
        return new String(chars);
    }
    
    /**
     * Helper class to hold an ingredient with its referencing recipes.
     */
    private static class IngredientWithReferences {
        final Ingredient ingredient;
        final List<String> affectedRecipeNames;
        
        IngredientWithReferences(Ingredient ingredient, List<String> affectedRecipeNames) {
            this.ingredient = ingredient;
            this.affectedRecipeNames = affectedRecipeNames;
        }
    }
}
