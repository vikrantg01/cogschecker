package com.cogschecker.foodcost.api.domain;

import jakarta.persistence.*;
import org.hibernate.annotations.GenericGenerator;

import java.time.Instant;
import java.util.UUID;

/**
 * Subscription entity linking an Organisation to its subscription tier.
 * Requirement 11.1, 11.2
 */
@Entity
@Table(name = "subscriptions")
public class Subscription {
    
    @Id
    @GeneratedValue(generator = "UUID")
    @GenericGenerator(name = "UUID", strategy = "org.hibernate.id.UUIDGenerator")
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;
    
    @Column(name = "organisation_id", nullable = false, unique = true)
    private UUID organisationId;
    
    @Enumerated(EnumType.STRING)
    @Column(name = "tier", nullable = false, length = 20)
    private SubscriptionTier tier = SubscriptionTier.FREE;
    
    @Column(name = "stripe_customer_id")
    private String stripeCustomerId;
    
    @Column(name = "stripe_subscription_id")
    private String stripeSubscriptionId;
    
    @Column(name = "current_period_end")
    private Instant currentPeriodEnd;
    
    @Enumerated(EnumType.STRING)
    @Column(name = "pending_downgrade_tier", length = 20)
    private SubscriptionTier pendingDowngradeTier;
    
    @Column(name = "payment_failed_at")
    private Instant paymentFailedAt;
    
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
    
    @PrePersist
    protected void onCreate() {
        createdAt = Instant.now();
        updatedAt = Instant.now();
    }
    
    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
    
    // Constructors
    
    public Subscription() {
    }
    
    public Subscription(UUID organisationId, SubscriptionTier tier) {
        this.organisationId = organisationId;
        this.tier = tier;
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
