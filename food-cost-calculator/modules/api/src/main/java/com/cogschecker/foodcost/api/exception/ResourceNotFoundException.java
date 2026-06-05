package com.cogschecker.foodcost.api.exception;

/**
 * Exception thrown when a requested resource (ingredient, recipe, venue, etc.) is not found.
 */
public class ResourceNotFoundException extends DomainException {
    
    public ResourceNotFoundException(String errorCode, String message) {
        super(errorCode, message);
    }
}
