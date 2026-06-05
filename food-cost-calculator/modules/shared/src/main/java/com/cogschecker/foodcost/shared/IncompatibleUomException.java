package com.cogschecker.foodcost.shared;

/**
 * Exception thrown when attempting to convert between incompatible UOM dimensions.
 */
public class IncompatibleUomException extends RuntimeException {
    
    private final UomEnum fromUnit;
    private final UomEnum toUnit;
    
    public IncompatibleUomException(UomEnum fromUnit, UomEnum toUnit) {
        super(String.format("Cannot convert from %s (%s) to %s (%s): incompatible dimensions",
                fromUnit.getSymbol(), fromUnit.getDimension(),
                toUnit.getSymbol(), toUnit.getDimension()));
        this.fromUnit = fromUnit;
        this.toUnit = toUnit;
    }
    
    public UomEnum getFromUnit() {
        return fromUnit;
    }
    
    public UomEnum getToUnit() {
        return toUnit;
    }
}
