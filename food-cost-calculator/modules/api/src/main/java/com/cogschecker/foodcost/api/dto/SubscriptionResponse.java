package com.cogschecker.foodcost.api.dto;

import com.cogschecker.foodcost.api.domain.SubscriptionTier;

import java.time.Instant;
import java.util.UUID;

/**
 * Response DTO for subscription details.
 * Requirements: 11.1, 11.7
 */
public class SubscriptionResponse {
    
    private UUID id;
    private UUID organisationId;
    private SubscriptionTier tier;
    private String stripeCustomerId;
    private String stripeSubscriptionId;
    private Instant currentPeriodEnd;
    private SubscriptionTier pendingDowngradeTier;
    private Instant paymentFailedAt;
    private Instant createdAt;
    private Instant updatedAt;
    
    public SubscriptionResponse() {
    }
    
    public SubscriptionResponse(
            UUID id,
            UUID organisationId,
            SubscriptionTier tier,
            String stripeCustomerId,
            String stripeSubscriptionId,
            Instant currentPeriodEnd,
            SubscriptionTier pendingDowngradeTier,
            Instant paymentFailedAt,
            Instant createdAt,
            Instant updatedAt) {
        this.id = id;
        this.organisationId = organisationId;
        this.tier = tier;
        this.stripeCustomerId = stripeCustomerId;
        this.stripeSubscriptionId = stripeSubscriptionId;
        this.currentPeriodEnd = currentPeriodEnd;
        this.pendingDowngradeTier = pendingDowngradeTier;
        this.paymentFailedAt = paymentFailedAt;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }
    
    // Getters and Setters
    
    public UUID getId() {
        return id;
    }
    
    public void setId(UUID id) {
        this.id = id;
    }
    
    public UUID getOrganisationId() {
        return organisationId;
    }
    
    public void setOrganisationId(UUID organisationId) {
        this.organisationId = organisationId;
    }
    
    public SubscriptionTier getTier() {
        return tier;
    }
    
    public void setTier(SubscriptionTier tier) {
        this.tier = tier;
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
    
    public SubscriptionTier getPendingDowngradeTier() {
        return pendingDowngradeTier;
    }
    
    public void setPendingDowngradeTier(SubscriptionTier pendingDowngradeTier) {
        this.pendingDowngradeTier = pendingDowngradeTier;
    }
    
    public Instant getPaymentFailedAt() {
        return paymentFailedAt;
    }
    
    public void setPaymentFailedAt(Instant paymentFailedAt) {
        this.paymentFailedAt = paymentFailedAt;
    }
    
    public Instant getCreatedAt() {
        return createdAt;
    }
    
    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
    
    public Instant getUpdatedAt() {
        return updatedAt;
    }
    
    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
