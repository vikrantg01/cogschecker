package com.cogschecker.foodcost.api.domain;

import com.cogschecker.foodcost.shared.UomEnum;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/**
 * JPA converter to store UomEnum as its symbol (e.g., "g") in the database
 * instead of the enum name (e.g., "GRAM").
 */
@Converter(autoApply = true)
public class UomEnumConverter implements AttributeConverter<UomEnum, String> {
    
    @Override
    public String convertToDatabaseColumn(UomEnum uom) {
        if (uom == null) {
            return null;
        }
        return uom.getSymbol();
    }
    
    @Override
    public UomEnum convertToEntityAttribute(String symbol) {
        if (symbol == null) {
            return null;
        }
        return UomEnum.fromSymbol(symbol);
    }
}
