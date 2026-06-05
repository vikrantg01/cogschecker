package com.cogschecker.foodcost.api.dto;

import com.cogschecker.foodcost.api.domain.SubscriptionEventType;
import com.cogschecker.foodcost.api.domain.SubscriptionTier;

import java.time.Instant;
import java.util.UUID;

/**
 * Response DTO for subscription history entry.
 * Requirement 11.9
 */
public class SubscriptionHistoryResponse {
    
    private UUID id;
    private UUID organisationId;
    private SubscriptionEventType eventType;
    private SubscriptionTier fromTier;
    private SubscriptionTier toTier;
    private String stripeEventId;
    private String description;
    private Instant createdAt;
    
    public SubscriptionHistoryResponse() {
    }
    
    public SubscriptionHistoryResponse(
            UUID id,
            UUID organisationId,
            SubscriptionEventType eventType,
            SubscriptionTier fromTier,
            SubscriptionTier toTier,
            String stripeEventId,
            String description,
            Instant createdAt) {
        this.id = id;
        this.organisationId = organisationId;
        this.eventType = eventType;
        this.fromTier = fromTier;
        this.toTier = toTier;
        this.stripeEventId = stripeEventId;
        this.description = description;
        this.createdAt = createdAt;
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
    
    public SubscriptionEventType getEventType() {
        return eventType;
    }
    
    public void setEventType(SubscriptionEventType eventType) {
        this.eventType = eventType;
    }
    
    public SubscriptionTier getFromTier() {
        return fromTier;
    }
    
    public void setFromTier(SubscriptionTier fromTier) {
        this.fromTier = fromTier;
    }
    
    public SubscriptionTier getToTier() {
        return toTier;
    }
    
    public void setToTier(SubscriptionTier toTier) {
        this.toTier = toTier;
    }
    
    public String getStripeEventId() {
        return stripeEventId;
    }
    
    public void setStripeEventId(String stripeEventId) {
        this.stripeEventId = stripeEventId;
    }
    
    public String getDescription() {
        return description;
    }
    
    public void setDescription(String description) {
        this.description = description;
    }
    
    public Instant getCreatedAt() {
        return createdAt;
    }
    
    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}
