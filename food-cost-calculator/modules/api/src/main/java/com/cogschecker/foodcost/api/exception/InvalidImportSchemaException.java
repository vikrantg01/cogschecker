package com.cogschecker.foodcost.api.exception;

import com.cogschecker.foodcost.shared.ErrorCodes;

import java.util.Map;

/**
 * Exception thrown when imported JSON data does not conform to the expected schema.
 * Requirements: 7.6
 */
public class InvalidImportSchemaException extends ValidationException {
    
    public InvalidImportSchemaException(String message) {
        super(ErrorCodes.DATA_IMPORT_INVALID_FORMAT, message);
    }
    
    public InvalidImportSchemaException(String message, Map<String, Object> details) {
        super(ErrorCodes.DATA_IMPORT_INVALID_FORMAT, message, details);
    }
}
