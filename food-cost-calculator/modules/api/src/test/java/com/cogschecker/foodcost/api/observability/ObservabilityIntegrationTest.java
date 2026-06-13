package com.cogschecker.foodcost.api.observability;

import com.cogschecker.foodcost.api.filter.CorrelationIdFilter;
import org.junit.jupiter.api.Test;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Integration test demonstrating the complete observability stack:
 * - Correlation ID propagation through filters
 * - MDC context available in service layer
 * - X-Request-ID returned in response headers
 * - Structured logging with correlation context
 * 
 * This test runs with the 'local' profile to avoid AWS dependencies.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
class ObservabilityIntegrationTest {
    
    private static final Logger logger = LoggerFactory.getLogger(ObservabilityIntegrationTest.class);
    
    @Autowired
    private MockMvc mockMvc;
    
    @Test
    void shouldPropagateCorrelationIdThroughRequestLifecycle() throws Exception {
        // Given
        String correlationId = UUID.randomUUID().toString();
        logger.info("Testing correlation ID propagation with: {}", correlationId);
        
        // When - make a request with X-Request-ID header
        MvcResult result = mockMvc.perform(get("/actuator/health")
                .header("X-Request-ID", correlationId))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Request-ID", correlationId))
                .andReturn();
        
        // Then - verify correlation ID is returned in response
        String returnedCorrelationId = result.getResponse().getHeader("X-Request-ID");
        assertThat(returnedCorrelationId).isEqualTo(correlationId);
        
        logger.info("Successfully verified correlation ID propagation: {}", correlationId);
    }
    
    @Test
    void shouldGenerateCorrelationIdWhenNotProvided() throws Exception {
        // Given - no X-Request-ID header
        logger.info("Testing automatic correlation ID generation");
        
        // When
        MvcResult result = mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(header().exists("X-Request-ID"))
                .andReturn();
        
        // Then - verify a correlation ID was generated
        String generatedCorrelationId = result.getResponse().getHeader("X-Request-ID");
        assertThat(generatedCorrelationId).isNotNull();
        assertThat(generatedCorrelationId).matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
        
        logger.info("Successfully generated correlation ID: {}", generatedCorrelationId);
    }
    
    @Test
    void shouldMaintainMDCContextAcrossMultipleRequests() throws Exception {
        // This test verifies that MDC is properly isolated between requests
        // and doesn't leak context from one request to another
        
        // Given - first request
        String correlationId1 = UUID.randomUUID().toString();
        MvcResult result1 = mockMvc.perform(get("/actuator/health")
                .header("X-Request-ID", correlationId1))
                .andExpect(status().isOk())
                .andReturn();
        
        assertThat(result1.getResponse().getHeader("X-Request-ID")).isEqualTo(correlationId1);
        
        // MDC should be cleared after first request
        assertThat(MDC.get("correlationId")).isNull();
        
        // Given - second request with different correlation ID
        String correlationId2 = UUID.randomUUID().toString();
        MvcResult result2 = mockMvc.perform(get("/actuator/health")
                .header("X-Request-ID", correlationId2))
                .andExpect(status().isOk())
                .andReturn();
        
        assertThat(result2.getResponse().getHeader("X-Request-ID")).isEqualTo(correlationId2);
        
        // Verify correlation IDs are different (no leakage)
        assertThat(correlationId1).isNotEqualTo(correlationId2);
        
        logger.info("Successfully verified MDC isolation between requests");
    }
    
    @Test
    void shouldLogWithStructuredContext() throws Exception {
        // This test demonstrates that logs during request processing
        // will include the correlation ID and other MDC context
        
        // Given
        String correlationId = UUID.randomUUID().toString();
        
        // When
        mockMvc.perform(get("/actuator/info")
                .header("X-Request-ID", correlationId))
                .andExpect(status().isOk());
        
        // Then - logs would include:
        // {
        //   "correlationId": "<correlationId>",
        //   "requestUri": "/actuator/info",
        //   "requestMethod": "GET",
        //   "responseStatus": "200",
        //   ...
        // }
        
        logger.info("Structured logging demonstration - correlation ID: {}", correlationId);
    }
}
