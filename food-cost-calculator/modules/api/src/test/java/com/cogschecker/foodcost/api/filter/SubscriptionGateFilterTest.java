package com.cogschecker.foodcost.api.filter;

import com.cogschecker.foodcost.api.security.CognitoAuthenticationToken;
import com.cogschecker.foodcost.api.security.RequiresTier;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerExecutionChain;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.lang.reflect.Method;
import java.util.Collections;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for SubscriptionGateFilter.
 * Requirements: 11.2, 11.3 - Subscription tier enforcement
 */
class SubscriptionGateFilterTest {

    private SubscriptionGateFilter filter;
    private RequestMappingHandlerMapping handlerMapping;
    private ObjectMapper objectMapper;
    private HttpServletRequest request;
    private HttpServletResponse response;
    private FilterChain filterChain;
    private StringWriter responseWriter;

    @BeforeEach
    void setUp() throws IOException {
        handlerMapping = mock(RequestMappingHandlerMapping.class);
        objectMapper = new ObjectMapper();
        filter = new SubscriptionGateFilter(handlerMapping, objectMapper);
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
    void shouldAllowAccessWhenUserHasRequiredTier() throws Exception {
        // Arrange
        CognitoAuthenticationToken auth = createAuthToken("pro");
        SecurityContextHolder.getContext().setAuthentication(auth);
        
        HandlerMethod handlerMethod = createHandlerMethodWithTier("pro");
        when(handlerMapping.getHandler(request)).thenReturn(new HandlerExecutionChain(handlerMethod));
        
        // Act
        filter.doFilterInternal(request, response, filterChain);
        
        // Assert
        verify(filterChain).doFilter(request, response);
        verify(response, never()).setStatus(HttpServletResponse.SC_PAYMENT_REQUIRED);
    }

    @Test
    void shouldAllowAccessWhenUserHasHigherTierThanRequired() throws Exception {
        // Arrange - user has pro_plus, endpoint requires pro
        CognitoAuthenticationToken auth = createAuthToken("pro_plus");
        SecurityContextHolder.getContext().setAuthentication(auth);
        
        HandlerMethod handlerMethod = createHandlerMethodWithTier("pro");
        when(handlerMapping.getHandler(request)).thenReturn(new HandlerExecutionChain(handlerMethod));
        
        // Act
        filter.doFilterInternal(request, response, filterChain);
        
        // Assert
        verify(filterChain).doFilter(request, response);
        verify(response, never()).setStatus(HttpServletResponse.SC_PAYMENT_REQUIRED);
    }

    @Test
    void shouldReturn402WhenUserTierIsInsufficient() throws Exception {
        // Arrange - user has free, endpoint requires pro
        CognitoAuthenticationToken auth = createAuthToken("free");
        SecurityContextHolder.getContext().setAuthentication(auth);
        
        HandlerMethod handlerMethod = createHandlerMethodWithTier("pro");
        when(handlerMapping.getHandler(request)).thenReturn(new HandlerExecutionChain(handlerMethod));
        
        // Act
        filter.doFilterInternal(request, response, filterChain);
        
        // Assert
        verify(response).setStatus(HttpServletResponse.SC_PAYMENT_REQUIRED); // 402
        verify(response).setContentType("application/json");
        verify(filterChain, never()).doFilter(request, response);
        
        String responseBody = responseWriter.toString();
        assertTrue(responseBody.contains("Payment Required"));
        assertTrue(responseBody.contains("pro"));
        assertTrue(responseBody.contains("upgrade"));
    }

    @Test
    void shouldReturn402WhenFreeTierTriesToAccessProPlusFeature() throws Exception {
        // Arrange
        CognitoAuthenticationToken auth = createAuthToken("free");
        SecurityContextHolder.getContext().setAuthentication(auth);
        
        HandlerMethod handlerMethod = createHandlerMethodWithTier("pro_plus");
        when(handlerMapping.getHandler(request)).thenReturn(new HandlerExecutionChain(handlerMethod));
        
        // Act
        filter.doFilterInternal(request, response, filterChain);
        
        // Assert
        verify(response).setStatus(HttpServletResponse.SC_PAYMENT_REQUIRED);
        verify(filterChain, never()).doFilter(request, response);
        
        String responseBody = responseWriter.toString();
        assertTrue(responseBody.contains("pro_plus"));
        assertTrue(responseBody.contains("AI-driven insights"));
    }

    @Test
    void shouldReturn402WhenProTierTriesToAccessProPlusFeature() throws Exception {
        // Arrange
        CognitoAuthenticationToken auth = createAuthToken("pro");
        SecurityContextHolder.getContext().setAuthentication(auth);
        
        HandlerMethod handlerMethod = createHandlerMethodWithTier("pro_plus");
        when(handlerMapping.getHandler(request)).thenReturn(new HandlerExecutionChain(handlerMethod));
        
        // Act
        filter.doFilterInternal(request, response, filterChain);
        
        // Assert
        verify(response).setStatus(HttpServletResponse.SC_PAYMENT_REQUIRED);
        verify(filterChain, never()).doFilter(request, response);
    }

    @Test
    void shouldContinueWhenNoRequiresTierAnnotation() throws Exception {
        // Arrange
        CognitoAuthenticationToken auth = createAuthToken("free");
        SecurityContextHolder.getContext().setAuthentication(auth);
        
        HandlerMethod handlerMethod = createHandlerMethodWithoutTier();
        when(handlerMapping.getHandler(request)).thenReturn(new HandlerExecutionChain(handlerMethod));
        
        // Act
        filter.doFilterInternal(request, response, filterChain);
        
        // Assert
        verify(filterChain).doFilter(request, response);
        verify(response, never()).setStatus(HttpServletResponse.SC_PAYMENT_REQUIRED);
    }

    @Test
    void shouldContinueWhenNoAuthentication() throws Exception {
        // Arrange
        HandlerMethod handlerMethod = createHandlerMethodWithTier("pro");
        when(handlerMapping.getHandler(request)).thenReturn(new HandlerExecutionChain(handlerMethod));
        
        // No authentication in SecurityContext
        
        // Act
        filter.doFilterInternal(request, response, filterChain);
        
        // Assert
        verify(filterChain).doFilter(request, response);
        verify(response, never()).setStatus(HttpServletResponse.SC_PAYMENT_REQUIRED);
    }

    @Test
    void shouldContinueWhenAuthenticationIsNotCognitoType() throws Exception {
        // Arrange
        org.springframework.security.authentication.UsernamePasswordAuthenticationToken otherAuth = 
            new org.springframework.security.authentication.UsernamePasswordAuthenticationToken("user", "pass");
        SecurityContextHolder.getContext().setAuthentication(otherAuth);
        
        HandlerMethod handlerMethod = createHandlerMethodWithTier("pro");
        when(handlerMapping.getHandler(request)).thenReturn(new HandlerExecutionChain(handlerMethod));
        
        // Act
        filter.doFilterInternal(request, response, filterChain);
        
        // Assert
        verify(filterChain).doFilter(request, response);
        verify(response, never()).setStatus(HttpServletResponse.SC_PAYMENT_REQUIRED);
    }

    @Test
    void shouldContinueWhenNoHandlerMethodFound() throws Exception {
        // Arrange
        CognitoAuthenticationToken auth = createAuthToken("free");
        SecurityContextHolder.getContext().setAuthentication(auth);
        
        when(handlerMapping.getHandler(request)).thenReturn(null);
        
        // Act
        filter.doFilterInternal(request, response, filterChain);
        
        // Assert
        verify(filterChain).doFilter(request, response);
        verify(response, never()).setStatus(HttpServletResponse.SC_PAYMENT_REQUIRED);
    }

    @Test
    void shouldHandleNullUserTierAsFreeTier() throws Exception {
        // Arrange
        CognitoAuthenticationToken auth = createAuthToken(null);
        SecurityContextHolder.getContext().setAuthentication(auth);
        
        HandlerMethod handlerMethod = createHandlerMethodWithTier("pro");
        when(handlerMapping.getHandler(request)).thenReturn(new HandlerExecutionChain(handlerMethod));
        
        // Act
        filter.doFilterInternal(request, response, filterChain);
        
        // Assert
        verify(response).setStatus(HttpServletResponse.SC_PAYMENT_REQUIRED);
        verify(filterChain, never()).doFilter(request, response);
    }

    @Test
    void shouldIncludeUpgradePathInResponse() throws Exception {
        // Arrange
        CognitoAuthenticationToken auth = createAuthToken("free");
        SecurityContextHolder.getContext().setAuthentication(auth);
        
        HandlerMethod handlerMethod = createHandlerMethodWithTier("pro");
        when(handlerMapping.getHandler(request)).thenReturn(new HandlerExecutionChain(handlerMethod));
        
        // Act
        filter.doFilterInternal(request, response, filterChain);
        
        // Assert
        String responseBody = responseWriter.toString();
        assertTrue(responseBody.contains("upgrade"));
        assertTrue(responseBody.contains("/api/v1/organisations/subscription/upgrade"));
    }

    @Test
    void shouldIncludeCurrentAndRequiredTierInResponse() throws Exception {
        // Arrange
        CognitoAuthenticationToken auth = createAuthToken("free");
        SecurityContextHolder.getContext().setAuthentication(auth);
        
        HandlerMethod handlerMethod = createHandlerMethodWithTier("pro");
        when(handlerMapping.getHandler(request)).thenReturn(new HandlerExecutionChain(handlerMethod));
        
        // Act
        filter.doFilterInternal(request, response, filterChain);
        
        // Assert
        String responseBody = responseWriter.toString();
        assertTrue(responseBody.contains("\"currentTier\":\"free\""));
        assertTrue(responseBody.contains("\"requiredTier\":\"pro\""));
    }

    @Test
    void shouldAllowFreeTierEndpointsForAllUsers() throws Exception {
        // Arrange - free tier user accessing free tier endpoint
        CognitoAuthenticationToken auth = createAuthToken("free");
        SecurityContextHolder.getContext().setAuthentication(auth);
        
        HandlerMethod handlerMethod = createHandlerMethodWithTier("free");
        when(handlerMapping.getHandler(request)).thenReturn(new HandlerExecutionChain(handlerMethod));
        
        // Act
        filter.doFilterInternal(request, response, filterChain);
        
        // Assert
        verify(filterChain).doFilter(request, response);
        verify(response, never()).setStatus(HttpServletResponse.SC_PAYMENT_REQUIRED);
    }

    // Helper methods

    private CognitoAuthenticationToken createAuthToken(String tier) {
        Map<String, String> venueRoles = Map.of("venue-123", "manager");
        return new CognitoAuthenticationToken(
            "user-1",
            "user@example.com",
            "org-456",
            venueRoles,
            tier,
            Collections.singletonList(new SimpleGrantedAuthority("ROLE_VENUE_venue-123_MANAGER"))
        );
    }

    private HandlerMethod createHandlerMethodWithTier(String tier) throws NoSuchMethodException {
        TestController controller = new TestController();
        Method method = TestController.class.getMethod("methodWithTier");
        HandlerMethod handlerMethod = new HandlerMethod(controller, method);
        
        // Mock the annotation
        RequiresTier annotation = mock(RequiresTier.class);
        when(annotation.value()).thenReturn(tier);
        
        // Create a spy to override getMethodAnnotation
        HandlerMethod spyHandler = spy(handlerMethod);
        when(spyHandler.getMethodAnnotation(RequiresTier.class)).thenReturn(annotation);
        
        return spyHandler;
    }

    private HandlerMethod createHandlerMethodWithoutTier() throws NoSuchMethodException {
        TestController controller = new TestController();
        Method method = TestController.class.getMethod("methodWithoutTier");
        return new HandlerMethod(controller, method);
    }

    // Test controller for creating HandlerMethods
    @RestController
    static class TestController {
        @GetMapping("/test")
        public void methodWithTier() {
        }

        @GetMapping("/test2")
        public void methodWithoutTier() {
        }
    }
}
