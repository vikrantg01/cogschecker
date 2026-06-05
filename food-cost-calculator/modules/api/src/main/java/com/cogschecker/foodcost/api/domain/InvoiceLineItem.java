package com.cogschecker.foodcost.api.domain;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Invoice line item entity representing OCR-extracted data from an invoice.
 * Requirements: 12.7 (Invoice OCR Processing), 12.9 (Confidence Scoring)
 */
@Entity
@Table(name = "invoice_line_items")
public class InvoiceLineItem {
    
    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private UUID id;
    
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "invoice_id", nullable = false)
    private Invoice invoice;
    
    @Column(name = "extracted_name")
    private String extractedName;
    
    @Column(name = "extracted_quantity", precision = 10, scale = 4)
    private BigDecimal extractedQuantity;
    
    @Column(name = "extracted_unit", length = 50)
    private String extractedUnit;
    
    @Column(name = "extracted_price", precision = 10, scale = 2)
    private BigDecimal extractedPrice;
    
    @Column(name = "confidence_score", precision = 4, scale = 3)
    private BigDecimal confidenceScore;
    
    @Column(name = "is_low_confidence", nullable = false)
    private Boolean isLowConfidence = false;
    
    @Column(name = "matched_ingredient_id")
    private UUID matchedIngredientId;
    
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 20)
    private InvoiceLineItemStatus status = InvoiceLineItemStatus.PENDING;
    
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
    
    @PrePersist
    protected void onCreate() {
        createdAt = Instant.now();
        updatedAt = Instant.now();
    }
    
    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
    
    // Constructors
    public InvoiceLineItem() {
    }
    
    // Getters and Setters
    public UUID getId() {
        return id;
    }
    
    public void setId(UUID id) {
        this.id = id;
    }
    
    public Invoice getInvoice() {
        return invoice;
    }
    
    public void setInvoice(Invoice invoice) {
        this.invoice = invoice;
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
    
    public InvoiceLineItemStatus getStatus() {
        return status;
    }
    
    public void setStatus(InvoiceLineItemStatus status) {
        this.status = status;
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
