package com.cogschecker.foodcost.api.exception;

import com.cogschecker.foodcost.shared.ErrorCodes;

/**
 * Exception thrown when a feature requires a higher subscription tier.
 */
public class SubscriptionTierException extends DomainException {
    
    public SubscriptionTierException(String message) {
        super(ErrorCodes.SUBSCRIPTION_FEATURE_NOT_AVAILABLE, message);
    }
}
