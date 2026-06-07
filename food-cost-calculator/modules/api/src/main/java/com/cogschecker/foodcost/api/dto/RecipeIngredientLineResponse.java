package com.cogschecker.foodcost.api.dto;

import com.cogschecker.foodcost.shared.UomEnum;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Response DTO for recipe ingredient lines.
 * Used to return ingredient line data for recipe editing.
 */
public class RecipeIngredientLineResponse {
    private String id;
    private String recipeId;
    private String ingredientId;
    private String subRecipeId;
    private BigDecimal quantityUsed;
    private UomEnum unitOfMeasure;
    private BigDecimal lineCost;
    
    // Constructors
    public RecipeIngredientLineResponse() {
    }
    
    // Getters and Setters
    public String getId() {
        return id;
    }
    
    public void setId(String id) {
        this.id = id;
    }
    
    public String getRecipeId() {
        return recipeId;
    }
    
    public void setRecipeId(String recipeId) {
        this.recipeId = recipeId;
    }
    
    public String getIngredientId() {
        return ingredientId;
    }
    
    public void setIngredientId(String ingredientId) {
        this.ingredientId = ingredientId;
    }
    
    public String getSubRecipeId() {
        return subRecipeId;
    }
    
    public void setSubRecipeId(String subRecipeId) {
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
    
    public BigDecimal getLineCost() {
        return lineCost;
    }
    
    public void setLineCost(BigDecimal lineCost) {
        this.lineCost = lineCost;
    }
}
