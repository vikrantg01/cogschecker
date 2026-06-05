package com.cogschecker.foodcost.api.domain;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Invoice entity representing a supplier invoice uploaded for OCR processing.
 * Requirements: 12.6 (Invoice Upload), 12.10 (Invoice History)
 */
@Entity
@Table(name = "invoices")
public class Invoice {
    
    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private UUID id;
    
    @Column(name = "venue_id", nullable = false)
    private UUID venueId;
    
    @Column(name = "file_name", nullable = false)
    private String fileName;
    
    @Column(name = "s3_key", nullable = false, length = 1024)
    private String s3Key;
    
    @Column(name = "uploaded_by")
    private UUID uploadedBy;
    
    @Column(name = "upload_date", nullable = false)
    private Instant uploadDate;
    
    @Enumerated(EnumType.STRING)
    @Column(name = "processing_status", nullable = false, length = 20)
    private InvoiceProcessingStatus processingStatus = InvoiceProcessingStatus.PENDING;
    
    @Column(name = "extracted_item_count")
    private Integer extractedItemCount;
    
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
    
    @OneToMany(mappedBy = "invoice", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<InvoiceLineItem> lineItems = new ArrayList<>();
    
    @PrePersist
    protected void onCreate() {
        createdAt = Instant.now();
        updatedAt = Instant.now();
        if (uploadDate == null) {
            uploadDate = Instant.now();
        }
    }
    
    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
    
    // Constructors
    public Invoice() {
    }
    
    public Invoice(UUID venueId, String fileName, String s3Key, UUID uploadedBy) {
        this.venueId = venueId;
        this.fileName = fileName;
        this.s3Key = s3Key;
        this.uploadedBy = uploadedBy;
        this.processingStatus = InvoiceProcessingStatus.PENDING;
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
    
    public String getS3Key() {
        return s3Key;
    }
    
    public void setS3Key(String s3Key) {
        this.s3Key = s3Key;
    }
    
    public UUID getUploadedBy() {
        return uploadedBy;
    }
    
    public void setUploadedBy(UUID uploadedBy) {
        this.uploadedBy = uploadedBy;
    }
    
    public Instant getUploadDate() {
        return uploadDate;
    }
    
    public void setUploadDate(Instant uploadDate) {
        this.uploadDate = uploadDate;
    }
    
    public InvoiceProcessingStatus getProcessingStatus() {
        return processingStatus;
    }
    
    public void setProcessingStatus(InvoiceProcessingStatus processingStatus) {
        this.processingStatus = processingStatus;
    }
    
    public Integer getExtractedItemCount() {
        return extractedItemCount;
    }
    
    public void setExtractedItemCount(Integer extractedItemCount) {
        this.extractedItemCount = extractedItemCount;
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
    
    public List<InvoiceLineItem> getLineItems() {
        return lineItems;
    }
    
    public void setLineItems(List<InvoiceLineItem> lineItems) {
        this.lineItems = lineItems;
    }
}
