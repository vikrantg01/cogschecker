package com.cogschecker.foodcost.api.exception;

/**
 * Exception thrown when authentication or authorization operations fail.
 */
public class AuthenticationException extends RuntimeException {

    public AuthenticationException(String message) {
        super(message);
    }

    public AuthenticationException(String message, Throwable cause) {
        super(message, cause);
    }
}
