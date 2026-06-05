package com.cogschecker.foodcost.api.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfigurationSource;

import java.math.BigDecimal;
import java.util.TimeZone;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration tests to verify Spring configuration beans are properly loaded.
 */
@SpringBootTest
@org.springframework.test.context.ActiveProfiles("test")
class ConfigurationTest {

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private SecurityFilterChain securityFilterChain;

    @Autowired
    private CorsConfigurationSource corsConfigurationSource;

    @Test
    void objectMapperShouldUseSnakeCase() {
        assertThat(objectMapper.getPropertyNamingStrategy())
            .isInstanceOf(PropertyNamingStrategies.SnakeCaseStrategy.class);
    }

    @Test
    void objectMapperShouldUseUtcTimeZone() {
        assertThat(objectMapper.getSerializationConfig().getTimeZone())
            .isEqualTo(TimeZone.getTimeZone("UTC"));
    }

    @Test
    void objectMapperShouldSerializeBigDecimalAsString() throws Exception {
        BigDecimal value = new BigDecimal("123.4567");
        String json = objectMapper.writeValueAsString(value);
        assertThat(json).isEqualTo("\"123.4567\"");
    }

    @Test
    void securityFilterChainShouldBeConfigured() {
        assertThat(securityFilterChain).isNotNull();
    }

    @Test
    void corsConfigurationSourceShouldBeConfigured() {
        assertThat(corsConfigurationSource).isNotNull();
    }
}
