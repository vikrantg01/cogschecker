package com.cogschecker.foodcost.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Response DTO for invoice line item.
 * Requirements: 12.7 (Invoice OCR Processing), 12.9 (Confidence Scoring)
 */
public class InvoiceLineItemResponse {
    
    @JsonProperty("id")
    private UUID id;
    
    @JsonProperty("extracted_name")
    private String extractedName;
    
    @JsonProperty("extracted_quantity")
    private BigDecimal extractedQuantity;
    
    @JsonProperty("extracted_unit")
    private String extractedUnit;
    
    @JsonProperty("extracted_price")
    private BigDecimal extractedPrice;
    
    @JsonProperty("confidence_score")
    private BigDecimal confidenceScore;
    
    @JsonProperty("is_low_confidence")
    private Boolean isLowConfidence;
    
    @JsonProperty("matched_ingredient_id")
    private UUID matchedIngredientId;
    
    @JsonProperty("status")
    private String status;
    
    public InvoiceLineItemResponse() {
    }
    
    public InvoiceLineItemResponse(
            UUID id,
            String extractedName,
            BigDecimal extractedQuantity,
            String extractedUnit,
            BigDecimal extractedPrice,
            BigDecimal confidenceScore,
            Boolean isLowConfidence,
            UUID matchedIngredientId,
            String status) {
        this.id = id;
        this.extractedName = extractedName;
        this.extractedQuantity = extractedQuantity;
        this.extractedUnit = extractedUnit;
        this.extractedPrice = extractedPrice;
        this.confidenceScore = confidenceScore;
        this.isLowConfidence = isLowConfidence;
        this.matchedIngredientId = matchedIngredientId;
        this.status = status;
    }
    
    // Getters and Setters
    public UUID getId() {
        return id;
    }
    
    public void setId(UUID id) {
        this.id = id;
    }
    
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
    
    public BigDecimal getConfidenceScore() {
        return confidenceScore;
    }
    
    public void setConfidenceScore(BigDecimal confidenceScore) {
        this.confidenceScore = confidenceScore;
    }
    
    public Boolean getIsLowConfidence() {
        return isLowConfidence;
    }
    
    public void setIsLowConfidence(Boolean isLowConfidence) {
        this.isLowConfidence = isLowConfidence;
    }
    
    public UUID getMatchedIngredientId() {
        return matchedIngredientId;
    }
    
    public void setMatchedIngredientId(UUID matchedIngredientId) {
        this.matchedIngredientId = matchedIngredientId;
    }
    
    public String getStatus() {
        return status;
    }
    
    public void setStatus(String status) {
        this.status = status;
    }
}
