package com.cogschecker.foodcost.api.exception;

import com.cogschecker.foodcost.shared.ErrorCodes;

/**
 * Exception thrown when a user attempts an action they don't have permission for.
 */
public class InsufficientPermissionsException extends DomainException {
    
    public InsufficientPermissionsException(String message) {
        super(ErrorCodes.AUTH_INSUFFICIENT_PERMISSIONS, message);
    }
}
