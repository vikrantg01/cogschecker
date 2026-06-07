package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.domain.AiInsight;
import com.cogschecker.foodcost.api.dto.AiInsightResponse;
import com.cogschecker.foodcost.api.dto.InsightDataAvailabilityResponse;
import com.cogschecker.foodcost.api.dto.UpdateInsightStatusRequest;
import com.cogschecker.foodcost.api.security.RequiresTier;
import com.cogschecker.foodcost.api.service.InsightService;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * REST controller for AI insights management (Pro+ tier only).
 * Requirements: 13.1, 13.5, 13.7
 */
@RestController
@RequestMapping("/api/v1/venues/{venueId}/insights")
public class InsightController {
    
    private static final Logger logger = LoggerFactory.getLogger(InsightController.class);
    
    private final InsightService insightService;
    
    public InsightController(InsightService insightService) {
        this.insightService = insightService;
    }
    
    /**
     * Get all AI insights for a venue (Pro+ tier only).
     * Requirements: 13.1, 13.7
     * 
     * GET /api/v1/venues/:venueId/insights
     * 
     * Returns all insights ordered by generated_at descending.
     * Only accessible to Pro+ tier users with MANAGER or ADMIN roles.
     * 
     * @param venueId the venue ID
     * @return list of insights
     */
    @GetMapping
    @RequiresTier("pro_plus")
    @PreAuthorize("hasVenueRole('MANAGER', #venueId) or hasVenueRole('ADMIN', #venueId)")
    public ResponseEntity<List<AiInsightResponse>> getInsights(@PathVariable UUID venueId) {
        logger.info("GET /venues/{}/insights", venueId);
        
        List<AiInsight> insights = insightService.getInsights(venueId);
        
        List<AiInsightResponse> response = insights.stream()
                .map(AiInsightResponse::fromEntity)
                .collect(Collectors.toList());
        
        return ResponseEntity.ok(response);
    }
    
    /**
     * Check if sufficient sales data is available to generate insights.
     * Requirements: 13.1, 13.6
     * 
     * GET /api/v1/venues/:venueId/insights/availability
     * 
     * Returns availability status including days of data and estimated availability date.
     * Only accessible to Pro+ tier users with MANAGER or ADMIN roles.
     * 
     * @param venueId the venue ID
     * @return data availability status
     */
    @GetMapping("/availability")
    @RequiresTier("pro_plus")
    @PreAuthorize("hasVenueRole('MANAGER', #venueId) or hasVenueRole('ADMIN', #venueId)")
    public ResponseEntity<InsightDataAvailabilityResponse> checkDataAvailability(@PathVariable UUID venueId) {
        logger.info("GET /venues/{}/insights/availability", venueId);
        
        InsightDataAvailabilityResponse availability = insightService.checkDataAvailability(venueId);
        
        return ResponseEntity.ok(availability);
    }
    
    /**
     * Update insight status (ACTIVE → ACTIONED or DISMISSED).
     * Requirements: 13.5
     * 
     * PATCH /api/v1/venues/:venueId/insights/:id/status
     * 
     * Allows users to mark insights as actioned or dismissed.
     * Only accessible to Pro+ tier users with MANAGER or ADMIN roles.
     * 
     * @param venueId the venue ID
     * @param id the insight ID
     * @param request the status update request with validated status value
     * @return the updated insight
     */
    @PatchMapping("/{id}/status")
    @RequiresTier("pro_plus")
    @PreAuthorize("hasVenueRole('MANAGER', #venueId) or hasVenueRole('ADMIN', #venueId)")
    public ResponseEntity<AiInsightResponse> updateInsightStatus(
            @PathVariable UUID venueId,
            @PathVariable UUID id,
            @Valid @RequestBody UpdateInsightStatusRequest request) {
        
        logger.info("PATCH /venues/{}/insights/{}/status - updating to: {}", venueId, id, request.getStatus());
        
        // Convert string status to enum
        AiInsight.Status newStatus = AiInsight.Status.valueOf(request.getStatus().toUpperCase());
        
        AiInsight updated = insightService.updateInsightStatus(venueId, id, newStatus);
        
        return ResponseEntity.ok(AiInsightResponse.fromEntity(updated));
    }
}
