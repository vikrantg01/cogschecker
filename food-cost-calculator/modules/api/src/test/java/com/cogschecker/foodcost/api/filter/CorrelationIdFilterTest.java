package com.cogschecker.foodcost.api.filter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.io.IOException;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

/**
 * Unit tests for CorrelationIdFilter.
 * 
 * Verifies that:
 * - Correlation IDs are extracted from X-Request-ID header
 * - New correlation IDs are generated when header is missing
 * - Correlation IDs are added to MDC for logging
 * - Correlation IDs are returned in response headers
 * - MDC is properly cleaned up after request processing
 */
class CorrelationIdFilterTest {
    
    private CorrelationIdFilter filter;
    private MockHttpServletRequest request;
    private MockHttpServletResponse response;
    private FilterChain filterChain;
    
    @BeforeEach
    void setUp() {
        filter = new CorrelationIdFilter();
        request = new MockHttpServletRequest();
        response = new MockHttpServletResponse();
        filterChain = mock(FilterChain.class);
        
        // Clear MDC before each test
        MDC.clear();
    }
    
    @AfterEach
    void tearDown() {
        // Ensure MDC is cleared after each test
        MDC.clear();
    }
    
    @Test
    void shouldExtractCorrelationIdFromHeader() throws ServletException, IOException {
        // Given
        String expectedCorrelationId = UUID.randomUUID().toString();
        request.addHeader("X-Request-ID", expectedCorrelationId);
        request.setRequestURI("/api/v1/ingredients");
        request.setMethod("GET");
        
        // When
        filter.doFilterInternal(request, response, filterChain);
        
        // Then
        assertThat(response.getHeader("X-Request-ID")).isEqualTo(expectedCorrelationId);
        verify(filterChain, times(1)).doFilter(request, response);
    }
    
    @Test
    void shouldGenerateCorrelationIdWhenHeaderMissing() throws ServletException, IOException {
        // Given
        request.setRequestURI("/api/v1/recipes");
        request.setMethod("POST");
        
        // When
        filter.doFilterInternal(request, response, filterChain);
        
        // Then
        String correlationId = response.getHeader("X-Request-ID");
        assertThat(correlationId).isNotNull();
        assertThat(correlationId).matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
        verify(filterChain, times(1)).doFilter(request, response);
    }
    
    @Test
    void shouldGenerateNewIdWhenHeaderIsEmpty() throws ServletException, IOException {
        // Given
        request.addHeader("X-Request-ID", "");
        request.setRequestURI("/api/v1/venues");
        request.setMethod("GET");
        
        // When
        filter.doFilterInternal(request, response, filterChain);
        
        // Then
        String correlationId = response.getHeader("X-Request-ID");
        assertThat(correlationId).isNotNull();
        assertThat(correlationId).isNotEmpty();
        verify(filterChain, times(1)).doFilter(request, response);
    }
    
    @Test
    void shouldAddRequestContextToMDCDuringProcessing() throws ServletException, IOException {
        // Given
        String expectedCorrelationId = UUID.randomUUID().toString();
        request.addHeader("X-Request-ID", expectedCorrelationId);
        request.setRequestURI("/api/v1/ingredients/123");
        request.setMethod("PATCH");
        
        // When
        doAnswer(invocation -> {
            // During filter chain execution, MDC should contain request context
            assertThat(MDC.get("correlationId")).isEqualTo(expectedCorrelationId);
            assertThat(MDC.get("requestUri")).isEqualTo("/api/v1/ingredients/123");
            assertThat(MDC.get("requestMethod")).isEqualTo("PATCH");
            return null;
        }).when(filterChain).doFilter(request, response);
        
        filter.doFilterInternal(request, response, filterChain);
        
        // Then
        verify(filterChain, times(1)).doFilter(request, response);
    }
    
    @Test
    void shouldClearMDCAfterRequestProcessing() throws ServletException, IOException {
        // Given
        String correlationId = UUID.randomUUID().toString();
        request.addHeader("X-Request-ID", correlationId);
        request.setRequestURI("/api/v1/recipes");
        request.setMethod("GET");
        
        // When
        filter.doFilterInternal(request, response, filterChain);
        
        // Then - MDC should be cleared after filter execution
        assertThat(MDC.get("correlationId")).isNull();
        assertThat(MDC.get("requestUri")).isNull();
        assertThat(MDC.get("requestMethod")).isNull();
        assertThat(MDC.get("responseStatus")).isNull();
    }
    
    @Test
    void shouldClearMDCEvenWhenFilterChainThrowsException() {
        // Given
        String correlationId = UUID.randomUUID().toString();
        request.addHeader("X-Request-ID", correlationId);
        request.setRequestURI("/api/v1/error");
        request.setMethod("GET");
        
        try {
            // When
            doThrow(new ServletException("Test exception"))
                .when(filterChain).doFilter(request, response);
            
            filter.doFilterInternal(request, response, filterChain);
        } catch (Exception e) {
            // Expected exception
        }
        
        // Then - MDC should still be cleared even after exception
        assertThat(MDC.get("correlationId")).isNull();
        assertThat(MDC.get("requestUri")).isNull();
    }
}
