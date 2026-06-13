package com.cogschecker.foodcost.api.dto;

import com.cogschecker.foodcost.shared.UomEnum;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;

/**
 * Request DTO for updating an existing ingredient.
 * All fields are optional - only provided fields will be updated.
 * Requirements: 1.3, 1.6
 */
public class UpdateIngredientRequest {
    
    @JsonProperty("name")
    @Size(min = 1, max = 100, message = "Ingredient name must be between 1 and 100 characters")
    private String name;
    
    @JsonProperty("purchasePrice")
    @DecimalMin(value = "0.01", message = "Purchase price must be greater than 0")
    private BigDecimal purchasePrice;
    
    @JsonProperty("purchaseQuantity")
    @DecimalMin(value = "0.0001", message = "Purchase quantity must be greater than 0")
    private BigDecimal purchaseQuantity;
    
    @JsonProperty("unitOfMeasure")
    private UomEnum unitOfMeasure;
    
    @JsonProperty("yieldPercentage")
    @DecimalMin(value = "1.0", message = "Yield percentage must be between 1 and 100")
    private BigDecimal yieldPercentage;
    
    // Constructors
    
    public UpdateIngredientRequest() {
    }
    
    public UpdateIngredientRequest(String name, BigDecimal purchasePrice, BigDecimal purchaseQuantity,
                                  UomEnum unitOfMeasure, BigDecimal yieldPercentage) {
        this.name = name;
        this.purchasePrice = purchasePrice;
        this.purchaseQuantity = purchaseQuantity;
        this.unitOfMeasure = unitOfMeasure;
        this.yieldPercentage = yieldPercentage;
    }
    
    // Getters and Setters
    
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
}
