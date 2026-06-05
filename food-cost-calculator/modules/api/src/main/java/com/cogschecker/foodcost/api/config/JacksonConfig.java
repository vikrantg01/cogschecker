package com.cogschecker.foodcost.api.config;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.module.SimpleModule;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;

import java.math.BigDecimal;
import java.time.ZoneId;
import java.util.TimeZone;

/**
 * Jackson configuration for JSON serialization/deserialization.
 * 
 * Key configurations:
 * - snake_case property naming (e.g., foodCostPerPortion -> food_cost_per_portion)
 * - BigDecimal serialized as strings to preserve precision
 * - UTC timezone for all timestamp fields
 * - ISO-8601 date/time format
 */
@Configuration
public class JacksonConfig {

    @Bean
    @Primary
    public ObjectMapper objectMapper(Jackson2ObjectMapperBuilder builder) {
        ObjectMapper mapper = builder.build();
        
        // Use snake_case for all JSON properties
        mapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        
        // Configure time zone to UTC
        mapper.setTimeZone(TimeZone.getTimeZone(ZoneId.of("UTC")));
        
        // Register JavaTimeModule for Java 8 date/time types
        mapper.registerModule(new JavaTimeModule());
        
        // Serialize BigDecimal as string to preserve precision
        SimpleModule bigDecimalModule = new SimpleModule();
        bigDecimalModule.addSerializer(BigDecimal.class, new BigDecimalAsStringSerializer());
        mapper.registerModule(bigDecimalModule);
        
        // Write dates as ISO-8601 strings, not timestamps
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        
        // Ignore unknown properties during deserialization (forward compatibility)
        mapper.disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
        
        // Don't include null values in JSON output
        mapper.setSerializationInclusion(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL);
        
        return mapper;
    }
}
