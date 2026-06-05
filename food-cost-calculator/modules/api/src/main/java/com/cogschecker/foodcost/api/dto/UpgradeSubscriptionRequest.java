package com.cogschecker.foodcost.api.dto;

import com.cogschecker.foodcost.api.domain.SubscriptionTier;
import jakarta.validation.constraints.NotNull;

import java.time.Instant;

/**
 * Request DTO for upgrading subscription.
 * Requirement 11.4
 */
public class UpgradeSubscriptionRequest {
    
    @NotNull(message = "Target tier is required")
    private SubscriptionTier targetTier;
    
    @NotNull(message = "Stripe customer ID is required")
    private String stripeCustomerId;
    
    @NotNull(message = "Stripe subscription ID is required")
    private String stripeSubscriptionId;
    
    @NotNull(message = "Current period end is required")
    private Instant currentPeriodEnd;
    
    public UpgradeSubscriptionRequest() {
    }
    
    public UpgradeSubscriptionRequest(
            SubscriptionTier targetTier,
            String stripeCustomerId,
            String stripeSubscriptionId,
            Instant currentPeriodEnd) {
        this.targetTier = targetTier;
        this.stripeCustomerId = stripeCustomerId;
        this.stripeSubscriptionId = stripeSubscriptionId;
        this.currentPeriodEnd = currentPeriodEnd;
    }
    
    // Getters and Setters
    
    public SubscriptionTier getTargetTier() {
        return targetTier;
    }
    
    public void setTargetTier(SubscriptionTier targetTier) {
        this.targetTier = targetTier;
    }
    
    public String getStripeCustomerId() {
        return stripeCustomerId;
    }
    
    public void setStripeCustomerId(String stripeCustomerId) {
        this.stripeCustomerId = stripeCustomerId;
    }
    
    public String getStripeSubscriptionId() {
        return stripeSubscriptionId;
    }
    
    public void setStripeSubscriptionId(String stripeSubscriptionId) {
        this.stripeSubscriptionId = stripeSubscriptionId;
    }
    
    public Instant getCurrentPeriodEnd() {
        return currentPeriodEnd;
    }
    
    public void setCurrentPeriodEnd(Instant currentPeriodEnd) {
        this.currentPeriodEnd = currentPeriodEnd;
    }
}
