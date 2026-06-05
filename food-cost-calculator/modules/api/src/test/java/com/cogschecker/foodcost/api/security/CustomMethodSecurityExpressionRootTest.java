package com.cogschecker.foodcost.api.security;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for CustomMethodSecurityExpressionRoot.
 * Tests the custom security expressions: hasVenueRole() and hasMinimumVenueRole().
 * 
 * Validates: Requirements 7.3, 9.1, 9.2, 9.3
 */
class CustomMethodSecurityExpressionRootTest {

    private RbacAuthorizationManager rbacAuthorizationManager;
    private CustomMethodSecurityExpressionRoot expressionRoot;
    private CognitoAuthenticationToken authentication;

    @BeforeEach
    void setUp() {
        rbacAuthorizationManager = new RbacAuthorizationManager();
        
        // Create a test authentication token with multiple venue roles
        Map<String, String> venueRoles = Map.of(
                "venue-1", "admin",
                "venue-2", "manager",
                "venue-3", "staff"
        );
        
        authentication = createAuthToken("user-1", "org-1", venueRoles);
        expressionRoot = new CustomMethodSecurityExpressionRoot(authentication, rbacAuthorizationManager);
    }

    @Test
    void hasVenueRole_WithStringVenueId_ShouldWork() {
        // Act & Assert
        assertTrue(expressionRoot.hasVenueRole("ADMIN", "venue-1"));
        assertTrue(expressionRoot.hasVenueRole("MANAGER", "venue-2"));
        assertTrue(expressionRoot.hasVenueRole("STAFF", "venue-3"));
    }

    @Test
    void hasVenueRole_WithUuidVenueId_ShouldWork() {
        // Arrange - create auth with UUID-formatted venue IDs
        UUID venueUuid = UUID.randomUUID();
        Map<String, String> venueRoles = Map.of(venueUuid.toString(), "manager");
        CognitoAuthenticationToken auth = createAuthToken("user-1", "org-1", venueRoles);
        CustomMethodSecurityExpressionRoot root = new CustomMethodSecurityExpressionRoot(auth, rbacAuthorizationManager);

        // Act & Assert - should work with UUID object
        assertTrue(root.hasVenueRole("MANAGER", venueUuid));
    }

    @Test
    void hasVenueRole_WithNullVenueId_ShouldReturnFalse() {
        // Act
        boolean result = expressionRoot.hasVenueRole("MANAGER", null);

        // Assert
        assertFalse(result);
    }

    @Test
    void hasVenueRole_WithWrongRole_ShouldReturnFalse() {
        // Act & Assert
        assertFalse(expressionRoot.hasVenueRole("STAFF", "venue-1")); // venue-1 has admin, not staff
        assertFalse(expressionRoot.hasVenueRole("ADMIN", "venue-2")); // venue-2 has manager, not admin
    }

    @Test
    void hasVenueRole_WithNoAccessToVenue_ShouldReturnFalse() {
        // Act
        boolean result = expressionRoot.hasVenueRole("MANAGER", "venue-999");

        // Assert
        assertFalse(result);
    }

    @Test
    void hasVenueRole_WithCaseInsensitiveRole_ShouldWork() {
        // Act & Assert
        assertTrue(expressionRoot.hasVenueRole("admin", "venue-1"));
        assertTrue(expressionRoot.hasVenueRole("ADMIN", "venue-1"));
        assertTrue(expressionRoot.hasVenueRole("Admin", "venue-1"));
    }

    @Test
    void hasMinimumVenueRole_WithExactRole_ShouldReturnTrue() {
        // Act & Assert
        assertTrue(expressionRoot.hasMinimumVenueRole("ADMIN", "venue-1"));
        assertTrue(expressionRoot.hasMinimumVenueRole("MANAGER", "venue-2"));
        assertTrue(expressionRoot.hasMinimumVenueRole("STAFF", "venue-3"));
    }

    @Test
    void hasMinimumVenueRole_WithHigherRole_ShouldReturnTrue() {
        // Act & Assert - admin (venue-1) should satisfy manager and staff requirements
        assertTrue(expressionRoot.hasMinimumVenueRole("MANAGER", "venue-1"));
        assertTrue(expressionRoot.hasMinimumVenueRole("STAFF", "venue-1"));
        
        // manager (venue-2) should satisfy staff requirement
        assertTrue(expressionRoot.hasMinimumVenueRole("STAFF", "venue-2"));
    }

    @Test
    void hasMinimumVenueRole_WithLowerRole_ShouldReturnFalse() {
        // Act & Assert - staff (venue-3) should NOT satisfy manager or admin requirements
        assertFalse(expressionRoot.hasMinimumVenueRole("MANAGER", "venue-3"));
        assertFalse(expressionRoot.hasMinimumVenueRole("ADMIN", "venue-3"));
        
        // manager (venue-2) should NOT satisfy admin requirement
        assertFalse(expressionRoot.hasMinimumVenueRole("ADMIN", "venue-2"));
    }

    @Test
    void hasMinimumVenueRole_WithNullVenueId_ShouldReturnFalse() {
        // Act
        boolean result = expressionRoot.hasMinimumVenueRole("MANAGER", null);

        // Assert
        assertFalse(result);
    }

    @Test
    void hasMinimumVenueRole_WithUuidVenueId_ShouldWork() {
        // Arrange
        UUID venueUuid = UUID.randomUUID();
        Map<String, String> venueRoles = Map.of(venueUuid.toString(), "admin");
        CognitoAuthenticationToken auth = createAuthToken("user-1", "org-1", venueRoles);
        CustomMethodSecurityExpressionRoot root = new CustomMethodSecurityExpressionRoot(auth, rbacAuthorizationManager);

        // Act & Assert
        assertTrue(root.hasMinimumVenueRole("ADMIN", venueUuid));
        assertTrue(root.hasMinimumVenueRole("MANAGER", venueUuid));
        assertTrue(root.hasMinimumVenueRole("STAFF", venueUuid));
    }

    @Test
    void getFilterObject_SetFilterObject_ShouldWork() {
        // Arrange
        Object filterObj = new Object();

        // Act
        expressionRoot.setFilterObject(filterObj);

        // Assert
        assertSame(filterObj, expressionRoot.getFilterObject());
    }

    @Test
    void getReturnObject_SetReturnObject_ShouldWork() {
        // Arrange
        Object returnObj = new Object();

        // Act
        expressionRoot.setReturnObject(returnObj);

        // Assert
        assertSame(returnObj, expressionRoot.getReturnObject());
    }

    @Test
    void getThis_ShouldReturnSelf() {
        // Act
        Object thisObj = expressionRoot.getThis();

        // Assert
        assertSame(expressionRoot, thisObj);
    }

    @Test
    void hasVenueRole_SimulatesPreAuthorizeAnnotationUsage() {
        // Simulate @PreAuthorize("hasVenueRole('MANAGER', #venueId)")
        // where #venueId is a method parameter
        
        String venueIdParam = "venue-2";
        
        // Act - this is what Spring Security would evaluate
        boolean canAccess = expressionRoot.hasVenueRole("MANAGER", venueIdParam);

        // Assert
        assertTrue(canAccess);
    }

    @Test
    void hasVenueRole_BlocksAccessForWrongRole() {
        // Simulate a staff user trying to access a manager-only endpoint
        Map<String, String> staffRoles = Map.of("venue-1", "staff");
        CognitoAuthenticationToken staffAuth = createAuthToken("staff-user", "org-1", staffRoles);
        CustomMethodSecurityExpressionRoot staffRoot = new CustomMethodSecurityExpressionRoot(staffAuth, rbacAuthorizationManager);

        // Act - staff trying to access @PreAuthorize("hasVenueRole('MANAGER', #venueId)")
        boolean canAccess = staffRoot.hasVenueRole("MANAGER", "venue-1");

        // Assert
        assertFalse(canAccess);
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
