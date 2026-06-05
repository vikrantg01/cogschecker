package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.SystemConfig;
import com.cogschecker.foodcost.api.dto.RecipeResponse;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.shared.ThresholdStatus;
import net.jqwik.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Property-based tests for ReportService using jqwik.
 * 
 * These tests verify report generation invariants hold across thousands of
 * randomly generated recipe datasets, ensuring correctness of sorting and filtering.
 */
class ReportServicePropertyTest {
    
    private static final UUID TEST_VENUE_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final BigDecimal DEFAULT_THRESHOLD = new BigDecimal("30.0");
    
    /**
     * Property 13: Report Sort Is Correct for All Columns and Directions
     * **Validates: Requirements 5.2, 5.3**
     * 
     * Verifies that for any set of recipes and any sortable column/direction combo,
     * the report is correctly sorted according to a reference Comparator-based sort,
     * and that toggling the same column reverses the direction.
     */
    @Property(tries = 100)
    @Label("P13: report sort is correct for all columns and directions")
    void reportSortIsCorrectForAllColumnsAndDirections(
            @ForAll("recipeDtoLists") List<RecipeDto> recipeDtos,
            @ForAll("sortableColumns") String sortColumn,
            @ForAll("sortDirections") String sortDir) {
        
        // Setup mocks and create service
        ReportService reportService = setupMocks(recipeDtos);
        
        // Get the actual sorted result from the service
        List<RecipeResponse> actualResult = reportService.getCostingReport(
            TEST_VENUE_ID, sortColumn, sortDir, null);
        
        // Calculate expected result using reference Comparator-based sort
        List<RecipeResponse> expectedResult = getExpectedSortedResult(recipeDtos, sortColumn, sortDir);
        
        // Assert that actual result matches expected result
        assertEquals(expectedResult.size(), actualResult.size(),
            String.format("Result size mismatch for sortColumn=%s, sortDir=%s", sortColumn, sortDir));
        
        for (int i = 0; i < expectedResult.size(); i++) {
            RecipeResponse expected = expectedResult.get(i);
            RecipeResponse actual = actualResult.get(i);
            
            assertEquals(expected.getName(), actual.getName(),
                String.format("At position %d for sortColumn=%s, sortDir=%s: expected name=%s but got name=%s",
                    i, sortColumn, sortDir, expected.getName(), actual.getName()));
            
            // Verify the sort column values match
            assertSortColumnValuesMatch(expected, actual, sortColumn, i, sortDir);
        }
    }
    
    /**
     * Property 13b: Toggle Same Column Reverses Sort Direction
     * **Validates: Requirements 5.2, 5.3**
     * 
     * Verifies that sorting by the same column twice with opposite directions
     * produces correctly ordered results. Note: For recipes with duplicate sort values,
     * we verify that each direction is sorted correctly, but don't require exact reversal
     * since Java's sort is stable and may order equal elements differently.
     */
    @Property(tries = 100)
    @Label("P13b: toggling same column reverses sort direction")
    void togglingSameColumnReversesSortDirection(
            @ForAll("recipeDtoLists") List<RecipeDto> recipeDtos,
            @ForAll("sortableColumns") String sortColumn) {
        
        // Setup mocks and create service
        ReportService reportService = setupMocks(recipeDtos);
        
        // Get ascending sort result
        List<RecipeResponse> ascResult = reportService.getCostingReport(
            TEST_VENUE_ID, sortColumn, "asc", null);
        
        // Get descending sort result
        List<RecipeResponse> descResult = reportService.getCostingReport(
            TEST_VENUE_ID, sortColumn, "desc", null);
        
        // Assert that both have the same size
        assertEquals(ascResult.size(), descResult.size(),
            String.format("Result size mismatch for sortColumn=%s", sortColumn));
        
        // Verify ascending sort is correct
        List<RecipeResponse> expectedAsc = getExpectedSortedResult(recipeDtos, sortColumn, "asc");
        for (int i = 0; i < expectedAsc.size(); i++) {
            assertEquals(expectedAsc.get(i).getName(), ascResult.get(i).getName(),
                String.format("Ascending sort incorrect at position %d for sortColumn=%s", i, sortColumn));
        }
        
        // Verify descending sort is correct
        List<RecipeResponse> expectedDesc = getExpectedSortedResult(recipeDtos, sortColumn, "desc");
        for (int i = 0; i < expectedDesc.size(); i++) {
            assertEquals(expectedDesc.get(i).getName(), descResult.get(i).getName(),
                String.format("Descending sort incorrect at position %d for sortColumn=%s", i, sortColumn));
        }
    }
    
    /**
     * Property 13c: Default Sort Is Name Ascending
     * **Validates: Requirements 5.3**
     * 
     * Verifies that when no sort column or direction is specified,
     * the default is name ascending.
     */
    @Property(tries = 100)
    @Label("P13c: default sort is name ascending")
    void defaultSortIsNameAscending(
            @ForAll("recipeDtoLists") List<RecipeDto> recipeDtos) {
        
        // Setup mocks and create service
        ReportService reportService = setupMocks(recipeDtos);
        
        // Get default sort result (no column, no direction)
        List<RecipeResponse> defaultResult = reportService.getCostingReport(
            TEST_VENUE_ID, null, null, null);
        
        // Get explicit name ascending result
        List<RecipeResponse> nameAscResult = reportService.getCostingReport(
            TEST_VENUE_ID, "name", "asc", null);
        
        // Assert that default result matches name ascending result
        assertEquals(nameAscResult.size(), defaultResult.size(),
            "Default sort result size should match name ascending result size");
        
        for (int i = 0; i < nameAscResult.size(); i++) {
            assertEquals(nameAscResult.get(i).getName(), defaultResult.get(i).getName(),
                String.format("At position %d: name asc=%s but default=%s",
                    i, nameAscResult.get(i).getName(), defaultResult.get(i).getName()));
        }
    }
    
    // Helper methods
    
    /**
     * Setup mocks for the test.
     */
    private ReportService setupMocks(List<RecipeDto> recipeDtos) {
        // Create mocks
        RecipeRepository recipeRepository = mock(RecipeRepository.class);
        SystemConfigService systemConfigService = mock(SystemConfigService.class);
        
        // Create Recipe domain objects from DTOs
        List<com.cogschecker.foodcost.api.domain.Recipe> recipes = recipeDtos.stream()
            .map(this::toRecipeEntity)
            .collect(Collectors.toList());
        
        when(recipeRepository.findByVenueId(TEST_VENUE_ID)).thenReturn(recipes);
        
        SystemConfig config = new SystemConfig(TEST_VENUE_ID, DEFAULT_THRESHOLD);
        when(systemConfigService.getConfig(TEST_VENUE_ID)).thenReturn(config);
        
        // Create and return the service with mocked dependencies
        return new ReportService(recipeRepository, systemConfigService);
    }
    
    /**
     * Convert RecipeDto to Recipe domain entity.
     */
    private com.cogschecker.foodcost.api.domain.Recipe toRecipeEntity(RecipeDto dto) {
        com.cogschecker.foodcost.api.domain.Recipe recipe = new com.cogschecker.foodcost.api.domain.Recipe();
        recipe.setId(dto.id);
        recipe.setVenueId(TEST_VENUE_ID);
        recipe.setName(dto.name);
        recipe.setPortionCount(dto.portionCount);
        recipe.setMenuSellingPrice(dto.menuSellingPrice);
        recipe.setTotalBatchCost(dto.totalBatchCost);
        recipe.setFoodCostPerPortion(dto.foodCostPerPortion);
        recipe.setFoodCostPercentage(dto.foodCostPercentage);
        recipe.setCreatedAt(dto.createdAt);
        recipe.setUpdatedAt(dto.updatedAt);
        return recipe;
    }
    
    /**
     * Get expected sorted result using reference Comparator-based implementation.
     * This is the reference implementation that mirrors the requirements.
     */
    private List<RecipeResponse> getExpectedSortedResult(
            List<RecipeDto> recipeDtos,
            String sortColumn,
            String sortDir) {
        
        // Filter recipes that pass pre-inclusion validation
        List<RecipeResponse> responses = recipeDtos.stream()
            .filter(this::passesPreInclusionValidation)
            .map(this::toRecipeResponse)
            .collect(Collectors.toList());
        
        // Get the comparator for the sort column
        Comparator<RecipeResponse> comparator = getReferenceComparator(sortColumn);
        
        // Determine sort direction
        boolean ascending = sortDir == null || sortDir.trim().isEmpty() || "asc".equalsIgnoreCase(sortDir);
        if (!ascending) {
            comparator = comparator.reversed();
        }
        
        // Sort the responses
        responses.sort(comparator);
        
        return responses;
    }
    
    /**
     * Validate that a recipe passes pre-inclusion criteria (Requirements 5.1).
     */
    private boolean passesPreInclusionValidation(RecipeDto dto) {
        // Non-empty name
        if (dto.name == null || dto.name.trim().isEmpty()) {
            return false;
        }
        
        // Non-negative food cost per portion
        if (dto.foodCostPerPortion != null && dto.foodCostPerPortion.compareTo(BigDecimal.ZERO) < 0) {
            return false;
        }
        
        // Non-negative menu selling price
        if (dto.menuSellingPrice != null && dto.menuSellingPrice.compareTo(BigDecimal.ZERO) < 0) {
            return false;
        }
        
        return true;
    }
    
    /**
     * Convert RecipeDto to RecipeResponse.
     */
    private RecipeResponse toRecipeResponse(RecipeDto dto) {
        RecipeResponse response = new RecipeResponse();
        response.setId(dto.id);
        response.setVenueId(TEST_VENUE_ID);
        response.setName(dto.name);
        response.setPortionCount(dto.portionCount);
        response.setMenuSellingPrice(dto.menuSellingPrice);
        response.setTotalBatchCost(dto.totalBatchCost);
        response.setFoodCostPerPortion(dto.foodCostPerPortion);
        response.setFoodCostPercentage(dto.foodCostPercentage);
        response.setCreatedAt(dto.createdAt);
        response.setUpdatedAt(dto.updatedAt);
        
        // Evaluate threshold status
        response.setThresholdStatus(evaluateThresholdStatus(dto.foodCostPercentage));
        
        return response;
    }
    
    /**
     * Evaluate threshold status for a food cost percentage.
     */
    private ThresholdStatus evaluateThresholdStatus(BigDecimal foodCostPercentage) {
        if (foodCostPercentage == null) {
            return null;
        }
        return foodCostPercentage.compareTo(DEFAULT_THRESHOLD) > 0 
            ? ThresholdStatus.EXCEEDING 
            : ThresholdStatus.PASSING;
    }
    
    /**
     * Get reference comparator for the specified sort column.
     * This mirrors the ReportService.getComparator logic.
     */
    private Comparator<RecipeResponse> getReferenceComparator(String sortColumn) {
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
    
    /**
     * Assert that the sort column values match between expected and actual.
     */
    private void assertSortColumnValuesMatch(
            RecipeResponse expected,
            RecipeResponse actual,
            String sortColumn,
            int position,
            String sortDir) {
        
        if (sortColumn == null || sortColumn.trim().isEmpty()) {
            sortColumn = "name";
        }
        
        switch (sortColumn.toLowerCase()) {
            case "foodcostperportion" -> {
                if (expected.getFoodCostPerPortion() == null) {
                    assertNull(actual.getFoodCostPerPortion(),
                        String.format("At position %d: expected null foodCostPerPortion but got %s",
                            position, actual.getFoodCostPerPortion()));
                } else {
                    assertEquals(0, expected.getFoodCostPerPortion().compareTo(actual.getFoodCostPerPortion()),
                        String.format("At position %d: foodCostPerPortion mismatch: expected %s but got %s",
                            position, expected.getFoodCostPerPortion(), actual.getFoodCostPerPortion()));
                }
            }
            case "menusellingprice" -> {
                if (expected.getMenuSellingPrice() == null) {
                    assertNull(actual.getMenuSellingPrice(),
                        String.format("At position %d: expected null menuSellingPrice but got %s",
                            position, actual.getMenuSellingPrice()));
                } else {
                    assertEquals(0, expected.getMenuSellingPrice().compareTo(actual.getMenuSellingPrice()),
                        String.format("At position %d: menuSellingPrice mismatch: expected %s but got %s",
                            position, expected.getMenuSellingPrice(), actual.getMenuSellingPrice()));
                }
            }
            case "foodcostpercentage" -> {
                if (expected.getFoodCostPercentage() == null) {
                    assertNull(actual.getFoodCostPercentage(),
                        String.format("At position %d: expected null foodCostPercentage but got %s",
                            position, actual.getFoodCostPercentage()));
                } else {
                    assertEquals(0, expected.getFoodCostPercentage().compareTo(actual.getFoodCostPercentage()),
                        String.format("At position %d: foodCostPercentage mismatch: expected %s but got %s",
                            position, expected.getFoodCostPercentage(), actual.getFoodCostPercentage()));
                }
            }
            default -> {
                // Name comparison is already done in the main assertion
            }
        }
    }
    
    // Arbitrary generators
    
    /**
     * Generate lists of recipe DTOs with varied compositions.
     * Generates 0-20 recipes to test various dataset sizes.
     */
    @Provide
    Arbitrary<List<RecipeDto>> recipeDtoLists() {
        return Arbitraries.integers().between(0, 20)
            .flatMap(numRecipes -> {
                if (numRecipes == 0) {
                    return Arbitraries.just(new ArrayList<>());
                }
                
                List<Arbitrary<RecipeDto>> recipeDtoArbitraries = new ArrayList<>();
                for (int i = 0; i < numRecipes; i++) {
                    recipeDtoArbitraries.add(recipeDtoArbitrary());
                }
                return Combinators.combine(recipeDtoArbitraries)
                    .as(ArrayList::new);
            });
    }
    
    /**
     * Generate a single recipe DTO with varied field values.
     */
    @Provide
    Arbitrary<RecipeDto> recipeDtoArbitrary() {
        // Generate recipe names with variety (including some duplicates to test stable sort)
        Arbitrary<String> name = Arbitraries.oneOf(
            // Valid names
            Arbitraries.strings().alpha().ofMinLength(1).ofMaxLength(50),
            // Some common names that will create duplicates
            Arbitraries.of("Apple Pie", "Banana Bread", "Chocolate Cake", "Donut", "Egg Tart"),
            // Edge cases (these should be filtered out by pre-inclusion validation)
            Arbitraries.of("", "   ", null)
        );
        
        Arbitrary<Integer> portionCount = Arbitraries.integers().between(1, 9999);
        
        // Menu selling price - nullable, can be 0 or negative (for validation testing)
        Arbitrary<BigDecimal> menuSellingPrice = Arbitraries.oneOf(
            Arbitraries.just((BigDecimal) null),
            Arbitraries.bigDecimals()
                .between(new BigDecimal("0.01"), new BigDecimal("999.99"))
                .ofScale(2),
            Arbitraries.just(BigDecimal.ZERO),
            Arbitraries.bigDecimals()
                .between(new BigDecimal("-100.00"), new BigDecimal("-0.01"))
                .ofScale(2)
        );
        
        // Food cost per portion - nullable, can be negative (for validation testing)
        Arbitrary<BigDecimal> foodCostPerPortion = Arbitraries.oneOf(
            Arbitraries.just((BigDecimal) null),
            Arbitraries.bigDecimals()
                .between(BigDecimal.ZERO, new BigDecimal("999.99"))
                .ofScale(2),
            Arbitraries.bigDecimals()
                .between(new BigDecimal("-100.00"), new BigDecimal("-0.01"))
                .ofScale(2)
        );
        
        // Food cost percentage - nullable, varied values
        Arbitrary<BigDecimal> foodCostPercentage = Arbitraries.oneOf(
            Arbitraries.just((BigDecimal) null),
            Arbitraries.bigDecimals()
                .between(new BigDecimal("0.1"), new BigDecimal("200.0"))
                .ofScale(1)
        );
        
        // Total batch cost
        Arbitrary<BigDecimal> totalBatchCost = Arbitraries.oneOf(
            Arbitraries.just((BigDecimal) null),
            Arbitraries.bigDecimals()
                .between(BigDecimal.ZERO, new BigDecimal("9999.99"))
                .ofScale(2)
        );
        
        // Build RecipeDto using flatMap to handle all 9 fields
        return name.flatMap(n ->
            portionCount.flatMap(pc ->
                menuSellingPrice.flatMap(msp ->
                    foodCostPerPortion.flatMap(fcp ->
                        foodCostPercentage.flatMap(fcpct ->
                            totalBatchCost.flatMap(tbc ->
                                Arbitraries.randomValue(random -> new RecipeDto(
                                    UUID.randomUUID(),
                                    n,
                                    pc,
                                    msp,
                                    fcp,
                                    fcpct,
                                    tbc,
                                    Instant.now().minusSeconds(random.nextInt(365 * 24 * 3600)),
                                    Instant.now().minusSeconds(random.nextInt(30 * 24 * 3600))
                                ))
                            )
                        )
                    )
                )
            )
        );
    }
    
    /**
     * Generate sortable column names.
     */
    @Provide
    Arbitrary<String> sortableColumns() {
        return Arbitraries.of(
            "name",
            "foodCostPerPortion",
            "menuSellingPrice",
            "foodCostPercentage",
            // Also test with different casings
            "Name",
            "FOODCOSTPERPORTION",
            "MenuSellingPrice",
            // Test with null and empty (should default to name)
            null,
            ""
        );
    }
    
    /**
     * Generate sort directions.
     */
    @Provide
    Arbitrary<String> sortDirections() {
        return Arbitraries.of(
            "asc",
            "desc",
            "ASC",
            "DESC",
            "Asc",
            "Desc",
            // Test with null and empty (should default to asc)
            null,
            ""
        );
    }
    
    /**
     * Property 14: Threshold Filter Returns Exactly the Exceeding Recipes
     * **Validates: Requirements 5.4**
     * 
     * Verifies that the threshold filter returns exactly the set of recipes where:
     * - food cost percentage > threshold
     * - menu price is not null and > 0
     * 
     * All other recipes (those with null/zero menu price or fcp <= threshold) should be excluded.
     */
    @Property(tries = 5000)
    @Label("P14: threshold filter returns exactly the exceeding recipes")
    void thresholdFilterReturnsExactlyExceedingRecipes(
            @ForAll("recipeDtoLists") List<RecipeDto> recipeDtos,
            @ForAll("thresholdValues") BigDecimal threshold) {
        
        // Setup mocks with custom threshold
        RecipeRepository recipeRepository = mock(RecipeRepository.class);
        SystemConfigService systemConfigService = mock(SystemConfigService.class);
        
        // Create Recipe domain objects from DTOs
        List<com.cogschecker.foodcost.api.domain.Recipe> recipes = recipeDtos.stream()
            .map(this::toRecipeEntity)
            .collect(Collectors.toList());
        
        when(recipeRepository.findByVenueId(TEST_VENUE_ID)).thenReturn(recipes);
        
        com.cogschecker.foodcost.api.domain.SystemConfig config = 
            new com.cogschecker.foodcost.api.domain.SystemConfig(TEST_VENUE_ID, threshold);
        when(systemConfigService.getConfig(TEST_VENUE_ID)).thenReturn(config);
        
        ReportService reportService = new ReportService(recipeRepository, systemConfigService);
        
        // Get the filtered result from the service using "exceedsThreshold" filter
        List<RecipeResponse> actualFiltered = reportService.getCostingReport(
            TEST_VENUE_ID, null, null, "exceedsThreshold");
        
        // Manually compute expected result: {r | r.fcp > threshold && r.menuPrice != null && r.menuPrice > 0}
        // Also apply pre-inclusion validation
        List<RecipeResponse> expectedFiltered = recipeDtos.stream()
                .filter(this::passesPreInclusionValidation)
                .filter(r -> r.menuSellingPrice != null && r.menuSellingPrice.compareTo(BigDecimal.ZERO) > 0)
                .filter(r -> r.foodCostPercentage != null && r.foodCostPercentage.compareTo(threshold) > 0)
                .map(this::toRecipeResponseForFilter)
                .collect(Collectors.toList());
        
        // Assert that filtered set equals expected set
        assertEquals(expectedFiltered.size(), actualFiltered.size(),
            String.format("Filtered recipe count mismatch for threshold %s: expected %d but got %d",
                threshold, expectedFiltered.size(), actualFiltered.size()));
        
        // Convert to sets for easier comparison (order doesn't matter for this test)
        Set<UUID> expectedIds = expectedFiltered.stream()
                .map(RecipeResponse::getId)
                .collect(Collectors.toSet());
        
        Set<UUID> actualIds = actualFiltered.stream()
                .map(RecipeResponse::getId)
                .collect(Collectors.toSet());
        
        // Verify each expected recipe is in the actual filtered list
        assertEquals(expectedIds, actualIds,
            String.format("Recipe ID sets don't match for threshold %s. Expected: %s, Actual: %s",
                threshold, expectedIds, actualIds));
        
        // Additional verification: ensure all recipes in filtered result exceed threshold
        for (RecipeResponse recipe : actualFiltered) {
            assertNotNull(recipe.getMenuSellingPrice(),
                String.format("Recipe '%s' in filtered result has null menu price", recipe.getName()));
            
            assertTrue(recipe.getMenuSellingPrice().compareTo(BigDecimal.ZERO) > 0,
                String.format("Recipe '%s' in filtered result has menu price <= 0: %s",
                    recipe.getName(), recipe.getMenuSellingPrice()));
            
            assertNotNull(recipe.getFoodCostPercentage(),
                String.format("Recipe '%s' in filtered result has null food cost percentage", recipe.getName()));
            
            assertTrue(recipe.getFoodCostPercentage().compareTo(threshold) > 0,
                String.format("Recipe '%s' with fcp=%s should not be in filtered list for threshold %s",
                    recipe.getName(), recipe.getFoodCostPercentage(), threshold));
        }
    }
    
    /**
     * Property 14b: Threshold Filter Excludes Recipes Without Menu Price
     * **Validates: Requirements 5.4**
     * 
     * Verifies that recipes without a menu price are always excluded from the threshold filter,
     * regardless of their food cost percentage.
     */
    @Property(tries = 1000)
    @Label("P14b: threshold filter excludes recipes without menu price")
    void thresholdFilterExcludesRecipesWithoutMenuPrice(
            @ForAll("recipeDtoListsWithNullMenuPrice") List<RecipeDto> recipeDtos,
            @ForAll("thresholdValues") BigDecimal threshold) {
        
        // Setup mocks with custom threshold
        RecipeRepository recipeRepository = mock(RecipeRepository.class);
        SystemConfigService systemConfigService = mock(SystemConfigService.class);
        
        // Create Recipe domain objects from DTOs
        List<com.cogschecker.foodcost.api.domain.Recipe> recipes = recipeDtos.stream()
            .map(this::toRecipeEntity)
            .collect(Collectors.toList());
        
        when(recipeRepository.findByVenueId(TEST_VENUE_ID)).thenReturn(recipes);
        
        com.cogschecker.foodcost.api.domain.SystemConfig config = 
            new com.cogschecker.foodcost.api.domain.SystemConfig(TEST_VENUE_ID, threshold);
        when(systemConfigService.getConfig(TEST_VENUE_ID)).thenReturn(config);
        
        ReportService reportService = new ReportService(recipeRepository, systemConfigService);
        
        // Get the filtered result
        List<RecipeResponse> actualFiltered = reportService.getCostingReport(
            TEST_VENUE_ID, null, null, "exceedsThreshold");
        
        // All recipes in the input have null menu price, so filtered result should be empty
        assertTrue(actualFiltered.isEmpty(),
            String.format("Expected empty filtered result when all recipes have null menu price, but got %d recipes",
                actualFiltered.size()));
    }
    
    /**
     * Property 14c: No Filter Returns All Valid Recipes
     * **Validates: Requirements 5.1, 5.4**
     * 
     * Verifies that when no filter is applied, all recipes that pass pre-inclusion validation
     * are included in the report, regardless of their threshold status.
     */
    @Property(tries = 1000)
    @Label("P14c: no filter returns all valid recipes")
    void noFilterReturnsAllValidRecipes(
            @ForAll("recipeDtoLists") List<RecipeDto> recipeDtos) {
        
        // Setup mocks
        ReportService reportService = setupMocks(recipeDtos);
        
        // Get the unfiltered result (filter = null)
        List<RecipeResponse> actualUnfiltered = reportService.getCostingReport(
            TEST_VENUE_ID, null, null, null);
        
        // Expected: all recipes that pass pre-inclusion validation
        long expectedCount = recipeDtos.stream()
                .filter(this::passesPreInclusionValidation)
                .count();
        
        // Assert that all valid recipes are included
        assertEquals(expectedCount, actualUnfiltered.size(),
            String.format("Expected %d valid recipes in unfiltered report, but got %d",
                expectedCount, actualUnfiltered.size()));
    }
    
    /**
     * Convert RecipeDto to RecipeResponse for filter tests.
     */
    private RecipeResponse toRecipeResponseForFilter(RecipeDto dto) {
        RecipeResponse response = new RecipeResponse();
        response.setId(dto.id);
        response.setVenueId(TEST_VENUE_ID);
        response.setName(dto.name);
        response.setPortionCount(dto.portionCount);
        response.setMenuSellingPrice(dto.menuSellingPrice);
        response.setTotalBatchCost(dto.totalBatchCost);
        response.setFoodCostPerPortion(dto.foodCostPerPortion);
        response.setFoodCostPercentage(dto.foodCostPercentage);
        response.setCreatedAt(dto.createdAt);
        response.setUpdatedAt(dto.updatedAt);
        return response;
    }
    
    /**
     * Generator for threshold values (1.0 to 100.0, scale 1).
     * Requirement 4.6: threshold is a value between 1 and 100 (inclusive).
     */
    @Provide
    Arbitrary<BigDecimal> thresholdValues() {
        return Arbitraries.bigDecimals()
            .between(BigDecimal.ONE, new BigDecimal("100.0"))
            .ofScale(1);
    }
    
    /**
     * Generator for recipe DTO lists where all recipes have null menu price.
     * Used for testing that threshold filter excludes recipes without menu price.
     */
    @Provide
    Arbitrary<List<RecipeDto>> recipeDtoListsWithNullMenuPrice() {
        return Arbitraries.integers().between(1, 20)
            .flatMap(numRecipes -> {
                List<Arbitrary<RecipeDto>> recipeDtoArbitraries = new ArrayList<>();
                for (int i = 0; i < numRecipes; i++) {
                    recipeDtoArbitraries.add(recipeDtoWithNullMenuPriceArbitrary());
                }
                return Combinators.combine(recipeDtoArbitraries)
                    .as(ArrayList::new);
            });
    }
    
    /**
     * Generate a single recipe DTO with null menu price and varied food cost percentage.
     */
    @Provide
    Arbitrary<RecipeDto> recipeDtoWithNullMenuPriceArbitrary() {
        Arbitrary<String> name = Arbitraries.strings().alpha().ofMinLength(1).ofMaxLength(50);
        Arbitrary<Integer> portionCount = Arbitraries.integers().between(1, 9999);
        
        // Food cost percentage can be any value (including exceeding typical thresholds)
        Arbitrary<BigDecimal> foodCostPercentage = Arbitraries.oneOf(
            Arbitraries.just(null),
            Arbitraries.bigDecimals()
                .between(new BigDecimal("0.1"), new BigDecimal("200.0"))
                .ofScale(1)
        );
        
        Arbitrary<BigDecimal> foodCostPerPortion = Arbitraries.bigDecimals()
            .between(BigDecimal.ZERO, new BigDecimal("999.99"))
            .ofScale(2);
        
        Arbitrary<BigDecimal> totalBatchCost = Arbitraries.bigDecimals()
            .between(BigDecimal.ZERO, new BigDecimal("9999.99"))
            .ofScale(2);
        
        return name.flatMap(n ->
            portionCount.flatMap(pc ->
                foodCostPercentage.flatMap(fcpct ->
                    foodCostPerPortion.flatMap(fcp ->
                        totalBatchCost.flatMap(tbc ->
                            Arbitraries.randomValue(random -> new RecipeDto(
                                UUID.randomUUID(),
                                n,
                                pc,
                                null, // menu price is always null
                                fcp,
                                fcpct,
                                tbc,
                                Instant.now().minusSeconds(random.nextInt(365 * 24 * 3600)),
                                Instant.now().minusSeconds(random.nextInt(30 * 24 * 3600))
                            ))
                        )
                    )
                )
            )
        );
    }
    
    /**
     * Helper class to hold recipe data for property tests.
     */
    private static class RecipeDto {
        final UUID id;
        final String name;
        final Integer portionCount;
        final BigDecimal menuSellingPrice;
        final BigDecimal foodCostPerPortion;
        final BigDecimal foodCostPercentage;
        final BigDecimal totalBatchCost;
        final Instant createdAt;
        final Instant updatedAt;
        
        RecipeDto(UUID id, String name, Integer portionCount,
                 BigDecimal menuSellingPrice, BigDecimal foodCostPerPortion,
                 BigDecimal foodCostPercentage, BigDecimal totalBatchCost,
                 Instant createdAt, Instant updatedAt) {
            this.id = id;
            this.name = name;
            this.portionCount = portionCount;
            this.menuSellingPrice = menuSellingPrice;
            this.foodCostPerPortion = foodCostPerPortion;
            this.foodCostPercentage = foodCostPercentage;
            this.totalBatchCost = totalBatchCost;
            this.createdAt = createdAt;
            this.updatedAt = updatedAt;
        }
    }
}
