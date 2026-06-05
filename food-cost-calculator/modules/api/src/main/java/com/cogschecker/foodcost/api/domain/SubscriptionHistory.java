package com.cogschecker.foodcost.api.domain;

import jakarta.persistence.*;
import org.hibernate.annotations.GenericGenerator;

import java.time.Instant;
import java.util.UUID;

/**
 * Subscription history entity for tracking tier changes and payment events.
 * Requirement 11.9
 */
@Entity
@Table(name = "subscription_history")
public class SubscriptionHistory {
    
    @Id
    @GeneratedValue(generator = "UUID")
    @GenericGenerator(name = "UUID", strategy = "org.hibernate.id.UUIDGenerator")
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;
    
    @Column(name = "organisation_id", nullable = false)
    private UUID organisationId;
    
    @Enumerated(EnumType.STRING)
    @Column(name = "event_type", nullable = false, length = 50)
    private SubscriptionEventType eventType;
    
    @Enumerated(EnumType.STRING)
    @Column(name = "from_tier", length = 20)
    private SubscriptionTier fromTier;
    
    @Enumerated(EnumType.STRING)
    @Column(name = "to_tier", length = 20)
    private SubscriptionTier toTier;
    
    @Column(name = "stripe_event_id")
    private String stripeEventId;
    
    @Column(name = "description", length = 500)
    private String description;
    
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    
    @PrePersist
    protected void onCreate() {
        createdAt = Instant.now();
    }
    
    // Constructors
    
    public SubscriptionHistory() {
    }
    
    public SubscriptionHistory(
            UUID organisationId,
            SubscriptionEventType eventType,
            SubscriptionTier fromTier,
            SubscriptionTier toTier,
            String description) {
        this.organisationId = organisationId;
        this.eventType = eventType;
        this.fromTier = fromTier;
        this.toTier = toTier;
        this.description = description;
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
