package com.cogschecker.foodcost.api.exception;

/**
 * Exception thrown when a webhook signature verification fails.
 * Indicates that the webhook request is not from a trusted source.
 */
public class WebhookSignatureException extends DomainException {
    
    public WebhookSignatureException(String errorCode, String message) {
        super(errorCode, message);
    }
    
    public WebhookSignatureException(String errorCode, String message, Throwable cause) {
        super(errorCode, message, cause);
    }
}
