package com.cogschecker.foodcost.api.exception;

import com.cogschecker.foodcost.api.dto.ErrorResponse;
import com.cogschecker.foodcost.shared.ErrorCodes;
import com.cogschecker.foodcost.shared.IncompatibleUomException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.HashMap;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Global exception handler for all REST controllers.
 * Maps domain exceptions and validation errors to standard ErrorResponse format.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger logger = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /**
     * Handle all custom domain exceptions.
     */
    @ExceptionHandler(DomainException.class)
    public ResponseEntity<ErrorResponse> handleDomainException(
            DomainException ex, 
            HttpServletRequest request) {
        
        logger.warn("Domain exception: {} - {}", ex.getErrorCode(), ex.getMessage());
        
        HttpStatus status = determineHttpStatus(ex);
        ErrorResponse error = new ErrorResponse(
            ex.getErrorCode(),
            ex.getMessage(),
            request.getRequestURI(),
            ex.getDetails()
        );
        
        return ResponseEntity.status(status).body(error);
    }

    /**
     * Handle IncompatibleUomException from shared module.
     */
    @ExceptionHandler(IncompatibleUomException.class)
    public ResponseEntity<ErrorResponse> handleIncompatibleUomException(
            IncompatibleUomException ex,
            HttpServletRequest request) {
        
        logger.warn("UOM incompatibility: {}", ex.getMessage());
        
        Map<String, Object> details = Map.of(
            "from_unit", ex.getFromUnit().getSymbol(),
            "to_unit", ex.getToUnit().getSymbol(),
            "from_dimension", ex.getFromUnit().getDimension().name(),
            "to_dimension", ex.getToUnit().getDimension().name()
        );
        
        ErrorResponse error = new ErrorResponse(
            ErrorCodes.UOM_INCOMPATIBLE_DIMENSIONS,
            ex.getMessage(),
            request.getRequestURI(),
            details
        );
        
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
    }

    /**
     * Handle InvalidFileTypeException for file uploads.
     */
    @ExceptionHandler(InvalidFileTypeException.class)
    public ResponseEntity<ErrorResponse> handleInvalidFileTypeException(
            InvalidFileTypeException ex,
            HttpServletRequest request) {
        
        logger.warn("Invalid file type: {}", ex.getMessage());
        
        ErrorResponse error = new ErrorResponse(
            "INVALID_FILE_TYPE",
            ex.getMessage(),
            request.getRequestURI()
        );
        
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
    }

    /**
     * Handle FileSizeExceededException for file uploads.
     */
    @ExceptionHandler(FileSizeExceededException.class)
    public ResponseEntity<ErrorResponse> handleFileSizeExceededException(
            FileSizeExceededException ex,
            HttpServletRequest request) {
        
        logger.warn("File size exceeded: {}", ex.getMessage());
        
        ErrorResponse error = new ErrorResponse(
            "FILE_SIZE_EXCEEDED",
            ex.getMessage(),
            request.getRequestURI()
        );
        
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
    }

    /**
     * Handle authentication exceptions from Cognito operations.
     */
    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<ErrorResponse> handleAuthenticationException(
            AuthenticationException ex,
            HttpServletRequest request) {
        
        logger.warn("Authentication exception: {}", ex.getMessage());
        
        ErrorResponse error = new ErrorResponse(
            ErrorCodes.AUTH_INVALID_CREDENTIALS,
            ex.getMessage(),
            request.getRequestURI()
        );
        
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(error);
    }

    /**
     * Handle IllegalArgumentException for invalid method arguments.
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ErrorResponse> handleIllegalArgumentException(
            IllegalArgumentException ex,
            HttpServletRequest request) {
        
        logger.warn("Illegal argument: {}", ex.getMessage());
        
        ErrorResponse error = new ErrorResponse(
            ErrorCodes.VALIDATION_CONSTRAINT_VIOLATION,
            ex.getMessage(),
            request.getRequestURI()
        );
        
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
    }

    /**
     * Handle Spring validation errors (@Valid on request bodies).
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidationException(
            MethodArgumentNotValidException ex,
            HttpServletRequest request) {
        
        Map<String, Object> fieldErrors = ex.getBindingResult()
            .getFieldErrors()
            .stream()
            .collect(Collectors.toMap(
                FieldError::getField,
                fieldError -> fieldError.getDefaultMessage() != null 
                    ? fieldError.getDefaultMessage() 
                    : "Invalid value",
                (existing, replacement) -> existing
            ));
        
        logger.warn("Validation failed for request {}: {}", request.getRequestURI(), fieldErrors);
        
        ErrorResponse error = new ErrorResponse(
            ErrorCodes.VALIDATION_CONSTRAINT_VIOLATION,
            "Validation failed for one or more fields",
            request.getRequestURI(),
            Map.of("field_errors", fieldErrors)
        );
        
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
    }

    /**
     * Handle constraint violations (e.g., @NotNull on method parameters).
     */
    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ErrorResponse> handleConstraintViolationException(
            ConstraintViolationException ex,
            HttpServletRequest request) {
        
        Map<String, String> violations = new HashMap<>();
        ex.getConstraintViolations().forEach(violation -> {
            String propertyPath = violation.getPropertyPath().toString();
            violations.put(propertyPath, violation.getMessage());
        });
        
        logger.warn("Constraint violation for request {}: {}", request.getRequestURI(), violations);
        
        ErrorResponse error = new ErrorResponse(
            ErrorCodes.VALIDATION_CONSTRAINT_VIOLATION,
            "Constraint violation occurred",
            request.getRequestURI(),
            Map.of("violations", violations)
        );
        
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
    }

    /**
     * Handle Spring Security access denied exceptions.
     */
    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ErrorResponse> handleAccessDeniedException(
            AccessDeniedException ex,
            HttpServletRequest request) {
        
        logger.warn("Access denied for request {}: {}", request.getRequestURI(), ex.getMessage());
        
        ErrorResponse error = new ErrorResponse(
            ErrorCodes.AUTH_INSUFFICIENT_PERMISSIONS,
            "Access denied: insufficient permissions",
            request.getRequestURI()
        );
        
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(error);
    }

    /**
     * Handle all other unhandled exceptions.
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleGenericException(
            Exception ex,
            HttpServletRequest request) {
        
        logger.error("Unexpected error for request {}", request.getRequestURI(), ex);
        
        ErrorResponse error = new ErrorResponse(
            "INTERNAL_ERROR",
            "An unexpected error occurred. Please try again later.",
            request.getRequestURI()
        );
        
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error);
    }

    /**
     * Determine the appropriate HTTP status code for a domain exception.
     */
    private HttpStatus determineHttpStatus(DomainException ex) {
        if (ex instanceof ResourceNotFoundException) {
            return HttpStatus.NOT_FOUND;
        } else if (ex instanceof DuplicateResourceException) {
            return HttpStatus.CONFLICT;
        } else if (ex instanceof DeleteConflictException) {
            return HttpStatus.CONFLICT;
        } else if (ex instanceof CircularReferenceException) {
            return HttpStatus.CONFLICT;
        } else if (ex instanceof ValidationException) {
            return HttpStatus.BAD_REQUEST;
        } else if (ex instanceof InsufficientPermissionsException) {
            return HttpStatus.FORBIDDEN;
        } else if (ex instanceof SubscriptionTierException) {
            return HttpStatus.PAYMENT_REQUIRED;
        } else if (ex instanceof WebhookSignatureException) {
            return HttpStatus.UNAUTHORIZED;
        } else if (ex instanceof InvoiceConfirmationException) {
            return HttpStatus.BAD_REQUEST;
        } else if (ex instanceof InvalidInvoiceStateException) {
            return HttpStatus.CONFLICT;
        }
        return HttpStatus.BAD_REQUEST;
    }
}
