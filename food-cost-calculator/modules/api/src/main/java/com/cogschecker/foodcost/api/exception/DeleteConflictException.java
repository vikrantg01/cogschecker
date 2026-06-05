package com.cogschecker.foodcost.api.exception;

import java.util.List;
import java.util.Map;

/**
 * Exception thrown when attempting to delete a resource that is referenced by other resources.
 * Requirement 1.8: Display warning with affected recipe names and require confirmation.
 */
public class DeleteConflictException extends DomainException {
    
    public DeleteConflictException(String errorCode, String message, List<String> affectedResources) {
        super(errorCode, message, Map.of("affected_resources", affectedResources));
    }
    
    public DeleteConflictException(String errorCode, String message, Map<String, Object> details) {
        super(errorCode, message, details);
    }
}
