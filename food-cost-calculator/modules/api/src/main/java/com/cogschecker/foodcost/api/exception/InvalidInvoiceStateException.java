package com.cogschecker.foodcost.api.exception;

import com.cogschecker.foodcost.shared.ErrorCodes;

/**
 * Exception thrown when an operation is attempted on an invoice in an invalid state.
 * Requirements: 12.8 (Invoice State Management)
 */
public class InvalidInvoiceStateException extends DomainException {
    
    public InvalidInvoiceStateException(String message) {
        super(ErrorCodes.INVOICE_INVALID_STATE, message);
    }
}
