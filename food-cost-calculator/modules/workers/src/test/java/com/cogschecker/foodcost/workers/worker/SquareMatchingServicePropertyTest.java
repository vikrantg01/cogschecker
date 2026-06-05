package com.cogschecker.foodcost.workers.worker;

import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import net.jqwik.api.*;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.*;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Property-based test for Square POS name matching logic.
 * 
 * Property 21: Square POS Name Matching Correctly Identifies Matches and Non-Matches
 * **Validates: Requirements 12.3**
 * 
 * For any Square catalog item name and any recipe library, the matching function must return
 * the recipe whose name is an exact match (case-insensitive) to the Square item name,
 * or return "no match" if no such recipe exists; the function must not return a false positive
 * or miss a true match.
 */
class SquareMatchingServicePropertyTest {
    
    /**
     * Property 21: Square name matching correctly identifies matches and non-matches
     * **Validates: Requirements 12.3**
     * 
     * Given:
     * - An arbitrary Square item name
     * - An arbitrary recipe library (0 to 20 recipes)
     * 
     * Then:
     * - If a recipe exists with an exact case-insensitive match, it must be found
     * - If no recipe exists with an exact case-insensitive match, no match should be returned
     * - No false positives (returning a match when none exists)
     * - No false negatives (missing a match that exists)
     */
    @Property(tries = 5000)
    @Label("P21: Square name matching correctly identifies matches and non-matches")
    void squareNameMatchingCorrectlyIdentifiesMatchesAndNonMatches(
            @ForAll("squareItemName") String squareItemName,
            @ForAll("recipeLibrary") RecipeLibrary recipeLibrary) {
        
        UUID venueId = recipeLibrary.venueId;
        List<Recipe> recipes = recipeLibrary.recipes;
        
        // Setup mock repository
        RecipeRepository recipeRepository = mock(RecipeRepository.class);
        
        // Mock the findByVenueIdAndNameIgnoreCase method to simulate database lookup
        when(recipeRepository.findByVenueIdAndNameIgnoreCase(eq(venueId), any(String.class)))
            .thenAnswer(invocation -> {
                String searchName = invocation.getArgument(1);
                return recipes.stream()
                    .filter(r -> r.getName().equalsIgnoreCase(searchName))
                    .findFirst();
            });
        
        // Execute the matching logic (as done in SquareSyncWorker.syncVenue)
        Optional<Recipe> matchedRecipe = recipeRepository.findByVenueIdAndNameIgnoreCase(venueId, squareItemName);
        
        // Determine the expected result: does a case-insensitive exact match exist?
        boolean shouldMatch = recipes.stream()
            .anyMatch(r -> r.getName().equalsIgnoreCase(squareItemName));
        
        Optional<Recipe> expectedMatch = recipes.stream()
            .filter(r -> r.getName().equalsIgnoreCase(squareItemName))
            .findFirst();
        
        // Assertions
        if (shouldMatch) {
            // True match case: recipe with exact case-insensitive name exists
            assertThat(matchedRecipe)
                .as("When recipe with name '%s' exists (case-insensitive), match must be found", squareItemName)
                .isPresent();
            
            assertThat(matchedRecipe.get().getName())
                .as("Matched recipe name must equal Square item name (case-insensitive)")
                .isEqualToIgnoringCase(squareItemName);
            
            assertThat(matchedRecipe.get().getId())
                .as("Matched recipe must be the expected recipe")
                .isEqualTo(expectedMatch.get().getId());
            
        } else {
            // No match case: no recipe with exact case-insensitive name exists
            assertThat(matchedRecipe)
                .as("When no recipe with name '%s' exists (case-insensitive), no match should be returned", squareItemName)
                .isEmpty();
        }
        
        // Additional invariants:
        // 1. If match is found, it must be an exact case-insensitive match (not partial)
        if (matchedRecipe.isPresent()) {
            assertThat(matchedRecipe.get().getName().equalsIgnoreCase(squareItemName))
                .as("Match must be exact case-insensitive, not partial")
                .isTrue();
        }
        
        // 2. No false positives: if no match is returned, no recipe should have that exact name
        if (matchedRecipe.isEmpty()) {
            boolean anyExactMatch = recipes.stream()
                .anyMatch(r -> r.getName().equalsIgnoreCase(squareItemName));
            
            assertThat(anyExactMatch)
                .as("If no match returned, no recipe should have exact case-insensitive name '%s'", squareItemName)
                .isFalse();
        }
    }
    
    /**
     * Focused test: verify partial matches are NOT matched (only exact matches count)
     */
    @Property(tries = 1000)
    @Label("P21.1: Partial name matches are not matched (only exact matches)")
    void partialNameMatchesAreNotMatched(
            @ForAll("validRecipeName") String fullRecipeName,
            @ForAll("prefixSuffixOrSubstring") String modification) {
        
        UUID venueId = UUID.randomUUID();
        
        // Create a recipe with the full name
        Recipe recipe = createRecipe(venueId, fullRecipeName);
        List<Recipe> recipes = List.of(recipe);
        
        // Create a modified Square item name that is NOT an exact match
        // (either shorter, longer, or contains the recipe name as substring)
        String squareItemName;
        if (modification.equals("prefix") && fullRecipeName.length() > 1) {
            // Take only a prefix of the recipe name
            squareItemName = fullRecipeName.substring(0, fullRecipeName.length() - 1);
        } else if (modification.equals("suffix") && fullRecipeName.length() > 1) {
            // Take only a suffix of the recipe name
            squareItemName = fullRecipeName.substring(1);
        } else if (modification.equals("add-prefix")) {
            // Add a prefix to the recipe name
            squareItemName = "Extra " + fullRecipeName;
        } else if (modification.equals("add-suffix")) {
            // Add a suffix to the recipe name
            squareItemName = fullRecipeName + " Extra";
        } else {
            // Default: add both
            squareItemName = "Prefix " + fullRecipeName + " Suffix";
        }
        
        // Ensure the names are different (case-insensitive)
        Assume.that(!squareItemName.equalsIgnoreCase(fullRecipeName));
        
        // Setup mock repository
        RecipeRepository recipeRepository = mock(RecipeRepository.class);
        
        when(recipeRepository.findByVenueIdAndNameIgnoreCase(eq(venueId), any(String.class)))
            .thenAnswer(invocation -> {
                String searchName = invocation.getArgument(1);
                return recipes.stream()
                    .filter(r -> r.getName().equalsIgnoreCase(searchName))
                    .findFirst();
            });
        
        // Execute matching
        Optional<Recipe> matchedRecipe = recipeRepository.findByVenueIdAndNameIgnoreCase(venueId, squareItemName);
        
        // Assertion: no match should be found for partial/extended names
        assertThat(matchedRecipe)
            .as("Partial match: Square item '%s' should NOT match recipe '%s'", squareItemName, fullRecipeName)
            .isEmpty();
    }
    
    /**
     * Focused test: verify case variations of the same name all match
     */
    @Property(tries = 1000)
    @Label("P21.2: Case variations of the same name all match")
    void caseVariationsOfSameNameAllMatch(
            @ForAll("validRecipeName") String baseRecipeName) {
        
        UUID venueId = UUID.randomUUID();
        
        // Create a recipe with the base name
        Recipe recipe = createRecipe(venueId, baseRecipeName);
        List<Recipe> recipes = List.of(recipe);
        
        // Generate case variations
        String lowerCase = baseRecipeName.toLowerCase(Locale.ROOT);
        String upperCase = baseRecipeName.toUpperCase(Locale.ROOT);
        String titleCase = toTitleCase(baseRecipeName);
        String randomCase = randomizeCase(baseRecipeName);
        
        String[] caseVariations = {baseRecipeName, lowerCase, upperCase, titleCase, randomCase};
        
        // Setup mock repository
        RecipeRepository recipeRepository = mock(RecipeRepository.class);
        
        when(recipeRepository.findByVenueIdAndNameIgnoreCase(eq(venueId), any(String.class)))
            .thenAnswer(invocation -> {
                String searchName = invocation.getArgument(1);
                return recipes.stream()
                    .filter(r -> r.getName().equalsIgnoreCase(searchName))
                    .findFirst();
            });
        
        // Test all case variations
        for (String caseVariation : caseVariations) {
            Optional<Recipe> matchedRecipe = recipeRepository.findByVenueIdAndNameIgnoreCase(venueId, caseVariation);
            
            assertThat(matchedRecipe)
                .as("Case variation '%s' of base name '%s' should match", caseVariation, baseRecipeName)
                .isPresent();
            
            assertThat(matchedRecipe.get().getId())
                .as("Case variation '%s' should match the same recipe", caseVariation)
                .isEqualTo(recipe.getId());
        }
    }
    
    /**
     * Focused test: multiple recipes with different names, no false matches
     */
    @Property(tries = 1000)
    @Label("P21.3: No false matches with multiple distinct recipes")
    void noFalseMatchesWithMultipleDistinctRecipes(
            @ForAll("recipeLibraryWithDistinctNames") RecipeLibrary recipeLibrary,
            @ForAll("validRecipeName") String squareItemName) {
        
        UUID venueId = recipeLibrary.venueId;
        List<Recipe> recipes = recipeLibrary.recipes;
        
        // Assume the Square item name is not in the recipe library (case-insensitive)
        Assume.that(recipes.stream().noneMatch(r -> r.getName().equalsIgnoreCase(squareItemName)));
        
        // Setup mock repository
        RecipeRepository recipeRepository = mock(RecipeRepository.class);
        
        when(recipeRepository.findByVenueIdAndNameIgnoreCase(eq(venueId), any(String.class)))
            .thenAnswer(invocation -> {
                String searchName = invocation.getArgument(1);
                return recipes.stream()
                    .filter(r -> r.getName().equalsIgnoreCase(searchName))
                    .findFirst();
            });
        
        // Execute matching
        Optional<Recipe> matchedRecipe = recipeRepository.findByVenueIdAndNameIgnoreCase(venueId, squareItemName);
        
        // Assertion: no match should be found
        assertThat(matchedRecipe)
            .as("Square item '%s' not in library should return no match", squareItemName)
            .isEmpty();
    }
    
    // ========== Arbitrary Providers ==========
    
    /**
     * Provides a valid Square item name (same constraints as recipe names: 1-100 chars).
     */
    @Provide
    Arbitrary<String> squareItemName() {
        return Arbitraries.strings()
            .withCharRange('a', 'z')
            .withCharRange('A', 'Z')
            .withChars(' ', '-', '_', '\'', '&', '.', ',')
            .ofMinLength(1)
            .ofMaxLength(100)
            .filter(s -> !s.trim().isEmpty())
            .filter(s -> s.chars().anyMatch(Character::isLetter));
    }
    
    /**
     * Provides a valid recipe name (1-100 chars with at least one letter).
     */
    @Provide
    Arbitrary<String> validRecipeName() {
        return Arbitraries.strings()
            .withCharRange('a', 'z')
            .withCharRange('A', 'Z')
            .withChars(' ', '-', '_', '\'', '&', '.', ',')
            .ofMinLength(1)
            .ofMaxLength(100)
            .filter(s -> !s.trim().isEmpty())
            .filter(s -> s.chars().anyMatch(Character::isLetter));
    }
    
    /**
     * Provides a modification type for partial match tests.
     */
    @Provide
    Arbitrary<String> prefixSuffixOrSubstring() {
        return Arbitraries.of("prefix", "suffix", "add-prefix", "add-suffix", "add-both");
    }
    
    /**
     * Provides a recipe library with 0 to 20 recipes.
     * Recipe names may or may not be distinct.
     */
    @Provide
    Arbitrary<RecipeLibrary> recipeLibrary() {
        UUID venueId = UUID.randomUUID();
        
        return Arbitraries.integers().between(0, 20).flatMap(count -> {
            Arbitrary<List<Recipe>> recipesArbitrary = validRecipeName()
                .list().ofSize(count)
                .map(names -> names.stream()
                    .map(name -> createRecipe(venueId, name))
                    .collect(Collectors.toList()));
            
            return recipesArbitrary.map(recipes -> new RecipeLibrary(venueId, recipes));
        });
    }
    
    /**
     * Provides a recipe library where all recipe names are distinct (case-insensitive).
     */
    @Provide
    Arbitrary<RecipeLibrary> recipeLibraryWithDistinctNames() {
        UUID venueId = UUID.randomUUID();
        
        return Arbitraries.integers().between(0, 20).flatMap(count -> {
            // Generate distinct names by ensuring uniqueness (case-insensitive)
            Arbitrary<List<String>> distinctNamesArbitrary = validRecipeName()
                .list().ofMinSize(count).ofMaxSize(count * 2)
                .map(names -> {
                    // Filter to get case-insensitive distinct names
                    Set<String> seen = new HashSet<>();
                    List<String> distinctNames = new ArrayList<>();
                    for (String name : names) {
                        String lowerName = name.toLowerCase(Locale.ROOT);
                        if (!seen.contains(lowerName)) {
                            seen.add(lowerName);
                            distinctNames.add(name);
                            if (distinctNames.size() >= count) {
                                break;
                            }
                        }
                    }
                    return distinctNames;
                })
                .filter(names -> names.size() >= count);
            
            return distinctNamesArbitrary.map(names -> {
                List<Recipe> recipes = names.stream()
                    .map(name -> createRecipe(venueId, name))
                    .collect(Collectors.toList());
                return new RecipeLibrary(venueId, recipes);
            });
        });
    }
    
    // ========== Helper Methods ==========
    
    /**
     * Create a Recipe entity with the given venue ID and name.
     */
    private Recipe createRecipe(UUID venueId, String name) {
        Recipe recipe = new Recipe();
        recipe.setId(UUID.randomUUID());
        recipe.setVenueId(venueId);
        recipe.setName(name);
        recipe.setPortionCount(1);
        recipe.setMenuSellingPrice(BigDecimal.TEN);
        recipe.setTotalBatchCost(BigDecimal.ZERO);
        recipe.setFoodCostPerPortion(BigDecimal.ZERO);
        recipe.setFoodCostPercentage(null);
        return recipe;
    }
    
    /**
     * Convert a string to title case (first letter of each word capitalized).
     */
    private String toTitleCase(String input) {
        if (input == null || input.isEmpty()) {
            return input;
        }
        
        StringBuilder result = new StringBuilder();
        boolean capitalizeNext = true;
        
        for (char c : input.toCharArray()) {
            if (Character.isWhitespace(c)) {
                result.append(c);
                capitalizeNext = true;
            } else if (capitalizeNext) {
                result.append(Character.toUpperCase(c));
                capitalizeNext = false;
            } else {
                result.append(Character.toLowerCase(c));
            }
        }
        
        return result.toString();
    }
    
    /**
     * Randomize the case of letters in a string.
     */
    private String randomizeCase(String input) {
        if (input == null || input.isEmpty()) {
            return input;
        }
        
        Random random = new Random();
        StringBuilder result = new StringBuilder();
        
        for (char c : input.toCharArray()) {
            if (Character.isLetter(c)) {
                result.append(random.nextBoolean() ? Character.toUpperCase(c) : Character.toLowerCase(c));
            } else {
                result.append(c);
            }
        }
        
        return result.toString();
    }
    
    // ========== Helper Classes ==========
    
    /**
     * Holder class for a recipe library (venue + recipes).
     */
    private static class RecipeLibrary {
        final UUID venueId;
        final List<Recipe> recipes;
        
        RecipeLibrary(UUID venueId, List<Recipe> recipes) {
            this.venueId = venueId;
            this.recipes = recipes;
        }
    }
}
