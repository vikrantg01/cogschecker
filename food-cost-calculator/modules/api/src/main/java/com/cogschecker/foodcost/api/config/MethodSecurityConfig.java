package com.cogschecker.foodcost.api.config;

import com.cogschecker.foodcost.api.security.CustomMethodSecurityExpressionHandler;
import com.cogschecker.foodcost.api.security.RbacAuthorizationManager;
import org.aopalliance.intercept.MethodInvocation;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.access.expression.method.MethodSecurityExpressionHandler;
import org.springframework.security.authorization.method.MethodInvocationResult;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.core.GrantedAuthorityDefaults;

/**
 * Configuration for method-level security with custom expressions.
 * Registers CustomMethodSecurityExpressionHandler to support hasVenueRole() expression.
 * 
 * Requirements: 7.3, 9.1, 9.2, 9.3
 */
@Configuration
@EnableMethodSecurity
public class MethodSecurityConfig {

    private final RbacAuthorizationManager rbacAuthorizationManager;

    public MethodSecurityConfig(RbacAuthorizationManager rbacAuthorizationManager) {
        this.rbacAuthorizationManager = rbacAuthorizationManager;
    }

    /**
     * Create a custom method security expression handler that supports
     * custom security expressions like hasVenueRole().
     * 
     * This bean is automatically picked up by Spring Security's method security infrastructure.
     */
    @Bean
    static MethodSecurityExpressionHandler methodSecurityExpressionHandler(RbacAuthorizationManager rbacAuthorizationManager) {
        return new CustomMethodSecurityExpressionHandler(rbacAuthorizationManager);
    }

    /**
     * Remove the "ROLE_" prefix from role names.
     * This allows @PreAuthorize expressions to use role names directly without the ROLE_ prefix.
     */
    @Bean
    static GrantedAuthorityDefaults grantedAuthorityDefaults() {
        return new GrantedAuthorityDefaults("");
    }
}
