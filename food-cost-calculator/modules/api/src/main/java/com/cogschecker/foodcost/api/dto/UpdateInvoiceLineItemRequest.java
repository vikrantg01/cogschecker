package com.cogschecker.foodcost.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;

import java.math.BigDecimal;

/**
 * Request DTO for updating an invoice line item before confirmation.
 * Requirements: 12.8 (Invoice Line Item Review)
 */
public class UpdateInvoiceLineItemRequest {
    
    @JsonProperty("extracted_name")
    @NotBlank(message = "Extracted name is required")
    private String extractedName;
    
    @JsonProperty("extracted_quantity")
    @DecimalMin(value = "0.0001", message = "Extracted quantity must be greater than 0")
    private BigDecimal extractedQuantity;
    
    @JsonProperty("extracted_unit")
    private String extractedUnit;
    
    @JsonProperty("extracted_price")
    @DecimalMin(value = "0.01", message = "Extracted price must be greater than 0")
    private BigDecimal extractedPrice;
    
    public UpdateInvoiceLineItemRequest() {
    }
    
    public UpdateInvoiceLineItemRequest(
            String extractedName,
            BigDecimal extractedQuantity,
            String extractedUnit,
            BigDecimal extractedPrice) {
        this.extractedName = extractedName;
        this.extractedQuantity = extractedQuantity;
        this.extractedUnit = extractedUnit;
        this.extractedPrice = extractedPrice;
    }
    
    // Getters and Setters
    public String getExtractedName() {
        return extractedName;
    }
    
    public void setExtractedName(String extractedName) {
        this.extractedName = extractedName;
    }
    
    public BigDecimal getExtractedQuantity() {
        return extractedQuantity;
    }
    
    public void setExtractedQuantity(BigDecimal extractedQuantity) {
        this.extractedQuantity = extractedQuantity;
    }
    
    public String getExtractedUnit() {
        return extractedUnit;
    }
    
    public void setExtractedUnit(String extractedUnit) {
        this.extractedUnit = extractedUnit;
    }
    
    public BigDecimal getExtractedPrice() {
        return extractedPrice;
    }
    
    public void setExtractedPrice(BigDecimal extractedPrice) {
        this.extractedPrice = extractedPrice;
    }
}
