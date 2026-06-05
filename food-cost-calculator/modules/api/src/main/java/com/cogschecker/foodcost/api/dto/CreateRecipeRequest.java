package com.cogschecker.foodcost.api.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * Request DTO for creating a recipe.
 * Requirements: 2.1, 2.2
 */
public class CreateRecipeRequest {
    
    @NotBlank(message = "Recipe name is required")
    @Size(min = 1, max = 100, message = "Recipe name must be between 1 and 100 characters")
    private String name;
    
    @Min(value = 1, message = "Portion count must be at least 1")
    @Max(value = 9999, message = "Portion count cannot exceed 9999")
    private Integer portionCount;
    
    @Size(max = 200, message = "Recipe cannot have more than 200 ingredient lines")
    private List<IngredientLineRequest> ingredientLines;
    
    // Constructors
    public CreateRecipeRequest() {
    }
    
    // Getters and Setters
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
    
    public List<IngredientLineRequest> getIngredientLines() {
        return ingredientLines;
    }
    
    public void setIngredientLines(List<IngredientLineRequest> ingredientLines) {
        this.ingredientLines = ingredientLines;
    }
}
