package com.cogschecker.foodcost.api.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;

import java.io.IOException;
import java.time.Instant;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * Unit tests for JwtAuthenticationFilter.
 * Validates: Requirements 8.2, 8.3, 8.4
 */
class JwtAuthenticationFilterTest {

    @Mock
    private JwtDecoder jwtDecoder;

    @Mock
    private FilterChain filterChain;

    private CognitoJwtConverter jwtConverter;
    private JwtAuthenticationFilter filter;

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);
        jwtConverter = new CognitoJwtConverter(new ObjectMapper());
        filter = new JwtAuthenticationFilter(jwtDecoder, jwtConverter);
        SecurityContextHolder.clearContext();
    }

    @Test
    void doFilterInternal_WithValidToken_ShouldSetAuthentication() throws ServletException, IOException {
        // Arrange
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer valid-token");
        MockHttpServletResponse response = new MockHttpServletResponse();

        Jwt jwt = createValidJwt();
        when(jwtDecoder.decode("valid-token")).thenReturn(jwt);

        // Act
        filter.doFilterInternal(request, response, filterChain);

        // Assert
        verify(filterChain).doFilter(request, response);
        assertNotNull(SecurityContextHolder.getContext().getAuthentication());
        assertTrue(SecurityContextHolder.getContext().getAuthentication() instanceof CognitoAuthenticationToken);

        CognitoAuthenticationToken token = (CognitoAuthenticationToken) SecurityContextHolder.getContext().getAuthentication();
        assertEquals("user-123", token.getUserId());
        assertEquals("user@example.com", token.getEmail());
        assertEquals("org-456", token.getOrganisationId());
        assertEquals("pro", token.getTier());
    }

    @Test
    void doFilterInternal_WithInvalidToken_ShouldNotSetAuthentication() throws ServletException, IOException {
        // Arrange
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer invalid-token");
        MockHttpServletResponse response = new MockHttpServletResponse();

        when(jwtDecoder.decode("invalid-token")).thenThrow(new JwtException("Invalid token"));

        // Act
        filter.doFilterInternal(request, response, filterChain);

        // Assert
        verify(filterChain).doFilter(request, response);
        assertNull(SecurityContextHolder.getContext().getAuthentication());
    }

    @Test
    void doFilterInternal_WithNoAuthorizationHeader_ShouldNotSetAuthentication() throws ServletException, IOException {
        // Arrange
        MockHttpServletRequest request = new MockHttpServletRequest();
        MockHttpServletResponse response = new MockHttpServletResponse();

        // Act
        filter.doFilterInternal(request, response, filterChain);

        // Assert
        verify(filterChain).doFilter(request, response);
        verify(jwtDecoder, never()).decode(anyString());
        assertNull(SecurityContextHolder.getContext().getAuthentication());
    }

    @Test
    void doFilterInternal_WithInvalidAuthorizationHeaderFormat_ShouldNotSetAuthentication() throws ServletException, IOException {
        // Arrange
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "InvalidFormat token");
        MockHttpServletResponse response = new MockHttpServletResponse();

        // Act
        filter.doFilterInternal(request, response, filterChain);

        // Assert
        verify(filterChain).doFilter(request, response);
        verify(jwtDecoder, never()).decode(anyString());
        assertNull(SecurityContextHolder.getContext().getAuthentication());
    }

    @Test
    void doFilterInternal_WithEmptyBearerToken_ShouldNotSetAuthentication() throws ServletException, IOException {
        // Arrange
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer ");
        MockHttpServletResponse response = new MockHttpServletResponse();

        // Act
        filter.doFilterInternal(request, response, filterChain);

        // Assert
        verify(filterChain).doFilter(request, response);
        verify(jwtDecoder, never()).decode(anyString());
        assertNull(SecurityContextHolder.getContext().getAuthentication());
    }

    @Test
    void doFilterInternal_WithExpiredToken_ShouldNotSetAuthentication() throws ServletException, IOException {
        // Arrange
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer expired-token");
        MockHttpServletResponse response = new MockHttpServletResponse();

        when(jwtDecoder.decode("expired-token")).thenThrow(new JwtException("Token expired"));

        // Act
        filter.doFilterInternal(request, response, filterChain);

        // Assert
        verify(filterChain).doFilter(request, response);
        assertNull(SecurityContextHolder.getContext().getAuthentication());
    }

    @Test
    void doFilterInternal_WithValidToken_ShouldExtractCustomClaims() throws ServletException, IOException {
        // Arrange
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer valid-token");
        MockHttpServletResponse response = new MockHttpServletResponse();

        Map<String, Object> claims = Map.of(
                "sub", "user-789",
                "email", "admin@example.com",
                "custom:org_id", "org-999",
                "custom:venue_roles", "{\"venue-1\":\"admin\",\"venue-2\":\"manager\",\"venue-3\":\"staff\"}",
                "custom:tier", "pro_plus"
        );

        Jwt jwt = new Jwt(
                "valid-token",
                Instant.now(),
                Instant.now().plusSeconds(3600),
                Map.of("alg", "RS256"),
                claims
        );

        when(jwtDecoder.decode("valid-token")).thenReturn(jwt);

        // Act
        filter.doFilterInternal(request, response, filterChain);

        // Assert
        CognitoAuthenticationToken token = (CognitoAuthenticationToken) SecurityContextHolder.getContext().getAuthentication();
        assertNotNull(token);
        assertEquals("user-789", token.getUserId());
        assertEquals("admin@example.com", token.getEmail());
        assertEquals("org-999", token.getOrganisationId());
        assertEquals("pro_plus", token.getTier());
        assertEquals(3, token.getVenueRoles().size());
        assertEquals("admin", token.getRoleForVenue("venue-1"));
        assertEquals("manager", token.getRoleForVenue("venue-2"));
        assertEquals("staff", token.getRoleForVenue("venue-3"));
    }

    /**
     * Helper method to create a valid test JWT.
     */
    private Jwt createValidJwt() {
        Map<String, Object> claims = Map.of(
                "sub", "user-123",
                "email", "user@example.com",
                "custom:org_id", "org-456",
                "custom:venue_roles", "{\"venue-1\":\"admin\"}",
                "custom:tier", "pro"
        );

        return new Jwt(
                "valid-token",
                Instant.now(),
                Instant.now().plusSeconds(3600),
                Map.of("alg", "RS256"),
                claims
        );
    }
}
