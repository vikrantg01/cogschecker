package com.cogschecker.foodcost.api.config;

import com.cogschecker.foodcost.api.filter.SubscriptionGateFilter;
import com.cogschecker.foodcost.api.filter.VenueScopeFilter;
import com.cogschecker.foodcost.api.security.JwtAuthenticationFilter;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/**
 * Spring Security configuration for JWT-based authentication via Amazon Cognito.
 * Configures stateless session management and integrates Cognito JWT verification.
 * 
 * Note: Method security is enabled in MethodSecurityConfig with custom expression handler.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;

    @Value("${cognito.jwks-uri}")
    private String jwksUri;

    public SecurityConfig(@Lazy JwtAuthenticationFilter jwtAuthenticationFilter) {
        this.jwtAuthenticationFilter = jwtAuthenticationFilter;
    }

    /**
     * Configure NimbusJwtDecoder to fetch and cache JWKS from Cognito.
     * The JWKS is cached in-memory and refreshed automatically when Cognito rotates signing keys.
     */
    @Bean
    public JwtDecoder jwtDecoder() {
        return NimbusJwtDecoder.withJwkSetUri(jwksUri).build();
    }

    /**
     * Create VenueScopeFilter as a bean.
     * This filter validates that venueId from path belongs to user's organisation.
     */
    @Bean
    public VenueScopeFilter venueScopeFilter() {
        return new VenueScopeFilter();
    }

    /**
     * Create SubscriptionGateFilter as a bean.
     * This filter validates that user's subscription tier meets endpoint requirements.
     * Uses lazy initialization for handlerMapping to avoid circular dependency.
     */
    @Bean
    public SubscriptionGateFilter subscriptionGateFilter(ObjectMapper objectMapper) {
        return new SubscriptionGateFilter(null, objectMapper);
    }

    @Bean
    public SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            VenueScopeFilter venueScopeFilter,
            @Lazy SubscriptionGateFilter subscriptionGateFilter) throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            )
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/**").permitAll()
                .requestMatchers("/api/v1/auth/**").permitAll()
                .requestMatchers("/api/v1/webhooks/**").permitAll()
                .anyRequest().authenticated()
            )
            .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterAfter(venueScopeFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterAfter(subscriptionGateFilter, VenueScopeFilter.class);

        return http.build();
    }
}
