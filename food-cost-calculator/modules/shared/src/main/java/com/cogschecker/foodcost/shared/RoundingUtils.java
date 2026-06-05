package com.cogschecker.foodcost.shared;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * Utility class for deterministic BigDecimal rounding operations.
 * All rounding uses HALF_UP mode for consistency.
 */
public class RoundingUtils {
    
    private RoundingUtils() {
        // Utility class, no instantiation
    }
    
    /**
     * Round a BigDecimal value to the specified number of decimal places using HALF_UP rounding.
     * 
     * @param value the value to round
     * @param scale the number of decimal places
     * @return the rounded value
     */
    public static BigDecimal round(BigDecimal value, int scale) {
        if (value == null) {
            throw new IllegalArgumentException("Value cannot be null");
        }
        if (scale < 0) {
            throw new IllegalArgumentException("Scale must be non-negative");
        }
        return value.setScale(scale, RoundingMode.HALF_UP);
    }
    
    /**
     * Round to 4 decimal places (used for cost per unit calculations).
     * 
     * @param value the value to round
     * @return the rounded value with 4 decimal places
     */
    public static BigDecimal round4dp(BigDecimal value) {
        return round(value, 4);
    }
    
    /**
     * Round to 2 decimal places (used for currency amounts).
     * 
     * @param value the value to round
     * @return the rounded value with 2 decimal places
     */
    public static BigDecimal round2dp(BigDecimal value) {
        return round(value, 2);
    }
    
    /**
     * Round to 1 decimal place (used for percentages).
     * 
     * @param value the value to round
     * @return the rounded value with 1 decimal place
     */
    public static BigDecimal round1dp(BigDecimal value) {
        return round(value, 1);
    }
}
