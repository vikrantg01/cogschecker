package com.cogschecker.foodcost.api.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;

import java.time.Instant;

/**
 * Local JWT configuration for development without real Cognito.
 * Provides a mock JWT decoder that accepts any token and creates test authentication.
 * 
 * IMPORTANT: Only active in 'local' profile. DO NOT use in production!
 */
@Configuration
@Profile("local")
public class LocalJwtConfig {

    private static final Logger logger = LoggerFactory.getLogger(LocalJwtConfig.class);

    @Bean
    public JwtDecoder localJwtDecoder() {
        logger.warn("⚠️  Using LOCAL JWT DECODER - bypassing Cognito validation!");
        
        return token -> {
            // Create a mock JWT for local testing with test organisation claims
            return Jwt.withTokenValue(token)
                    .header("alg", "none")
                    .claim("sub", "00000000-0000-0000-0000-000000000002") // test user UUID
                    .claim("email", "test@example.com")
                    .claim("custom:org_id", "00000000-0000-0000-0000-000000000001") // test org UUID
                    .claim("custom:tier", "PRO")
                    .claim("custom:venue_roles", "{}") // empty venue roles JSON
                    .issuedAt(Instant.now())
                    .expiresAt(Instant.now().plusSeconds(3600))
                    .build();
        };
    }
}
