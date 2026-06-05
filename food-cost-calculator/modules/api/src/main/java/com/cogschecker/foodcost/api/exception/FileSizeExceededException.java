package com.cogschecker.foodcost.api.exception;

/**
 * Exception thrown when an uploaded file exceeds the maximum allowed size.
 * Requirements: 12.6 (Invoice Upload - file size validation)
 */
public class FileSizeExceededException extends RuntimeException {
    
    public FileSizeExceededException(String message) {
        super(message);
    }
    
    public FileSizeExceededException(String message, Throwable cause) {
        super(message, cause);
    }
}
