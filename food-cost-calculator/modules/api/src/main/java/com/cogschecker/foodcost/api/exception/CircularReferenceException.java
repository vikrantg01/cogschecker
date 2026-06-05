package com.cogschecker.foodcost.api.exception;

import com.cogschecker.foodcost.shared.ErrorCodes;

/**
 * Exception thrown when attempting to create a circular reference in the recipe sub-recipe graph.
 * Requirement 2.4 - Circular reference detection
 * 
 * This exception is mapped to HTTP 409 Conflict.
 */
public class CircularReferenceException extends DomainException {
    
    public CircularReferenceException(String message) {
        super(ErrorCodes.RECIPE_CIRCULAR_REFERENCE, message);
    }
}
