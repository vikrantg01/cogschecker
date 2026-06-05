package com.cogschecker.foodcost.shared;

import java.math.BigDecimal;

/**
 * Evaluator for determining whether a recipe's food cost percentage
 * exceeds or passes a target threshold.
 * 
 * Requirements: 4.7, 4.8
 */
public class ThresholdEvaluator {
    
    /**
     * Evaluate whether the food cost percentage exceeds the target threshold.
     * 
     * Requirement 4.7: When a recipe's Food Cost Percentage exceeds the target threshold,
     * the system shall display a visual indicator.
     * 
     * Requirement 4.8: When a recipe's Food Cost Percentage is at or below the target threshold,
     * the system shall display a passing visual indicator.
     * 
     * @param foodCostPercentage the recipe's food cost percentage (can be null)
     * @param threshold the target threshold percentage (typically between 1 and 100)
     * @return ThresholdStatus.EXCEEDING if percentage exceeds threshold,
     *         ThresholdStatus.PASSING if at or below threshold,
     *         null if foodCostPercentage is null (no menu price set)
     */
    public static ThresholdStatus evaluate(BigDecimal foodCostPercentage, BigDecimal threshold) {
        // If food cost percentage is null (no menu price set), return null
        // The UI should handle this by not displaying any indicator
        if (foodCostPercentage == null) {
            return null;
        }
        
        // If threshold is null, we cannot evaluate - return null
        if (threshold == null) {
            return null;
        }
        
        // Requirement 4.7: exceeds means foodCostPercentage > threshold
        // Requirement 4.8: at or below means foodCostPercentage <= threshold
        if (foodCostPercentage.compareTo(threshold) > 0) {
            return ThresholdStatus.EXCEEDING;
        } else {
            return ThresholdStatus.PASSING;
        }
    }
}
