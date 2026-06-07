package com.cogschecker.foodcost.api.config;

import com.cogschecker.foodcost.api.security.RbacAuthorizationManager;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.security.access.expression.method.DefaultMethodSecurityExpressionHandler;
import org.springframework.security.access.expression.method.MethodSecurityExpressionHandler;
import org.springframework.security.oauth2.jwt.JwtDecoder;

import static org.mockito.Mockito.mock;

/**
 * Test configuration for InsightController.
 * Provides mocked security beans including JwtDecoder needed when OAuth2 security is partially enabled.
 */
@TestConfiguration
public class InsightControllerTestConfig {

    @Bean
    @Primary
    public RbacAuthorizationManager rbacAuthorizationManager() {
        return mock(RbacAuthorizationManager.class);
    }

    @Bean
    @Primary
    public MethodSecurityExpressionHandler methodSecurityExpressionHandler(RbacAuthorizationManager rbacAuthorizationManager) {
        return new DefaultMethodSecurityExpressionHandler();
    }
    
    @Bean
    @Primary
    public JwtDecoder jwtDecoder() {
        return mock(JwtDecoder.class);
    }
}
