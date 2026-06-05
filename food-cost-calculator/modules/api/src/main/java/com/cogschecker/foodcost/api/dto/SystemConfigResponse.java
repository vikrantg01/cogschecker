package com.cogschecker.foodcost.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Response DTO for system configuration.
 * Requirement: 4.6
 */
public class SystemConfigResponse {
    
    @JsonProperty("venue_id")
    private UUID venueId;
    
    @JsonProperty("target_food_cost_percentage")
    private BigDecimal targetFoodCostPercentage;
    
    public SystemConfigResponse() {
    }
    
    public SystemConfigResponse(UUID venueId, BigDecimal targetFoodCostPercentage) {
        this.venueId = venueId;
        this.targetFoodCostPercentage = targetFoodCostPercentage;
    }
    
    public UUID getVenueId() {
        return venueId;
    }
    
    public void setVenueId(UUID venueId) {
        this.venueId = venueId;
    }
    
    public BigDecimal getTargetFoodCostPercentage() {
        return targetFoodCostPercentage;
    }
    
    public void setTargetFoodCostPercentage(BigDecimal targetFoodCostPercentage) {
        this.targetFoodCostPercentage = targetFoodCostPercentage;
    }
}
