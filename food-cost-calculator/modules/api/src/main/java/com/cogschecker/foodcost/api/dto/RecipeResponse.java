package com.cogschecker.foodcost.api.dto;

import com.cogschecker.foodcost.shared.ThresholdStatus;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Response DTO for recipe list view.
 * Requirements: 4.7, 4.8
 */
public class RecipeResponse {
    private UUID id;
    private UUID venueId;
    private String name;
    private Integer portionCount;
    private BigDecimal menuSellingPrice;
    private BigDecimal totalBatchCost;
    private BigDecimal foodCostPerPortion;
    private BigDecimal foodCostPercentage;
    private ThresholdStatus thresholdStatus;
    private Instant createdAt;
    private Instant updatedAt;
    
    // Constructors
    public RecipeResponse() {
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
    
    public ThresholdStatus getThresholdStatus() {
        return thresholdStatus;
    }
    
    public void setThresholdStatus(ThresholdStatus thresholdStatus) {
        this.thresholdStatus = thresholdStatus;
    }
}
