package com.cogschecker.foodcost.api.exception;

import java.util.Map;

/**
 * Exception thrown when business validation rules are violated.
 */
public class ValidationException extends DomainException {
    
    public ValidationException(String errorCode, String message) {
        super(errorCode, message);
    }
    
    public ValidationException(String errorCode, String message, Map<String, Object> details) {
        super(errorCode, message, details);
    }
}
