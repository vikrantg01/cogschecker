package com.cogschecker.foodcost.api.exception;

import com.cogschecker.foodcost.shared.ErrorCodes;

/**
 * Exception thrown when a tier limit is exceeded.
 * For example, when a Free tier venue attempts to create more than 25 recipes.
 * Requirement 2.12
 */
public class TierLimitExceededException extends DomainException {
    
    public TierLimitExceededException(String message) {
        super(ErrorCodes.RECIPE_TIER_LIMIT_EXCEEDED, message);
    }
    
    public TierLimitExceededException(String errorCode, String message) {
        super(errorCode, message);
    }
}
