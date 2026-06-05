package com.cogschecker.foodcost.shared;

/**
 * Enumeration representing whether a recipe's food cost percentage
 * exceeds or passes the target threshold.
 * 
 * Requirements: 4.7, 4.8
 */
public enum ThresholdStatus {
    /**
     * Food cost percentage exceeds the target threshold.
     * Requirement 4.7: Display visual indicator for recipes exceeding threshold.
     */
    EXCEEDING,
    
    /**
     * Food cost percentage is at or below the target threshold.
     * Requirement 4.8: Display passing indicator when at or below threshold.
     */
    PASSING
}
