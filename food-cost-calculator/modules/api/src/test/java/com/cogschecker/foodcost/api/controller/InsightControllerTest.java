package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.config.InsightControllerTestConfig;
import com.cogschecker.foodcost.api.domain.AiInsight;
import com.cogschecker.foodcost.api.dto.UpdateInsightStatusRequest;
import com.cogschecker.foodcost.api.exception.ResourceNotFoundException;
import com.cogschecker.foodcost.api.service.InsightService;
import com.cogschecker.foodcost.shared.ErrorCodes;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Unit tests for InsightController REST endpoints.
 * Tests Requirements: 13.1, 13.5, 13.7
 */
@WebMvcTest(controllers = InsightController.class,
        excludeAutoConfiguration = {
                org.springframework.boot.autoconfigure.security.servlet.SecurityAutoConfiguration.class,
                org.springframework.boot.autoconfigure.security.servlet.SecurityFilterAutoConfiguration.class,
                org.springframework.boot.autoconfigure.security.oauth2.resource.servlet.OAuth2ResourceServerAutoConfiguration.class
        })
@Import(InsightControllerTestConfig.class)
class InsightControllerTest {
    
    @Autowired
    private MockMvc mockMvc;
    
    @Autowired
    private ObjectMapper objectMapper;
    
    @MockBean
    private InsightService insightService;
    
    private UUID venueId;
    private UUID insightId;
    private AiInsight testInsight;
    
    @BeforeEach
    void setUp() {
        venueId = UUID.randomUUID();
        insightId = UUID.randomUUID();
        
        Map<String, Object> supportingData = new HashMap<>();
        supportingData.put("recipe_id", UUID.randomUUID().toString());
        supportingData.put("current_food_cost_percentage", 42.5);
        
        testInsight = new AiInsight(
            venueId,
            AiInsight.InsightType.RECIPE_PROFITABILITY,
            "High food cost on Signature Burger",
            "The Signature Burger has a food cost percentage of 42.5%, which is above the target threshold of 30%.",
            supportingData,
            "Consider reducing portion sizes or finding cheaper ingredient suppliers."
        );
        testInsight.setId(insightId);
    }
    
    /**
     * Test GET /venues/:venueId/insights - list all insights.
     * Requirement: 13.1, 13.7 - Get all insights for Pro+ tier
     */
    @Test
    @WithMockUser
    void testGetInsights() throws Exception {
        List<AiInsight> insights = Arrays.asList(testInsight);
        when(insightService.getInsights(venueId)).thenReturn(insights);
        
        mockMvc.perform(get("/api/v1/venues/{venueId}/insights", venueId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$").isArray())
            .andExpect(jsonPath("$[0].id").value(insightId.toString()))
            .andExpect(jsonPath("$[0].venueId").value(venueId.toString()))
            .andExpect(jsonPath("$[0].insightType").value("recipe_profitability"))
            .andExpect(jsonPath("$[0].title").value("High food cost on Signature Burger"))
            .andExpect(jsonPath("$[0].status").value("active"))
            .andExpect(jsonPath("$[0].supportingData.recipe_id").exists())
            .andExpect(jsonPath("$[0].supportingData.current_food_cost_percentage").value(42.5));
        
        verify(insightService, times(1)).getInsights(venueId);
    }
    
    /**
     * Test GET /venues/:venueId/insights - empty list when no insights.
     * Requirement: 13.7
     */
    @Test
    @WithMockUser
    void testGetInsightsEmpty() throws Exception {
        when(insightService.getInsights(venueId)).thenReturn(Arrays.asList());
        
        mockMvc.perform(get("/api/v1/venues/{venueId}/insights", venueId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$").isArray())
            .andExpect(jsonPath("$").isEmpty());
        
        verify(insightService, times(1)).getInsights(venueId);
    }
    
    /**
     * Test PATCH /venues/:venueId/insights/:id/status - mark as actioned.
     * Requirement: 13.5 - Update insight status
     */
    @Test
    @WithMockUser
    void testUpdateInsightStatusToActioned() throws Exception {
        UpdateInsightStatusRequest request = new UpdateInsightStatusRequest("actioned");
        
        AiInsight updatedInsight = new AiInsight(
            testInsight.getVenueId(),
            testInsight.getInsightType(),
            testInsight.getTitle(),
            testInsight.getExplanation(),
            testInsight.getSupportingData(),
            testInsight.getRecommendedAction()
        );
        updatedInsight.setId(insightId);
        updatedInsight.setStatus(AiInsight.Status.ACTIONED);
        
        when(insightService.updateInsightStatus(eq(venueId), eq(insightId), eq(AiInsight.Status.ACTIONED)))
            .thenReturn(updatedInsight);
        
        mockMvc.perform(patch("/api/v1/venues/{venueId}/insights/{id}/status", venueId, insightId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(insightId.toString()))
            .andExpect(jsonPath("$.status").value("actioned"));
        
        verify(insightService, times(1)).updateInsightStatus(venueId, insightId, AiInsight.Status.ACTIONED);
    }
    
    /**
     * Test PATCH /venues/:venueId/insights/:id/status - mark as dismissed.
     * Requirement: 13.5 - Update insight status
     */
    @Test
    @WithMockUser
    void testUpdateInsightStatusToDismissed() throws Exception {
        UpdateInsightStatusRequest request = new UpdateInsightStatusRequest("dismissed");
        
        AiInsight updatedInsight = new AiInsight(
            testInsight.getVenueId(),
            testInsight.getInsightType(),
            testInsight.getTitle(),
            testInsight.getExplanation(),
            testInsight.getSupportingData(),
            testInsight.getRecommendedAction()
        );
        updatedInsight.setId(insightId);
        updatedInsight.setStatus(AiInsight.Status.DISMISSED);
        
        when(insightService.updateInsightStatus(eq(venueId), eq(insightId), eq(AiInsight.Status.DISMISSED)))
            .thenReturn(updatedInsight);
        
        mockMvc.perform(patch("/api/v1/venues/{venueId}/insights/{id}/status", venueId, insightId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(insightId.toString()))
            .andExpect(jsonPath("$.status").value("dismissed"));
        
        verify(insightService, times(1)).updateInsightStatus(venueId, insightId, AiInsight.Status.DISMISSED);
    }
    
    /**
     * Test PATCH /venues/:venueId/insights/:id/status - validation error for invalid status.
     * Requirement: 13.5 - Validate status values
     */
    @Test
    @WithMockUser
    void testUpdateInsightStatusInvalidStatus() throws Exception {
        UpdateInsightStatusRequest request = new UpdateInsightStatusRequest("invalid");
        
        mockMvc.perform(patch("/api/v1/venues/{venueId}/insights/{id}/status", venueId, insightId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isBadRequest());
        
        verify(insightService, never()).updateInsightStatus(any(), any(), any());
    }
    
    /**
     * Test PATCH /venues/:venueId/insights/:id/status - insight not found.
     * Requirement: 13.5
     */
    @Test
    @WithMockUser
    void testUpdateInsightStatusNotFound() throws Exception {
        UpdateInsightStatusRequest request = new UpdateInsightStatusRequest("actioned");
        
        when(insightService.updateInsightStatus(eq(venueId), eq(insightId), eq(AiInsight.Status.ACTIONED)))
            .thenThrow(new ResourceNotFoundException(ErrorCodes.INSIGHT_NOT_FOUND, "Insight not found"));
        
        mockMvc.perform(patch("/api/v1/venues/{venueId}/insights/{id}/status", venueId, insightId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isNotFound());
        
        verify(insightService, times(1)).updateInsightStatus(venueId, insightId, AiInsight.Status.ACTIONED);
    }
    
    /**
     * Test PATCH /venues/:venueId/insights/:id/status - attempting to update non-ACTIVE insight.
     * Requirement: 13.5
     */
    @Test
    @WithMockUser
    void testUpdateInsightStatusAlreadyActioned() throws Exception {
        UpdateInsightStatusRequest request = new UpdateInsightStatusRequest("dismissed");
        
        when(insightService.updateInsightStatus(eq(venueId), eq(insightId), eq(AiInsight.Status.DISMISSED)))
            .thenThrow(new IllegalArgumentException("Can only update status of ACTIVE insights"));
        
        mockMvc.perform(patch("/api/v1/venues/{venueId}/insights/{id}/status", venueId, insightId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isBadRequest());
        
        verify(insightService, times(1)).updateInsightStatus(venueId, insightId, AiInsight.Status.DISMISSED);
    }
}
