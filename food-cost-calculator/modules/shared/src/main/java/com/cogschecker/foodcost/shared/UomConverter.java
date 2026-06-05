package com.cogschecker.foodcost.shared;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * Handles unit of measure conversions with exact factors from Requirement 6.3.
 * Throws IncompatibleUomException for cross-dimension conversions.
 */
public class UomConverter {
    
    // Weight conversions (all to grams as base)
    private static final BigDecimal KG_TO_G = new BigDecimal("1000");
    private static final BigDecimal OZ_TO_G = new BigDecimal("28.3495");
    private static final BigDecimal LB_TO_G = new BigDecimal("453.592");
    
    // Volume conversions (all to millilitres as base)
    private static final BigDecimal L_TO_ML = new BigDecimal("1000");
    private static final BigDecimal TSP_TO_ML = new BigDecimal("5");
    private static final BigDecimal TBSP_TO_ML = new BigDecimal("15");
    private static final BigDecimal CUP_TO_ML = new BigDecimal("240");
    
    /**
     * Convert a quantity from one unit to another.
     * 
     * @param quantity the quantity to convert
     * @param fromUnit the source unit
     * @param toUnit the target unit
     * @return the converted quantity
     * @throws IncompatibleUomException if units are from different dimensions
     */
    public static BigDecimal convert(BigDecimal quantity, UomEnum fromUnit, UomEnum toUnit) {
        if (quantity == null) {
            throw new IllegalArgumentException("Quantity cannot be null");
        }
        if (fromUnit == null || toUnit == null) {
            throw new IllegalArgumentException("Units cannot be null");
        }
        
        // No conversion needed if units are the same
        if (fromUnit == toUnit) {
            return quantity;
        }
        
        // Check dimension compatibility
        if (fromUnit.getDimension() != toUnit.getDimension()) {
            throw new IncompatibleUomException(fromUnit, toUnit);
        }
        
        // Convert within the same dimension
        switch (fromUnit.getDimension()) {
            case WEIGHT:
                return convertWeight(quantity, fromUnit, toUnit);
            case VOLUME:
                return convertVolume(quantity, fromUnit, toUnit);
            case COUNT:
                // COUNT dimension should not reach here since fromUnit == toUnit check above
                // But if it does, it means trying to convert between 'each' units, which should be identical
                throw new IncompatibleUomException(fromUnit, toUnit);
            default:
                throw new IllegalStateException("Unknown dimension: " + fromUnit.getDimension());
        }
    }
    
    /**
     * Convert weight units via grams as the common base.
     */
    private static BigDecimal convertWeight(BigDecimal quantity, UomEnum fromUnit, UomEnum toUnit) {
        // First convert to grams
        BigDecimal grams;
        switch (fromUnit) {
            case GRAM:
                grams = quantity;
                break;
            case KILOGRAM:
                grams = quantity.multiply(KG_TO_G);
                break;
            case OUNCE:
                grams = quantity.multiply(OZ_TO_G);
                break;
            case POUND:
                grams = quantity.multiply(LB_TO_G);
                break;
            default:
                throw new IllegalStateException("Unsupported weight unit: " + fromUnit);
        }
        
        // Then convert from grams to target unit
        switch (toUnit) {
            case GRAM:
                return grams;
            case KILOGRAM:
                return grams.divide(KG_TO_G, 10, RoundingMode.HALF_UP);
            case OUNCE:
                return grams.divide(OZ_TO_G, 10, RoundingMode.HALF_UP);
            case POUND:
                return grams.divide(LB_TO_G, 10, RoundingMode.HALF_UP);
            default:
                throw new IllegalStateException("Unsupported weight unit: " + toUnit);
        }
    }
    
    /**
     * Convert volume units via millilitres as the common base.
     */
    private static BigDecimal convertVolume(BigDecimal quantity, UomEnum fromUnit, UomEnum toUnit) {
        // First convert to millilitres
        BigDecimal millilitres;
        switch (fromUnit) {
            case MILLILITRE:
                millilitres = quantity;
                break;
            case LITRE:
                millilitres = quantity.multiply(L_TO_ML);
                break;
            case TEASPOON:
                millilitres = quantity.multiply(TSP_TO_ML);
                break;
            case TABLESPOON:
                millilitres = quantity.multiply(TBSP_TO_ML);
                break;
            case CUP:
                millilitres = quantity.multiply(CUP_TO_ML);
                break;
            default:
                throw new IllegalStateException("Unsupported volume unit: " + fromUnit);
        }
        
        // Then convert from millilitres to target unit
        switch (toUnit) {
            case MILLILITRE:
                return millilitres;
            case LITRE:
                return millilitres.divide(L_TO_ML, 10, RoundingMode.HALF_UP);
            case TEASPOON:
                return millilitres.divide(TSP_TO_ML, 10, RoundingMode.HALF_UP);
            case TABLESPOON:
                return millilitres.divide(TBSP_TO_ML, 10, RoundingMode.HALF_UP);
            case CUP:
                return millilitres.divide(CUP_TO_ML, 10, RoundingMode.HALF_UP);
            default:
                throw new IllegalStateException("Unsupported volume unit: " + toUnit);
        }
    }
}
