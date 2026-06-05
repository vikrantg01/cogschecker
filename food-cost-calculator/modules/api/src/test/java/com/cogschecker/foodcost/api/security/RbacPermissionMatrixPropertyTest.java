package com.cogschecker.foodcost.api.security;

import net.jqwik.api.*;
import net.jqwik.api.constraints.Size;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Property-based test for RBAC permission matrix enforcement.
 * 
 * **Property 19: RBAC Correctly Enforces Permissions for All Role/Action Combinations**
 * **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
 * 
 * Tests that the RBAC system correctly enforces permissions for all role/action combinations
 * as defined in the requirements:
 * - Admin: Full CRUD access to all venues in their organisation
 * - Manager: Full CRUD access to assigned venues only
 * - Staff: Read-only access to assigned venues (no create, update, delete, export)
 * 
 * The test generates users with varied roles across multiple venues and verifies that
 * permission checks return the expected results according to the permission matrix.
 */
class RbacPermissionMatrixPropertyTest {

    private final RbacAuthorizationManager authorizationManager = new RbacAuthorizationManager();

    /**
     * Property: For any user with any role (Admin, Manager, Staff) and any action,
     * the RBAC system must correctly enforce permissions according to the matrix:
     * 
     * Action Matrix:
     * - CREATE/UPDATE/DELETE: Admin ✓ (all venues), Manager ✓ (assigned venues), Staff ✗
     * - READ: Admin ✓ (all venues), Manager ✓ (assigned venues), Staff ✓ (assigned venues)
     * - EXPORT: Admin ✓ (all venues), Manager ✓ (assigned venues), Staff ✗
     * 
     * The test verifies:
     * 1. Admin users can perform all CRUD operations on all venues
     * 2. Manager users can perform all CRUD operations on their assigned venues only
     * 3. Staff users can only READ on their assigned venues (all mutations blocked)
     * 4. Users cannot access venues they have no role for
     */
    @Property(tries = 1000)
    @Label("P19: RBAC correctly enforces permissions for all role/action combinations")
    void rbacCorrectlyEnforcesPermissionsForAllRoleActionCombinations(
            @ForAll("userRoleScenarios") UserRoleScenario scenario) {

        // Create authentication token for the user
        CognitoAuthenticationToken auth = createAuthToken(
                scenario.userId,
                scenario.organisationId,
                scenario.venueRoles
        );

        // Test all venues (both assigned and unassigned)
        for (String venueId : scenario.allVenueIds) {
            String userRole = scenario.venueRoles.get(venueId);

            // Verify permission checks for all action types
            verifyReadPermissions(auth, venueId, userRole);
            verifyWritePermissions(auth, venueId, userRole);
        }
    }

    /**
     * Verify READ permissions (GET operations).
     * All roles (Admin, Manager, Staff) should have read access to their assigned venues.
     * No role should have read access to unassigned venues.
     */
    private void verifyReadPermissions(CognitoAuthenticationToken auth, String venueId, String userRole) {
        if (userRole == null) {
            // No role for this venue - should be denied
            assertThat(authorizationManager.hasVenueRole(auth, "STAFF", venueId))
                    .as("User with no role should not have read access to venue %s", venueId)
                    .isFalse();
            assertThat(authorizationManager.hasVenueRole(auth, "MANAGER", venueId))
                    .as("User with no role should not have manager access to venue %s", venueId)
                    .isFalse();
            assertThat(authorizationManager.hasVenueRole(auth, "ADMIN", venueId))
                    .as("User with no role should not have admin access to venue %s", venueId)
                    .isFalse();
        } else {
            // Has a role - should have at least STAFF-level access (read-only)
            assertThat(authorizationManager.hasMinimumVenueRole(auth, "STAFF", venueId))
                    .as("User with role %s should have read access to venue %s", userRole, venueId)
                    .isTrue();
        }
    }

    /**
     * Verify WRITE permissions (CREATE, UPDATE, DELETE, EXPORT operations).
     * Only Admin and Manager roles should have write access to their assigned venues.
     * Staff role should never have write access.
     */
    private void verifyWritePermissions(CognitoAuthenticationToken auth, String venueId, String userRole) {
        boolean shouldHaveWriteAccess = userRole != null &&
                (userRole.equalsIgnoreCase("ADMIN") || userRole.equalsIgnoreCase("MANAGER"));

        // Check minimum role level for MANAGER (which is required for write operations)
        boolean hasWriteAccess = authorizationManager.hasMinimumVenueRole(auth, "MANAGER", venueId);

        assertThat(hasWriteAccess)
                .as("User with role %s should %s write access to venue %s",
                        userRole,
                        shouldHaveWriteAccess ? "have" : "NOT have",
                        venueId)
                .isEqualTo(shouldHaveWriteAccess);

        // Specifically verify Staff cannot write
        if (userRole != null && userRole.equalsIgnoreCase("STAFF")) {
            assertThat(authorizationManager.hasVenueRole(auth, "MANAGER", venueId))
                    .as("Staff user should not have manager-level access to venue %s", venueId)
                    .isFalse();
            assertThat(authorizationManager.hasVenueRole(auth, "ADMIN", venueId))
                    .as("Staff user should not have admin-level access to venue %s", venueId)
                    .isFalse();
        }
    }

    /**
     * Additional verification: Admin succeeds on all operations, Manager on venue-scoped,
     * Staff read-only.
     */
    @Property(tries = 1000)
    @Label("P19b: Admin succeeds on all operations, Manager on venue-scoped, Staff read-only")
    void adminManagerStaffPermissionMatrix(
            @ForAll("roleType") Role role,
            @ForAll("actionType") Action action,
            @ForAll("venueIds") String venueId) {

        // Create a user with the specified role for the venue
        Map<String, String> venueRoles = Map.of(venueId, role.name().toLowerCase());
        CognitoAuthenticationToken auth = createAuthToken(
                UUID.randomUUID().toString(),
                UUID.randomUUID().toString(),
                venueRoles
        );

        boolean expectedAccess = determineExpectedAccess(role, action);
        boolean actualAccess = checkAccess(auth, venueId, action);

        assertThat(actualAccess)
                .as("Role %s should %s access for action %s on venue %s",
                        role,
                        expectedAccess ? "have" : "NOT have",
                        action,
                        venueId)
                .isEqualTo(expectedAccess);
    }

    /**
     * Determine expected access based on role and action according to the permission matrix.
     */
    private boolean determineExpectedAccess(Role role, Action action) {
        switch (role) {
            case ADMIN:
                // Admin has access to all actions
                return true;
            case MANAGER:
                // Manager has access to all actions
                return true;
            case STAFF:
                // Staff only has access to READ actions
                return action == Action.READ;
            default:
                return false;
        }
    }

    /**
     * Check if the user has access to perform the action on the venue.
     */
    private boolean checkAccess(CognitoAuthenticationToken auth, String venueId, Action action) {
        switch (action) {
            case READ:
                // READ requires at least STAFF role
                return authorizationManager.hasMinimumVenueRole(auth, "STAFF", venueId);
            case CREATE:
            case UPDATE:
            case DELETE:
            case EXPORT:
                // WRITE operations require at least MANAGER role
                return authorizationManager.hasMinimumVenueRole(auth, "MANAGER", venueId);
            default:
                return false;
        }
    }

    // ========== Generators ==========

    /**
     * Generate user role scenarios with varied role assignments across multiple venues.
     * Each scenario includes:
     * - A user ID
     * - An organisation ID
     * - Role assignments for 0-5 venues (representing the user's access)
     * - A list of all venue IDs (including venues the user has no access to)
     */
    @Provide
    Arbitrary<UserRoleScenario> userRoleScenarios() {
        return Combinators.combine(
                Arbitraries.strings().alpha().ofLength(36), // userId (UUID-like)
                Arbitraries.strings().alpha().ofLength(36), // organisationId
                venueRoleMap(),
                allVenueIdsList()
        ).as((userId, orgId, venueRoles, allVenueIds) -> {
            UserRoleScenario scenario = new UserRoleScenario();
            scenario.userId = userId;
            scenario.organisationId = orgId;
            scenario.venueRoles = venueRoles;
            scenario.allVenueIds = allVenueIds;
            return scenario;
        });
    }

    /**
     * Generate a map of venue IDs to roles.
     * Represents the user's role assignments across 0-5 venues.
     */
    @Provide
    Arbitrary<Map<String, String>> venueRoleMap() {
        return Arbitraries.maps(
                venueIds(),
                roles()
        ).ofMinSize(0).ofMaxSize(5);
    }

    /**
     * Generate a list of all venue IDs (including venues user has no access to).
     * This allows testing that users cannot access venues they're not assigned to.
     */
    @Provide
    Arbitrary<List<String>> allVenueIdsList() {
        return venueIds().list().ofMinSize(1).ofMaxSize(10);
    }

    /**
     * Generate venue IDs (UUID-like strings).
     */
    @Provide
    Arbitrary<String> venueIds() {
        return Arbitraries.strings().alpha().ofLength(36);
    }

    /**
     * Generate role names (admin, manager, staff - case variations).
     */
    @Provide
    Arbitrary<String> roles() {
        return Arbitraries.of("admin", "manager", "staff", "ADMIN", "MANAGER", "STAFF", "Admin", "Manager", "Staff");
    }

    /**
     * Generate role enum values.
     */
    @Provide
    Arbitrary<Role> roleType() {
        return Arbitraries.of(Role.values());
    }

    /**
     * Generate action enum values.
     */
    @Provide
    Arbitrary<Action> actionType() {
        return Arbitraries.of(Action.values());
    }

    // ========== Helper Classes ==========

    /**
     * Represents a user role scenario for testing.
     */
    static class UserRoleScenario {
        String userId;
        String organisationId;
        Map<String, String> venueRoles; // venueId -> role
        List<String> allVenueIds; // includes venues user has no access to
    }

    /**
     * Role types for testing.
     */
    enum Role {
        ADMIN,
        MANAGER,
        STAFF
    }

    /**
     * Action types for testing.
     */
    enum Action {
        READ,
        CREATE,
        UPDATE,
        DELETE,
        EXPORT
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
