package com.cogschecker.foodcost.api.dto;

import java.math.BigDecimal;

/**
 * Response DTO for a single line in the cost breakdown.
 * Requirements: 3.5, 3.6, 3.7
 * 
 * Each line contains:
 * - name: ingredient or sub-recipe name
 * - quantity: amount used
 * - unitOfMeasure: UOM symbol
 * - unitCost: cost per unit (null if missing price)
 * - lineCost: total cost for this line (null if missing price)
 * - missingPrice: flag indicating if price data is unavailable
 */
public class CostBreakdownLineResponse {
    private String name;
    private BigDecimal quantity;
    private String unitOfMeasure;
    private BigDecimal unitCost;
    private BigDecimal lineCost;
    private boolean missingPrice;
    
    // Constructors
    public CostBreakdownLineResponse() {
    }
    
    // Getters and Setters
    public String getName() {
        return name;
    }
    
    public void setName(String name) {
        this.name = name;
    }
    
    public BigDecimal getQuantity() {
        return quantity;
    }
    
    public void setQuantity(BigDecimal quantity) {
        this.quantity = quantity;
    }
    
    public String getUnitOfMeasure() {
        return unitOfMeasure;
    }
    
    public void setUnitOfMeasure(String unitOfMeasure) {
        this.unitOfMeasure = unitOfMeasure;
    }
    
    public BigDecimal getUnitCost() {
        return unitCost;
    }
    
    public void setUnitCost(BigDecimal unitCost) {
        this.unitCost = unitCost;
    }
    
    public BigDecimal getLineCost() {
        return lineCost;
    }
    
    public void setLineCost(BigDecimal lineCost) {
        this.lineCost = lineCost;
    }
    
    public boolean isMissingPrice() {
        return missingPrice;
    }
    
    public void setMissingPrice(boolean missingPrice) {
        this.missingPrice = missingPrice;
    }
}
