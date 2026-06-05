package com.cogschecker.foodcost.api.domain;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * SystemConfig entity representing venue-specific configuration settings.
 * Requirement: 4.6
 */
@Entity
@Table(name = "system_config")
public class SystemConfig {
    
    @Id
    @Column(name = "venue_id", updatable = false, nullable = false)
    private UUID venueId;
    
    @Column(name = "target_food_cost_percentage", nullable = false, precision = 5, scale = 1)
    private BigDecimal targetFoodCostPercentage = new BigDecimal("30.0");
    
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
    
    public SystemConfig() {
    }
    
    public SystemConfig(UUID venueId, BigDecimal targetFoodCostPercentage) {
        this.venueId = venueId;
        this.targetFoodCostPercentage = targetFoodCostPercentage != null ? 
            targetFoodCostPercentage : new BigDecimal("30.0");
    }
    
    // Getters and Setters
    
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
