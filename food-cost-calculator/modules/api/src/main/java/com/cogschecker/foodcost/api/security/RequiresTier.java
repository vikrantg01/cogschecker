package com.cogschecker.foodcost.api.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Annotation to mark controller methods that require a specific subscription tier.
 * Used by SubscriptionGateFilter to enforce tier-based feature access.
 * 
 * Valid tier values: "free", "pro", "pro_plus"
 * 
 * Tier hierarchy: free < pro < pro_plus
 * When a method requires "pro", users with "pro" or "pro_plus" can access it.
 * When a method requires "pro_plus", only users with "pro_plus" can access it.
 * 
 * Requirements: 11.2, 11.3
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RequiresTier {
    /**
     * The minimum required subscription tier.
     * Valid values: "free", "pro", "pro_plus"
     */
    String value();
}
