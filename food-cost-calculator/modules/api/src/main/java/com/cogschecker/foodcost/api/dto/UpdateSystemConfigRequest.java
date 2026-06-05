package com.cogschecker.foodcost.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;

import java.math.BigDecimal;

/**
 * Request DTO for updating system configuration.
 * Requirement: 4.6
 */
public class UpdateSystemConfigRequest {
    
    @JsonProperty("target_food_cost_percentage")
    @DecimalMin(value = "1.0", message = "Target food cost percentage must be at least 1")
    @DecimalMax(value = "100.0", message = "Target food cost percentage must be at most 100")
    private BigDecimal targetFoodCostPercentage;
    
    public UpdateSystemConfigRequest() {
    }
    
    public UpdateSystemConfigRequest(BigDecimal targetFoodCostPercentage) {
        this.targetFoodCostPercentage = targetFoodCostPercentage;
    }
    
    public BigDecimal getTargetFoodCostPercentage() {
        return targetFoodCostPercentage;
    }
    
    public void setTargetFoodCostPercentage(BigDecimal targetFoodCostPercentage) {
        this.targetFoodCostPercentage = targetFoodCostPercentage;
    }
}
