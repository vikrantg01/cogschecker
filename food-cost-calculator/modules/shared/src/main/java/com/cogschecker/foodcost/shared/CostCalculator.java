package com.cogschecker.foodcost.shared;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * Pure static methods for food cost calculations.
 * All methods use BigDecimal with HALF_UP rounding for financial accuracy.
 * 
 * Calculation rules from Requirements 1.2, 1.5, 3.1, 3.2, 4.2:
 * - cost_per_unit = purchase_price / purchase_quantity (4 d.p.)
 * - effective_cost_per_usable_unit = cost_per_unit / (yield_percentage / 100) (4 d.p.)
 * - line_cost = quantity_used * effective_cost_per_usable_unit
 * - total_batch_cost = SUM(line_cost for all ingredient lines)
 * - food_cost_per_portion = total_batch_cost / portion_count (2 d.p.)
 * - food_cost_percentage = (food_cost_per_portion / menu_selling_price) * 100 (1 d.p.)
 */
public class CostCalculator {
    
    private static final BigDecimal ONE_HUNDRED = new BigDecimal("100");
    
    private CostCalculator() {
        // Utility class, no instantiation
    }
    
    /**
     * Calculate cost per unit.
     * cost_per_unit = purchase_price / purchase_quantity
     * 
     * @param purchasePrice the purchase price (must be > 0)
     * @param purchaseQuantity the purchase quantity (must be > 0)
     * @return cost per unit rounded to 4 decimal places
     * @throws IllegalArgumentException if inputs are null, zero, or negative
     */
    public static BigDecimal costPerUnit(BigDecimal purchasePrice, BigDecimal purchaseQuantity) {
        validatePositive(purchasePrice, "Purchase price");
        validatePositive(purchaseQuantity, "Purchase quantity");
        
        BigDecimal result = purchasePrice.divide(purchaseQuantity, 10, RoundingMode.HALF_UP);
        return RoundingUtils.round4dp(result);
    }
    
    /**
     * Calculate effective cost per usable unit (accounting for yield).
     * effective_cost_per_usable_unit = cost_per_unit / (yield_percentage / 100)
     * 
     * @param costPerUnit the cost per unit (must be > 0)
     * @param yieldPercentage the yield percentage (must be between 1 and 100 inclusive)
     * @return effective cost per usable unit rounded to 4 decimal places
     * @throws IllegalArgumentException if inputs are invalid
     */
    public static BigDecimal effectiveCostPerUsableUnit(BigDecimal costPerUnit, BigDecimal yieldPercentage) {
        validatePositive(costPerUnit, "Cost per unit");
        validateYieldPercentage(yieldPercentage);
        
        BigDecimal yieldFactor = yieldPercentage.divide(ONE_HUNDRED, 10, RoundingMode.HALF_UP);
        BigDecimal result = costPerUnit.divide(yieldFactor, 10, RoundingMode.HALF_UP);
        return RoundingUtils.round4dp(result);
    }
    
    /**
     * Calculate the cost of a single ingredient line in a recipe.
     * line_cost = quantity_used * effective_cost_per_usable_unit
     * 
     * Note: quantity_used should already be converted to the purchase unit before calling this method.
     * 
     * @param quantityUsed the quantity used in the recipe (in purchase units)
     * @param effectiveCostPerUsableUnit the effective cost per usable unit
     * @return line cost (not rounded, for summing)
     * @throws IllegalArgumentException if inputs are null or negative
     */
    public static BigDecimal lineCost(BigDecimal quantityUsed, BigDecimal effectiveCostPerUsableUnit) {
        validateNonNegative(quantityUsed, "Quantity used");
        validateNonNegative(effectiveCostPerUsableUnit, "Effective cost per usable unit");
        
        return quantityUsed.multiply(effectiveCostPerUsableUnit);
    }
    
    /**
     * Calculate total batch cost by summing all ingredient line costs.
     * total_batch_cost = SUM(line_cost)
     * 
     * @param lineCosts array of individual line costs
     * @return total batch cost (not rounded, for further calculations)
     * @throws IllegalArgumentException if lineCosts is null
     */
    public static BigDecimal batchCost(BigDecimal... lineCosts) {
        if (lineCosts == null) {
            throw new IllegalArgumentException("Line costs cannot be null");
        }
        
        BigDecimal total = BigDecimal.ZERO;
        for (BigDecimal lineCost : lineCosts) {
            if (lineCost != null) {
                total = total.add(lineCost);
            }
        }
        return total;
    }
    
    /**
     * Calculate food cost per portion.
     * food_cost_per_portion = total_batch_cost / portion_count
     * 
     * @param totalBatchCost the total batch cost
     * @param portionCount the number of portions (must be > 0)
     * @return food cost per portion rounded to 2 decimal places
     * @throws IllegalArgumentException if inputs are invalid
     */
    public static BigDecimal foodCostPerPortion(BigDecimal totalBatchCost, int portionCount) {
        validateNonNegative(totalBatchCost, "Total batch cost");
        if (portionCount <= 0) {
            throw new IllegalArgumentException("Portion count must be greater than 0");
        }
        
        BigDecimal result = totalBatchCost.divide(
            new BigDecimal(portionCount), 
            10, 
            RoundingMode.HALF_UP
        );
        return RoundingUtils.round2dp(result);
    }
    
    /**
     * Calculate food cost percentage.
     * food_cost_percentage = (food_cost_per_portion / menu_selling_price) * 100
     * 
     * @param foodCostPerPortion the food cost per portion
     * @param menuSellingPrice the menu selling price (must be > 0)
     * @return food cost percentage rounded to 1 decimal place
     * @throws IllegalArgumentException if inputs are invalid
     */
    public static BigDecimal foodCostPercentage(BigDecimal foodCostPerPortion, BigDecimal menuSellingPrice) {
        validateNonNegative(foodCostPerPortion, "Food cost per portion");
        validatePositive(menuSellingPrice, "Menu selling price");
        
        BigDecimal result = foodCostPerPortion
            .divide(menuSellingPrice, 10, RoundingMode.HALF_UP)
            .multiply(ONE_HUNDRED);
        return RoundingUtils.round1dp(result);
    }
    
    // Validation helpers
    
    private static void validatePositive(BigDecimal value, String fieldName) {
        if (value == null) {
            throw new IllegalArgumentException(fieldName + " cannot be null");
        }
        if (value.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException(fieldName + " must be greater than 0");
        }
    }
    
    private static void validateNonNegative(BigDecimal value, String fieldName) {
        if (value == null) {
            throw new IllegalArgumentException(fieldName + " cannot be null");
        }
        if (value.compareTo(BigDecimal.ZERO) < 0) {
            throw new IllegalArgumentException(fieldName + " cannot be negative");
        }
    }
    
    private static void validateYieldPercentage(BigDecimal yieldPercentage) {
        if (yieldPercentage == null) {
            throw new IllegalArgumentException("Yield percentage cannot be null");
        }
        if (yieldPercentage.compareTo(BigDecimal.ONE) < 0 || 
            yieldPercentage.compareTo(ONE_HUNDRED) > 0) {
            throw new IllegalArgumentException("Yield percentage must be between 1 and 100 inclusive");
        }
    }
}
