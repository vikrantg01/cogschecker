package com.cogschecker.foodcost.api.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * DTO for mapping a source ingredient to a destination ingredient or create-new flag.
 * Used in cross-venue recipe copy when re-submitting with ingredient mappings.
 * Requirement: 10.7
 */
public class IngredientMapping {
    
    @NotNull(message = "Source ingredient ID is required")
    private UUID sourceIngredientId;
    
    // Either destinationIngredientId is set (map to existing) OR createNew is true
    private UUID destinationIngredientId;
    
    private Boolean createNew;
    
    // Constructors
    public IngredientMapping() {
    }
    
    public IngredientMapping(UUID sourceIngredientId, UUID destinationIngredientId) {
        this.sourceIngredientId = sourceIngredientId;
        this.destinationIngredientId = destinationIngredientId;
        this.createNew = false;
    }
    
    public IngredientMapping(UUID sourceIngredientId, boolean createNew) {
        this.sourceIngredientId = sourceIngredientId;
        this.createNew = createNew;
    }
    
    // Getters and Setters
    public UUID getSourceIngredientId() {
        return sourceIngredientId;
    }
    
    public void setSourceIngredientId(UUID sourceIngredientId) {
        this.sourceIngredientId = sourceIngredientId;
    }
    
    public UUID getDestinationIngredientId() {
        return destinationIngredientId;
    }
    
    public void setDestinationIngredientId(UUID destinationIngredientId) {
        this.destinationIngredientId = destinationIngredientId;
    }
    
    public Boolean getCreateNew() {
        return createNew;
    }
    
    public void setCreateNew(Boolean createNew) {
        this.createNew = createNew;
    }
}
