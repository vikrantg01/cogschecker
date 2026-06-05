package com.cogschecker.foodcost.api.domain;

import jakarta.persistence.*;
import org.hibernate.annotations.GenericGenerator;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Recipe entity (minimal implementation for ingredient reference checking).
 */
@Entity
@Table(name = "recipes")
public class Recipe {
    
    @Id
    @GeneratedValue(generator = "UUID")
    @GenericGenerator(name = "UUID", strategy = "org.hibernate.id.UUIDGenerator")
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;
    
    @Column(name = "venue_id", nullable = false)
    private UUID venueId;
    
    @Column(name = "name", nullable = false, length = 100)
    private String name;
    
    @Column(name = "portion_count", nullable = false)
    private Integer portionCount;
    
    @Column(name = "menu_selling_price", precision = 10, scale = 2)
    private BigDecimal menuSellingPrice;
    
    @Column(name = "total_batch_cost", precision = 10, scale = 2)
    private BigDecimal totalBatchCost;
    
    @Column(name = "food_cost_per_portion", precision = 10, scale = 2)
    private BigDecimal foodCostPerPortion;
    
    @Column(name = "food_cost_percentage", precision = 5, scale = 1)
    private BigDecimal foodCostPercentage;
    
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
    
    // Constructors
    
    public Recipe() {
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
    
    public Integer getPortionCount() {
        return portionCount;
    }
    
    public void setPortionCount(Integer portionCount) {
        this.portionCount = portionCount;
    }
    
    public BigDecimal getMenuSellingPrice() {
        return menuSellingPrice;
    }
    
    public void setMenuSellingPrice(BigDecimal menuSellingPrice) {
        this.menuSellingPrice = menuSellingPrice;
    }
    
    public BigDecimal getTotalBatchCost() {
        return totalBatchCost;
    }
    
    public void setTotalBatchCost(BigDecimal totalBatchCost) {
        this.totalBatchCost = totalBatchCost;
    }
    
    public BigDecimal getFoodCostPerPortion() {
        return foodCostPerPortion;
    }
    
    public void setFoodCostPerPortion(BigDecimal foodCostPerPortion) {
        this.foodCostPerPortion = foodCostPerPortion;
    }
    
    public BigDecimal getFoodCostPercentage() {
        return foodCostPercentage;
    }
    
    public void setFoodCostPercentage(BigDecimal foodCostPercentage) {
        this.foodCostPercentage = foodCostPercentage;
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
