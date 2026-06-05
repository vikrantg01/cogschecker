package com.cogschecker.foodcost.api.domain;

import jakarta.persistence.*;
import org.hibernate.annotations.GenericGenerator;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * SquareUnmatchedItem entity representing Square menu items that could not be matched
 * to recipes during sync.
 * Requirements: 12.4 (Square sync - unmatched item logging)
 */
@Entity
@Table(name = "square_unmatched_items")
public class SquareUnmatchedItem {
    
    @Id
    @GeneratedValue(generator = "UUID")
    @GenericGenerator(name = "UUID", strategy = "org.hibernate.id.UUIDGenerator")
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;
    
    @Column(name = "venue_id", nullable = false)
    private UUID venueId;
    
    @Column(name = "square_item_name", nullable = false)
    private String squareItemName;
    
    @Column(name = "square_item_price", precision = 10, scale = 2)
    private BigDecimal squareItemPrice;
    
    @Column(name = "status", nullable = false)
    @Enumerated(EnumType.STRING)
    private UnmatchedStatus status = UnmatchedStatus.PENDING;
    
    @Column(name = "mapped_recipe_id")
    private UUID mappedRecipeId;
    
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
    
    public SquareUnmatchedItem() {
    }
    
    public SquareUnmatchedItem(UUID venueId, String squareItemName, BigDecimal squareItemPrice) {
        this.venueId = venueId;
        this.squareItemName = squareItemName;
        this.squareItemPrice = squareItemPrice;
        this.status = UnmatchedStatus.PENDING;
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
    
    public String getSquareItemName() {
        return squareItemName;
    }
    
    public void setSquareItemName(String squareItemName) {
        this.squareItemName = squareItemName;
    }
    
    public BigDecimal getSquareItemPrice() {
        return squareItemPrice;
    }
    
    public void setSquareItemPrice(BigDecimal squareItemPrice) {
        this.squareItemPrice = squareItemPrice;
    }
    
    public UnmatchedStatus getStatus() {
        return status;
    }
    
    public void setStatus(UnmatchedStatus status) {
        this.status = status;
    }
    
    public UUID getMappedRecipeId() {
        return mappedRecipeId;
    }
    
    public void setMappedRecipeId(UUID mappedRecipeId) {
        this.mappedRecipeId = mappedRecipeId;
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
    
    public enum UnmatchedStatus {
        PENDING,
        MAPPED,
        DISMISSED
    }
}
