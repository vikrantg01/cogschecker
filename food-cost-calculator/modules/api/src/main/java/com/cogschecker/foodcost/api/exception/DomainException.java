package com.cogschecker.foodcost.api.exception;

import java.util.Map;

/**
 * Base class for all domain-specific exceptions in the Food Cost Calculator.
 * Each domain exception should have an associated error code from ErrorCodes.
 */
public abstract class DomainException extends RuntimeException {
    
    private final String errorCode;
    private final Map<String, Object> details;
    
    protected DomainException(String errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
        this.details = null;
    }
    
    protected DomainException(String errorCode, String message, Map<String, Object> details) {
        super(message);
        this.errorCode = errorCode;
        this.details = details;
    }
    
    protected DomainException(String errorCode, String message, Throwable cause) {
        this(errorCode, message, null, cause);
    }
    
    protected DomainException(String errorCode, String message, Map<String, Object> details, Throwable cause) {
        super(message, cause);
        this.errorCode = errorCode;
        this.details = details;
    }
    
    public String getErrorCode() {
        return errorCode;
    }
    
    public Map<String, Object> getDetails() {
        return details;
    }
}
