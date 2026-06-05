package com.cogschecker.foodcost.api.domain;

/**
 * Invoice processing status enumeration.
 * Requirements: 12.6 (Invoice Upload), 12.7 (Invoice OCR Processing)
 */
public enum InvoiceProcessingStatus {
    PENDING,      // File uploaded, waiting for OCR processing
    PROCESSING,   // OCR in progress
    REVIEW,       // OCR complete, waiting for user review/confirmation
    CONFIRMED,    // User confirmed and data applied to ingredients
    FAILED        // OCR or processing failed
}
