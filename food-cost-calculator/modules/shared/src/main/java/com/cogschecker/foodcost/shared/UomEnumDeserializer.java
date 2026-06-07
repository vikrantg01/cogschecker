package com.cogschecker.foodcost.shared;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;

import java.io.IOException;

/**
 * Custom JSON deserializer for UomEnum that accepts both enum names and symbols.
 * Allows frontend to send "g" and backend to parse it as GRAM.
 */
public class UomEnumDeserializer extends JsonDeserializer<UomEnum> {
    
    @Override
    public UomEnum deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
        String value = p.getText();
        
        // Try to find by symbol first (for frontend compatibility)
        for (UomEnum uom : UomEnum.values()) {
            if (uom.getSymbol().equals(value)) {
                return uom;
            }
        }
        
        // Fall back to enum name (for backward compatibility)
        try {
            return UomEnum.valueOf(value.toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new IOException("Unknown unit of measure: " + value);
        }
    }
}
