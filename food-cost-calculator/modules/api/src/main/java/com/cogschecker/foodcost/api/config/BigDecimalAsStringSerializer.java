package com.cogschecker.foodcost.api.config;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.SerializerProvider;

import java.io.IOException;
import java.math.BigDecimal;

/**
 * Custom Jackson serializer that writes BigDecimal values as JSON strings.
 * This prevents precision loss that can occur with floating-point numbers.
 */
public class BigDecimalAsStringSerializer extends JsonSerializer<BigDecimal> {

    @Override
    public void serialize(BigDecimal value, JsonGenerator gen, SerializerProvider serializers) 
            throws IOException {
        if (value == null) {
            gen.writeNull();
        } else {
            gen.writeString(value.toPlainString());
        }
    }
}
