package com.cogschecker.foodcost.api.dto;

import java.util.List;

/**
 * Response DTO returned when cross-venue recipe copy has missing ingredients.
 * Returned as 409 Conflict with list of missing ingredients.
 * Requirement: 10.7
 */
public class MissingIngredientsResponse {
    
    private String message;
    private List<MissingIngredientInfo> missingIngredients;
    
    // Constructors
    public MissingIngredientsResponse() {
    }
    
    public MissingIngredientsResponse(String message, List<MissingIngredientInfo> missingIngredients) {
        this.message = message;
        this.missingIngredients = missingIngredients;
    }
    
    // Getters and Setters
    public String getMessage() {
        return message;
    }
    
    public void setMessage(String message) {
        this.message = message;
    }
    
    public List<MissingIngredientInfo> getMissingIngredients() {
        return missingIngredients;
    }
    
    public void setMissingIngredients(List<MissingIngredientInfo> missingIngredients) {
        this.missingIngredients = missingIngredients;
    }
}
