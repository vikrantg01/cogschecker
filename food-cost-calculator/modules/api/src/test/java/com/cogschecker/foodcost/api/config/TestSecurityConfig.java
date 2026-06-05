package com.cogschecker.foodcost.api.config;

import com.cogschecker.foodcost.api.security.CustomMethodSecurityExpressionHandler;
import com.cogschecker.foodcost.api.security.RbacAuthorizationManager;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.security.access.expression.method.DefaultMethodSecurityExpressionHandler;
import org.springframework.security.access.expression.method.MethodSecurityExpressionHandler;

import static org.mockito.Mockito.mock;

/**
 * Test configuration for security-related beans in controller tests.
 * Provides mock beans for @WebMvcTest slices that need method security.
 * 
 * This configuration ensures that @PreAuthorize annotations are processed
 * but with mocked RBAC logic during unit tests.
 */
@TestConfiguration
public class TestSecurityConfig {

    @Bean
    @Primary
    public RbacAuthorizationManager rbacAuthorizationManager() {
        return mock(RbacAuthorizationManager.class);
    }

    @Bean
    @Primary
    public MethodSecurityExpressionHandler methodSecurityExpressionHandler(RbacAuthorizationManager rbacAuthorizationManager) {
        // Use the default handler for tests - actual RBAC logic is mocked
        return new DefaultMethodSecurityExpressionHandler();
    }
}
