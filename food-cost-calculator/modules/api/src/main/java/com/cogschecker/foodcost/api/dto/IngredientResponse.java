package com.cogschecker.foodcost.api.dto;

import com.cogschecker.foodcost.api.domain.Ingredient;
import com.cogschecker.foodcost.shared.UomEnum;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Response DTO for ingredient data.
 * Returns all ingredient fields including computed cost values.
 */
public class IngredientResponse {
    
    private UUID id;
    private UUID venueId;
    private String name;
    private BigDecimal purchasePrice;
    private BigDecimal purchaseQuantity;
    private UomEnum unitOfMeasure;
    private BigDecimal yieldPercentage;
    private BigDecimal costPerUnit;
    private BigDecimal effectiveCostPerUsableUnit;
    private Instant createdAt;
    private Instant updatedAt;
    
    // Constructors
    
    public IngredientResponse() {
    }
    
    public IngredientResponse(Ingredient ingredient) {
        this.id = ingredient.getId();
        this.venueId = ingredient.getVenueId();
        this.name = ingredient.getName();
        this.purchasePrice = ingredient.getPurchasePrice();
        this.purchaseQuantity = ingredient.getPurchaseQuantity();
        this.unitOfMeasure = ingredient.getUnitOfMeasure();
        this.yieldPercentage = ingredient.getYieldPercentage();
        this.costPerUnit = ingredient.getCostPerUnit();
        this.effectiveCostPerUsableUnit = ingredient.getEffectiveCostPerUsableUnit();
        this.createdAt = ingredient.getCreatedAt();
        this.updatedAt = ingredient.getUpdatedAt();
    }
    
    // Static factory method for convenience
    public static IngredientResponse fromEntity(Ingredient ingredient) {
        return new IngredientResponse(ingredient);
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
