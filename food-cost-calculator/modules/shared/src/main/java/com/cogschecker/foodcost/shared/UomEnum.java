package com.cogschecker.foodcost.shared;

import com.fasterxml.jackson.databind.annotation.JsonDeserialize;

/**
 * Units of measure grouped by measurement dimension.
 * Cross-dimension conversions are forbidden.
 */
@JsonDeserialize(using = UomEnumDeserializer.class)
public enum UomEnum {
    // Weight dimension
    GRAM("g", UomDimension.WEIGHT),
    KILOGRAM("kg", UomDimension.WEIGHT),
    OUNCE("oz", UomDimension.WEIGHT),
    POUND("lb", UomDimension.WEIGHT),
    
    // Volume dimension
    MILLILITRE("ml", UomDimension.VOLUME),
    LITRE("L", UomDimension.VOLUME),
    TEASPOON("tsp", UomDimension.VOLUME),
    TABLESPOON("tbsp", UomDimension.VOLUME),
    CUP("cup", UomDimension.VOLUME),
    
    // Count dimension
    EACH("each", UomDimension.COUNT);
    
    private final String symbol;
    private final UomDimension dimension;
    
    UomEnum(String symbol, UomDimension dimension) {
        this.symbol = symbol;
        this.dimension = dimension;
    }
    
    public String getSymbol() {
        return symbol;
    }
    
    @com.fasterxml.jackson.annotation.JsonValue
    public String toJson() {
        return symbol;
    }
    
    public UomDimension getDimension() {
        return dimension;
    }
    
    /**
     * Find a UOM by its symbol (case-insensitive).
     * @param symbol the symbol to find
     * @return the matching UomEnum
     * @throws IllegalArgumentException if no matching UOM is found
     */
    public static UomEnum fromSymbol(String symbol) {
        if (symbol == null) {
            throw new IllegalArgumentException("UOM symbol cannot be null");
        }
        for (UomEnum uom : values()) {
            if (uom.symbol.equalsIgnoreCase(symbol)) {
                return uom;
            }
        }
        throw new IllegalArgumentException("Unknown UOM symbol: " + symbol);
    }
    
    public enum UomDimension {
        WEIGHT,
        VOLUME,
        COUNT
    }
}
