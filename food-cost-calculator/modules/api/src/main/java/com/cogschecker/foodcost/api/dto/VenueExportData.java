package com.cogschecker.foodcost.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * DTO for venue export data structure.
 * Requirements: 7.4, 7.7
 * 
 * This represents the complete venue data for export/import.
 */
public class VenueExportData {
    
    @JsonProperty("version")
    private Integer version;
    
    @JsonProperty("exportedAt")
    private String exportedAt;
    
    @JsonProperty("venue")
    private VenueData venue;
    
    // Constructors
    
    public VenueExportData() {
    }
    
    public VenueExportData(Integer version, String exportedAt, VenueData venue) {
        this.version = version;
        this.exportedAt = exportedAt;
        this.venue = venue;
    }
    
    // Getters and Setters
    
    public Integer getVersion() {
        return version;
    }
    
    public void setVersion(Integer version) {
        this.version = version;
    }
    
    public String getExportedAt() {
        return exportedAt;
    }
    
    public void setExportedAt(String exportedAt) {
        this.exportedAt = exportedAt;
    }
    
    public VenueData getVenue() {
        return venue;
    }
    
    public void setVenue(VenueData venue) {
        this.venue = venue;
    }
    
    /**
     * Nested venue data containing all ingredients, recipes, and configuration.
     */
    public static class VenueData {
        
        @JsonProperty("ingredients")
        private List<IngredientExportData> ingredients;
        
        @JsonProperty("recipes")
        private List<RecipeExportData> recipes;
        
        @JsonProperty("targetFoodCostPercentage")
        private BigDecimal targetFoodCostPercentage;
        
        // Constructors
        
        public VenueData() {
        }
        
        public VenueData(List<IngredientExportData> ingredients, 
                        List<RecipeExportData> recipes, 
                        BigDecimal targetFoodCostPercentage) {
            this.ingredients = ingredients;
            this.recipes = recipes;
            this.targetFoodCostPercentage = targetFoodCostPercentage;
        }
        
        // Getters and Setters
        
        public List<IngredientExportData> getIngredients() {
            return ingredients;
        }
        
        public void setIngredients(List<IngredientExportData> ingredients) {
            this.ingredients = ingredients;
        }
        
        public List<RecipeExportData> getRecipes() {
            return recipes;
        }
        
        public void setRecipes(List<RecipeExportData> recipes) {
            this.recipes = recipes;
        }
        
        public BigDecimal getTargetFoodCostPercentage() {
            return targetFoodCostPercentage;
        }
        
        public void setTargetFoodCostPercentage(BigDecimal targetFoodCostPercentage) {
            this.targetFoodCostPercentage = targetFoodCostPercentage;
        }
    }
    
    /**
     * Ingredient data for export.
     */
    public static class IngredientExportData {
        
        @JsonProperty("id")
        private String id;
        
        @JsonProperty("name")
        private String name;
        
        @JsonProperty("purchasePrice")
        private BigDecimal purchasePrice;
        
        @JsonProperty("purchaseQuantity")
        private BigDecimal purchaseQuantity;
        
        @JsonProperty("unitOfMeasure")
        private String unitOfMeasure;
        
        @JsonProperty("yieldPercentage")
        private BigDecimal yieldPercentage;
        
        @JsonProperty("costPerUnit")
        private BigDecimal costPerUnit;
        
        @JsonProperty("effectiveCostPerUsableUnit")
        private BigDecimal effectiveCostPerUsableUnit;
        
        @JsonProperty("createdAt")
        private String createdAt;
        
        @JsonProperty("updatedAt")
        private String updatedAt;
        
        // Constructors
        
        public IngredientExportData() {
        }
        
        // Getters and Setters
        
        public String getId() {
            return id;
        }
        
        public void setId(String id) {
            this.id = id;
        }
        
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
        
        public String getUnitOfMeasure() {
            return unitOfMeasure;
        }
        
        public void setUnitOfMeasure(String unitOfMeasure) {
            this.unitOfMeasure = unitOfMeasure;
        }
        
        public BigDecimal getYieldPercentage() {
            return yieldPercentage;
        }
        
        public void setYieldPercentage(BigDecimal yieldPercentage) {
            this.yieldPercentage = yieldPercentage;
        }
        
        public BigDecimal getCostPerUnit() {
            return costPerUnit;
        }
        
        public void setCostPerUnit(BigDecimal costPerUnit) {
            this.costPerUnit = costPerUnit;
        }
        
        public BigDecimal getEffectiveCostPerUsableUnit() {
            return effectiveCostPerUsableUnit;
        }
        
        public void setEffectiveCostPerUsableUnit(BigDecimal effectiveCostPerUsableUnit) {
            this.effectiveCostPerUsableUnit = effectiveCostPerUsableUnit;
        }
        
        public String getCreatedAt() {
            return createdAt;
        }
        
        public void setCreatedAt(String createdAt) {
            this.createdAt = createdAt;
        }
        
        public String getUpdatedAt() {
            return updatedAt;
        }
        
        public void setUpdatedAt(String updatedAt) {
            this.updatedAt = updatedAt;
        }
    }
    
    /**
     * Recipe data for export.
     */
    public static class RecipeExportData {
        
        @JsonProperty("id")
        private String id;
        
        @JsonProperty("name")
        private String name;
        
        @JsonProperty("portionCount")
        private Integer portionCount;
        
        @JsonProperty("menuSellingPrice")
        private BigDecimal menuSellingPrice;
        
        @JsonProperty("totalBatchCost")
        private BigDecimal totalBatchCost;
        
        @JsonProperty("foodCostPerPortion")
        private BigDecimal foodCostPerPortion;
        
        @JsonProperty("foodCostPercentage")
        private BigDecimal foodCostPercentage;
        
        @JsonProperty("ingredientLines")
        private List<IngredientLineExportData> ingredientLines;
        
        @JsonProperty("createdAt")
        private String createdAt;
        
        @JsonProperty("updatedAt")
        private String updatedAt;
        
        // Constructors
        
        public RecipeExportData() {
        }
        
        // Getters and Setters
        
        public String getId() {
            return id;
        }
        
        public void setId(String id) {
            this.id = id;
        }
        
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
        
        public BigDecimal getMenuSellingPrice() {
            return menuSellingPrice;
        }
        
        public void setMenuSellingPrice(BigDecimal menuSellingPrice) {
            this.menuSellingPrice = menuSellingPrice;
        }
        
        public BigDecimal getTotalBatchCost() {
            return totalBatchCost;
        }
        
        public void setTotalBatchCost(BigDecimal totalBatchCost) {
            this.totalBatchCost = totalBatchCost;
        }
        
        public BigDecimal getFoodCostPerPortion() {
            return foodCostPerPortion;
        }
        
        public void setFoodCostPerPortion(BigDecimal foodCostPerPortion) {
            this.foodCostPerPortion = foodCostPerPortion;
        }
        
        public BigDecimal getFoodCostPercentage() {
            return foodCostPercentage;
        }
        
        public void setFoodCostPercentage(BigDecimal foodCostPercentage) {
            this.foodCostPercentage = foodCostPercentage;
        }
        
        public List<IngredientLineExportData> getIngredientLines() {
            return ingredientLines;
        }
        
        public void setIngredientLines(List<IngredientLineExportData> ingredientLines) {
            this.ingredientLines = ingredientLines;
        }
        
        public String getCreatedAt() {
            return createdAt;
        }
        
        public void setCreatedAt(String createdAt) {
            this.createdAt = createdAt;
        }
        
        public String getUpdatedAt() {
            return updatedAt;
        }
        
        public void setUpdatedAt(String updatedAt) {
            this.updatedAt = updatedAt;
        }
    }
    
    /**
     * Ingredient line data for export.
     */
    public static class IngredientLineExportData {
        
        @JsonProperty("id")
        private String id;
        
        @JsonProperty("ingredientId")
        private String ingredientId;
        
        @JsonProperty("subRecipeId")
        private String subRecipeId;
        
        @JsonProperty("quantityUsed")
        private BigDecimal quantityUsed;
        
        @JsonProperty("unitOfMeasure")
        private String unitOfMeasure;
        
        @JsonProperty("lineCost")
        private BigDecimal lineCost;
        
        @JsonProperty("createdAt")
        private String createdAt;
        
        @JsonProperty("updatedAt")
        private String updatedAt;
        
        // Constructors
        
        public IngredientLineExportData() {
        }
        
        // Getters and Setters
        
        public String getId() {
            return id;
        }
        
        public void setId(String id) {
            this.id = id;
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
        
        public String getUnitOfMeasure() {
            return unitOfMeasure;
        }
        
        public void setUnitOfMeasure(String unitOfMeasure) {
            this.unitOfMeasure = unitOfMeasure;
        }
        
        public BigDecimal getLineCost() {
            return lineCost;
        }
        
        public void setLineCost(BigDecimal lineCost) {
            this.lineCost = lineCost;
        }
        
        public String getCreatedAt() {
            return createdAt;
        }
        
        public void setCreatedAt(String createdAt) {
            this.createdAt = createdAt;
        }
        
        public String getUpdatedAt() {
            return updatedAt;
        }
        
        public void setUpdatedAt(String updatedAt) {
            this.updatedAt = updatedAt;
        }
    }
}
