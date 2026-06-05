package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.dto.RecipeResponse;
import net.jqwik.api.*;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Property-based tests for CsvExportService using jqwik.
 * 
 * These tests verify CSV export invariants hold across thousands of
 * randomly generated recipe datasets, ensuring correctness of row counts and value formatting.
 */
class CsvExportServicePropertyTest {
    
    private final CsvExportService csvExportService = new CsvExportService();
    
    /**
     * Property 15: CSV Export Contains Correct Rows and Correctly Rounded Values
     * **Validates: Requirements 5.6, 5.7**
     * 
     * Verifies that:
     * 1. The exported CSV contains exactly one row per recipe in the input set
     * 2. All numeric amounts are rounded to the correct decimal places:
     *    - Food Cost Per Portion: 2 decimal places
     *    - Menu Price: 2 decimal places
     *    - Food Cost Percentage: 1 decimal place
     * 3. Portions Per Batch is an integer with no decimal places
     */
    @Property(tries = 1000)
    @Label("P15: CSV export contains correct rows and correctly rounded values")
    void csvExportContainsCorrectRowsAndCorrectlyRoundedValues(
            @ForAll("recipeResponseLists") List<RecipeResponse> recipes) {
        
        // Generate CSV export using the system under test
        String csv = csvExportService.export(recipes);
        
        // Parse CSV into records (handling multi-line quoted fields)
        List<String[]> records = parseCsv(csv);
        
        // Requirement 5.6: CSV must have header + one row per recipe
        int expectedRecordCount = 1 + recipes.size(); // 1 header + N data rows
        assertEquals(expectedRecordCount, records.size(),
            String.format("CSV should have %d records (1 header + %d recipes) but has %d",
                expectedRecordCount, recipes.size(), records.size()));
        
        // Verify header format
        String[] headerFields = records.get(0);
        assertEquals(5, headerFields.length, "Header should have 5 columns");
        assertEquals("Recipe Name", headerFields[0]);
        assertEquals("Food Cost Per Portion", headerFields[1]);
        assertEquals("Menu Price", headerFields[2]);
        assertEquals("Food Cost Percentage", headerFields[3]);
        assertEquals("Portions Per Batch", headerFields[4]);
        
        // Verify each data row
        for (int i = 0; i < recipes.size(); i++) {
            RecipeResponse recipe = recipes.get(i);
            String[] fields = records.get(i + 1); // +1 to skip header
            
            // Verify field count
            assertEquals(5, fields.length,
                String.format("Row %d should have 5 fields but has %d",
                    i + 1, fields.length));
            
            // Field 0: Recipe Name (may be quoted if it contains special chars)
            String expectedName = recipe.getName() != null ? recipe.getName() : "";
            assertEquals(expectedName, fields[0],
                String.format("Row %d: recipe name mismatch", i + 1));
            
            // Field 1: Food Cost Per Portion - 2 decimal places
            String expectedFcp = formatDecimal(recipe.getFoodCostPerPortion(), 2);
            assertEquals(expectedFcp, fields[1],
                String.format("Row %d: food cost per portion should be %s but is %s",
                    i + 1, expectedFcp, fields[1]));
            
            // Verify rounding to 2 decimal places
            if (recipe.getFoodCostPerPortion() != null && !fields[1].isEmpty()) {
                assertDecimalPlaces(fields[1], 2,
                    String.format("Row %d: food cost per portion must be rounded to 2 d.p.", i + 1));
            }
            
            // Field 2: Menu Price - 2 decimal places
            String expectedMenuPrice = formatDecimal(recipe.getMenuSellingPrice(), 2);
            assertEquals(expectedMenuPrice, fields[2],
                String.format("Row %d: menu price should be %s but is %s",
                    i + 1, expectedMenuPrice, fields[2]));
            
            // Verify rounding to 2 decimal places
            if (recipe.getMenuSellingPrice() != null && !fields[2].isEmpty()) {
                assertDecimalPlaces(fields[2], 2,
                    String.format("Row %d: menu price must be rounded to 2 d.p.", i + 1));
            }
            
            // Field 3: Food Cost Percentage - 1 decimal place or "N/A"
            String expectedFcpct;
            if (recipe.getFoodCostPercentage() == null) {
                expectedFcpct = "N/A";
            } else {
                expectedFcpct = formatDecimal(recipe.getFoodCostPercentage(), 1);
            }
            assertEquals(expectedFcpct, fields[3],
                String.format("Row %d: food cost percentage should be %s but is %s",
                    i + 1, expectedFcpct, fields[3]));
            
            // Verify rounding to 1 decimal place (if not N/A)
            if (recipe.getFoodCostPercentage() != null && !fields[3].equals("N/A")) {
                assertDecimalPlaces(fields[3], 1,
                    String.format("Row %d: food cost percentage must be rounded to 1 d.p.", i + 1));
            }
            
            // Field 4: Portions Per Batch - integer (no decimal places)
            String expectedPortions = recipe.getPortionCount() != null 
                ? recipe.getPortionCount().toString() 
                : "";
            assertEquals(expectedPortions, fields[4],
                String.format("Row %d: portions per batch should be %s but is %s",
                    i + 1, expectedPortions, fields[4]));
            
            // Verify it's an integer (no decimal point)
            if (!fields[4].isEmpty()) {
                assertFalse(fields[4].contains("."),
                    String.format("Row %d: portions per batch should be an integer without decimals", i + 1));
            }
        }
    }
    
    /**
     * Helper method to format a BigDecimal to the specified number of decimal places.
     * Returns empty string if value is null.
     */
    private String formatDecimal(BigDecimal value, int decimalPlaces) {
        if (value == null) {
            return "";
        }
        return value.setScale(decimalPlaces, RoundingMode.HALF_UP).toPlainString();
    }
    
    /**
     * Helper method to parse a complete CSV string into records (rows).
     * Handles multi-line quoted fields properly.
     * Each record is an array of field values.
     */
    private List<String[]> parseCsv(String csv) {
        List<String[]> records = new ArrayList<>();
        List<String> currentRecord = new ArrayList<>();
        StringBuilder currentField = new StringBuilder();
        boolean inQuotes = false;
        
        for (int i = 0; i < csv.length(); i++) {
            char c = csv.charAt(i);
            
            if (c == '"') {
                if (inQuotes && i + 1 < csv.length() && csv.charAt(i + 1) == '"') {
                    // Doubled quote - add single quote to field
                    currentField.append('"');
                    i++; // Skip next quote
                } else {
                    // Toggle quote state
                    inQuotes = !inQuotes;
                }
            } else if (c == ',' && !inQuotes) {
                // Field separator
                currentRecord.add(currentField.toString());
                currentField = new StringBuilder();
            } else if (c == '\n' && !inQuotes) {
                // Record separator (newline outside quotes)
                currentRecord.add(currentField.toString());
                if (!currentRecord.isEmpty()) {
                    records.add(currentRecord.toArray(new String[0]));
                }
                currentRecord = new ArrayList<>();
                currentField = new StringBuilder();
            } else {
                // Regular character or newline inside quotes
                currentField.append(c);
            }
        }
        
        // Add last field and record if not empty
        if (!currentField.isEmpty() || !currentRecord.isEmpty()) {
            currentRecord.add(currentField.toString());
            if (!currentRecord.isEmpty()) {
                records.add(currentRecord.toArray(new String[0]));
            }
        }
        
        return records;
    }
    
    /**
     * Helper method to parse a single CSV line (deprecated - use parseCsv instead).
     * Kept for reference but not used in the main test.
     */
    @Deprecated
    private String[] parseCsvLine(String line) {
        List<String> fields = new ArrayList<>();
        StringBuilder currentField = new StringBuilder();
        boolean inQuotes = false;
        
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            
            if (c == '"') {
                if (inQuotes && i + 1 < line.length() && line.charAt(i + 1) == '"') {
                    // Doubled quote - add single quote to field
                    currentField.append('"');
                    i++; // Skip next quote
                } else {
                    // Toggle quote state
                    inQuotes = !inQuotes;
                }
            } else if (c == ',' && !inQuotes) {
                // Field separator
                fields.add(currentField.toString());
                currentField = new StringBuilder();
            } else {
                currentField.append(c);
            }
        }
        
        // Add last field
        fields.add(currentField.toString());
        
        return fields.toArray(new String[0]);
    }
    
    /**
     * Assert that a decimal string has exactly the specified number of decimal places.
     */
    private void assertDecimalPlaces(String value, int expectedDecimalPlaces, String message) {
        // Skip empty strings
        if (value.isEmpty()) {
            return;
        }
        
        // Check if the value contains a decimal point
        int decimalPointIndex = value.indexOf('.');
        
        if (decimalPointIndex == -1) {
            // No decimal point - should have .00 or .0 appended
            fail(message + " Expected decimal point but found none in: " + value);
        } else {
            // Count decimal places
            int actualDecimalPlaces = value.length() - decimalPointIndex - 1;
            assertEquals(expectedDecimalPlaces, actualDecimalPlaces,
                message + " Value: " + value);
        }
    }
    
    // Arbitrary generators
    
    /**
     * Generate lists of recipe responses with varied compositions.
     * Generates 0-50 recipes to test various dataset sizes including empty reports.
     */
    @Provide
    Arbitrary<List<RecipeResponse>> recipeResponseLists() {
        return Arbitraries.integers().between(0, 50)
            .flatMap(numRecipes -> {
                if (numRecipes == 0) {
                    return Arbitraries.just(new ArrayList<>());
                }
                
                List<Arbitrary<RecipeResponse>> recipeArbitraries = new ArrayList<>();
                for (int i = 0; i < numRecipes; i++) {
                    recipeArbitraries.add(recipeResponseArbitrary());
                }
                return Combinators.combine(recipeArbitraries)
                    .as(ArrayList::new);
            });
    }
    
    /**
     * Generate a single recipe response with varied field values.
     * Includes edge cases for CSV escaping (commas, quotes, newlines).
     */
    @Provide
    Arbitrary<RecipeResponse> recipeResponseArbitrary() {
        // Generate recipe names with variety including CSV special characters
        Arbitrary<String> name = Arbitraries.oneOf(
            // Normal names
            Arbitraries.strings().alpha().ofMinLength(1).ofMaxLength(50),
            // Names with commas (require quoting)
            Arbitraries.of("Soup, Tomato", "Bread, Wheat", "Cake, Chocolate"),
            // Names with quotes (require doubling)
            Arbitraries.of("Chef's \"Special\"", "\"Best\" Pizza", "The \"King's\" Feast"),
            // Names with newlines (require quoting)
            Arbitraries.of("Recipe\nWith Newline", "Multi\nLine\nName"),
            // Common recipe names
            Arbitraries.of("Apple Pie", "Banana Bread", "Caesar Salad", "Donut", "Egg Tart")
        );
        
        Arbitrary<Integer> portionCount = Arbitraries.integers().between(1, 9999);
        
        // Menu selling price - nullable or positive
        Arbitrary<BigDecimal> menuSellingPrice = Arbitraries.oneOf(
            // Null case (food cost percentage will be N/A)
            Arbitraries.just((BigDecimal) null),
            // Normal prices with various decimal values to test rounding
            Arbitraries.bigDecimals()
                .between(new BigDecimal("0.01"), new BigDecimal("999.99"))
                .ofScale(2),
            // Prices that need rounding (more than 2 decimal places before export)
            Arbitraries.bigDecimals()
                .between(new BigDecimal("1.001"), new BigDecimal("99.999"))
                .ofScale(3)
        );
        
        // Food cost per portion - nullable or non-negative
        Arbitrary<BigDecimal> foodCostPerPortion = Arbitraries.oneOf(
            // Null case
            Arbitraries.just((BigDecimal) null),
            // Normal costs with various decimal values to test rounding
            Arbitraries.bigDecimals()
                .between(BigDecimal.ZERO, new BigDecimal("999.99"))
                .ofScale(2),
            // Costs that need rounding (more than 2 decimal places before export)
            Arbitraries.bigDecimals()
                .between(new BigDecimal("0.001"), new BigDecimal("99.999"))
                .ofScale(3),
            // Edge case: very small costs that round to 0.00
            Arbitraries.bigDecimals()
                .between(new BigDecimal("0.0001"), new BigDecimal("0.0049"))
                .ofScale(4)
        );
        
        // Food cost percentage - nullable or varied values
        // Note: In real system, this is null if menu price is null
        Arbitrary<BigDecimal> foodCostPercentage = Arbitraries.oneOf(
            // Null case (will display as N/A)
            Arbitraries.just((BigDecimal) null),
            // Normal percentages with various decimal values to test rounding
            Arbitraries.bigDecimals()
                .between(new BigDecimal("0.1"), new BigDecimal("200.0"))
                .ofScale(1),
            // Percentages that need rounding (more than 1 decimal place before export)
            Arbitraries.bigDecimals()
                .between(new BigDecimal("0.01"), new BigDecimal("199.99"))
                .ofScale(2),
            // Edge cases
            Arbitraries.just(new BigDecimal("0.0")),
            Arbitraries.just(new BigDecimal("100.0")),
            Arbitraries.just(new BigDecimal("33.3")),
            Arbitraries.just(new BigDecimal("66.7"))
        );
        
        // Build RecipeResponse using flatMap to handle all fields
        return name.flatMap(n ->
            portionCount.flatMap(pc ->
                menuSellingPrice.flatMap(msp ->
                    foodCostPerPortion.flatMap(fcp ->
                        foodCostPercentage.flatMap(fcpct ->
                            Arbitraries.randomValue(random -> {
                                RecipeResponse response = new RecipeResponse();
                                response.setId(UUID.randomUUID());
                                response.setVenueId(UUID.randomUUID());
                                response.setName(n);
                                response.setPortionCount(pc);
                                response.setMenuSellingPrice(msp);
                                response.setFoodCostPerPortion(fcp);
                                
                                // Food cost percentage should be null if menu price is null
                                // This matches the real system behavior
                                if (msp == null) {
                                    response.setFoodCostPercentage(null);
                                } else {
                                    response.setFoodCostPercentage(fcpct);
                                }
                                
                                response.setCreatedAt(Instant.now().minusSeconds(random.nextInt(365 * 24 * 3600)));
                                response.setUpdatedAt(Instant.now().minusSeconds(random.nextInt(30 * 24 * 3600)));
                                
                                return response;
                            })
                        )
                    )
                )
            )
        );
    }
}
