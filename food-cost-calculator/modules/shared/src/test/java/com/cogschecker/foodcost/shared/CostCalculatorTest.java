package com.cogschecker.foodcost.shared;

import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import static org.junit.jupiter.api.Assertions.*;

class CostCalculatorTest {
    
    @Test
    void testCostPerUnit() {
        // Basic calculation: 10.00 / 5 = 2.0000
        assertEquals(new BigDecimal("2.0000"), 
            CostCalculator.costPerUnit(new BigDecimal("10.00"), new BigDecimal("5")));
        
        // With decimals: 15.50 / 2.5 = 6.2000
        assertEquals(new BigDecimal("6.2000"), 
            CostCalculator.costPerUnit(new BigDecimal("15.50"), new BigDecimal("2.5")));
        
        // Rounds to 4 decimal places: 10 / 3 = 3.3333...
        assertEquals(new BigDecimal("3.3333"), 
            CostCalculator.costPerUnit(new BigDecimal("10"), new BigDecimal("3")));
    }
    
    @Test
    void testCostPerUnitZeroPriceThrows() {
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.costPerUnit(BigDecimal.ZERO, new BigDecimal("5")));
    }
    
    @Test
    void testCostPerUnitNegativePriceThrows() {
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.costPerUnit(new BigDecimal("-10"), new BigDecimal("5")));
    }
    
    @Test
    void testCostPerUnitZeroQuantityThrows() {
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.costPerUnit(new BigDecimal("10"), BigDecimal.ZERO));
    }
    
    @Test
    void testCostPerUnitNullThrows() {
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.costPerUnit(null, new BigDecimal("5")));
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.costPerUnit(new BigDecimal("10"), null));
    }
    
    @Test
    void testEffectiveCostPerUsableUnit() {
        // 100% yield: 2.0000 / (100 / 100) = 2.0000
        assertEquals(new BigDecimal("2.0000"), 
            CostCalculator.effectiveCostPerUsableUnit(new BigDecimal("2.0000"), new BigDecimal("100")));
        
        // 80% yield: 2.0000 / (80 / 100) = 2.5000
        assertEquals(new BigDecimal("2.5000"), 
            CostCalculator.effectiveCostPerUsableUnit(new BigDecimal("2.0000"), new BigDecimal("80")));
        
        // 50% yield: 4.0000 / (50 / 100) = 8.0000
        assertEquals(new BigDecimal("8.0000"), 
            CostCalculator.effectiveCostPerUsableUnit(new BigDecimal("4.0000"), new BigDecimal("50")));
        
        // Low yield: 3.0000 / (25 / 100) = 12.0000
        assertEquals(new BigDecimal("12.0000"), 
            CostCalculator.effectiveCostPerUsableUnit(new BigDecimal("3.0000"), new BigDecimal("25")));
    }
    
    @Test
    void testEffectiveCostPerUsableUnitYieldBelowRangeThrows() {
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.effectiveCostPerUsableUnit(new BigDecimal("2.0000"), BigDecimal.ZERO));
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.effectiveCostPerUsableUnit(new BigDecimal("2.0000"), new BigDecimal("0.5")));
    }
    
    @Test
    void testEffectiveCostPerUsableUnitYieldAboveRangeThrows() {
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.effectiveCostPerUsableUnit(new BigDecimal("2.0000"), new BigDecimal("101")));
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.effectiveCostPerUsableUnit(new BigDecimal("2.0000"), new BigDecimal("150")));
    }
    
    @Test
    void testEffectiveCostPerUsableUnitNullThrows() {
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.effectiveCostPerUsableUnit(null, new BigDecimal("100")));
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.effectiveCostPerUsableUnit(new BigDecimal("2.0000"), null));
    }
    
    @Test
    void testLineCost() {
        // 5 units * 2.0000 per unit = 10.0000
        assertEquals(new BigDecimal("10.0000"), 
            CostCalculator.lineCost(new BigDecimal("5"), new BigDecimal("2.0000")));
        
        // 2.5 units * 3.5000 per unit = 8.7500
        assertEquals(new BigDecimal("8.75000"), 
            CostCalculator.lineCost(new BigDecimal("2.5"), new BigDecimal("3.5000")));
        
        // Zero quantity
        assertEquals(new BigDecimal("0.0000"), 
            CostCalculator.lineCost(BigDecimal.ZERO, new BigDecimal("2.0000")));
    }
    
    @Test
    void testLineCostNegativeThrows() {
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.lineCost(new BigDecimal("-5"), new BigDecimal("2.0000")));
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.lineCost(new BigDecimal("5"), new BigDecimal("-2.0000")));
    }
    
    @Test
    void testLineCostNullThrows() {
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.lineCost(null, new BigDecimal("2.0000")));
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.lineCost(new BigDecimal("5"), null));
    }
    
    @Test
    void testBatchCost() {
        // Sum of multiple line costs
        BigDecimal total = CostCalculator.batchCost(
            new BigDecimal("10.00"),
            new BigDecimal("5.50"),
            new BigDecimal("3.25")
        );
        assertEquals(new BigDecimal("18.75"), total);
    }
    
    @Test
    void testBatchCostEmpty() {
        assertEquals(BigDecimal.ZERO, CostCalculator.batchCost());
    }
    
    @Test
    void testBatchCostSingle() {
        assertEquals(new BigDecimal("10.00"), 
            CostCalculator.batchCost(new BigDecimal("10.00")));
    }
    
    @Test
    void testBatchCostWithNulls() {
        // Null entries are ignored
        BigDecimal total = CostCalculator.batchCost(
            new BigDecimal("10.00"),
            null,
            new BigDecimal("5.50")
        );
        assertEquals(new BigDecimal("15.50"), total);
    }
    
    @Test
    void testBatchCostNullArrayThrows() {
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.batchCost((BigDecimal[]) null));
    }
    
    @Test
    void testFoodCostPerPortion() {
        // 20.00 / 4 portions = 5.00
        assertEquals(new BigDecimal("5.00"), 
            CostCalculator.foodCostPerPortion(new BigDecimal("20.00"), 4));
        
        // 15.50 / 6 portions = 2.58 (rounded)
        assertEquals(new BigDecimal("2.58"), 
            CostCalculator.foodCostPerPortion(new BigDecimal("15.50"), 6));
        
        // 10 / 3 portions = 3.33 (rounded)
        assertEquals(new BigDecimal("3.33"), 
            CostCalculator.foodCostPerPortion(new BigDecimal("10"), 3));
    }
    
    @Test
    void testFoodCostPerPortionZeroPortionsThrows() {
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.foodCostPerPortion(new BigDecimal("20.00"), 0));
    }
    
    @Test
    void testFoodCostPerPortionNegativePortionsThrows() {
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.foodCostPerPortion(new BigDecimal("20.00"), -1));
    }
    
    @Test
    void testFoodCostPerPortionNegativeCostThrows() {
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.foodCostPerPortion(new BigDecimal("-20.00"), 4));
    }
    
    @Test
    void testFoodCostPerPortionNullThrows() {
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.foodCostPerPortion(null, 4));
    }
    
    @Test
    void testFoodCostPerPortionZeroCost() {
        assertEquals(new BigDecimal("0.00"), 
            CostCalculator.foodCostPerPortion(BigDecimal.ZERO, 4));
    }
    
    @Test
    void testFoodCostPercentage() {
        // 5.00 / 20.00 * 100 = 25.0%
        assertEquals(new BigDecimal("25.0"), 
            CostCalculator.foodCostPercentage(new BigDecimal("5.00"), new BigDecimal("20.00")));
        
        // 3.50 / 10.00 * 100 = 35.0%
        assertEquals(new BigDecimal("35.0"), 
            CostCalculator.foodCostPercentage(new BigDecimal("3.50"), new BigDecimal("10.00")));
        
        // 10 / 30 * 100 = 33.3%
        assertEquals(new BigDecimal("33.3"), 
            CostCalculator.foodCostPercentage(new BigDecimal("10"), new BigDecimal("30")));
        
        // 2.55 / 8.50 * 100 = 30.0%
        assertEquals(new BigDecimal("30.0"), 
            CostCalculator.foodCostPercentage(new BigDecimal("2.55"), new BigDecimal("8.50")));
    }
    
    @Test
    void testFoodCostPercentageZeroMenuPriceThrows() {
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.foodCostPercentage(new BigDecimal("5.00"), BigDecimal.ZERO));
    }
    
    @Test
    void testFoodCostPercentageNegativeMenuPriceThrows() {
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.foodCostPercentage(new BigDecimal("5.00"), new BigDecimal("-20.00")));
    }
    
    @Test
    void testFoodCostPercentageNegativeFoodCostThrows() {
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.foodCostPercentage(new BigDecimal("-5.00"), new BigDecimal("20.00")));
    }
    
    @Test
    void testFoodCostPercentageNullThrows() {
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.foodCostPercentage(null, new BigDecimal("20.00")));
        assertThrows(IllegalArgumentException.class, () -> 
            CostCalculator.foodCostPercentage(new BigDecimal("5.00"), null));
    }
    
    @Test
    void testFoodCostPercentageZeroFoodCost() {
        assertEquals(new BigDecimal("0.0"), 
            CostCalculator.foodCostPercentage(BigDecimal.ZERO, new BigDecimal("20.00")));
    }
    
    @Test
    void testIntegratedCalculation() {
        // Requirement 1.2, 1.5 example:
        // Purchase: $10 for 1 kg
        BigDecimal purchasePrice = new BigDecimal("10.00");
        BigDecimal purchaseQuantity = new BigDecimal("1"); // kg
        
        // Cost per unit: 10 / 1 = 10.0000
        BigDecimal costPerUnit = CostCalculator.costPerUnit(purchasePrice, purchaseQuantity);
        assertEquals(new BigDecimal("10.0000"), costPerUnit);
        
        // Yield: 80%
        BigDecimal yieldPercentage = new BigDecimal("80");
        
        // Effective cost: 10.0000 / 0.8 = 12.5000
        BigDecimal effectiveCost = CostCalculator.effectiveCostPerUsableUnit(costPerUnit, yieldPercentage);
        assertEquals(new BigDecimal("12.5000"), effectiveCost);
        
        // Recipe uses 0.25 kg = 250g (after conversion)
        BigDecimal quantityUsed = new BigDecimal("0.25");
        
        // Line cost: 0.25 * 12.5000 = 3.1250
        BigDecimal lineCost = CostCalculator.lineCost(quantityUsed, effectiveCost);
        assertEquals(new BigDecimal("3.125000"), lineCost);
        
        // Total batch cost with another ingredient
        BigDecimal totalBatch = CostCalculator.batchCost(lineCost, new BigDecimal("2.50"));
        assertEquals(new BigDecimal("5.625000"), totalBatch);
        
        // Food cost per portion (4 portions)
        BigDecimal foodCostPerPortion = CostCalculator.foodCostPerPortion(totalBatch, 4);
        assertEquals(new BigDecimal("1.41"), foodCostPerPortion);
        
        // Food cost percentage (menu price $5)
        BigDecimal foodCostPercentage = CostCalculator.foodCostPercentage(
            foodCostPerPortion, new BigDecimal("5.00"));
        assertEquals(new BigDecimal("28.2"), foodCostPercentage);
    }
}
