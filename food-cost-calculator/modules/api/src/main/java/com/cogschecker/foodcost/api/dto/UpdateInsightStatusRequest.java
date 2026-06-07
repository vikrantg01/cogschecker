package com.cogschecker.foodcost.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * Request DTO for updating insight status.
 * Requirements: 13.5
 */
public class UpdateInsightStatusRequest {
    
    @NotBlank(message = "Status is required")
    @Pattern(regexp = "^(actioned|dismissed)$", message = "Status must be 'actioned' or 'dismissed'")
    private String status;
    
    // Constructors
    
    public UpdateInsightStatusRequest() {
    }
    
    public UpdateInsightStatusRequest(String status) {
        this.status = status;
    }
    
    // Getters and Setters
    
    public String getStatus() {
        return status;
    }
    
    public void setStatus(String status) {
        this.status = status;
    }
}
