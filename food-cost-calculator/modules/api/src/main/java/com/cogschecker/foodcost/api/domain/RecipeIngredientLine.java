package com.cogschecker.foodcost.api.domain;

import com.cogschecker.foodcost.shared.UomEnum;
import jakarta.persistence.*;
import org.hibernate.annotations.GenericGenerator;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Recipe ingredient line entity (minimal implementation for ingredient reference checking).
 */
@Entity
@Table(name = "recipe_ingredient_lines")
public class RecipeIngredientLine {
    
    @Id
    @GeneratedValue(generator = "UUID")
    @GenericGenerator(name = "UUID", strategy = "org.hibernate.id.UUIDGenerator")
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;
    
    @Column(name = "recipe_id", nullable = false)
    private UUID recipeId;
    
    @Column(name = "ingredient_id")
    private UUID ingredientId;
    
    @Column(name = "sub_recipe_id")
    private UUID subRecipeId;
    
    @Column(name = "quantity_used", nullable = false, precision = 10, scale = 4)
    private BigDecimal quantityUsed;
    
    @Convert(converter = UomEnumConverter.class)
    @Column(name = "unit_of_measure", nullable = false, length = 10)
    private UomEnum unitOfMeasure;
    
    @Column(name = "line_cost", precision = 10, scale = 4)
    private BigDecimal lineCost;
    
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
    
    // Constructors
    
    public RecipeIngredientLine() {
    }
    
    // Getters and Setters
    
    public UUID getId() {
        return id;
    }
    
    public void setId(UUID id) {
        this.id = id;
    }
    
    public UUID getRecipeId() {
        return recipeId;
    }
    
    public void setRecipeId(UUID recipeId) {
        this.recipeId = recipeId;
    }
    
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
    
    public BigDecimal getLineCost() {
        return lineCost;
    }
    
    public void setLineCost(BigDecimal lineCost) {
        this.lineCost = lineCost;
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
