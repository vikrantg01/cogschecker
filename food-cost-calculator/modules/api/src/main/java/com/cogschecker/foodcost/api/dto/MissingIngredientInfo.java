package com.cogschecker.foodcost.api.dto;

import java.util.UUID;

/**
 * DTO for a missing ingredient in cross-venue recipe copy.
 * Requirement: 10.7
 */
public class MissingIngredientInfo {
    
    private UUID sourceIngredientId;
    private String ingredientName;
    private String unitOfMeasure;
    
    // Constructors
    public MissingIngredientInfo() {
    }
    
    public MissingIngredientInfo(UUID sourceIngredientId, String ingredientName, String unitOfMeasure) {
        this.sourceIngredientId = sourceIngredientId;
        this.ingredientName = ingredientName;
        this.unitOfMeasure = unitOfMeasure;
    }
    
    // Getters and Setters
    public UUID getSourceIngredientId() {
        return sourceIngredientId;
    }
    
    public void setSourceIngredientId(UUID sourceIngredientId) {
        this.sourceIngredientId = sourceIngredientId;
    }
    
    public String getIngredientName() {
        return ingredientName;
    }
    
    public void setIngredientName(String ingredientName) {
        this.ingredientName = ingredientName;
    }
    
    public String getUnitOfMeasure() {
        return unitOfMeasure;
    }
    
    public void setUnitOfMeasure(String unitOfMeasure) {
        this.unitOfMeasure = unitOfMeasure;
    }
}
