package com.cogschecker.foodcost.api.security;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for RbacAuthorizationManager.
 * Validates: Requirements 7.3, 9.1, 9.2, 9.3
 */
class RbacAuthorizationManagerTest {

    private RbacAuthorizationManager authorizationManager;

    @BeforeEach
    void setUp() {
        authorizationManager = new RbacAuthorizationManager();
    }

    @Test
    void hasVenueRole_WithMatchingRole_ShouldReturnTrue() {
        // Arrange
        Map<String, String> venueRoles = Map.of("venue-1", "manager");
        CognitoAuthenticationToken auth = createAuthToken("user-1", "org-1", venueRoles);

        // Act
        boolean result = authorizationManager.hasVenueRole(auth, "MANAGER", "venue-1");

        // Assert
        assertTrue(result);
    }

    @Test
    void hasVenueRole_WithDifferentRole_ShouldReturnFalse() {
        // Arrange
        Map<String, String> venueRoles = Map.of("venue-1", "staff");
        CognitoAuthenticationToken auth = createAuthToken("user-1", "org-1", venueRoles);

        // Act
        boolean result = authorizationManager.hasVenueRole(auth, "MANAGER", "venue-1");

        // Assert
        assertFalse(result);
    }

    @Test
    void hasVenueRole_WithNoAccessToVenue_ShouldReturnFalse() {
        // Arrange
        Map<String, String> venueRoles = Map.of("venue-1", "manager");
        CognitoAuthenticationToken auth = createAuthToken("user-1", "org-1", venueRoles);

        // Act
        boolean result = authorizationManager.hasVenueRole(auth, "MANAGER", "venue-2");

        // Assert
        assertFalse(result);
    }

    @Test
    void hasVenueRole_WithCaseInsensitiveRole_ShouldMatch() {
        // Arrange
        Map<String, String> venueRoles = Map.of("venue-1", "manager");
        CognitoAuthenticationToken auth = createAuthToken("user-1", "org-1", venueRoles);

        // Act - test various case combinations
        assertTrue(authorizationManager.hasVenueRole(auth, "MANAGER", "venue-1"));
        assertTrue(authorizationManager.hasVenueRole(auth, "manager", "venue-1"));
        assertTrue(authorizationManager.hasVenueRole(auth, "Manager", "venue-1"));
    }

    @Test
    void hasVenueRole_WithNullAuthentication_ShouldReturnFalse() {
        // Act
        boolean result = authorizationManager.hasVenueRole(null, "MANAGER", "venue-1");

        // Assert
        assertFalse(result);
    }

    @Test
    void hasVenueRole_WithNonCognitoAuth_ShouldReturnFalse() {
        // Arrange
        Authentication auth = new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(
                "user", "password");

        // Act
        boolean result = authorizationManager.hasVenueRole(auth, "MANAGER", "venue-1");

        // Assert
        assertFalse(result);
    }

    @Test
    void hasVenueRole_WithAdminRole_ShouldMatch() {
        // Arrange
        Map<String, String> venueRoles = Map.of("venue-1", "admin");
        CognitoAuthenticationToken auth = createAuthToken("user-1", "org-1", venueRoles);

        // Act
        boolean result = authorizationManager.hasVenueRole(auth, "ADMIN", "venue-1");

        // Assert
        assertTrue(result);
    }

    @Test
    void hasVenueRole_WithStaffRole_ShouldMatch() {
        // Arrange
        Map<String, String> venueRoles = Map.of("venue-1", "staff");
        CognitoAuthenticationToken auth = createAuthToken("user-1", "org-1", venueRoles);

        // Act
        boolean result = authorizationManager.hasVenueRole(auth, "STAFF", "venue-1");

        // Assert
        assertTrue(result);
    }

    @Test
    void hasVenueRole_WithMultipleVenues_ShouldCheckCorrectVenue() {
        // Arrange
        Map<String, String> venueRoles = Map.of(
                "venue-1", "admin",
                "venue-2", "manager",
                "venue-3", "staff"
        );
        CognitoAuthenticationToken auth = createAuthToken("user-1", "org-1", venueRoles);

        // Act & Assert
        assertTrue(authorizationManager.hasVenueRole(auth, "ADMIN", "venue-1"));
        assertTrue(authorizationManager.hasVenueRole(auth, "MANAGER", "venue-2"));
        assertTrue(authorizationManager.hasVenueRole(auth, "STAFF", "venue-3"));

        assertFalse(authorizationManager.hasVenueRole(auth, "MANAGER", "venue-1")); // venue-1 has admin, not manager
        assertFalse(authorizationManager.hasVenueRole(auth, "ADMIN", "venue-2")); // venue-2 has manager, not admin
    }

    @Test
    void hasMinimumVenueRole_WithExactRole_ShouldReturnTrue() {
        // Arrange
        Map<String, String> venueRoles = Map.of("venue-1", "manager");
        CognitoAuthenticationToken auth = createAuthToken("user-1", "org-1", venueRoles);

        // Act
        boolean result = authorizationManager.hasMinimumVenueRole(auth, "MANAGER", "venue-1");

        // Assert
        assertTrue(result);
    }

    @Test
    void hasMinimumVenueRole_WithHigherRole_ShouldReturnTrue() {
        // Arrange
        Map<String, String> venueRoles = Map.of("venue-1", "admin");
        CognitoAuthenticationToken auth = createAuthToken("user-1", "org-1", venueRoles);

        // Act - admin should satisfy minimum role of manager
        boolean result = authorizationManager.hasMinimumVenueRole(auth, "MANAGER", "venue-1");

        // Assert
        assertTrue(result);
    }

    @Test
    void hasMinimumVenueRole_WithLowerRole_ShouldReturnFalse() {
        // Arrange
        Map<String, String> venueRoles = Map.of("venue-1", "staff");
        CognitoAuthenticationToken auth = createAuthToken("user-1", "org-1", venueRoles);

        // Act - staff should NOT satisfy minimum role of manager
        boolean result = authorizationManager.hasMinimumVenueRole(auth, "MANAGER", "venue-1");

        // Assert
        assertFalse(result);
    }

    @Test
    void hasMinimumVenueRole_RoleHierarchy_AdminCanAccessManagerEndpoints() {
        // Arrange - user has ADMIN role
        Map<String, String> venueRoles = Map.of("venue-1", "admin");
        CognitoAuthenticationToken auth = createAuthToken("user-1", "org-1", venueRoles);

        // Act & Assert - admin should have access to all role levels
        assertTrue(authorizationManager.hasMinimumVenueRole(auth, "ADMIN", "venue-1"));
        assertTrue(authorizationManager.hasMinimumVenueRole(auth, "MANAGER", "venue-1"));
        assertTrue(authorizationManager.hasMinimumVenueRole(auth, "STAFF", "venue-1"));
    }

    @Test
    void hasMinimumVenueRole_RoleHierarchy_ManagerCannotAccessAdminEndpoints() {
        // Arrange - user has MANAGER role
        Map<String, String> venueRoles = Map.of("venue-1", "manager");
        CognitoAuthenticationToken auth = createAuthToken("user-1", "org-1", venueRoles);

        // Act & Assert
        assertFalse(authorizationManager.hasMinimumVenueRole(auth, "ADMIN", "venue-1"));
        assertTrue(authorizationManager.hasMinimumVenueRole(auth, "MANAGER", "venue-1"));
        assertTrue(authorizationManager.hasMinimumVenueRole(auth, "STAFF", "venue-1"));
    }

    @Test
    void hasMinimumVenueRole_RoleHierarchy_StaffCannotAccessManagerOrAdminEndpoints() {
        // Arrange - user has STAFF role
        Map<String, String> venueRoles = Map.of("venue-1", "staff");
        CognitoAuthenticationToken auth = createAuthToken("user-1", "org-1", venueRoles);

        // Act & Assert
        assertFalse(authorizationManager.hasMinimumVenueRole(auth, "ADMIN", "venue-1"));
        assertFalse(authorizationManager.hasMinimumVenueRole(auth, "MANAGER", "venue-1"));
        assertTrue(authorizationManager.hasMinimumVenueRole(auth, "STAFF", "venue-1"));
    }

    @Test
    void hasMinimumVenueRole_WithNullAuthentication_ShouldReturnFalse() {
        // Act
        boolean result = authorizationManager.hasMinimumVenueRole(null, "MANAGER", "venue-1");

        // Assert
        assertFalse(result);
    }

    @Test
    void hasMinimumVenueRole_WithNoAccessToVenue_ShouldReturnFalse() {
        // Arrange
        Map<String, String> venueRoles = Map.of("venue-1", "admin");
        CognitoAuthenticationToken auth = createAuthToken("user-1", "org-1", venueRoles);

        // Act
        boolean result = authorizationManager.hasMinimumVenueRole(auth, "STAFF", "venue-2");

        // Assert
        assertFalse(result);
    }

    /**
     * Helper method to create a test CognitoAuthenticationToken.
     */
    private CognitoAuthenticationToken createAuthToken(String userId, String orgId, Map<String, String> venueRoles) {
        List<SimpleGrantedAuthority> authorities = venueRoles.entrySet().stream()
                .map(entry -> new SimpleGrantedAuthority(
                        String.format("ROLE_VENUE_%s_%s", entry.getKey(), entry.getValue().toUpperCase())))
                .toList();

        return new CognitoAuthenticationToken(
                userId,
                "user@example.com",
                orgId,
                venueRoles,
                "pro",
                authorities
        );
    }
}
