package com.cogschecker.foodcost.api.security;

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
