package com.cogschecker.foodcost.api.domain;

import com.cogschecker.foodcost.shared.UomEnum;
import jakarta.persistence.*;
import org.hibernate.annotations.GenericGenerator;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Ingredient entity representing a purchasable raw material with pricing and yield information.
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */
@Entity
@Table(name = "ingredients")
public class Ingredient {
    
    @Id
    @GeneratedValue(generator = "UUID")
    @GenericGenerator(name = "UUID", strategy = "org.hibernate.id.UUIDGenerator")
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;
    
    @Column(name = "venue_id", nullable = false)
    private UUID venueId;
    
    @Column(name = "name", nullable = false, length = 100)
    private String name;
    
    @Column(name = "purchase_price", nullable = false, precision = 10, scale = 2)
    private BigDecimal purchasePrice;
    
    @Column(name = "purchase_quantity", nullable = false, precision = 10, scale = 4)
    private BigDecimal purchaseQuantity;
    
    @Enumerated(EnumType.STRING)
    @Column(name = "unit_of_measure", nullable = false, length = 10)
    private UomEnum unitOfMeasure;
    
    @Column(name = "yield_percentage", nullable = false, precision = 5, scale = 2)
    private BigDecimal yieldPercentage = new BigDecimal("100.00");
    
    @Column(name = "cost_per_unit", precision = 10, scale = 4)
    private BigDecimal costPerUnit;
    
    @Column(name = "effective_cost_per_usable_unit", precision = 10, scale = 4)
    private BigDecimal effectiveCostPerUsableUnit;
    
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
    
    public Ingredient() {
    }
    
    public Ingredient(UUID venueId, String name, BigDecimal purchasePrice, 
                     BigDecimal purchaseQuantity, UomEnum unitOfMeasure, 
                     BigDecimal yieldPercentage) {
        this.venueId = venueId;
        this.name = name;
        this.purchasePrice = purchasePrice;
        this.purchaseQuantity = purchaseQuantity;
        this.unitOfMeasure = unitOfMeasure;
        this.yieldPercentage = yieldPercentage != null ? yieldPercentage : new BigDecimal("100.00");
    }
    
    // Getters and Setters
    
    public UUID getId() {
        return id;
    }
    
    public void setId(UUID id) {
        this.id = id;
    }
    
    public UUID getVenueId() {
        return venueId;
    }
    
    public void setVenueId(UUID venueId) {
        this.venueId = venueId;
    }
    
    public String getName() {
        return name;
    }
    
    public void setName(String name) {
        this.name = name;
    }
    
    public BigDecimal getPurchasePrice() {
        return purchasePrice;
    }
    
    public void setPurchasePrice(BigDecimal purchasePrice) {
        this.purchasePrice = purchasePrice;
    }
    
    public BigDecimal getPurchaseQuantity() {
        return purchaseQuantity;
    }
    
    public void setPurchaseQuantity(BigDecimal purchaseQuantity) {
        this.purchaseQuantity = purchaseQuantity;
    }
    
    public UomEnum getUnitOfMeasure() {
        return unitOfMeasure;
    }
    
    public void setUnitOfMeasure(UomEnum unitOfMeasure) {
        this.unitOfMeasure = unitOfMeasure;
    }
    
    public BigDecimal getYieldPercentage() {
        return yieldPercentage;
    }
    
    public void setYieldPercentage(BigDecimal yieldPercentage) {
        this.yieldPercentage = yieldPercentage;
    }
    
    public BigDecimal getCostPerUnit() {
        return costPerUnit;
    }
    
    public void setCostPerUnit(BigDecimal costPerUnit) {
        this.costPerUnit = costPerUnit;
    }
    
    public BigDecimal getEffectiveCostPerUsableUnit() {
        return effectiveCostPerUsableUnit;
    }
    
    public void setEffectiveCostPerUsableUnit(BigDecimal effectiveCostPerUsableUnit) {
        this.effectiveCostPerUsableUnit = effectiveCostPerUsableUnit;
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
