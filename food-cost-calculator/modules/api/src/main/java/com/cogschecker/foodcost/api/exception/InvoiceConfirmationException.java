package com.cogschecker.foodcost.api.exception;

import com.cogschecker.foodcost.shared.ErrorCodes;

import java.util.List;
import java.util.Map;

/**
 * Exception thrown when invoice confirmation fails due to validation issues.
 * Requirements: 12.9 (Low-Confidence Field Validation)
 */
public class InvoiceConfirmationException extends DomainException {
    
    private final List<String> lowConfidenceFields;
    
    public InvoiceConfirmationException(String message, List<String> lowConfidenceFields) {
        super(ErrorCodes.INVOICE_CONFIRMATION_FAILED, message, 
              Map.of("low_confidence_fields", lowConfidenceFields));
        this.lowConfidenceFields = lowConfidenceFields;
    }
    
    public List<String> getLowConfidenceFields() {
        return lowConfidenceFields;
    }
}
