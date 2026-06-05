package com.cogschecker.foodcost.shared;

import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import static org.junit.jupiter.api.Assertions.*;

class RoundingUtilsTest {
    
    @Test
    void testRoundBasic() {
        assertEquals(new BigDecimal("1.23"), RoundingUtils.round(new BigDecimal("1.234"), 2));
        assertEquals(new BigDecimal("1.24"), RoundingUtils.round(new BigDecimal("1.235"), 2));
        assertEquals(new BigDecimal("1.00"), RoundingUtils.round(new BigDecimal("1.001"), 2));
    }
    
    @Test
    void testRoundHalfUp() {
        // Test HALF_UP rounding mode
        assertEquals(new BigDecimal("1.3"), RoundingUtils.round(new BigDecimal("1.25"), 1));
        assertEquals(new BigDecimal("1.2"), RoundingUtils.round(new BigDecimal("1.24"), 1));
        assertEquals(new BigDecimal("2.5"), RoundingUtils.round(new BigDecimal("2.45"), 1));
    }
    
    @Test
    void testRound4dp() {
        assertEquals(new BigDecimal("1.2346"), RoundingUtils.round4dp(new BigDecimal("1.23456")));
        assertEquals(new BigDecimal("1.2345"), RoundingUtils.round4dp(new BigDecimal("1.23450")));
        assertEquals(new BigDecimal("1.2345"), RoundingUtils.round4dp(new BigDecimal("1.234500001")));
        assertEquals(new BigDecimal("1.2346"), RoundingUtils.round4dp(new BigDecimal("1.234550001")));
    }
    
    @Test
    void testRound2dp() {
        assertEquals(new BigDecimal("1.23"), RoundingUtils.round2dp(new BigDecimal("1.234")));
        assertEquals(new BigDecimal("1.24"), RoundingUtils.round2dp(new BigDecimal("1.235")));
        assertEquals(new BigDecimal("10.50"), RoundingUtils.round2dp(new BigDecimal("10.5")));
    }
    
    @Test
    void testRound1dp() {
        assertEquals(new BigDecimal("1.2"), RoundingUtils.round1dp(new BigDecimal("1.23")));
        assertEquals(new BigDecimal("1.3"), RoundingUtils.round1dp(new BigDecimal("1.25")));
        assertEquals(new BigDecimal("30.0"), RoundingUtils.round1dp(new BigDecimal("30.04")));
    }
    
    @Test
    void testRoundZeroScale() {
        assertEquals(new BigDecimal("1"), RoundingUtils.round(new BigDecimal("1.4"), 0));
        assertEquals(new BigDecimal("2"), RoundingUtils.round(new BigDecimal("1.5"), 0));
        assertEquals(new BigDecimal("2"), RoundingUtils.round(new BigDecimal("1.6"), 0));
    }
    
    @Test
    void testRoundLargeScale() {
        BigDecimal value = new BigDecimal("1.123456789");
        assertEquals(new BigDecimal("1.1234567890"), RoundingUtils.round(value, 10));
    }
    
    @Test
    void testRoundAlreadyCorrectScale() {
        assertEquals(new BigDecimal("1.23"), RoundingUtils.round(new BigDecimal("1.23"), 2));
        assertEquals(new BigDecimal("1.2300"), RoundingUtils.round(new BigDecimal("1.23"), 4));
    }
    
    @Test
    void testRoundNegativeNumbers() {
        assertEquals(new BigDecimal("-1.23"), RoundingUtils.round(new BigDecimal("-1.234"), 2));
        assertEquals(new BigDecimal("-1.24"), RoundingUtils.round(new BigDecimal("-1.235"), 2));
    }
    
    @Test
    void testRoundNullThrowsException() {
        assertThrows(IllegalArgumentException.class, () -> RoundingUtils.round(null, 2));
        assertThrows(IllegalArgumentException.class, () -> RoundingUtils.round4dp(null));
        assertThrows(IllegalArgumentException.class, () -> RoundingUtils.round2dp(null));
        assertThrows(IllegalArgumentException.class, () -> RoundingUtils.round1dp(null));
    }
    
    @Test
    void testRoundNegativeScaleThrowsException() {
        assertThrows(IllegalArgumentException.class, () -> 
            RoundingUtils.round(new BigDecimal("1.23"), -1));
    }
    
    @Test
    void testRoundZero() {
        assertEquals(new BigDecimal("0.00"), RoundingUtils.round(BigDecimal.ZERO, 2));
        assertEquals(new BigDecimal("0.0000"), RoundingUtils.round4dp(BigDecimal.ZERO));
    }
}
