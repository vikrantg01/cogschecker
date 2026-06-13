package com.cogschecker.foodcost.api.filter;

import com.amazonaws.xray.AWSXRay;
import com.amazonaws.xray.entities.Segment;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;

/**
 * Filter that extracts or generates a correlation ID for request tracing.
 * 
 * The correlation ID is:
 * - Extracted from the X-Request-ID header if present
 * - Generated as a new UUID if not present
 * - Added to the MDC for structured logging
 * - Added to the AWS X-Ray trace annotations
 * - Returned in the response X-Request-ID header
 * 
 * This filter runs first in the filter chain to ensure correlation ID is available
 * for all subsequent filters and controllers.
 */
@Component
@Order(1) // Run this filter first
public class CorrelationIdFilter extends OncePerRequestFilter {
    
    private static final Logger logger = LoggerFactory.getLogger(CorrelationIdFilter.class);
    private static final String CORRELATION_ID_HEADER = "X-Request-ID";
    private static final String CORRELATION_ID_MDC_KEY = "correlationId";
    private static final String XRAY_TRACE_ID_MDC_KEY = "xrayTraceId";
    
    @Override
    protected void doFilterInternal(HttpServletRequest request, 
                                    HttpServletResponse response, 
                                    FilterChain filterChain) throws ServletException, IOException {
        try {
            // Extract or generate correlation ID
            String correlationId = request.getHeader(CORRELATION_ID_HEADER);
            if (correlationId == null || correlationId.trim().isEmpty()) {
                correlationId = UUID.randomUUID().toString();
            }
            
            // Add to MDC for structured logging
            MDC.put(CORRELATION_ID_MDC_KEY, correlationId);
            
            // Add correlation ID to X-Ray trace if available
            try {
                Segment segment = AWSXRay.getCurrentSegmentOptional().orElse(null);
                if (segment != null) {
                    segment.putAnnotation(CORRELATION_ID_MDC_KEY, correlationId);
                    
                    // Also add X-Ray trace ID to MDC for cross-referencing
                    String traceId = segment.getTraceId().toString();
                    MDC.put(XRAY_TRACE_ID_MDC_KEY, traceId);
                }
            } catch (Exception e) {
                // X-Ray not available or disabled - continue without it
                logger.debug("X-Ray segment not available, skipping trace annotation", e);
            }
            
            // Add correlation ID to response headers
            response.setHeader(CORRELATION_ID_HEADER, correlationId);
            
            // Extract additional context for logging
            MDC.put("requestUri", request.getRequestURI());
            MDC.put("requestMethod", request.getMethod());
            
            logger.debug("Request received: {} {}", request.getMethod(), request.getRequestURI());
            
            // Continue filter chain
            filterChain.doFilter(request, response);
            
            // Add response status to MDC for logging
            MDC.put("responseStatus", String.valueOf(response.getStatus()));
            
            logger.debug("Request completed: {} {} - Status: {}", 
                        request.getMethod(), request.getRequestURI(), response.getStatus());
            
        } finally {
            // Always clear MDC to prevent memory leaks and cross-request contamination
            MDC.clear();
        }
    }
}
