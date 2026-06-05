package com.cogschecker.foodcost.api.exception;

/**
 * Exception thrown when attempting to create a resource with a name that already exists.
 */
public class DuplicateResourceException extends DomainException {
    
    public DuplicateResourceException(String errorCode, String message) {
        super(errorCode, message);
    }
}
