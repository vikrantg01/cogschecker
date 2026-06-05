package com.cogschecker.foodcost.api.dto;

import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.UUID;

/**
 * Request DTO for copying a recipe from another venue.
 * Requirements: 10.6, 10.7
 * 
 * On first submission, only sourceVenueId and recipeId are provided.
 * If missing ingredients are detected, the server returns 409 with the list.
 * Admin re-submits with ingredientMappings to resolve missing ingredients.
 */
public class CopyRecipeRequest {
    
    @NotNull(message = "Source venue ID is required")
    private UUID sourceVenueId;
    
    @NotNull(message = "Recipe ID is required")
    private UUID recipeId;
    
    /**
     * Optional ingredient mappings for resolving missing ingredients.
     * Provided on re-submission after receiving 409 response.
     */
    private List<IngredientMapping> ingredientMappings;
    
    // Constructors
    public CopyRecipeRequest() {
    }
    
    // Getters and Setters
    public UUID getSourceVenueId() {
        return sourceVenueId;
    }
    
    public void setSourceVenueId(UUID sourceVenueId) {
        this.sourceVenueId = sourceVenueId;
    }
    
    public UUID getRecipeId() {
        return recipeId;
    }
    
    public void setRecipeId(UUID recipeId) {
        this.recipeId = recipeId;
    }
    
    public List<IngredientMapping> getIngredientMappings() {
        return ingredientMappings;
    }
    
    public void setIngredientMappings(List<IngredientMapping> ingredientMappings) {
        this.ingredientMappings = ingredientMappings;
    }
}
