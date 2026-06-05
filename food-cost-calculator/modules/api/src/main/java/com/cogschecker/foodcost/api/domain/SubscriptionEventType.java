package com.cogschecker.foodcost.api.domain;

/**
 * Subscription event type enum for history tracking.
 * Requirement 11.9
 */
public enum SubscriptionEventType {
    CREATED,
    UPGRADED,
    DOWNGRADED,
    DOWNGRADE_SCHEDULED,
    DOWNGRADE_CANCELLED,
    PAYMENT_SUCCEEDED,
    PAYMENT_FAILED,
    PAYMENT_RECOVERED
}
