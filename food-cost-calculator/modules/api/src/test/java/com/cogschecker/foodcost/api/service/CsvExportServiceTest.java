package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.dto.RecipeResponse;
import com.cogschecker.foodcost.shared.ThresholdStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for CsvExportService.
 * Requirements: 5.6, 5.7
 */
class CsvExportServiceTest {
    
    private CsvExportService csvExportService;
    
    @BeforeEach
    void setUp() {
        csvExportService = new CsvExportService();
    }
    
    @Test
    void export_EmptyList_ReturnsHeaderOnly() {
        // Given - Requirement 5.7: export only filtered rows (which can be empty)
        List<RecipeResponse> recipes = Collections.emptyList();
        
        // When
        String csv = csvExportService.export(recipes);
        
        // Then
        String expectedHeader = "Recipe Name,Food Cost Per Portion,Menu Price,Food Cost Percentage,Portions Per Batch\n";
        assertEquals(expectedHeader, csv);
    }
    
    @Test
    void export_SingleRecipe_ProducesCorrectlyCsvWithCorrectRounding() {
        // Given - Requirement 5.6: columns with correct decimal places
        RecipeResponse recipe = createRecipe(
            "Chicken Salad",
            new BigDecimal("5.678"),    // Food cost per portion
            new BigDecimal("15.999"),   // Menu price
            new BigDecimal("35.65"),    // Food cost percentage
            4
        );
        
        // When
        String csv = csvExportService.export(Collections.singletonList(recipe));
        
        // Then
        String[] lines = csv.split("\n");
        assertEquals(2, lines.length); // header + 1 data row
        
        // Requirement 5.6: Food Cost Per Portion rounded to 2 d.p.
        // Requirement 5.6: Menu Price rounded to 2 d.p.
        // Requirement 5.6: Food Cost Percentage rounded to 1 d.p.
        String expected = "Chicken Salad,5.68,16.00,35.7,4";
        assertEquals(expected, lines[1]);
    }
    
    @Test
    void export_MultipleRecipes_ProducesMultipleRows() {
        // Given
        List<RecipeResponse> recipes = Arrays.asList(
            createRecipe("Recipe A", new BigDecimal("10.00"), new BigDecimal("30.00"), new BigDecimal("33.3"), 2),
            createRecipe("Recipe B", new BigDecimal("8.50"), new BigDecimal("25.00"), new BigDecimal("34.0"), 3),
            createRecipe("Recipe C", new BigDecimal("12.25"), new BigDecimal("40.00"), new BigDecimal("30.6"), 5)
        );
        
        // When
        String csv = csvExportService.export(recipes);
        
        // Then
        String[] lines = csv.split("\n");
        assertEquals(4, lines.length); // header + 3 data rows
        
        assertEquals("Recipe A,10.00,30.00,33.3,2", lines[1]);
        assertEquals("Recipe B,8.50,25.00,34.0,3", lines[2]);
        assertEquals("Recipe C,12.25,40.00,30.6,5", lines[3]);
    }
    
    @Test
    void export_RecipeWithNullMenuPrice_DisplaysEmptyFieldForPrice() {
        // Given - recipe without menu price set
        RecipeResponse recipe = createRecipe(
            "Incomplete Recipe",
            new BigDecimal("5.00"),
            null,  // No menu price
            null,  // No food cost percentage (can't calculate without menu price)
            2
        );
        
        // When
        String csv = csvExportService.export(Collections.singletonList(recipe));
        
        // Then
        String[] lines = csv.split("\n");
        // Requirement 5.6: N/A for food cost percentage when menu price is null
        String expected = "Incomplete Recipe,5.00,,N/A,2";
        assertEquals(expected, lines[1]);
    }
    
    @Test
    void export_RecipeWithNullFoodCostPerPortion_DisplaysEmptyField() {
        // Given
        RecipeResponse recipe = createRecipe(
            "Recipe Without Cost",
            null,  // No food cost per portion
            new BigDecimal("20.00"),
            null,  // No percentage
            3
        );
        
        // When
        String csv = csvExportService.export(Collections.singletonList(recipe));
        
        // Then
        String[] lines = csv.split("\n");
        String expected = "Recipe Without Cost,,20.00,N/A,3";
        assertEquals(expected, lines[1]);
    }
    
    @Test
    void export_RecipeNameWithComma_EscapesFieldInQuotes() {
        // Given - recipe name contains comma
        RecipeResponse recipe = createRecipe(
            "Soup, Tomato",
            new BigDecimal("3.50"),
            new BigDecimal("10.00"),
            new BigDecimal("35.0"),
            1
        );
        
        // When
        String csv = csvExportService.export(Collections.singletonList(recipe));
        
        // Then
        String[] lines = csv.split("\n");
        // Field with comma should be wrapped in quotes
        String expected = "\"Soup, Tomato\",3.50,10.00,35.0,1";
        assertEquals(expected, lines[1]);
    }
    
    @Test
    void export_RecipeNameWithQuotes_EscapesQuotesCorrectly() {
        // Given - recipe name contains quotes
        RecipeResponse recipe = createRecipe(
            "Chef's \"Special\" Pasta",
            new BigDecimal("8.00"),
            new BigDecimal("25.00"),
            new BigDecimal("32.0"),
            2
        );
        
        // When
        String csv = csvExportService.export(Collections.singletonList(recipe));
        
        // Then
        String[] lines = csv.split("\n");
        // Internal quotes should be doubled and field wrapped in quotes
        String expected = "\"Chef's \"\"Special\"\" Pasta\",8.00,25.00,32.0,2";
        assertEquals(expected, lines[1]);
    }
    
    @Test
    void export_RecipeNameWithNewline_EscapesFieldInQuotes() {
        // Given - recipe name contains newline
        RecipeResponse recipe = createRecipe(
            "Recipe\nWith Newline",
            new BigDecimal("6.00"),
            new BigDecimal("18.00"),
            new BigDecimal("33.3"),
            3
        );
        
        // When
        String csv = csvExportService.export(Collections.singletonList(recipe));
        
        // Then
        // Field with newline should be wrapped in quotes and preserved
        assertTrue(csv.contains("\"Recipe\nWith Newline\""));
        assertTrue(csv.contains("6.00,18.00,33.3,3"));
    }
    
    @Test
    void export_RoundingEdgeCases_RoundsCorrectly() {
        // Given - test HALF_UP rounding for edge cases
        List<RecipeResponse> recipes = Arrays.asList(
            // 5.675 should round UP to 5.68 (HALF_UP)
            createRecipe("Round Up", new BigDecimal("5.675"), new BigDecimal("15.00"), new BigDecimal("37.83"), 2),
            // 5.674 should round DOWN to 5.67
            createRecipe("Round Down", new BigDecimal("5.674"), new BigDecimal("15.00"), new BigDecimal("37.83"), 2),
            // 5.5 should stay 5.50 (2 decimal places)
            createRecipe("Exact", new BigDecimal("5.5"), new BigDecimal("15.0"), new BigDecimal("36.7"), 2),
            // Percentage: 35.65 rounds to 35.7 (1 decimal place, HALF_UP)
            createRecipe("Percentage Up", new BigDecimal("10.00"), new BigDecimal("30.00"), new BigDecimal("35.65"), 2),
            // Percentage: 35.64 rounds to 35.6
            createRecipe("Percentage Down", new BigDecimal("10.00"), new BigDecimal("30.00"), new BigDecimal("35.64"), 2)
        );
        
        // When
        String csv = csvExportService.export(recipes);
        
        // Then
        String[] lines = csv.split("\n");
        assertEquals("Round Up,5.68,15.00,37.8,2", lines[1]);     // 5.675 -> 5.68, 37.83 -> 37.8
        assertEquals("Round Down,5.67,15.00,37.8,2", lines[2]);   // 5.674 -> 5.67
        assertEquals("Exact,5.50,15.00,36.7,2", lines[3]);        // 5.5 -> 5.50
        assertEquals("Percentage Up,10.00,30.00,35.7,2", lines[4]);    // 35.65 -> 35.7
        assertEquals("Percentage Down,10.00,30.00,35.6,2", lines[5]);  // 35.64 -> 35.6
    }
    
    @Test
    void export_FilteredRecipes_ExportsOnlyProvidedRecipes() {
        // Given - Requirement 5.7: when report is filtered, export only filtered rows
        // Simulate a filtered list (only recipes exceeding threshold)
        List<RecipeResponse> filteredRecipes = Arrays.asList(
            createRecipe("High Cost 1", new BigDecimal("15.00"), new BigDecimal("30.00"), new BigDecimal("50.0"), 2),
            createRecipe("High Cost 2", new BigDecimal("12.00"), new BigDecimal("25.00"), new BigDecimal("48.0"), 3)
        );
        
        // When
        String csv = csvExportService.export(filteredRecipes);
        
        // Then - only the filtered recipes should appear
        String[] lines = csv.split("\n");
        assertEquals(3, lines.length); // header + 2 data rows
        assertEquals("High Cost 1,15.00,30.00,50.0,2", lines[1]);
        assertEquals("High Cost 2,12.00,25.00,48.0,3", lines[2]);
    }
    
    @Test
    void export_HeaderRow_HasCorrectColumnNames() {
        // Given - Requirement 5.6: specific column names
        List<RecipeResponse> recipes = Collections.emptyList();
        
        // When
        String csv = csvExportService.export(recipes);
        
        // Then
        String expectedHeader = "Recipe Name,Food Cost Per Portion,Menu Price,Food Cost Percentage,Portions Per Batch\n";
        assertEquals(expectedHeader, csv);
    }
    
    @Test
    void export_LargeDecimalValues_RoundsAndFormatsCorrectly() {
        // Given - test with larger decimal values
        RecipeResponse recipe = createRecipe(
            "Expensive Recipe",
            new BigDecimal("125.456789"),
            new BigDecimal("399.999"),
            new BigDecimal("31.36447"),
            10
        );
        
        // When
        String csv = csvExportService.export(Collections.singletonList(recipe));
        
        // Then
        String[] lines = csv.split("\n");
        // 125.456789 -> 125.46 (HALF_UP)
        // 399.999 -> 400.00 (HALF_UP)
        // 31.36447 -> 31.4 (HALF_UP)
        assertEquals("Expensive Recipe,125.46,400.00,31.4,10", lines[1]);
    }
    
    @Test
    void export_ZeroValues_DisplaysCorrectly() {
        // Given
        RecipeResponse recipe = createRecipe(
            "Zero Cost Recipe",
            new BigDecimal("0.00"),
            new BigDecimal("0.00"),
            new BigDecimal("0.0"),
            1
        );
        
        // When
        String csv = csvExportService.export(Collections.singletonList(recipe));
        
        // Then
        String[] lines = csv.split("\n");
        assertEquals("Zero Cost Recipe,0.00,0.00,0.0,1", lines[1]);
    }
    
    // Helper method to create a RecipeResponse for testing
    private RecipeResponse createRecipe(String name, BigDecimal foodCostPerPortion, 
                                       BigDecimal menuSellingPrice, BigDecimal foodCostPercentage,
                                       Integer portionCount) {
        RecipeResponse recipe = new RecipeResponse();
        recipe.setId(UUID.randomUUID());
        recipe.setVenueId(UUID.randomUUID());
        recipe.setName(name);
        recipe.setFoodCostPerPortion(foodCostPerPortion);
        recipe.setMenuSellingPrice(menuSellingPrice);
        recipe.setFoodCostPercentage(foodCostPercentage);
        recipe.setPortionCount(portionCount);
        recipe.setThresholdStatus(ThresholdStatus.PASSING);
        recipe.setCreatedAt(Instant.now());
        recipe.setUpdatedAt(Instant.now());
        return recipe;
    }
}
