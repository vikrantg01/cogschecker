package com.cogschecker.foodcost.api.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for CognitoJwtConverter.
 * Validates: Requirements 8.2, 8.3, 8.4
 */
class CognitoJwtConverterTest {

    private CognitoJwtConverter converter;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        converter = new CognitoJwtConverter(objectMapper);
    }

    @Test
    void convert_WithValidClaims_ShouldExtractAllFields() {
        // Arrange
        Map<String, Object> claims = new HashMap<>();
        claims.put("sub", "user-123");
        claims.put("email", "user@example.com");
        claims.put("custom:org_id", "org-456");
        claims.put("custom:venue_roles", "{\"venue-1\":\"admin\",\"venue-2\":\"manager\"}");
        claims.put("custom:tier", "pro");

        Jwt jwt = createJwt(claims);

        // Act
        CognitoAuthenticationToken token = converter.convert(jwt);

        // Assert
        assertNotNull(token);
        assertEquals("user-123", token.getUserId());
        assertEquals("user@example.com", token.getEmail());
        assertEquals("org-456", token.getOrganisationId());
        assertEquals("pro", token.getTier());
        assertEquals(2, token.getVenueRoles().size());
        assertEquals("admin", token.getRoleForVenue("venue-1"));
        assertEquals("manager", token.getRoleForVenue("venue-2"));
        assertTrue(token.isAuthenticated());
    }

    @Test
    void convert_WithValidVenueRoles_ShouldBuildAuthorities() {
        // Arrange
        Map<String, Object> claims = new HashMap<>();
        claims.put("sub", "user-123");
        claims.put("email", "user@example.com");
        claims.put("custom:org_id", "org-456");
        claims.put("custom:venue_roles", "{\"venue-1\":\"admin\",\"venue-2\":\"staff\"}");
        claims.put("custom:tier", "free");

        Jwt jwt = createJwt(claims);

        // Act
        CognitoAuthenticationToken token = converter.convert(jwt);

        // Assert
        assertNotNull(token.getAuthorities());
        assertEquals(2, token.getAuthorities().size());

        assertTrue(token.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .anyMatch(auth -> auth.equals("ROLE_VENUE_venue-1_ADMIN")));

        assertTrue(token.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .anyMatch(auth -> auth.equals("ROLE_VENUE_venue-2_STAFF")));
    }

    @Test
    void convert_WithNoVenueRoles_ShouldReturnEmptyAuthorities() {
        // Arrange
        Map<String, Object> claims = new HashMap<>();
        claims.put("sub", "user-123");
        claims.put("email", "user@example.com");
        claims.put("custom:org_id", "org-456");
        claims.put("custom:venue_roles", "{}");
        claims.put("custom:tier", "free");

        Jwt jwt = createJwt(claims);

        // Act
        CognitoAuthenticationToken token = converter.convert(jwt);

        // Assert
        assertNotNull(token);
        assertTrue(token.getVenueRoles().isEmpty());
        assertTrue(token.getAuthorities().isEmpty());
    }

    @Test
    void convert_WithInvalidVenueRolesJson_ShouldReturnEmptyRoles() {
        // Arrange
        Map<String, Object> claims = new HashMap<>();
        claims.put("sub", "user-123");
        claims.put("email", "user@example.com");
        claims.put("custom:org_id", "org-456");
        claims.put("custom:venue_roles", "invalid-json");
        claims.put("custom:tier", "free");

        Jwt jwt = createJwt(claims);

        // Act
        CognitoAuthenticationToken token = converter.convert(jwt);

        // Assert
        assertNotNull(token);
        assertTrue(token.getVenueRoles().isEmpty());
        assertTrue(token.getAuthorities().isEmpty());
    }

    @Test
    void convert_WithNullVenueRoles_ShouldReturnEmptyRoles() {
        // Arrange
        Map<String, Object> claims = new HashMap<>();
        claims.put("sub", "user-123");
        claims.put("email", "user@example.com");
        claims.put("custom:org_id", "org-456");
        claims.put("custom:tier", "free");
        // No venue_roles claim

        Jwt jwt = createJwt(claims);

        // Act
        CognitoAuthenticationToken token = converter.convert(jwt);

        // Assert
        assertNotNull(token);
        assertTrue(token.getVenueRoles().isEmpty());
        assertTrue(token.getAuthorities().isEmpty());
    }

    @Test
    void cognitoAuthenticationToken_HasAccessToVenue_ShouldReturnCorrectly() {
        // Arrange
        Map<String, Object> claims = new HashMap<>();
        claims.put("sub", "user-123");
        claims.put("email", "user@example.com");
        claims.put("custom:org_id", "org-456");
        claims.put("custom:venue_roles", "{\"venue-1\":\"admin\"}");
        claims.put("custom:tier", "pro");

        Jwt jwt = createJwt(claims);
        CognitoAuthenticationToken token = converter.convert(jwt);

        // Act & Assert
        assertTrue(token.hasAccessToVenue("venue-1"));
        assertFalse(token.hasAccessToVenue("venue-2"));
    }

    @Test
    void cognitoAuthenticationToken_GetRoleForVenue_ShouldReturnCorrectRole() {
        // Arrange
        Map<String, Object> claims = new HashMap<>();
        claims.put("sub", "user-123");
        claims.put("email", "user@example.com");
        claims.put("custom:org_id", "org-456");
        claims.put("custom:venue_roles", "{\"venue-1\":\"manager\",\"venue-2\":\"staff\"}");
        claims.put("custom:tier", "pro");

        Jwt jwt = createJwt(claims);
        CognitoAuthenticationToken token = converter.convert(jwt);

        // Act & Assert
        assertEquals("manager", token.getRoleForVenue("venue-1"));
        assertEquals("staff", token.getRoleForVenue("venue-2"));
        assertNull(token.getRoleForVenue("venue-3"));
    }

    /**
     * Helper method to create a test JWT with given claims.
     */
    private Jwt createJwt(Map<String, Object> claims) {
        return new Jwt(
                "test-token",
                Instant.now(),
                Instant.now().plusSeconds(3600),
                Map.of("alg", "RS256"),
                claims
        );
    }
}
