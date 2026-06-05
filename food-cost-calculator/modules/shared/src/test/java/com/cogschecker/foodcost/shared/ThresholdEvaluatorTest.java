package com.cogschecker.foodcost.shared;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for ThresholdEvaluator.
 * Requirements: 4.7, 4.8
 */
class ThresholdEvaluatorTest {
    
    @Test
    void testEvaluate_WhenPercentageExceedsThreshold_ReturnsExceeding() {
        // Requirement 4.7: percentage > threshold should return EXCEEDING
        BigDecimal percentage = new BigDecimal("35.5");
        BigDecimal threshold = new BigDecimal("30.0");
        
        ThresholdStatus result = ThresholdEvaluator.evaluate(percentage, threshold);
        
        assertEquals(ThresholdStatus.EXCEEDING, result);
    }
    
    @Test
    void testEvaluate_WhenPercentageEqualsThreshold_ReturnsPassing() {
        // Requirement 4.8: percentage == threshold should return PASSING (at or below)
        BigDecimal percentage = new BigDecimal("30.0");
        BigDecimal threshold = new BigDecimal("30.0");
        
        ThresholdStatus result = ThresholdEvaluator.evaluate(percentage, threshold);
        
        assertEquals(ThresholdStatus.PASSING, result);
    }
    
    @Test
    void testEvaluate_WhenPercentageBelowThreshold_ReturnsPassing() {
        // Requirement 4.8: percentage < threshold should return PASSING
        BigDecimal percentage = new BigDecimal("25.0");
        BigDecimal threshold = new BigDecimal("30.0");
        
        ThresholdStatus result = ThresholdEvaluator.evaluate(percentage, threshold);
        
        assertEquals(ThresholdStatus.PASSING, result);
    }
    
    @Test
    void testEvaluate_WhenPercentageIsNull_ReturnsNull() {
        // When food cost percentage is null (no menu price), return null
        BigDecimal threshold = new BigDecimal("30.0");
        
        ThresholdStatus result = ThresholdEvaluator.evaluate(null, threshold);
        
        assertNull(result);
    }
    
    @Test
    void testEvaluate_WhenThresholdIsNull_ReturnsNull() {
        // When threshold is null, cannot evaluate - return null
        BigDecimal percentage = new BigDecimal("25.0");
        
        ThresholdStatus result = ThresholdEvaluator.evaluate(percentage, null);
        
        assertNull(result);
    }
    
    @Test
    void testEvaluate_WhenBothAreNull_ReturnsNull() {
        ThresholdStatus result = ThresholdEvaluator.evaluate(null, null);
        
        assertNull(result);
    }
    
    @Test
    void testEvaluate_EdgeCase_VerySmallExceedance() {
        // Test edge case: just barely exceeding (30.01 > 30.0)
        BigDecimal percentage = new BigDecimal("30.01");
        BigDecimal threshold = new BigDecimal("30.0");
        
        ThresholdStatus result = ThresholdEvaluator.evaluate(percentage, threshold);
        
        assertEquals(ThresholdStatus.EXCEEDING, result);
    }
    
    @Test
    void testEvaluate_EdgeCase_VerySmallPassing() {
        // Test edge case: just barely passing (29.99 < 30.0)
        BigDecimal percentage = new BigDecimal("29.99");
        BigDecimal threshold = new BigDecimal("30.0");
        
        ThresholdStatus result = ThresholdEvaluator.evaluate(percentage, threshold);
        
        assertEquals(ThresholdStatus.PASSING, result);
    }
    
    @Test
    void testEvaluate_WithZeroPercentage() {
        // Recipe with zero food cost percentage should pass
        BigDecimal percentage = BigDecimal.ZERO;
        BigDecimal threshold = new BigDecimal("30.0");
        
        ThresholdStatus result = ThresholdEvaluator.evaluate(percentage, threshold);
        
        assertEquals(ThresholdStatus.PASSING, result);
    }
    
    @Test
    void testEvaluate_WithHighPercentage() {
        // Very high food cost percentage (e.g., 150%) should exceed
        BigDecimal percentage = new BigDecimal("150.0");
        BigDecimal threshold = new BigDecimal("30.0");
        
        ThresholdStatus result = ThresholdEvaluator.evaluate(percentage, threshold);
        
        assertEquals(ThresholdStatus.EXCEEDING, result);
    }
    
    @Test
    void testEvaluate_WithDifferentScales() {
        // Test that BigDecimal comparison works correctly with different scales
        BigDecimal percentage = new BigDecimal("30.000");
        BigDecimal threshold = new BigDecimal("30.0");
        
        ThresholdStatus result = ThresholdEvaluator.evaluate(percentage, threshold);
        
        assertEquals(ThresholdStatus.PASSING, result);
    }
}
