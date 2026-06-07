package com.cogschecker.foodcost.api.dto;

import com.cogschecker.foodcost.shared.UomEnum;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Request DTO for an ingredient line in a recipe.
 * Requirements: 2.2
 * 
 * Either ingredientId or subRecipeId must be set (mutually exclusive).
 */
public class IngredientLineRequest {
    
    @JsonProperty("ingredientId")
    private UUID ingredientId;
    
    @JsonProperty("subRecipeId")
    private UUID subRecipeId;
    
    @JsonProperty("quantityUsed")
    @NotNull(message = "Quantity is required")
    @DecimalMin(value = "0.0001", message = "Quantity must be greater than 0")
    private BigDecimal quantityUsed;
    
    @JsonProperty("unitOfMeasure")
    @NotNull(message = "Unit of measure is required")
    private UomEnum unitOfMeasure;
    
    // Constructors
    public IngredientLineRequest() {
    }
    
    // Getters and Setters
    public UUID getIngredientId() {
        return ingredientId;
    }
    
    public void setIngredientId(UUID ingredientId) {
        this.ingredientId = ingredientId;
    }
    
    public UUID getSubRecipeId() {
        return subRecipeId;
    }
    
    public void setSubRecipeId(UUID subRecipeId) {
        this.subRecipeId = subRecipeId;
    }
    
    public BigDecimal getQuantityUsed() {
        return quantityUsed;
    }
    
    public void setQuantityUsed(BigDecimal quantityUsed) {
        this.quantityUsed = quantityUsed;
    }
    
    public UomEnum getUnitOfMeasure() {
        return unitOfMeasure;
    }
    
    public void setUnitOfMeasure(UomEnum unitOfMeasure) {
        this.unitOfMeasure = unitOfMeasure;
    }
}
