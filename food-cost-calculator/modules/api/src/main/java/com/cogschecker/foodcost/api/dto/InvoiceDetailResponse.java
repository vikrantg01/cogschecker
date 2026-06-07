package com.cogschecker.foodcost.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Response DTO for invoice detail with line items.
 * Requirements: 12.7 (Invoice OCR Processing), 12.10 (Invoice History)
 */
public class InvoiceDetailResponse {
    
    @JsonProperty("id")
    private UUID id;
    
    @JsonProperty("venue_id")
    private UUID venueId;
    
    @JsonProperty("file_name")
    private String fileName;
    
    @JsonProperty("upload_date")
    private Instant uploadDate;
    
    @JsonProperty("processing_status")
    private String processingStatus;
    
    @JsonProperty("extracted_item_count")
    private Integer extractedItemCount;
    
    @JsonProperty("line_items")
    private List<InvoiceLineItemResponse> lineItems;
    
    public InvoiceDetailResponse() {
    }
    
    public InvoiceDetailResponse(
            UUID id,
            UUID venueId,
            String fileName,
            Instant uploadDate,
            String processingStatus,
            Integer extractedItemCount,
            List<InvoiceLineItemResponse> lineItems) {
        this.id = id;
        this.venueId = venueId;
        this.fileName = fileName;
        this.uploadDate = uploadDate;
        this.processingStatus = processingStatus;
        this.extractedItemCount = extractedItemCount;
        this.lineItems = lineItems;
    }
    
    // Getters and Setters
    public UUID getId() {
        return id;
    }
    
    public void setId(UUID id) {
        this.id = id;
    }
    
    public UUID getVenueId() {
        return venueId;
    }
    
    public void setVenueId(UUID venueId) {
        this.venueId = venueId;
    }
    
    public String getFileName() {
        return fileName;
    }
    
    public void setFileName(String fileName) {
        this.fileName = fileName;
    }
    
    public Instant getUploadDate() {
        return uploadDate;
    }
    
    public void setUploadDate(Instant uploadDate) {
        this.uploadDate = uploadDate;
    }
    
    public String getProcessingStatus() {
        return processingStatus;
    }
    
    public void setProcessingStatus(String processingStatus) {
        this.processingStatus = processingStatus;
    }
    
    public Integer getExtractedItemCount() {
        return extractedItemCount;
    }
    
    public void setExtractedItemCount(Integer extractedItemCount) {
        this.extractedItemCount = extractedItemCount;
    }
    
    public List<InvoiceLineItemResponse> getLineItems() {
        return lineItems;
    }
    
    public void setLineItems(List<InvoiceLineItemResponse> lineItems) {
        this.lineItems = lineItems;
    }
}
