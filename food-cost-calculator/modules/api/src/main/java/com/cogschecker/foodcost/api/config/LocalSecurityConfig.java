package com.cogschecker.foodcost.api.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.core.Authentication;

import java.util.function.Supplier;

/**
 * Local development security configuration that bypasses method security checks.
 * 
 * CRITICAL: This configuration is ONLY active in 'local' profile and completely
 * disables authorization checks for local development. DO NOT use in production!
 * 
 * Purpose: Provides a workaround for Spring Security 6.x custom expression handler
 * issues that prevent custom @PreAuthorize expressions like hasOrganisationRole()
 * from evaluating correctly.
 * 
 * In local profile:
 * - All authenticated requests are allowed
 * - No role or permission checks are performed
 * - Simplifies local development workflow
 * 
 * In production profiles (dev, staging, prod):
 * - Full RBAC is enforced via MethodSecurityConfig
 * - Custom security expressions are used
 * - Proper authorization is required
 */
@Configuration
@Profile("local")
@EnableMethodSecurity(prePostEnabled = false) // Disable @PreAuthorize in local
public class LocalSecurityConfig {

    private static final Logger logger = LoggerFactory.getLogger(LocalSecurityConfig.class);

    public LocalSecurityConfig() {
        logger.warn("⚠️  LOCAL SECURITY CONFIG ACTIVE - Method security is DISABLED!");
        logger.warn("⚠️  All authenticated requests will be authorized in local profile");
        logger.warn("⚠️  DO NOT use this configuration in production!");
    }
}
