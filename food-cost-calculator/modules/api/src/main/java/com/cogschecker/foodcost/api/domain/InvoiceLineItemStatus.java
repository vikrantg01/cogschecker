package com.cogschecker.foodcost.api.domain;

/**
 * Invoice line item status enumeration.
 * Requirements: 12.8 (Invoice Line Item Review and Confirmation)
 */
public enum InvoiceLineItemStatus {
    PENDING,     // Waiting for user review
    CONFIRMED,   // User confirmed and applied to ingredient
    DISMISSED    // User dismissed this line
}
