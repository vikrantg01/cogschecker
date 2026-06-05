package com.cogschecker.foodcost.shared;

import net.jqwik.api.*;
import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.util.Arrays;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class UomConverterTest {
    
    private static final BigDecimal TOLERANCE = new BigDecimal("0.0001");
    
    // Helper method to compare BigDecimal with tolerance
    private void assertBigDecimalEquals(BigDecimal expected, BigDecimal actual) {
        assertTrue(
            expected.subtract(actual).abs().compareTo(TOLERANCE) <= 0,
            String.format("Expected %s but got %s (difference: %s)", 
                expected, actual, expected.subtract(actual).abs())
        );
    }
    
    @Test
    void testSameUnitReturnsOriginalQuantity() {
        BigDecimal quantity = new BigDecimal("100");
        assertEquals(quantity, UomConverter.convert(quantity, UomEnum.GRAM, UomEnum.GRAM));
        assertEquals(quantity, UomConverter.convert(quantity, UomEnum.MILLILITRE, UomEnum.MILLILITRE));
        assertEquals(quantity, UomConverter.convert(quantity, UomEnum.EACH, UomEnum.EACH));
    }
    
    @Test
    void testKilogramToGram() {
        BigDecimal result = UomConverter.convert(new BigDecimal("1"), UomEnum.KILOGRAM, UomEnum.GRAM);
        assertBigDecimalEquals(new BigDecimal("1000"), result);
        
        result = UomConverter.convert(new BigDecimal("2.5"), UomEnum.KILOGRAM, UomEnum.GRAM);
        assertBigDecimalEquals(new BigDecimal("2500"), result);
    }
    
    @Test
    void testGramToKilogram() {
        BigDecimal result = UomConverter.convert(new BigDecimal("1000"), UomEnum.GRAM, UomEnum.KILOGRAM);
        assertBigDecimalEquals(new BigDecimal("1"), result);
        
        result = UomConverter.convert(new BigDecimal("500"), UomEnum.GRAM, UomEnum.KILOGRAM);
        assertBigDecimalEquals(new BigDecimal("0.5"), result);
    }
    
    @Test
    void testOunceToGram() {
        BigDecimal result = UomConverter.convert(new BigDecimal("1"), UomEnum.OUNCE, UomEnum.GRAM);
        assertBigDecimalEquals(new BigDecimal("28.3495"), result);
    }
    
    @Test
    void testPoundToGram() {
        BigDecimal result = UomConverter.convert(new BigDecimal("1"), UomEnum.POUND, UomEnum.GRAM);
        assertBigDecimalEquals(new BigDecimal("453.592"), result);
    }
    
    @Test
    void testLitreToMillilitre() {
        BigDecimal result = UomConverter.convert(new BigDecimal("1"), UomEnum.LITRE, UomEnum.MILLILITRE);
        assertBigDecimalEquals(new BigDecimal("1000"), result);
        
        result = UomConverter.convert(new BigDecimal("0.5"), UomEnum.LITRE, UomEnum.MILLILITRE);
        assertBigDecimalEquals(new BigDecimal("500"), result);
    }
    
    @Test
    void testMillilitreToLitre() {
        BigDecimal result = UomConverter.convert(new BigDecimal("1000"), UomEnum.MILLILITRE, UomEnum.LITRE);
        assertBigDecimalEquals(new BigDecimal("1"), result);
    }
    
    @Test
    void testTeaspoonToMillilitre() {
        BigDecimal result = UomConverter.convert(new BigDecimal("1"), UomEnum.TEASPOON, UomEnum.MILLILITRE);
        assertBigDecimalEquals(new BigDecimal("5"), result);
        
        result = UomConverter.convert(new BigDecimal("2"), UomEnum.TEASPOON, UomEnum.MILLILITRE);
        assertBigDecimalEquals(new BigDecimal("10"), result);
    }
    
    @Test
    void testTablespoonToMillilitre() {
        BigDecimal result = UomConverter.convert(new BigDecimal("1"), UomEnum.TABLESPOON, UomEnum.MILLILITRE);
        assertBigDecimalEquals(new BigDecimal("15"), result);
    }
    
    @Test
    void testCupToMillilitre() {
        BigDecimal result = UomConverter.convert(new BigDecimal("1"), UomEnum.CUP, UomEnum.MILLILITRE);
        assertBigDecimalEquals(new BigDecimal("240"), result);
    }
    
    @Test
    void testCupToLitre() {
        BigDecimal result = UomConverter.convert(new BigDecimal("1"), UomEnum.CUP, UomEnum.LITRE);
        assertBigDecimalEquals(new BigDecimal("0.24"), result);
    }
    
    @Test
    void testTablespoonToTeaspoon() {
        BigDecimal result = UomConverter.convert(new BigDecimal("1"), UomEnum.TABLESPOON, UomEnum.TEASPOON);
        assertBigDecimalEquals(new BigDecimal("3"), result);
    }
    
    @Test
    void testPoundToKilogram() {
        BigDecimal result = UomConverter.convert(new BigDecimal("1"), UomEnum.POUND, UomEnum.KILOGRAM);
        assertBigDecimalEquals(new BigDecimal("0.453592"), result);
    }
    
    @Test
    void testWeightToVolumeThrowsIncompatibleUomException() {
        assertThrows(IncompatibleUomException.class, () -> 
            UomConverter.convert(new BigDecimal("100"), UomEnum.GRAM, UomEnum.MILLILITRE));
        
        assertThrows(IncompatibleUomException.class, () -> 
            UomConverter.convert(new BigDecimal("100"), UomEnum.KILOGRAM, UomEnum.LITRE));
    }
    
    @Test
    void testVolumeToWeightThrowsIncompatibleUomException() {
        assertThrows(IncompatibleUomException.class, () -> 
            UomConverter.convert(new BigDecimal("100"), UomEnum.MILLILITRE, UomEnum.GRAM));
        
        assertThrows(IncompatibleUomException.class, () -> 
            UomConverter.convert(new BigDecimal("1"), UomEnum.CUP, UomEnum.OUNCE));
    }
    
    @Test
    void testWeightToCountThrowsIncompatibleUomException() {
        assertThrows(IncompatibleUomException.class, () -> 
            UomConverter.convert(new BigDecimal("100"), UomEnum.GRAM, UomEnum.EACH));
    }
    
    @Test
    void testVolumeToCountThrowsIncompatibleUomException() {
        assertThrows(IncompatibleUomException.class, () -> 
            UomConverter.convert(new BigDecimal("100"), UomEnum.MILLILITRE, UomEnum.EACH));
    }
    
    @Test
    void testCountToWeightThrowsIncompatibleUomException() {
        assertThrows(IncompatibleUomException.class, () -> 
            UomConverter.convert(new BigDecimal("5"), UomEnum.EACH, UomEnum.GRAM));
    }
    
    @Test
    void testCountToVolumeThrowsIncompatibleUomException() {
        assertThrows(IncompatibleUomException.class, () -> 
            UomConverter.convert(new BigDecimal("5"), UomEnum.EACH, UomEnum.MILLILITRE));
    }
    
    @Test
    void testNullQuantityThrowsException() {
        assertThrows(IllegalArgumentException.class, () -> 
            UomConverter.convert(null, UomEnum.GRAM, UomEnum.KILOGRAM));
    }
    
    @Test
    void testNullFromUnitThrowsException() {
        assertThrows(IllegalArgumentException.class, () -> 
            UomConverter.convert(new BigDecimal("100"), null, UomEnum.GRAM));
    }
    
    @Test
    void testNullToUnitThrowsException() {
        assertThrows(IllegalArgumentException.class, () -> 
            UomConverter.convert(new BigDecimal("100"), UomEnum.GRAM, null));
    }
    
    @Test
    void testZeroQuantityConverts() {
        BigDecimal result = UomConverter.convert(BigDecimal.ZERO, UomEnum.GRAM, UomEnum.KILOGRAM);
        assertEquals(BigDecimal.ZERO, result.compareTo(BigDecimal.ZERO) == 0 ? BigDecimal.ZERO : result);
    }
    
    @Test
    void testDecimalQuantityConverts() {
        BigDecimal result = UomConverter.convert(new BigDecimal("0.5"), UomEnum.KILOGRAM, UomEnum.GRAM);
        assertBigDecimalEquals(new BigDecimal("500"), result);
        
        result = UomConverter.convert(new BigDecimal("1.5"), UomEnum.TABLESPOON, UomEnum.MILLILITRE);
        assertBigDecimalEquals(new BigDecimal("22.5"), result);
    }
    
    // ========== Property-Based Tests ==========
    
    /**
     * Property 17: Cross-Dimension UOM Combination Is Always Rejected
     * **Validates: Requirements 6.4, 6.5**
     * 
     * Enumerates all incompatible dimension pairs (weight×volume, weight×count, volume×count);
     * asserts each throws IncompatibleUomException and no conversion occurs.
     */
    @Property(tries = 1000)
    @Label("P17: Cross-dimension UOM combination is always rejected")
    void crossDimensionUomCombinationIsAlwaysRejected(
            @ForAll("quantities") BigDecimal quantity,
            @ForAll("incompatibleUomPairs") UomPair incompatiblePair) {
        
        // Assert that attempting conversion throws IncompatibleUomException
        IncompatibleUomException exception = assertThrows(
            IncompatibleUomException.class,
            () -> UomConverter.convert(quantity, incompatiblePair.from, incompatiblePair.to),
            String.format("Expected IncompatibleUomException when converting %s from %s to %s",
                    quantity, incompatiblePair.from, incompatiblePair.to)
        );
        
        // Verify exception contains the correct unit information
        assertEquals(incompatiblePair.from, exception.getFromUnit());
        assertEquals(incompatiblePair.to, exception.getToUnit());
        
        // Verify the dimensions are indeed different
        assertNotEquals(
            incompatiblePair.from.getDimension(),
            incompatiblePair.to.getDimension(),
            "Units should have different dimensions for this test"
        );
    }
    
    /**
     * Provides positive quantities for testing
     */
    @Provide
    Arbitrary<BigDecimal> quantities() {
        return Arbitraries.bigDecimals()
                .between(new BigDecimal("0.01"), new BigDecimal("10000"))
                .ofScale(4);
    }
    
    /**
     * Provides all incompatible UOM pairs across different dimensions:
     * - Weight × Volume
     * - Weight × Count
     * - Volume × Count
     */
    @Provide
    Arbitrary<UomPair> incompatibleUomPairs() {
        // All weight units
        List<UomEnum> weightUnits = Arrays.asList(
            UomEnum.GRAM, UomEnum.KILOGRAM, UomEnum.OUNCE, UomEnum.POUND
        );
        
        // All volume units
        List<UomEnum> volumeUnits = Arrays.asList(
            UomEnum.MILLILITRE, UomEnum.LITRE, UomEnum.TEASPOON, 
            UomEnum.TABLESPOON, UomEnum.CUP
        );
        
        // Count unit
        List<UomEnum> countUnits = Arrays.asList(UomEnum.EACH);
        
        // Generate all weight × volume pairs (both directions)
        Arbitrary<UomPair> weightToVolume = Arbitraries.of(weightUnits)
                .flatMap(weight -> Arbitraries.of(volumeUnits)
                        .map(volume -> new UomPair(weight, volume)));
        
        Arbitrary<UomPair> volumeToWeight = Arbitraries.of(volumeUnits)
                .flatMap(volume -> Arbitraries.of(weightUnits)
                        .map(weight -> new UomPair(volume, weight)));
        
        // Generate all weight × count pairs (both directions)
        Arbitrary<UomPair> weightToCount = Arbitraries.of(weightUnits)
                .flatMap(weight -> Arbitraries.of(countUnits)
                        .map(count -> new UomPair(weight, count)));
        
        Arbitrary<UomPair> countToWeight = Arbitraries.of(countUnits)
                .flatMap(count -> Arbitraries.of(weightUnits)
                        .map(weight -> new UomPair(count, weight)));
        
        // Generate all volume × count pairs (both directions)
        Arbitrary<UomPair> volumeToCount = Arbitraries.of(volumeUnits)
                .flatMap(volume -> Arbitraries.of(countUnits)
                        .map(count -> new UomPair(volume, count)));
        
        Arbitrary<UomPair> countToVolume = Arbitraries.of(countUnits)
                .flatMap(count -> Arbitraries.of(volumeUnits)
                        .map(volume -> new UomPair(count, volume)));
        
        // Combine all incompatible pairs
        return Arbitraries.oneOf(
            weightToVolume, volumeToWeight,
            weightToCount, countToWeight,
            volumeToCount, countToVolume
        );
    }
    
    /**
     * Helper class to represent a pair of UOM units
     */
    private static class UomPair {
        final UomEnum from;
        final UomEnum to;
        
        UomPair(UomEnum from, UomEnum to) {
            this.from = from;
            this.to = to;
        }
        
        @Override
        public String toString() {
            return String.format("%s -> %s", from, to);
        }
    }
}
