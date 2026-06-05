package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.domain.SystemConfig;
import com.cogschecker.foodcost.api.dto.UpdateSystemConfigRequest;
import com.cogschecker.foodcost.api.service.SystemConfigService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Unit tests for SystemConfigController REST endpoints.
 * Tests Requirement: 4.6
 */
@WebMvcTest(SystemConfigController.class)
class SystemConfigControllerTest {
    
    @Autowired
    private MockMvc mockMvc;
    
    @Autowired
    private ObjectMapper objectMapper;
    
    @MockBean
    private SystemConfigService systemConfigService;
    
    private UUID venueId;
    
    @BeforeEach
    void setUp() {
        venueId = UUID.randomUUID();
    }
    
    /**
     * Test GET /venues/:venueId/config - get config.
     * Requirement: 4.6
     */
    @Test
    @WithMockUser
    void testGetConfig_ReturnsConfig() throws Exception {
        // Given
        SystemConfig config = new SystemConfig(venueId, new BigDecimal("30.0"));
        when(systemConfigService.getConfig(venueId)).thenReturn(config);
        
        // When/Then
        mockMvc.perform(get("/api/v1/venues/{venueId}/config", venueId)
                .contentType(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.venue_id").value(venueId.toString()))
            .andExpect(jsonPath("$.target_food_cost_percentage").value(30.0));
        
        verify(systemConfigService).getConfig(venueId);
    }
    
    /**
     * Test GET /venues/:venueId/config - returns default when not found.
     * Requirement: 4.6
     */
    @Test
    @WithMockUser
    void testGetConfig_ReturnsDefaultWhenNotFound() throws Exception {
        // Given
        SystemConfig defaultConfig = new SystemConfig(venueId, new BigDecimal("30.0"));
        when(systemConfigService.getConfig(venueId)).thenReturn(defaultConfig);
        
        // When/Then
        mockMvc.perform(get("/api/v1/venues/{venueId}/config", venueId)
                .contentType(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.venue_id").value(venueId.toString()))
            .andExpect(jsonPath("$.target_food_cost_percentage").value(30.0));
        
        verify(systemConfigService).getConfig(venueId);
    }
    
    /**
     * Test PATCH /venues/:venueId/config - update config.
     * Requirement: 4.6
     */
    @Test
    @WithMockUser
    void testUpdateConfig_ValidRequest_UpdatesConfig() throws Exception {
        // Given
        BigDecimal newPercentage = new BigDecimal("35.5");
        UpdateSystemConfigRequest request = new UpdateSystemConfigRequest(newPercentage);
        SystemConfig updatedConfig = new SystemConfig(venueId, newPercentage);
        
        when(systemConfigService.updateConfig(eq(venueId), any(BigDecimal.class)))
            .thenReturn(updatedConfig);
        
        // When/Then
        mockMvc.perform(patch("/api/v1/venues/{venueId}/config", venueId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.venue_id").value(venueId.toString()))
            .andExpect(jsonPath("$.target_food_cost_percentage").value(35.5));
        
        verify(systemConfigService).updateConfig(eq(venueId), any(BigDecimal.class));
    }
    
    /**
     * Test PATCH /venues/:venueId/config - minimum boundary value.
     * Requirement: 4.6
     */
    @Test
    @WithMockUser
    void testUpdateConfig_MinimumValue_Accepts() throws Exception {
        // Given
        BigDecimal minPercentage = new BigDecimal("1.0");
        UpdateSystemConfigRequest request = new UpdateSystemConfigRequest(minPercentage);
        SystemConfig updatedConfig = new SystemConfig(venueId, minPercentage);
        
        when(systemConfigService.updateConfig(eq(venueId), any(BigDecimal.class)))
            .thenReturn(updatedConfig);
        
        // When/Then
        mockMvc.perform(patch("/api/v1/venues/{venueId}/config", venueId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.target_food_cost_percentage").value(1.0));
        
        verify(systemConfigService).updateConfig(eq(venueId), any(BigDecimal.class));
    }
    
    /**
     * Test PATCH /venues/:venueId/config - maximum boundary value.
     * Requirement: 4.6
     */
    @Test
    @WithMockUser
    void testUpdateConfig_MaximumValue_Accepts() throws Exception {
        // Given
        BigDecimal maxPercentage = new BigDecimal("100.0");
        UpdateSystemConfigRequest request = new UpdateSystemConfigRequest(maxPercentage);
        SystemConfig updatedConfig = new SystemConfig(venueId, maxPercentage);
        
        when(systemConfigService.updateConfig(eq(venueId), any(BigDecimal.class)))
            .thenReturn(updatedConfig);
        
        // When/Then
        mockMvc.perform(patch("/api/v1/venues/{venueId}/config", venueId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.target_food_cost_percentage").value(100.0));
        
        verify(systemConfigService).updateConfig(eq(venueId), any(BigDecimal.class));
    }
    
    /**
     * Test PATCH /venues/:venueId/config - below minimum rejected by validation.
     * Requirement: 4.6
     */
    @Test
    @WithMockUser
    void testUpdateConfig_BelowMinimum_ReturnsBadRequest() throws Exception {
        // Given
        BigDecimal belowMin = new BigDecimal("0.9");
        UpdateSystemConfigRequest request = new UpdateSystemConfigRequest(belowMin);
        
        // When/Then
        mockMvc.perform(patch("/api/v1/venues/{venueId}/config", venueId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isBadRequest());
        
        verify(systemConfigService, never()).updateConfig(any(), any());
    }
    
    /**
     * Test PATCH /venues/:venueId/config - above maximum rejected by validation.
     * Requirement: 4.6
     */
    @Test
    @WithMockUser
    void testUpdateConfig_AboveMaximum_ReturnsBadRequest() throws Exception {
        // Given
        BigDecimal aboveMax = new BigDecimal("100.1");
        UpdateSystemConfigRequest request = new UpdateSystemConfigRequest(aboveMax);
        
        // When/Then
        mockMvc.perform(patch("/api/v1/venues/{venueId}/config", venueId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isBadRequest());
        
        verify(systemConfigService, never()).updateConfig(any(), any());
    }
}
