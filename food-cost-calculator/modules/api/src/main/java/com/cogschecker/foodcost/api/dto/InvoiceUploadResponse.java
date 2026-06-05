package com.cogschecker.foodcost.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.UUID;

/**
 * Response DTO for invoice upload endpoint.
 * Requirements: 12.6 (Invoice Upload)
 */
public class InvoiceUploadResponse {
    
    @JsonProperty("invoice_id")
    private UUID invoiceId;
    
    @JsonProperty("status")
    private String status;
    
    public InvoiceUploadResponse() {
    }
    
    public InvoiceUploadResponse(UUID invoiceId, String status) {
        this.invoiceId = invoiceId;
        this.status = status;
    }
    
    public UUID getInvoiceId() {
        return invoiceId;
    }
    
    public void setInvoiceId(UUID invoiceId) {
        this.invoiceId = invoiceId;
    }
    
    public String getStatus() {
        return status;
    }
    
    public void setStatus(String status) {
        this.status = status;
    }
}
