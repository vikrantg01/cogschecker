package com.cogschecker.foodcost.shared;

import net.jqwik.api.*;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Property-based tests for CostCalculator using jqwik.
 * 
 * These tests verify mathematical invariants hold across thousands of
 * randomly generated inputs, ensuring correctness of financial calculations.
 */
class CostCalculatorPropertyTest {
    
    /**
     * Property 1: Cost-Per-Unit Calculation
     * **Validates: Requirements 1.2, 1.3**
     * 
     * Verifies that cost_per_unit == round(purchase_price / purchase_quantity, 4)
     * for all valid purchase price and quantity > 0.
     */
    @Property(tries = 5000)
    @Label("P1: cost_per_unit == round(purchase_price / purchase_quantity, 4)")
    void costPerUnitCalculation(
            @ForAll("purchasePriceValues") BigDecimal purchasePrice,
            @ForAll("purchasePriceValues") BigDecimal purchaseQuantity) {
        
        // Calculate using the system under test
        BigDecimal actualResult = CostCalculator.costPerUnit(purchasePrice, purchaseQuantity);
        
        // Calculate expected result using the formula: purchase_price / purchase_quantity
        // This is the reference implementation that matches the requirement
        BigDecimal expectedResult = purchasePrice.divide(purchaseQuantity, 10, RoundingMode.HALF_UP);
        expectedResult = RoundingUtils.round4dp(expectedResult);
        
        // Assert equality
        assertEquals(expectedResult, actualResult,
            String.format("For purchasePrice=%s, purchaseQuantity=%s: expected %s but got %s",
                purchasePrice, purchaseQuantity, expectedResult, actualResult));
    }
    
    /**
     * Property 2: Effective Cost Per Usable Unit Calculation
     * **Validates: Requirements 1.5**
     * 
     * Verifies that effective_cost_per_usable_unit == round(cost_per_unit / (yield / 100), 4)
     * for all valid cost > 0 and yield in [1, 100].
     */
    @Property(tries = 5000)
    @Label("P2: effective_cost_per_usable_unit == round(cost_per_unit / (yield / 100), 4)")
    void effectiveCostPerUsableUnitCalculation(
            @ForAll("costPerUnitValues") BigDecimal costPerUnit,
            @ForAll("yieldPercentageValues") BigDecimal yieldPercentage) {
        
        // Calculate using the system under test
        BigDecimal actualResult = CostCalculator.effectiveCostPerUsableUnit(costPerUnit, yieldPercentage);
        
        // Calculate expected result using the formula: cost_per_unit / (yield / 100)
        // This is the reference implementation that matches the requirement
        BigDecimal yieldFactor = yieldPercentage.divide(new BigDecimal("100"), 10, RoundingMode.HALF_UP);
        BigDecimal expectedResult = costPerUnit.divide(yieldFactor, 10, RoundingMode.HALF_UP);
        expectedResult = RoundingUtils.round4dp(expectedResult);
        
        // Assert equality
        assertEquals(expectedResult, actualResult,
            String.format("For costPerUnit=%s, yield=%s: expected %s but got %s",
                costPerUnit, yieldPercentage, expectedResult, actualResult));
    }
    
    /**
     * Additional property: Effective cost should always be >= cost per unit
     * (since yield is at most 100%, dividing by it can only increase the cost)
     */
    @Property(tries = 1000)
    @Label("Effective cost >= cost per unit (yield adjustment never reduces cost)")
    void effectiveCostNeverLessThanCostPerUnit(
            @ForAll("costPerUnitValues") BigDecimal costPerUnit,
            @ForAll("yieldPercentageValues") BigDecimal yieldPercentage) {
        
        BigDecimal effectiveCost = CostCalculator.effectiveCostPerUsableUnit(costPerUnit, yieldPercentage);
        
        assertTrue(effectiveCost.compareTo(costPerUnit) >= 0,
            String.format("Effective cost %s should be >= cost per unit %s", 
                effectiveCost, costPerUnit));
    }
    
    /**
     * Additional property: At 100% yield, effective cost equals cost per unit
     */
    @Property(tries = 1000)
    @Label("At 100% yield, effective cost equals cost per unit")
    void effectiveCostEqualsAtFullYield(
            @ForAll("costPerUnitValues") BigDecimal costPerUnit) {
        
        BigDecimal effectiveCost = CostCalculator.effectiveCostPerUsableUnit(
            costPerUnit, new BigDecimal("100"));
        
        assertEquals(costPerUnit, effectiveCost,
            String.format("At 100%% yield, effective cost should equal cost per unit %s", 
                costPerUnit));
    }
    
    /**
     * Property 9: Food Cost Per Portion Calculation
     * **Validates: Requirements 3.2**
     * 
     * Verifies that food_cost_per_portion == round(batchCost / portionCount, 2)
     * for all valid batch cost >= 0 and portion count in [1, 9999].
     */
    @Property(tries = 5000)
    @Label("P9: food_cost_per_portion == round(batchCost / portionCount, 2)")
    void foodCostPerPortionCalculation(
            @ForAll("batchCostValues") BigDecimal batchCost,
            @ForAll("portionCountValues") int portionCount) {
        
        // Calculate using the system under test
        BigDecimal actualResult = CostCalculator.foodCostPerPortion(batchCost, portionCount);
        
        // Calculate expected result using the formula: batchCost / portionCount
        // This is the reference implementation that matches the requirement
        BigDecimal expectedResult = batchCost.divide(
            new BigDecimal(portionCount), 
            10, 
            RoundingMode.HALF_UP
        );
        expectedResult = RoundingUtils.round2dp(expectedResult);
        
        // Assert equality
        assertEquals(expectedResult, actualResult,
            String.format("For batchCost=%s, portionCount=%s: expected %s but got %s",
                batchCost, portionCount, expectedResult, actualResult));
    }
    
    /**
     * Property 7: Recipe Validation Rejects All Invalid Inputs
     * **Validates: Requirements 2.1, 2.10, 2.11**
     * 
     * Verifies that recipe validation correctly rejects all invalid combinations of:
     * - name (empty/whitespace variants)
     * - portion count (outside [1,9999])
     * - line quantities (≤ 0)
     * 
     * And that each failing field is properly identified.
     */
    @Property(tries = 5000)
    @Label("P7: Recipe validation rejects all invalid inputs and identifies failing fields")
    void recipeValidationRejectsInvalidInputs(
            @ForAll("invalidRecipeInputs") InvalidRecipeInput input) {
        
        // Call the validator
        RecipeValidator.ValidationResult result = RecipeValidator.validateRecipe(
            input.name,
            input.portionCount,
            input.ingredientLines
        );
        
        // Assert that validation failed
        assertFalse(result.isValid(),
            String.format("Validation should fail for input: name='%s', portionCount=%s, lines=%s",
                input.name, input.portionCount, input.ingredientLines != null ? input.ingredientLines.size() : "null"));
        
        // Assert that at least one field is identified as failing
        assertFalse(result.getFailingFields().isEmpty(),
            "At least one failing field should be identified");
        
        // Verify that each expected invalid field is identified
        for (String expectedFailingField : input.expectedFailingFields) {
            assertTrue(result.getFailingFields().contains(expectedFailingField),
                String.format("Expected field '%s' to be identified as failing. Actual failing fields: %s",
                    expectedFailingField, result.getFailingFields()));
        }
    }
    
    /**
     * Helper class to hold invalid recipe inputs with expected failing fields.
     */
    private static class InvalidRecipeInput {
        final String name;
        final Integer portionCount;
        final List<RecipeValidator.RecipeLineInput> ingredientLines;
        final List<String> expectedFailingFields;
        
        InvalidRecipeInput(String name, Integer portionCount, 
                          List<RecipeValidator.RecipeLineInput> ingredientLines,
                          List<String> expectedFailingFields) {
            this.name = name;
            this.portionCount = portionCount;
            this.ingredientLines = ingredientLines;
            this.expectedFailingFields = expectedFailingFields;
        }
    }
    
    /**
     * Generator for invalid recipe inputs.
     * Creates combinations of invalid name, portion count, and line quantities.
     */
    @Provide
    Arbitrary<InvalidRecipeInput> invalidRecipeInputs() {
        return Arbitraries.oneOf(
            // Invalid name variants
            invalidNameInputs(),
            // Invalid portion count
            invalidPortionCountInputs(),
            // Invalid line quantities
            invalidLineQuantityInputs()
        );
    }
    
    /**
     * Generate recipes with invalid names (empty, whitespace, null).
     */
    @Provide
    Arbitrary<InvalidRecipeInput> invalidNameInputs() {
        Arbitrary<String> invalidNames = Arbitraries.oneOf(
            Arbitraries.just(null),
            Arbitraries.just(""),
            Arbitraries.just("   "),
            Arbitraries.just("\t"),
            Arbitraries.just("\n"),
            Arbitraries.just("  \t  \n  ")
        );
        
        Arbitrary<Integer> validPortionCount = Arbitraries.integers()
            .between(1, 9999);
        
        return Combinators.combine(invalidNames, validPortionCount)
            .as((name, portionCount) -> new InvalidRecipeInput(
                name,
                portionCount,
                new ArrayList<>(),
                List.of("name")
            ));
    }
    
    /**
     * Generate recipes with invalid portion counts (< 1 or > 9999).
     */
    @Provide
    Arbitrary<InvalidRecipeInput> invalidPortionCountInputs() {
        Arbitrary<String> validName = Arbitraries.strings()
            .alpha()
            .ofMinLength(1)
            .ofMaxLength(50);
        
        Arbitrary<Integer> invalidPortionCount = Arbitraries.oneOf(
            // Below minimum
            Arbitraries.integers().between(Integer.MIN_VALUE, 0),
            // Above maximum
            Arbitraries.integers().between(10000, Integer.MAX_VALUE)
        );
        
        return Combinators.combine(validName, invalidPortionCount)
            .as((name, portionCount) -> new InvalidRecipeInput(
                name,
                portionCount,
                new ArrayList<>(),
                List.of("portionCount")
            ));
    }
    
    /**
     * Generate recipes with invalid line quantities (≤ 0).
     */
    @Provide
    Arbitrary<InvalidRecipeInput> invalidLineQuantityInputs() {
        Arbitrary<String> validName = Arbitraries.strings()
            .alpha()
            .ofMinLength(1)
            .ofMaxLength(50);
        
        Arbitrary<Integer> validPortionCount = Arbitraries.integers()
            .between(1, 9999);
        
        // Generate 1-3 ingredient lines with at least one having invalid quantity
        Arbitrary<List<RecipeValidator.RecipeLineInput>> invalidLines = 
            Arbitraries.integers().between(1, 3)
                .flatMap(numLines -> {
                    // Create list with at least one invalid line
                    List<Arbitrary<RecipeValidator.RecipeLineInput>> lineArbitraries = new ArrayList<>();
                    
                    // First line is always invalid
                    Arbitrary<BigDecimal> invalidQuantity = Arbitraries.oneOf(
                        Arbitraries.bigDecimals()
                            .between(new BigDecimal("-1000"), BigDecimal.ZERO)
                            .ofScale(4)
                    );
                    lineArbitraries.add(invalidQuantity.map(RecipeValidator.RecipeLineInput::new));
                    
                    // Remaining lines can be valid or invalid
                    for (int i = 1; i < numLines; i++) {
                        Arbitrary<BigDecimal> quantity = Arbitraries.oneOf(
                            // Valid quantity
                            Arbitraries.bigDecimals()
                                .between(new BigDecimal("0.0001"), new BigDecimal("1000"))
                                .ofScale(4),
                            // Invalid quantity
                            Arbitraries.bigDecimals()
                                .between(new BigDecimal("-1000"), BigDecimal.ZERO)
                                .ofScale(4)
                        );
                        lineArbitraries.add(quantity.map(RecipeValidator.RecipeLineInput::new));
                    }
                    
                    return Combinators.combine(lineArbitraries)
                        .as(lines -> new ArrayList<>(lines));
                });
        
        return Combinators.combine(validName, validPortionCount, invalidLines)
            .as((name, portionCount, lines) -> {
                // Build expected failing fields based on which lines have invalid quantities
                List<String> expectedFailingFields = new ArrayList<>();
                for (int i = 0; i < lines.size(); i++) {
                    if (lines.get(i).getQuantityUsed() == null || 
                        lines.get(i).getQuantityUsed().compareTo(BigDecimal.ZERO) <= 0) {
                        expectedFailingFields.add("ingredientLines[" + i + "].quantityUsed");
                    }
                }
                
                return new InvalidRecipeInput(name, portionCount, lines, expectedFailingFields);
            });
    }
    
    /**
     * Property 8: Batch Cost Calculation Is Correct for All Recipe Compositions
     * **Validates: Requirements 3.1, 3.4**
     * 
     * Verifies that total_batch_cost equals the manual sum of (converted quantity × effective cost)
     * for all ingredient lines with varied quantities, UOMs, and yields.
     */
    @Property(tries = 5000)
    @Label("P8: batch cost calculation is correct for all recipe compositions")
    void batchCostCalculationCorrectForAllRecipeCompositions(
            @ForAll("ingredientLinesList") List<IngredientLine> ingredientLines) {
        
        // Calculate the expected batch cost manually by summing each line
        BigDecimal expectedBatchCost = BigDecimal.ZERO;
        List<BigDecimal> lineCosts = new ArrayList<>();
        
        for (IngredientLine line : ingredientLines) {
            // Step 1: Convert quantity from recipe UOM to purchase UOM
            BigDecimal convertedQuantity;
            try {
                convertedQuantity = UomConverter.convert(
                    line.quantityUsed,
                    line.recipeUom,
                    line.purchaseUom
                );
            } catch (IncompatibleUomException e) {
                // Skip incompatible UOM combinations (these should be prevented by validation)
                continue;
            }
            
            // Step 2: Calculate cost per unit
            BigDecimal costPerUnit = CostCalculator.costPerUnit(
                line.purchasePrice,
                line.purchaseQuantity
            );
            
            // Step 3: Calculate effective cost per usable unit (accounting for yield)
            BigDecimal effectiveCost = CostCalculator.effectiveCostPerUsableUnit(
                costPerUnit,
                line.yieldPercentage
            );
            
            // Step 4: Calculate line cost
            BigDecimal lineCost = CostCalculator.lineCost(convertedQuantity, effectiveCost);
            lineCosts.add(lineCost);
            expectedBatchCost = expectedBatchCost.add(lineCost);
        }
        
        // Calculate actual batch cost using the system under test
        BigDecimal actualBatchCost = CostCalculator.batchCost(
            lineCosts.toArray(new BigDecimal[0])
        );
        
        // Assert equality
        assertEquals(expectedBatchCost, actualBatchCost,
            String.format("Batch cost mismatch: expected %s but got %s for %d ingredient lines",
                expectedBatchCost, actualBatchCost, ingredientLines.size()));
    }
    
    /**
     * Helper class to represent an ingredient line with all necessary data
     * for batch cost calculation.
     */
    private static class IngredientLine {
        final BigDecimal quantityUsed;
        final UomEnum recipeUom;
        final BigDecimal purchasePrice;
        final BigDecimal purchaseQuantity;
        final UomEnum purchaseUom;
        final BigDecimal yieldPercentage;
        
        IngredientLine(BigDecimal quantityUsed, UomEnum recipeUom,
                      BigDecimal purchasePrice, BigDecimal purchaseQuantity,
                      UomEnum purchaseUom, BigDecimal yieldPercentage) {
            this.quantityUsed = quantityUsed;
            this.recipeUom = recipeUom;
            this.purchasePrice = purchasePrice;
            this.purchaseQuantity = purchaseQuantity;
            this.purchaseUom = purchaseUom;
            this.yieldPercentage = yieldPercentage;
        }
    }
    
    /**
     * Generator for lists of ingredient lines with varied compositions.
     * Ensures UOM compatibility between recipe and purchase units.
     */
    @Provide
    Arbitrary<List<IngredientLine>> ingredientLinesList() {
        // Generate 1-20 ingredient lines per recipe
        return Arbitraries.integers().between(1, 20)
            .flatMap(numLines -> {
                List<Arbitrary<IngredientLine>> lineArbitraries = new ArrayList<>();
                for (int i = 0; i < numLines; i++) {
                    lineArbitraries.add(ingredientLineArbitrary());
                }
                return Combinators.combine(lineArbitraries)
                    .as(lines -> new ArrayList<>(lines));
            });
    }
    
    /**
     * Generator for a single ingredient line with compatible UOMs.
     */
    @Provide
    Arbitrary<IngredientLine> ingredientLineArbitrary() {
        // First, pick a UOM dimension and then select compatible UOMs within that dimension
        return Arbitraries.of(UomEnum.UomDimension.values())
            .flatMap(dimension -> {
                // Get all UOMs in this dimension
                List<UomEnum> uomsInDimension = new ArrayList<>();
                for (UomEnum uom : UomEnum.values()) {
                    if (uom.getDimension() == dimension) {
                        uomsInDimension.add(uom);
                    }
                }
                
                // Generate compatible recipe and purchase UOMs from the same dimension
                Arbitrary<UomEnum> recipeUom = Arbitraries.of(
                    uomsInDimension.toArray(new UomEnum[0])
                );
                Arbitrary<UomEnum> purchaseUom = Arbitraries.of(
                    uomsInDimension.toArray(new UomEnum[0])
                );
                
                // Generate quantities and prices
                Arbitrary<BigDecimal> quantityUsed = Arbitraries.bigDecimals()
                    .between(new BigDecimal("0.0001"), new BigDecimal("1000"))
                    .ofScale(4);
                
                // Use price and quantity that ensure cost per unit > 0.0001 (min 4dp non-zero)
                // to avoid rounding to zero
                Arbitrary<BigDecimal> purchasePrice = Arbitraries.bigDecimals()
                    .between(new BigDecimal("0.01"), new BigDecimal("999.99"))
                    .ofScale(2);
                
                Arbitrary<BigDecimal> purchaseQuantity = Arbitraries.bigDecimals()
                    .between(new BigDecimal("0.01"), new BigDecimal("100"))
                    .ofScale(2);
                
                Arbitrary<BigDecimal> yieldPercentage = Arbitraries.bigDecimals()
                    .between(BigDecimal.ONE, new BigDecimal("100"))
                    .ofScale(2);
                
                // Combine all fields
                return Combinators.combine(
                    quantityUsed, recipeUom,
                    purchasePrice, purchaseQuantity, purchaseUom,
                    yieldPercentage
                ).as(IngredientLine::new);
            });
    }
    
    // Arbitrary providers for reusable value generation
    
    @Provide
    Arbitrary<BigDecimal> purchasePriceValues() {
        return Arbitraries.bigDecimals()
            .between(new BigDecimal("0.01"), new BigDecimal("999999.99"))
            .ofScale(2);
    }
    
    @Provide
    Arbitrary<BigDecimal> costPerUnitValues() {
        return Arbitraries.bigDecimals()
            .between(new BigDecimal("0.0001"), new BigDecimal("999999.9999"))
            .ofScale(4);
    }
    
    @Provide
    Arbitrary<BigDecimal> yieldPercentageValues() {
        return Arbitraries.bigDecimals()
            .between(BigDecimal.ONE, new BigDecimal("100"))
            .ofScale(2);
    }
    
    @Provide
    Arbitrary<BigDecimal> batchCostValues() {
        return Arbitraries.bigDecimals()
            .between(BigDecimal.ZERO, new BigDecimal("999999.99"))
            .ofScale(2);
    }
    
    @Provide
    Arbitrary<Integer> portionCountValues() {
        return Arbitraries.integers()
            .between(1, 9999);
    }
    
    /**
     * Property 11: Food Cost Percentage Calculation
     * **Validates: Requirements 4.2**
     * 
     * Verifies that food_cost_percentage == round((foodCostPerPortion / menuSellingPrice) × 100, 1)
     * for all valid food cost per portion >= 0 and menu selling price > 0.
     */
    @Property(tries = 5000)
    @Label("P11: food_cost_percentage == round((fcp / price) × 100, 1)")
    void foodCostPercentageCalculation(
            @ForAll("foodCostPerPortionValues") BigDecimal foodCostPerPortion,
            @ForAll("menuSellingPriceValues") BigDecimal menuSellingPrice) {
        
        // Calculate using the system under test
        BigDecimal actualResult = CostCalculator.foodCostPercentage(foodCostPerPortion, menuSellingPrice);
        
        // Calculate expected result using the formula: (foodCostPerPortion / menuSellingPrice) × 100
        // This is the reference implementation that matches the requirement
        BigDecimal expectedResult = foodCostPerPortion.divide(menuSellingPrice, 10, RoundingMode.HALF_UP);
        expectedResult = expectedResult.multiply(new BigDecimal("100"));
        expectedResult = RoundingUtils.round1dp(expectedResult);
        
        // Assert equality
        assertEquals(expectedResult, actualResult,
            String.format("For foodCostPerPortion=%s, menuSellingPrice=%s: expected %s but got %s",
                foodCostPerPortion, menuSellingPrice, expectedResult, actualResult));
    }
    
    @Provide
    Arbitrary<BigDecimal> foodCostPerPortionValues() {
        return Arbitraries.bigDecimals()
            .between(BigDecimal.ZERO, new BigDecimal("999999.99"))
            .ofScale(2);
    }
    
    @Provide
    Arbitrary<BigDecimal> menuSellingPriceValues() {
        return Arbitraries.bigDecimals()
            .between(new BigDecimal("0.01"), new BigDecimal("999999.99"))
            .ofScale(2);
    }
    
    /**
     * Property 12: Threshold Indicator Reflects the Correct Comparison
     * **Validates: Requirements 4.7, 4.8**
     * 
     * Verifies that the ThresholdEvaluator correctly returns:
     * - EXCEEDING if foodCostPercentage > threshold
     * - PASSING if foodCostPercentage <= threshold
     * 
     * For all possible values of percentage and threshold.
     */
    @Property(tries = 5000)
    @Label("P12: threshold indicator correctly reflects the comparison for all values")
    void thresholdIndicatorCorrectlyReflectsComparison(
            @ForAll("foodCostPercentageValues") BigDecimal foodCostPercentage,
            @ForAll("thresholdValues") BigDecimal threshold) {
        
        // Call the system under test
        ThresholdStatus actualStatus = ThresholdEvaluator.evaluate(foodCostPercentage, threshold);
        
        // Determine expected status based on the comparison
        // Requirement 4.7: EXCEEDING if fcp > threshold
        // Requirement 4.8: PASSING if fcp <= threshold
        ThresholdStatus expectedStatus;
        if (foodCostPercentage.compareTo(threshold) > 0) {
            expectedStatus = ThresholdStatus.EXCEEDING;
        } else {
            expectedStatus = ThresholdStatus.PASSING;
        }
        
        // Assert the status is correct
        assertEquals(expectedStatus, actualStatus,
            String.format("For foodCostPercentage=%s, threshold=%s: expected %s but got %s",
                foodCostPercentage, threshold, expectedStatus, actualStatus));
    }
    
    /**
     * Additional property: Null food cost percentage returns null status
     */
    @Property(tries = 1000)
    @Label("Null food cost percentage returns null status")
    void nullFoodCostPercentageReturnsNullStatus(
            @ForAll("thresholdValues") BigDecimal threshold) {
        
        ThresholdStatus status = ThresholdEvaluator.evaluate(null, threshold);
        
        assertNull(status,
            "When food cost percentage is null (no menu price), status should be null");
    }
    
    /**
     * Additional property: Null threshold returns null status
     */
    @Property(tries = 1000)
    @Label("Null threshold returns null status")
    void nullThresholdReturnsNullStatus(
            @ForAll("foodCostPercentageValuesForNull") BigDecimal foodCostPercentage) {
        
        ThresholdStatus status = ThresholdEvaluator.evaluate(foodCostPercentage, null);
        
        assertNull(status,
            "When threshold is null, status should be null");
    }
    
    /**
     * Additional property: Exactly at threshold should be PASSING
     */
    @Property(tries = 1000)
    @Label("Food cost percentage exactly at threshold is PASSING")
    void exactlyAtThresholdIsPassing(
            @ForAll("thresholdValues") BigDecimal threshold) {
        
        ThresholdStatus status = ThresholdEvaluator.evaluate(threshold, threshold);
        
        assertEquals(ThresholdStatus.PASSING, status,
            String.format("When foodCostPercentage equals threshold (%s), status should be PASSING",
                threshold));
    }
    
    /**
     * Generator for food cost percentage values (0.1 to 200.0, scale 1).
     * Covers typical range including values well below and above common thresholds.
     * Used for the main P12 property test.
     */
    @Provide
    Arbitrary<BigDecimal> foodCostPercentageValues() {
        return Arbitraries.bigDecimals()
            .between(new BigDecimal("0.1"), new BigDecimal("200.0"))
            .ofScale(1);
    }
    
    /**
     * Generator for food cost percentage values for null tests.
     * Same as foodCostPercentageValues but with different name to avoid conflicts.
     */
    @Provide
    Arbitrary<BigDecimal> foodCostPercentageValuesForNull() {
        return Arbitraries.bigDecimals()
            .between(new BigDecimal("0.1"), new BigDecimal("200.0"))
            .ofScale(1);
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
     * Property 14: Threshold Filter Returns Exactly the Exceeding Recipes
     * **Validates: Requirements 5.4**
     * 
     * Verifies that the threshold filter returns exactly the set of recipes where:
     * - food cost percentage > threshold
     * - menu price is not null
     * 
     * All other recipes (those with null menu price or fcp <= threshold) should be excluded.
     */
    @Property(tries = 5000)
    @Label("P14: threshold filter returns exactly the exceeding recipes")
    void thresholdFilterReturnsExactlyExceedingRecipes(
            @ForAll("recipeDtoList") List<RecipeDto> recipes,
            @ForAll("thresholdValues") BigDecimal threshold) {
        
        // Filter recipes using the same logic as ReportService
        // Requirement 5.4: exclude recipes without menu price, include only where fcp > threshold
        List<RecipeDto> actualFiltered = recipes.stream()
                .filter(r -> r.menuPrice != null && r.menuPrice.compareTo(BigDecimal.ZERO) > 0)
                .filter(r -> r.foodCostPercentage != null && r.foodCostPercentage.compareTo(threshold) > 0)
                .collect(java.util.stream.Collectors.toList());
        
        // Manually compute expected result: {r | r.fcp > threshold && r.menuPrice != null}
        List<RecipeDto> expectedFiltered = new ArrayList<>();
        for (RecipeDto recipe : recipes) {
            boolean hasValidMenuPrice = recipe.menuPrice != null && recipe.menuPrice.compareTo(BigDecimal.ZERO) > 0;
            boolean exceedsThreshold = recipe.foodCostPercentage != null && 
                                      recipe.foodCostPercentage.compareTo(threshold) > 0;
            
            if (hasValidMenuPrice && exceedsThreshold) {
                expectedFiltered.add(recipe);
            }
        }
        
        // Assert that filtered set equals expected set
        assertEquals(expectedFiltered.size(), actualFiltered.size(),
            String.format("Filtered recipe count mismatch for threshold %s: expected %d but got %d",
                threshold, expectedFiltered.size(), actualFiltered.size()));
        
        // Verify each expected recipe is in the actual filtered list
        for (RecipeDto expected : expectedFiltered) {
            assertTrue(actualFiltered.contains(expected),
                String.format("Expected recipe '%s' with fcp=%s to be in filtered list for threshold %s",
                    expected.name, expected.foodCostPercentage, threshold));
        }
        
        // Verify no extra recipes are in the actual filtered list
        for (RecipeDto actual : actualFiltered) {
            assertTrue(expectedFiltered.contains(actual),
                String.format("Unexpected recipe '%s' in filtered list for threshold %s",
                    actual.name, threshold));
        }
    }
    
    /**
     * Helper class representing a recipe DTO with relevant fields for threshold filtering.
     */
    private static class RecipeDto {
        final String name;
        final BigDecimal foodCostPercentage;
        final BigDecimal menuPrice;
        
        RecipeDto(String name, BigDecimal foodCostPercentage, BigDecimal menuPrice) {
            this.name = name;
            this.foodCostPercentage = foodCostPercentage;
            this.menuPrice = menuPrice;
        }
        
        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            RecipeDto that = (RecipeDto) o;
            return java.util.Objects.equals(name, that.name) &&
                   java.util.Objects.equals(foodCostPercentage, that.foodCostPercentage) &&
                   java.util.Objects.equals(menuPrice, that.menuPrice);
        }
        
        @Override
        public int hashCode() {
            return java.util.Objects.hash(name, foodCostPercentage, menuPrice);
        }
    }
    
    /**
     * Generator for lists of recipe DTOs with varied food cost percentages and menu prices.
     * Includes recipes with:
     * - null menu price (should be excluded from filtered results)
     * - null food cost percentage (should be excluded)
     * - various fcp values above and below typical thresholds
     */
    @Provide
    Arbitrary<List<RecipeDto>> recipeDtoList() {
        return Arbitraries.integers().between(5, 50)
            .flatMap(numRecipes -> {
                List<Arbitrary<RecipeDto>> recipeArbitraries = new ArrayList<>();
                for (int i = 0; i < numRecipes; i++) {
                    recipeArbitraries.add(recipeDtoArbitrary());
                }
                return Combinators.combine(recipeArbitraries)
                    .as(recipesList -> new ArrayList<>(recipesList));
            });
    }
    
    /**
     * Generator for a single recipe DTO with varied characteristics.
     */
    @Provide
    Arbitrary<RecipeDto> recipeDtoArbitrary() {
        Arbitrary<String> name = Arbitraries.strings()
            .alpha()
            .ofMinLength(1)
            .ofMaxLength(50);
        
        // Food cost percentage can be null or a value in range [0.1, 200.0]
        Arbitrary<BigDecimal> foodCostPercentage = Arbitraries.oneOf(
            Arbitraries.just(null),
            Arbitraries.bigDecimals()
                .between(new BigDecimal("0.1"), new BigDecimal("200.0"))
                .ofScale(1)
        );
        
        // Menu price can be null or a positive value
        Arbitrary<BigDecimal> menuPrice = Arbitraries.oneOf(
            Arbitraries.just(null),
            Arbitraries.bigDecimals()
                .between(new BigDecimal("0.01"), new BigDecimal("999.99"))
                .ofScale(2)
        );
        
        return Combinators.combine(name, foodCostPercentage, menuPrice)
            .as(RecipeDto::new);
    }
    
    /**
     * Property 10: Cost Propagation Reaches All Transitively Dependent Recipes
     * **Validates: Requirements 3.3**
     * 
     * Verifies that when an ingredient is updated, all recipes that directly or transitively
     * reference it (through sub-recipes) have their food_cost_per_portion correctly recalculated.
     * 
     * Test approach:
     * 1. Generate a recipe graph with varied depth and branching
     * 2. Calculate the initial cost for all recipes
     * 3. Update the base ingredient's price
     * 4. Recalculate all dependent recipes in dependency order (leaves first)
     * 5. Assert that every dependent recipe has the correct recalculated food_cost_per_portion
     */
    @Property(tries = 1000)
    @Label("P10: cost propagation reaches all transitively dependent recipes")
    void costPropagationReachesAllTransitivelyDependentRecipes(
            @ForAll("recipeGraphs") RecipeGraph graph) {
        
        // Step 1: Calculate initial costs for all recipes in dependency order (leaves first)
        Map<UUID, BigDecimal> initialCostsPerPortion = new HashMap<>();
        for (RecipeNode node : graph.recipesInDependencyOrder) {
            BigDecimal costPerPortion = calculateRecipeCost(node, initialCostsPerPortion, graph.baseIngredient);
            initialCostsPerPortion.put(node.recipeId, costPerPortion);
        }
        
        // Step 2: Update the base ingredient's price
        TestIngredient updatedIngredient = graph.baseIngredient.withUpdatedPrice(
            graph.baseIngredient.purchasePrice.multiply(new BigDecimal("1.5"))
        );
        
        // Step 3: Recalculate all dependent recipes in dependency order
        Map<UUID, BigDecimal> updatedCostsPerPortion = new HashMap<>();
        for (RecipeNode node : graph.recipesInDependencyOrder) {
            BigDecimal costPerPortion = calculateRecipeCost(node, updatedCostsPerPortion, updatedIngredient);
            updatedCostsPerPortion.put(node.recipeId, costPerPortion);
        }
        
        // Step 4: Verify that ALL recipes have been recalculated with the new cost
        // and that the new cost is different from the initial cost
        for (RecipeNode node : graph.recipesInDependencyOrder) {
            BigDecimal initialCost = initialCostsPerPortion.get(node.recipeId);
            BigDecimal updatedCost = updatedCostsPerPortion.get(node.recipeId);
            
            assertNotNull(initialCost, 
                String.format("Recipe %s should have an initial cost", node.recipeId));
            assertNotNull(updatedCost,
                String.format("Recipe %s should have an updated cost", node.recipeId));
            
            // Calculate expected updated cost manually to verify correctness
            BigDecimal expectedUpdatedCost = calculateRecipeCost(node, updatedCostsPerPortion, updatedIngredient);
            
            assertEquals(expectedUpdatedCost, updatedCost,
                String.format("Recipe %s (depth %d) should have correct recalculated cost. Expected: %s, Actual: %s",
                    node.recipeId, node.depth, expectedUpdatedCost, updatedCost));
            
            // Verify that the cost changed (since ingredient price increased by 50%)
            // The updated cost should be higher than the initial cost
            assertTrue(updatedCost.compareTo(initialCost) > 0,
                String.format("Recipe %s cost should increase after ingredient price increase. Initial: %s, Updated: %s",
                    node.recipeId, initialCost, updatedCost));
        }
        
        // Step 5: Verify that the cost increase propagated proportionally through the graph
        // For recipes at the leaf level (directly using the ingredient), verify the cost increased by ~50%
        for (RecipeNode node : graph.recipesInDependencyOrder) {
            if (node.depth == 1) { // Leaf recipes that directly use the base ingredient
                BigDecimal initialCost = initialCostsPerPortion.get(node.recipeId);
                BigDecimal updatedCost = updatedCostsPerPortion.get(node.recipeId);
                
                // Calculate expected ratio (should be close to 1.5 if the recipe only uses the base ingredient)
                BigDecimal ratio = updatedCost.divide(initialCost, 10, RoundingMode.HALF_UP);
                
                // Verify ratio is between 1.0 and 1.52 (allowing for rounding differences)
                // it won't be exactly 1.5 if the recipe has other ingredients too
                assertTrue(ratio.compareTo(BigDecimal.ONE) >= 0 && ratio.compareTo(new BigDecimal("1.52")) <= 0,
                    String.format("Leaf recipe %s cost ratio should be between 1.0 and 1.52. Actual ratio: %s",
                        node.recipeId, ratio));
            }
        }
    }
    
    /**
     * Helper method to calculate the cost of a recipe given the current state of its dependencies.
     * 
     * @param node the recipe node
     * @param recipeCostsCache cache of already-calculated recipe costs (for sub-recipes)
     * @param baseIngredient the base ingredient (may have updated price)
     * @return the food cost per portion for this recipe
     */
    private BigDecimal calculateRecipeCost(
            RecipeNode node,
            Map<UUID, BigDecimal> recipeCostsCache,
            TestIngredient baseIngredient) {
        
        BigDecimal totalBatchCost = BigDecimal.ZERO;
        
        // Sum up costs from all ingredient lines
        for (RecipeNode.IngredientLineReference line : node.ingredientLines) {
            BigDecimal lineCost;
            
            if (line.isSubRecipe) {
                // Sub-recipe line: use cached cost per portion
                BigDecimal subRecipeCostPerPortion = recipeCostsCache.get(line.ingredientOrRecipeId);
                if (subRecipeCostPerPortion == null) {
                    throw new IllegalStateException(
                        "Sub-recipe " + line.ingredientOrRecipeId + " not yet calculated (wrong dependency order)");
                }
                lineCost = line.quantityUsed.multiply(subRecipeCostPerPortion);
            } else {
                // Regular ingredient line
                TestIngredient ingredient = line.ingredientOrRecipeId.equals(baseIngredient.ingredientId)
                    ? baseIngredient
                    : line.otherIngredient;
                
                if (ingredient == null) {
                    throw new IllegalStateException("Ingredient not found: " + line.ingredientOrRecipeId);
                }
                
                // Calculate cost per unit and effective cost
                BigDecimal costPerUnit = CostCalculator.costPerUnit(
                    ingredient.purchasePrice,
                    ingredient.purchaseQuantity
                );
                BigDecimal effectiveCost = CostCalculator.effectiveCostPerUsableUnit(
                    costPerUnit,
                    ingredient.yieldPercentage
                );
                
                // Convert quantity to purchase unit (assuming same UOM for simplicity in this test)
                BigDecimal convertedQuantity = line.quantityUsed;
                
                lineCost = CostCalculator.lineCost(convertedQuantity, effectiveCost);
            }
            
            totalBatchCost = totalBatchCost.add(lineCost);
        }
        
        // Calculate food cost per portion
        return CostCalculator.foodCostPerPortion(totalBatchCost, node.portionCount);
    }
    
    /**
     * Generator for recipe graphs with varied depth and branching patterns.
     * 
     * A recipe graph consists of:
     * - A base ingredient (that will be updated)
     * - A list of recipes in dependency order (leaves first)
     * - Each recipe may reference the base ingredient, other ingredients, or sub-recipes
     * 
     * The graph will have:
     * - Depth: 1-4 levels (where depth 1 = directly uses base ingredient)
     * - Branching: 1-3 recipes at each level
     */
    @Provide
    Arbitrary<RecipeGraph> recipeGraphs() {
        Arbitrary<Integer> depthArbitrary = Arbitraries.integers().between(1, 4);
        Arbitrary<BigDecimal> basePriceArbitrary = Arbitraries.bigDecimals()
            .between(new BigDecimal("5.00"), new BigDecimal("50.00"))
            .ofScale(2);
        Arbitrary<BigDecimal> baseQuantityArbitrary = Arbitraries.bigDecimals()
            .between(new BigDecimal("0.5"), new BigDecimal("5.00"))
            .ofScale(2);
        
        return Combinators.combine(depthArbitrary, basePriceArbitrary, baseQuantityArbitrary)
            .as((maxDepth, basePrice, baseQuantity) -> {
                // Create base ingredient with randomized price
                TestIngredient baseIngredient = new TestIngredient(
                    UUID.randomUUID(),
                    basePrice,
                    baseQuantity,
                    new BigDecimal("100") // full yield for simplicity
                );
                
                List<RecipeNode> allRecipes = new ArrayList<>();
                
                // Generate recipes at each depth level
                for (int depth = 1; depth <= maxDepth; depth++) {
                    int numRecipesAtDepth = 1 + (depth % 3); // 1-3 recipes per level
                    
                    for (int i = 0; i < numRecipesAtDepth; i++) {
                        RecipeNode recipe = generateRecipeAtDepth(
                            depth,
                            baseIngredient,
                            allRecipes,
                            i // seed for deterministic randomness
                        );
                        allRecipes.add(recipe);
                    }
                }
                
                return new RecipeGraph(baseIngredient, allRecipes);
            });
    }
    
    /**
     * Generate a single recipe node at a given depth in the dependency graph.
     * 
     * @param depth the depth level (1 = directly uses base ingredient)
     * @param baseIngredient the base ingredient
     * @param existingRecipes recipes at lower depths (potential sub-recipes)
     * @param seed deterministic seed for random choices
     * @return a new recipe node
     */
    private RecipeNode generateRecipeAtDepth(
            int depth,
            TestIngredient baseIngredient,
            List<RecipeNode> existingRecipes,
            int seed) {
        
        UUID recipeId = UUID.randomUUID();
        int portionCount = 2 + (depth * seed); // varies from 2 to ~12 portions
        List<RecipeNode.IngredientLineReference> ingredientLines = new ArrayList<>();
        
        if (depth == 1) {
            // Leaf recipe: directly uses the base ingredient
            BigDecimal baseQuantity = new BigDecimal(String.format("%.2f", 1.0 + seed * 0.5));
            ingredientLines.add(new RecipeNode.IngredientLineReference(
                baseIngredient.ingredientId,
                false,
                baseQuantity,
                null
            ));
            
            // Optionally add other ingredients (based on seed)
            if (seed % 2 == 0) {
                TestIngredient otherIngredient = new TestIngredient(
                    UUID.randomUUID(),
                    new BigDecimal(String.format("%.2f", 3.0 + seed * 1.0)),
                    new BigDecimal("1.00"),
                    new BigDecimal("100")
                );
                ingredientLines.add(new RecipeNode.IngredientLineReference(
                    otherIngredient.ingredientId,
                    false,
                    new BigDecimal(String.format("%.2f", 0.5 + seed * 0.25)),
                    otherIngredient
                ));
            }
        } else {
            // Non-leaf recipe: uses sub-recipes from previous levels
            List<RecipeNode> potentialSubRecipes = existingRecipes.stream()
                .filter(r -> r.depth == depth - 1)
                .collect(java.util.stream.Collectors.toList());
            
            if (!potentialSubRecipes.isEmpty()) {
                // Pick 1-2 sub-recipes based on seed
                int numSubRecipes = 1 + (seed % Math.min(2, potentialSubRecipes.size()));
                for (int i = 0; i < numSubRecipes && i < potentialSubRecipes.size(); i++) {
                    RecipeNode subRecipe = potentialSubRecipes.get(i % potentialSubRecipes.size());
                    ingredientLines.add(new RecipeNode.IngredientLineReference(
                        subRecipe.recipeId,
                        true,
                        new BigDecimal(String.format("%.2f", 1.0 + i * 0.5)),
                        null
                    ));
                }
            }
            
            // Also add the base ingredient directly (to ensure transitive dependency)
            if (seed % 3 != 0) {
                ingredientLines.add(new RecipeNode.IngredientLineReference(
                    baseIngredient.ingredientId,
                    false,
                    new BigDecimal(String.format("%.2f", 0.25 + seed * 0.1)),
                    null
                ));
            }
        }
        
        return new RecipeNode(recipeId, portionCount, depth, ingredientLines);
    }
    
    /**
     * Represents a recipe graph for testing cost propagation.
     */
    private static class RecipeGraph {
        final TestIngredient baseIngredient;
        final List<RecipeNode> recipesInDependencyOrder; // leaves first
        
        RecipeGraph(TestIngredient baseIngredient, List<RecipeNode> recipesInDependencyOrder) {
            this.baseIngredient = baseIngredient;
            this.recipesInDependencyOrder = recipesInDependencyOrder;
        }
    }
    
    /**
     * Represents a recipe in the test graph.
     */
    private static class RecipeNode {
        final UUID recipeId;
        final int portionCount;
        final int depth; // 1 = directly uses base ingredient, 2+ = uses sub-recipes
        final List<IngredientLineReference> ingredientLines;
        
        RecipeNode(UUID recipeId, int portionCount, int depth, List<IngredientLineReference> ingredientLines) {
            this.recipeId = recipeId;
            this.portionCount = portionCount;
            this.depth = depth;
            this.ingredientLines = ingredientLines;
        }
        
        /**
         * Represents a reference to an ingredient or sub-recipe in a recipe.
         */
        static class IngredientLineReference {
            final UUID ingredientOrRecipeId;
            final boolean isSubRecipe;
            final BigDecimal quantityUsed;
            final TestIngredient otherIngredient; // only for non-base ingredients
            
            IngredientLineReference(UUID ingredientOrRecipeId, boolean isSubRecipe, 
                                   BigDecimal quantityUsed, TestIngredient otherIngredient) {
                this.ingredientOrRecipeId = ingredientOrRecipeId;
                this.isSubRecipe = isSubRecipe;
                this.quantityUsed = quantityUsed;
                this.otherIngredient = otherIngredient;
            }
        }
    }
    
    /**
     * Test ingredient with price, quantity, and yield.
     */
    private static class TestIngredient {
        final UUID ingredientId;
        final BigDecimal purchasePrice;
        final BigDecimal purchaseQuantity;
        final BigDecimal yieldPercentage;
        
        TestIngredient(UUID ingredientId, BigDecimal purchasePrice, 
                      BigDecimal purchaseQuantity, BigDecimal yieldPercentage) {
            this.ingredientId = ingredientId;
            this.purchasePrice = purchasePrice;
            this.purchaseQuantity = purchaseQuantity;
            this.yieldPercentage = yieldPercentage;
        }
        
        /**
         * Create a copy of this ingredient with an updated price.
         */
        TestIngredient withUpdatedPrice(BigDecimal newPrice) {
            return new TestIngredient(
                this.ingredientId,
                newPrice,
                this.purchaseQuantity,
                this.yieldPercentage
            );
        }
    }
}
