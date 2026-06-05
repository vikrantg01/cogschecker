package com.cogschecker.foodcost.api.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;
import org.springframework.stereotype.Component;

import java.util.function.Supplier;

/**
 * Custom authorization manager for role-based access control (RBAC) at the venue level.
 * This manager handles venue-scoped authorization decisions based on user roles.
 * 
 * Requirements: 7.3, 9.1, 9.2, 9.3
 */
@Component
public class RbacAuthorizationManager implements AuthorizationManager<RequestAuthorizationContext> {

    private static final Logger logger = LoggerFactory.getLogger(RbacAuthorizationManager.class);

    @Override
    public AuthorizationDecision check(Supplier<Authentication> authentication, RequestAuthorizationContext context) {
        Authentication auth = authentication.get();
        
        if (auth == null || !auth.isAuthenticated()) {
            logger.debug("Authorization denied: no authentication present");
            return new AuthorizationDecision(false);
        }

        if (!(auth instanceof CognitoAuthenticationToken)) {
            logger.debug("Authorization denied: authentication is not CognitoAuthenticationToken");
            return new AuthorizationDecision(false);
        }

        // For basic authenticated requests, grant access
        // Fine-grained authorization is handled by @PreAuthorize annotations
        return new AuthorizationDecision(true);
    }

    /**
     * Check if the authenticated user has a specific role for a venue.
     * This method is called by the custom security expression evaluator.
     * 
     * @param authentication the authentication object
     * @param requiredRole the role to check (ADMIN, MANAGER, or STAFF)
     * @param venueId the venue ID
     * @return true if the user has the required role for the venue
     */
    public boolean hasVenueRole(Authentication authentication, String requiredRole, String venueId) {
        if (authentication == null || !authentication.isAuthenticated()) {
            logger.debug("hasVenueRole: no authentication present");
            return false;
        }

        if (!(authentication instanceof CognitoAuthenticationToken)) {
            logger.debug("hasVenueRole: authentication is not CognitoAuthenticationToken");
            return false;
        }

        CognitoAuthenticationToken cognitoAuth = (CognitoAuthenticationToken) authentication;
        
        // Get the user's role for this venue
        String userRole = cognitoAuth.getRoleForVenue(venueId);
        
        if (userRole == null) {
            logger.debug("hasVenueRole: user {} has no role for venue {}", 
                    cognitoAuth.getUserId(), venueId);
            return false;
        }

        // Normalize roles to uppercase for comparison
        String normalizedUserRole = userRole.toUpperCase();
        String normalizedRequiredRole = requiredRole.toUpperCase();

        // Check if user's role matches required role
        boolean hasRole = normalizedUserRole.equals(normalizedRequiredRole);
        
        logger.debug("hasVenueRole: user {} has role {} for venue {}, required role {}, result: {}",
                cognitoAuth.getUserId(), normalizedUserRole, venueId, normalizedRequiredRole, hasRole);

        return hasRole;
    }

    /**
     * Check if the authenticated user has at least the specified role level for a venue.
     * Role hierarchy: ADMIN > MANAGER > STAFF
     * 
     * @param authentication the authentication object
     * @param minimumRole the minimum role required (ADMIN, MANAGER, or STAFF)
     * @param venueId the venue ID
     * @return true if the user has at least the minimum role for the venue
     */
    public boolean hasMinimumVenueRole(Authentication authentication, String minimumRole, String venueId) {
        if (authentication == null || !authentication.isAuthenticated()) {
            return false;
        }

        if (!(authentication instanceof CognitoAuthenticationToken)) {
            return false;
        }

        CognitoAuthenticationToken cognitoAuth = (CognitoAuthenticationToken) authentication;
        String userRole = cognitoAuth.getRoleForVenue(venueId);
        
        if (userRole == null) {
            return false;
        }

        return hasMinimumRoleLevel(userRole, minimumRole);
    }

    /**
     * Check if a user role meets the minimum role level requirement.
     * 
     * @param userRole the user's actual role
     * @param minimumRole the minimum required role
     * @return true if userRole >= minimumRole in the role hierarchy
     */
    private boolean hasMinimumRoleLevel(String userRole, String minimumRole) {
        int userLevel = getRoleLevel(userRole);
        int minimumLevel = getRoleLevel(minimumRole);
        return userLevel >= minimumLevel;
    }

    /**
     * Get the hierarchical level of a role.
     * ADMIN = 3, MANAGER = 2, STAFF = 1, unknown = 0
     */
    private int getRoleLevel(String role) {
        if (role == null) {
            return 0;
        }
        
        switch (role.toUpperCase()) {
            case "ADMIN":
                return 3;
            case "MANAGER":
                return 2;
            case "STAFF":
                return 1;
            default:
                return 0;
        }
    }
}
