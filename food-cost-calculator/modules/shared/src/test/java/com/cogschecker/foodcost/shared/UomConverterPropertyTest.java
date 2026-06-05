package com.cogschecker.foodcost.shared;

import net.jqwik.api.*;
import net.jqwik.api.constraints.BigRange;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/**
 * Property-based tests for UOM conversion to verify exact conversion factors.
 * 
 * **Property 16: UOM Conversion Applies Exact Defined Factors**
 * **Validates: Requirements 6.2, 6.3**
 */
class UomConverterPropertyTest {
    
    private static final BigDecimal TOLERANCE = new BigDecimal("0.00001");
    
    /**
     * Property 16: UOM conversion applies exact defined factors for all compatible unit pairs.
     * Generate arbitrary quantities and all compatible unit pairs; verify conversions use exact base factors.
     */
    @Property(tries = 5000)
    void uomConversionAppliesExactDefinedFactors(
            @ForAll("quantities") BigDecimal quantity,
            @ForAll("compatibleUnitPairs") ConversionPair pair) {
        
        BigDecimal result = UomConverter.convert(quantity, pair.from, pair.to);
        
        // Verify the conversion by computing the expected result using the defined base factors
        // We convert through the base unit to ensure we're using the exact same logic as the implementation
        BigDecimal expected = computeExpectedConversion(quantity, pair.from, pair.to);
        
        // For exact conversions (like kg→g), use exact equality
        // For conversions involving division, use tolerance
        if (isExactConversion(pair)) {
            if (result.compareTo(expected) != 0) {
                throw new AssertionError(String.format(
                    "Exact conversion %s → %s failed for quantity %s: expected %s but got %s",
                    pair.from, pair.to, quantity, expected, result
                ));
            }
        } else {
            BigDecimal difference = result.subtract(expected).abs();
            if (difference.compareTo(TOLERANCE) > 0) {
                throw new AssertionError(String.format(
                    "Conversion %s → %s failed for quantity %s: expected %s but got %s (difference: %s)",
                    pair.from, pair.to, quantity, expected, result, difference
                ));
            }
        }
    }
    
    /**
     * Check if a conversion is exact (multiplication only, no division).
     */
    private boolean isExactConversion(ConversionPair pair) {
        // Conversions to base units (grams, millilitres) from larger units are exact multiplications
        return (pair.to == UomEnum.GRAM && (pair.from == UomEnum.KILOGRAM || pair.from == UomEnum.OUNCE || pair.from == UomEnum.POUND)) ||
               (pair.to == UomEnum.MILLILITRE && (pair.from == UomEnum.LITRE || pair.from == UomEnum.TEASPOON || pair.from == UomEnum.TABLESPOON || pair.from == UomEnum.CUP));
    }
    
    /**
     * Compute expected conversion using the same base-unit approach as UomConverter.
     */
    private BigDecimal computeExpectedConversion(BigDecimal quantity, UomEnum from, UomEnum to) {
        if (from == to) {
            return quantity;
        }
        
        if (from.getDimension() == UomEnum.UomDimension.WEIGHT) {
            // Convert to grams first
            BigDecimal grams = toGrams(quantity, from);
            // Then from grams to target
            return fromGrams(grams, to);
        } else if (from.getDimension() == UomEnum.UomDimension.VOLUME) {
            // Convert to millilitres first
            BigDecimal millilitres = toMillilitres(quantity, from);
            // Then from millilitres to target
            return fromMillilitres(millilitres, to);
        }
        
        throw new IllegalStateException("Cannot convert COUNT dimension");
    }
    
    private BigDecimal toGrams(BigDecimal quantity, UomEnum unit) {
        switch (unit) {
            case GRAM: return quantity;
            case KILOGRAM: return quantity.multiply(new BigDecimal("1000"));
            case OUNCE: return quantity.multiply(new BigDecimal("28.3495"));
            case POUND: return quantity.multiply(new BigDecimal("453.592"));
            default: throw new IllegalStateException("Not a weight unit: " + unit);
        }
    }
    
    private BigDecimal fromGrams(BigDecimal grams, UomEnum unit) {
        switch (unit) {
            case GRAM: return grams;
            case KILOGRAM: return grams.divide(new BigDecimal("1000"), 10, RoundingMode.HALF_UP);
            case OUNCE: return grams.divide(new BigDecimal("28.3495"), 10, RoundingMode.HALF_UP);
            case POUND: return grams.divide(new BigDecimal("453.592"), 10, RoundingMode.HALF_UP);
            default: throw new IllegalStateException("Not a weight unit: " + unit);
        }
    }
    
    private BigDecimal toMillilitres(BigDecimal quantity, UomEnum unit) {
        switch (unit) {
            case MILLILITRE: return quantity;
            case LITRE: return quantity.multiply(new BigDecimal("1000"));
            case TEASPOON: return quantity.multiply(new BigDecimal("5"));
            case TABLESPOON: return quantity.multiply(new BigDecimal("15"));
            case CUP: return quantity.multiply(new BigDecimal("240"));
            default: throw new IllegalStateException("Not a volume unit: " + unit);
        }
    }
    
    private BigDecimal fromMillilitres(BigDecimal millilitres, UomEnum unit) {
        switch (unit) {
            case MILLILITRE: return millilitres;
            case LITRE: return millilitres.divide(new BigDecimal("1000"), 10, RoundingMode.HALF_UP);
            case TEASPOON: return millilitres.divide(new BigDecimal("5"), 10, RoundingMode.HALF_UP);
            case TABLESPOON: return millilitres.divide(new BigDecimal("15"), 10, RoundingMode.HALF_UP);
            case CUP: return millilitres.divide(new BigDecimal("240"), 10, RoundingMode.HALF_UP);
            default: throw new IllegalStateException("Not a volume unit: " + unit);
        }
    }
    
    /**
     * Property: Same unit conversion returns the original quantity unchanged.
     */
    @Property(tries = 1000)
    void sameUnitConversionReturnsOriginalQuantity(
            @ForAll("quantities") BigDecimal quantity,
            @ForAll("allUnits") UomEnum unit) {
        
        BigDecimal result = UomConverter.convert(quantity, unit, unit);
        
        if (result.compareTo(quantity) != 0) {
            throw new AssertionError(String.format(
                "Same unit conversion should return original quantity: %s → %s returned %s instead of %s",
                quantity, unit, result, quantity
            ));
        }
    }
    
    /**
     * Property: Conversion is transitive - converting A→B→C should equal A→C (within tolerance).
     */
    @Property(tries = 1000)
    void conversionIsTransitive(
            @ForAll("quantities") BigDecimal quantity,
            @ForAll("transitiveUnitTriples") UnitTriple triple) {
        
        // Direct conversion A → C
        BigDecimal directResult = UomConverter.convert(quantity, triple.first, triple.third);
        
        // Transitive conversion A → B → C
        BigDecimal intermediate = UomConverter.convert(quantity, triple.first, triple.second);
        BigDecimal transitiveResult = UomConverter.convert(intermediate, triple.second, triple.third);
        
        BigDecimal difference = directResult.subtract(transitiveResult).abs();
        
        if (difference.compareTo(TOLERANCE) > 0) {
            throw new AssertionError(String.format(
                "Transitive conversion failed: %s → %s → %s gave %s, but direct %s → %s gave %s (difference: %s)",
                triple.first, triple.second, triple.third, transitiveResult,
                triple.first, triple.third, directResult, difference
            ));
        }
    }
    
    /**
     * Property: Round-trip conversion (A→B→A) should return the original quantity (within tolerance).
     */
    @Property(tries = 1000)
    void roundTripConversionPreservesQuantity(
            @ForAll("quantities") BigDecimal quantity,
            @ForAll("compatibleUnitPairs") ConversionPair pair) {
        
        BigDecimal converted = UomConverter.convert(quantity, pair.from, pair.to);
        BigDecimal roundTrip = UomConverter.convert(converted, pair.to, pair.from);
        
        BigDecimal difference = quantity.subtract(roundTrip).abs();
        
        if (difference.compareTo(TOLERANCE) > 0) {
            throw new AssertionError(String.format(
                "Round-trip conversion %s → %s → %s failed: started with %s, ended with %s (difference: %s)",
                pair.from, pair.to, pair.from, quantity, roundTrip, difference
            ));
        }
    }
    
    // Arbitraries (data generators)
    
    @Provide
    Arbitrary<BigDecimal> quantities() {
        return Arbitraries.bigDecimals()
                .between(new BigDecimal("0.01"), new BigDecimal("999999.99"))
                .ofScale(4);
    }
    
    @Provide
    Arbitrary<UomEnum> allUnits() {
        return Arbitraries.of(UomEnum.values());
    }
    
    @Provide
    Arbitrary<ConversionPair> compatibleUnitPairs() {
        List<ConversionPair> weightPairs = List.of(
            new ConversionPair(UomEnum.KILOGRAM, UomEnum.GRAM),
            new ConversionPair(UomEnum.GRAM, UomEnum.KILOGRAM),
            new ConversionPair(UomEnum.OUNCE, UomEnum.GRAM),
            new ConversionPair(UomEnum.GRAM, UomEnum.OUNCE),
            new ConversionPair(UomEnum.POUND, UomEnum.GRAM),
            new ConversionPair(UomEnum.GRAM, UomEnum.POUND),
            new ConversionPair(UomEnum.POUND, UomEnum.KILOGRAM),
            new ConversionPair(UomEnum.KILOGRAM, UomEnum.POUND),
            new ConversionPair(UomEnum.OUNCE, UomEnum.KILOGRAM),
            new ConversionPair(UomEnum.KILOGRAM, UomEnum.OUNCE),
            new ConversionPair(UomEnum.POUND, UomEnum.OUNCE),
            new ConversionPair(UomEnum.OUNCE, UomEnum.POUND)
        );
        
        List<ConversionPair> volumePairs = List.of(
            new ConversionPair(UomEnum.LITRE, UomEnum.MILLILITRE),
            new ConversionPair(UomEnum.MILLILITRE, UomEnum.LITRE),
            new ConversionPair(UomEnum.TEASPOON, UomEnum.MILLILITRE),
            new ConversionPair(UomEnum.MILLILITRE, UomEnum.TEASPOON),
            new ConversionPair(UomEnum.TABLESPOON, UomEnum.MILLILITRE),
            new ConversionPair(UomEnum.MILLILITRE, UomEnum.TABLESPOON),
            new ConversionPair(UomEnum.CUP, UomEnum.MILLILITRE),
            new ConversionPair(UomEnum.MILLILITRE, UomEnum.CUP),
            new ConversionPair(UomEnum.TABLESPOON, UomEnum.TEASPOON),
            new ConversionPair(UomEnum.TEASPOON, UomEnum.TABLESPOON),
            new ConversionPair(UomEnum.CUP, UomEnum.LITRE),
            new ConversionPair(UomEnum.LITRE, UomEnum.CUP),
            new ConversionPair(UomEnum.CUP, UomEnum.TABLESPOON),
            new ConversionPair(UomEnum.TABLESPOON, UomEnum.CUP),
            new ConversionPair(UomEnum.CUP, UomEnum.TEASPOON),
            new ConversionPair(UomEnum.TEASPOON, UomEnum.CUP),
            new ConversionPair(UomEnum.LITRE, UomEnum.TABLESPOON),
            new ConversionPair(UomEnum.TABLESPOON, UomEnum.LITRE),
            new ConversionPair(UomEnum.LITRE, UomEnum.TEASPOON),
            new ConversionPair(UomEnum.TEASPOON, UomEnum.LITRE)
        );
        
        return Arbitraries.of(
            Stream.concat(weightPairs.stream(), volumePairs.stream()).toList()
        );
    }
    
    @Provide
    Arbitrary<UnitTriple> transitiveUnitTriples() {
        // Generate triples where all three units are in the same dimension
        List<UnitTriple> weightTriples = List.of(
            new UnitTriple(UomEnum.KILOGRAM, UomEnum.GRAM, UomEnum.OUNCE),
            new UnitTriple(UomEnum.KILOGRAM, UomEnum.GRAM, UomEnum.POUND),
            new UnitTriple(UomEnum.POUND, UomEnum.GRAM, UomEnum.OUNCE),
            new UnitTriple(UomEnum.POUND, UomEnum.KILOGRAM, UomEnum.OUNCE),
            new UnitTriple(UomEnum.OUNCE, UomEnum.GRAM, UomEnum.KILOGRAM),
            new UnitTriple(UomEnum.OUNCE, UomEnum.GRAM, UomEnum.POUND)
        );
        
        List<UnitTriple> volumeTriples = List.of(
            new UnitTriple(UomEnum.LITRE, UomEnum.MILLILITRE, UomEnum.CUP),
            new UnitTriple(UomEnum.LITRE, UomEnum.MILLILITRE, UomEnum.TEASPOON),
            new UnitTriple(UomEnum.LITRE, UomEnum.MILLILITRE, UomEnum.TABLESPOON),
            new UnitTriple(UomEnum.CUP, UomEnum.MILLILITRE, UomEnum.TABLESPOON),
            new UnitTriple(UomEnum.CUP, UomEnum.MILLILITRE, UomEnum.TEASPOON),
            new UnitTriple(UomEnum.TABLESPOON, UomEnum.MILLILITRE, UomEnum.TEASPOON),
            new UnitTriple(UomEnum.TABLESPOON, UomEnum.TEASPOON, UomEnum.CUP)
        );
        
        return Arbitraries.of(
            Stream.concat(weightTriples.stream(), volumeTriples.stream()).toList()
        );
    }
    
    // Helper classes
    
    static class ConversionPair {
        final UomEnum from;
        final UomEnum to;
        
        ConversionPair(UomEnum from, UomEnum to) {
            this.from = from;
            this.to = to;
        }
        
        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            ConversionPair that = (ConversionPair) o;
            return from == that.from && to == that.to;
        }
        
        @Override
        public int hashCode() {
            return 31 * from.hashCode() + to.hashCode();
        }
        
        @Override
        public String toString() {
            return from + " → " + to;
        }
    }
    
    static class UnitTriple {
        final UomEnum first;
        final UomEnum second;
        final UomEnum third;
        
        UnitTriple(UomEnum first, UomEnum second, UomEnum third) {
            this.first = first;
            this.second = second;
            this.third = third;
        }
        
        @Override
        public String toString() {
            return first + " → " + second + " → " + third;
        }
    }
}
