package com.cogschecker.foodcost.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;
import java.util.Map;

/**
 * Standard error response format for all API errors.
 * All custom exceptions are mapped to this structure.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ErrorResponse {
    
    private final String error_code;
    private final String message;
    private final Instant timestamp;
    private final String path;
    private final Map<String, Object> details;
    
    public ErrorResponse(String errorCode, String message, String path) {
        this(errorCode, message, path, null);
    }
    
    public ErrorResponse(String errorCode, String message, String path, Map<String, Object> details) {
        this.error_code = errorCode;
        this.message = message;
        this.timestamp = Instant.now();
        this.path = path;
        this.details = details;
    }
    
    public String getErrorCode() {
        return error_code;
    }
    
    public String getMessage() {
        return message;
    }
    
    public Instant getTimestamp() {
        return timestamp;
    }
    
    public String getPath() {
        return path;
    }
    
    public Map<String, Object> getDetails() {
        return details;
    }
}
