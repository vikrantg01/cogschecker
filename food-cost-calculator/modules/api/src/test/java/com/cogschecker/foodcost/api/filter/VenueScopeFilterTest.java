package com.cogschecker.foodcost.api.filter;

import com.cogschecker.foodcost.api.security.CognitoAuthenticationToken;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.servlet.HandlerMapping;

import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for VenueScopeFilter.
 * Requirements: 7.2, 10.3 - Venue data isolation
 */
class VenueScopeFilterTest {

    private VenueScopeFilter filter;
    private HttpServletRequest request;
    private HttpServletResponse response;
    private FilterChain filterChain;
    private StringWriter responseWriter;

    @BeforeEach
    void setUp() throws IOException {
        filter = new VenueScopeFilter();
        request = mock(HttpServletRequest.class);
        response = mock(HttpServletResponse.class);
        filterChain = mock(FilterChain.class);
        
        responseWriter = new StringWriter();
        PrintWriter printWriter = new PrintWriter(responseWriter);
        when(response.getWriter()).thenReturn(printWriter);
        
        // Clear SecurityContext before each test
        SecurityContextHolder.clearContext();
    }

    @Test
    void shouldAllowAccessWhenVenueIdBelongsToUser() throws ServletException, IOException {
        // Arrange
        String venueId = "venue-123";
        String orgId = "org-456";
        
        Map<String, String> venueRoles = Map.of(venueId, "manager");
        CognitoAuthenticationToken auth = new CognitoAuthenticationToken(
            "user-1",
            "user@example.com",
            orgId,
            venueRoles,
            "pro",
            Collections.singletonList(new SimpleGrantedAuthority("ROLE_VENUE_" + venueId + "_MANAGER"))
        );
        
        SecurityContextHolder.getContext().setAuthentication(auth);
        
        Map<String, String> pathVariables = new HashMap<>();
        pathVariables.put("venueId", venueId);
        when(request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE)).thenReturn(pathVariables);
        
        // Act
        filter.doFilterInternal(request, response, filterChain);
        
        // Assert
        verify(filterChain).doFilter(request, response);
        verify(response, never()).setStatus(HttpServletResponse.SC_FORBIDDEN);
    }

    @Test
    void shouldReturn403WhenVenueIdDoesNotBelongToUser() throws ServletException, IOException {
        // Arrange
        String requestedVenueId = "venue-999";
        String userVenueId = "venue-123";
        String orgId = "org-456";
        
        Map<String, String> venueRoles = Map.of(userVenueId, "manager");
        CognitoAuthenticationToken auth = new CognitoAuthenticationToken(
            "user-1",
            "user@example.com",
            orgId,
            venueRoles,
            "pro",
            Collections.singletonList(new SimpleGrantedAuthority("ROLE_VENUE_" + userVenueId + "_MANAGER"))
        );
        
        SecurityContextHolder.getContext().setAuthentication(auth);
        
        Map<String, String> pathVariables = new HashMap<>();
        pathVariables.put("venueId", requestedVenueId);
        when(request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE)).thenReturn(pathVariables);
        
        // Act
        filter.doFilterInternal(request, response, filterChain);
        
        // Assert
        verify(response).setStatus(HttpServletResponse.SC_FORBIDDEN);
        verify(response).setContentType("application/json");
        verify(filterChain, never()).doFilter(request, response);
        
        String responseBody = responseWriter.toString();
        assertTrue(responseBody.contains("Forbidden"));
        assertTrue(responseBody.contains("You do not have access to this venue"));
    }

    @Test
    void shouldContinueWhenNoVenueIdInPath() throws ServletException, IOException {
        // Arrange
        String orgId = "org-456";
        Map<String, String> venueRoles = Map.of("venue-123", "manager");
        CognitoAuthenticationToken auth = new CognitoAuthenticationToken(
            "user-1",
            "user@example.com",
            orgId,
            venueRoles,
            "pro",
            Collections.singletonList(new SimpleGrantedAuthority("ROLE_VENUE_venue-123_MANAGER"))
        );
        
        SecurityContextHolder.getContext().setAuthentication(auth);
        
        // No path variables
        when(request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE)).thenReturn(null);
        
        // Act
        filter.doFilterInternal(request, response, filterChain);
        
        // Assert
        verify(filterChain).doFilter(request, response);
        verify(response, never()).setStatus(HttpServletResponse.SC_FORBIDDEN);
    }

    @Test
    void shouldContinueWhenNoAuthentication() throws ServletException, IOException {
        // Arrange
        Map<String, String> pathVariables = new HashMap<>();
        pathVariables.put("venueId", "venue-123");
        when(request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE)).thenReturn(pathVariables);
        
        // No authentication in SecurityContext
        
        // Act
        filter.doFilterInternal(request, response, filterChain);
        
        // Assert
        verify(filterChain).doFilter(request, response);
        verify(response, never()).setStatus(HttpServletResponse.SC_FORBIDDEN);
    }

    @Test
    void shouldContinueWhenAuthenticationIsNotCognitoType() throws ServletException, IOException {
        // Arrange
        Map<String, String> pathVariables = new HashMap<>();
        pathVariables.put("venueId", "venue-123");
        when(request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE)).thenReturn(pathVariables);
        
        // Set a different authentication type
        org.springframework.security.authentication.UsernamePasswordAuthenticationToken otherAuth = 
            new org.springframework.security.authentication.UsernamePasswordAuthenticationToken("user", "pass");
        SecurityContextHolder.getContext().setAuthentication(otherAuth);
        
        // Act
        filter.doFilterInternal(request, response, filterChain);
        
        // Assert
        verify(filterChain).doFilter(request, response);
        verify(response, never()).setStatus(HttpServletResponse.SC_FORBIDDEN);
    }

    @Test
    void shouldAllowAccessWhenUserHasMultipleVenues() throws ServletException, IOException {
        // Arrange
        String venueId1 = "venue-123";
        String venueId2 = "venue-456";
        String orgId = "org-789";
        
        Map<String, String> venueRoles = Map.of(
            venueId1, "manager",
            venueId2, "admin"
        );
        
        CognitoAuthenticationToken auth = new CognitoAuthenticationToken(
            "user-1",
            "user@example.com",
            orgId,
            venueRoles,
            "pro",
            Collections.emptyList()
        );
        
        SecurityContextHolder.getContext().setAuthentication(auth);
        
        Map<String, String> pathVariables = new HashMap<>();
        pathVariables.put("venueId", venueId2);
        when(request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE)).thenReturn(pathVariables);
        
        // Act
        filter.doFilterInternal(request, response, filterChain);
        
        // Assert
        verify(filterChain).doFilter(request, response);
        verify(response, never()).setStatus(HttpServletResponse.SC_FORBIDDEN);
    }

    @Test
    void shouldReturn403WhenVenueIdInPathButUserHasNoVenues() throws ServletException, IOException {
        // Arrange
        String requestedVenueId = "venue-999";
        String orgId = "org-456";
        
        Map<String, String> venueRoles = Collections.emptyMap();
        CognitoAuthenticationToken auth = new CognitoAuthenticationToken(
            "user-1",
            "user@example.com",
            orgId,
            venueRoles,
            "free",
            Collections.emptyList()
        );
        
        SecurityContextHolder.getContext().setAuthentication(auth);
        
        Map<String, String> pathVariables = new HashMap<>();
        pathVariables.put("venueId", requestedVenueId);
        when(request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE)).thenReturn(pathVariables);
        
        // Act
        filter.doFilterInternal(request, response, filterChain);
        
        // Assert
        verify(response).setStatus(HttpServletResponse.SC_FORBIDDEN);
        verify(filterChain, never()).doFilter(request, response);
    }
}
