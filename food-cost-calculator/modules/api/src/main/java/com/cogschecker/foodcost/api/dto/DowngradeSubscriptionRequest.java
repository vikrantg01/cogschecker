package com.cogschecker.foodcost.api.dto;

import com.cogschecker.foodcost.api.domain.SubscriptionTier;
import jakarta.validation.constraints.NotNull;

/**
 * Request DTO for downgrading subscription.
 * Requirement 11.5
 */
public class DowngradeSubscriptionRequest {
    
    @NotNull(message = "Target tier is required")
    private SubscriptionTier targetTier;
    
    public DowngradeSubscriptionRequest() {
    }
    
    public DowngradeSubscriptionRequest(SubscriptionTier targetTier) {
        this.targetTier = targetTier;
    }
    
    // Getters and Setters
    
    public SubscriptionTier getTargetTier() {
        return targetTier;
    }
    
    public void setTargetTier(SubscriptionTier targetTier) {
        this.targetTier = targetTier;
    }
}
