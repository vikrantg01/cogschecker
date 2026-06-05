package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.domain.SystemConfig;
import com.cogschecker.foodcost.api.dto.SystemConfigResponse;
import com.cogschecker.foodcost.api.dto.UpdateSystemConfigRequest;
import com.cogschecker.foodcost.api.service.SystemConfigService;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * REST controller for venue system configuration.
 * Endpoints: GET /venues/:venueId/config, PATCH /venues/:venueId/config
 * Requirement: 4.6
 */
@RestController
@RequestMapping("/api/v1/venues/{venueId}/config")
public class SystemConfigController {
    
    private static final Logger logger = LoggerFactory.getLogger(SystemConfigController.class);
    
    private final SystemConfigService systemConfigService;
    
    public SystemConfigController(SystemConfigService systemConfigService) {
        this.systemConfigService = systemConfigService;
    }
    
    /**
     * Get system configuration for a venue.
     * GET /api/v1/venues/:venueId/config
     * Requirement: 4.6
     * 
     * @param venueId the venue ID
     * @return the system config (default if not found)
     */
    @GetMapping
    public ResponseEntity<SystemConfigResponse> getConfig(@PathVariable UUID venueId) {
        logger.info("GET /api/v1/venues/{}/config", venueId);
        
        SystemConfig config = systemConfigService.getConfig(venueId);
        
        SystemConfigResponse response = new SystemConfigResponse(
            config.getVenueId(),
            config.getTargetFoodCostPercentage()
        );
        
        return ResponseEntity.ok(response);
    }
    
    /**
     * Update system configuration for a venue.
     * PATCH /api/v1/venues/:venueId/config
     * Requirement: 4.6
     * 
     * @param venueId the venue ID
     * @param request the update request with new target percentage
     * @return the updated system config
     */
    @PatchMapping
    public ResponseEntity<SystemConfigResponse> updateConfig(
            @PathVariable UUID venueId,
            @Valid @RequestBody UpdateSystemConfigRequest request) {
        
        logger.info("PATCH /api/v1/venues/{}/config: targetFoodCostPercentage={}", 
            venueId, request.getTargetFoodCostPercentage());
        
        SystemConfig config = systemConfigService.updateConfig(
            venueId,
            request.getTargetFoodCostPercentage()
        );
        
        SystemConfigResponse response = new SystemConfigResponse(
            config.getVenueId(),
            config.getTargetFoodCostPercentage()
        );
        
        return ResponseEntity.ok(response);
    }
}
