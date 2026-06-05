package com.cogschecker.foodcost.api.security;

import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;

import java.util.Collection;
import java.util.Map;

/**
 * Custom authentication token for Cognito-authenticated users.
 * Holds the user's organisation ID, venue roles, and subscription tier
 * extracted from Cognito JWT custom claims.
 */
public class CognitoAuthenticationToken extends AbstractAuthenticationToken {

    private final String userId;
    private final String email;
    private final String organisationId;
    private final Map<String, String> venueRoles;
    private final String tier;

    public CognitoAuthenticationToken(
            String userId,
            String email,
            String organisationId,
            Map<String, String> venueRoles,
            String tier,
            Collection<? extends GrantedAuthority> authorities) {
        super(authorities);
        this.userId = userId;
        this.email = email;
        this.organisationId = organisationId;
        this.venueRoles = venueRoles;
        this.tier = tier;
        setAuthenticated(true);
    }

    @Override
    public Object getCredentials() {
        return null;
    }

    @Override
    public Object getPrincipal() {
        return userId;
    }

    public String getUserId() {
        return userId;
    }

    public String getEmail() {
        return email;
    }

    public String getOrganisationId() {
        return organisationId;
    }

    public Map<String, String> getVenueRoles() {
        return venueRoles;
    }

    public String getTier() {
        return tier;
    }

    /**
     * Get the role for a specific venue.
     * @param venueId the venue UUID
     * @return the role name (e.g., "admin", "manager", "staff") or null if no access
     */
    public String getRoleForVenue(String venueId) {
        return venueRoles.get(venueId);
    }

    /**
     * Check if the user has access to a specific venue.
     * @param venueId the venue UUID
     * @return true if the user has any role for this venue
     */
    public boolean hasAccessToVenue(String venueId) {
        return venueRoles.containsKey(venueId);
    }
}
