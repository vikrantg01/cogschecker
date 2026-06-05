package com.cogschecker.foodcost.api.exception;

/**
 * Exception thrown when an uploaded file has an invalid type.
 * Requirements: 12.6 (Invoice Upload - file type validation)
 */
public class InvalidFileTypeException extends RuntimeException {
    
    public InvalidFileTypeException(String message) {
        super(message);
    }
    
    public InvalidFileTypeException(String message, Throwable cause) {
        super(message, cause);
    }
}
