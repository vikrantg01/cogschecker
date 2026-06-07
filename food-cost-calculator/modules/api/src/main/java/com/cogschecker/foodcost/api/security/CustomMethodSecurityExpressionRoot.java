package com.cogschecker.foodcost.api.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.expression.SecurityExpressionRoot;
import org.springframework.security.access.expression.method.MethodSecurityExpressionOperations;
import org.springframework.security.core.Authentication;

/**
 * Custom security expression root that provides additional security expressions
 * for method-level authorization.
 * 
 * Extends Spring Security's SecurityExpressionRoot to add custom expressions:
 * - hasVenueRole(role, venueId): Check if user has specific role for venue
 * 
 * Requirements: 7.3, 9.1, 9.2, 9.3
 */
public class CustomMethodSecurityExpressionRoot extends SecurityExpressionRoot 
        implements MethodSecurityExpressionOperations {

    private static final Logger logger = LoggerFactory.getLogger(CustomMethodSecurityExpressionRoot.class);
    
    private Object filterObject;
    private Object returnObject;
    private final RbacAuthorizationManager rbacAuthorizationManager;

    public CustomMethodSecurityExpressionRoot(Authentication authentication, 
                                             RbacAuthorizationManager rbacAuthorizationManager) {
        super(authentication);
        this.rbacAuthorizationManager = rbacAuthorizationManager;
    }

    /**
     * Custom security expression to check if the authenticated user has a specific role for a venue.
     * 
     * Usage in @PreAuthorize: @PreAuthorize("hasVenueRole('MANAGER', #venueId)")
     * 
     * @param role the required role (ADMIN, MANAGER, or STAFF)
     * @param venueId the venue ID (can be a String or UUID)
     * @return true if the user has the specified role for the venue
     */
    public boolean hasVenueRole(String role, Object venueId) {
        if (venueId == null) {
            return false;
        }
        
        // Convert venueId to String (handles both String and UUID)
        String venueIdStr = venueId.toString();
        
        return rbacAuthorizationManager.hasVenueRole(getAuthentication(), role, venueIdStr);
    }

    /**
     * Custom security expression to check if user has at least the minimum role level for a venue.
     * Role hierarchy: ADMIN > MANAGER > STAFF
     * 
     * Usage: @PreAuthorize("hasMinimumVenueRole('MANAGER', #venueId)")
     * This would allow both MANAGER and ADMIN roles.
     * 
     * @param minimumRole the minimum required role
     * @param venueId the venue ID
     * @return true if the user has at least the minimum role level
     */
    public boolean hasMinimumVenueRole(String minimumRole, Object venueId) {
        if (venueId == null) {
            return false;
        }
        
        String venueIdStr = venueId.toString();
        return rbacAuthorizationManager.hasMinimumVenueRole(getAuthentication(), minimumRole, venueIdStr);
    }

    /**
     * Custom security expression to check if the authenticated user has organisation admin role.
     * 
     * Usage in @PreAuthorize: @PreAuthorize("hasOrganisationRole('ADMIN', #orgId)")
     * 
     * @param role the required role (currently only "ADMIN" is supported at organisation level)
     * @param organisationId the organisation ID
     * @return true if the user has admin role for the organisation
     */
    public boolean hasOrganisationRole(String role, Object organisationId) {
        if (organisationId == null) {
            return false;
        }
        
        try {
            // Get the authentication token
            if (!(getAuthentication() instanceof CognitoAuthenticationToken)) {
                logger.warn("Authentication is not a CognitoAuthenticationToken: {}", 
                           getAuthentication() != null ? getAuthentication().getClass().getName() : "null");
                return false;
            }
            
            CognitoAuthenticationToken auth = (CognitoAuthenticationToken) getAuthentication();
            
            // Check if the user's organisation matches and role is ADMIN
            String orgIdStr = organisationId.toString();
            return "ADMIN".equalsIgnoreCase(role) 
                    && auth.getOrganisationId() != null 
                    && auth.getOrganisationId().equals(orgIdStr);
        } catch (ClassCastException e) {
            logger.error("Failed to cast authentication to CognitoAuthenticationToken", e);
            return false;
        }
    }

    // MethodSecurityExpressionOperations interface methods

    @Override
    public void setFilterObject(Object filterObject) {
        this.filterObject = filterObject;
    }

    @Override
    public Object getFilterObject() {
        return this.filterObject;
    }

    @Override
    public void setReturnObject(Object returnObject) {
        this.returnObject = returnObject;
    }

    @Override
    public Object getReturnObject() {
        return this.returnObject;
    }

    @Override
    public Object getThis() {
        return this;
    }
}
