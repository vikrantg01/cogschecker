package com.cogschecker.foodcost.api.exception;

import com.cogschecker.foodcost.api.dto.ErrorResponse;
import com.cogschecker.foodcost.shared.ErrorCodes;
import com.cogschecker.foodcost.shared.IncompatibleUomException;
import com.cogschecker.foodcost.shared.UomEnum;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * Unit tests for GlobalExceptionHandler.
 */
class GlobalExceptionHandlerTest {

    private GlobalExceptionHandler handler;

    @Mock
    private HttpServletRequest request;

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);
        handler = new GlobalExceptionHandler();
        when(request.getRequestURI()).thenReturn("/api/v1/test");
    }

    @Test
    void shouldHandleResourceNotFoundException() {
        ResourceNotFoundException ex = new ResourceNotFoundException(
            ErrorCodes.INGREDIENT_NOT_FOUND,
            "Ingredient not found"
        );

        ResponseEntity<ErrorResponse> response = handler.handleDomainException(ex, request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getErrorCode()).isEqualTo(ErrorCodes.INGREDIENT_NOT_FOUND);
        assertThat(response.getBody().getMessage()).isEqualTo("Ingredient not found");
        assertThat(response.getBody().getPath()).isEqualTo("/api/v1/test");
    }

    @Test
    void shouldHandleDuplicateResourceException() {
        DuplicateResourceException ex = new DuplicateResourceException(
            ErrorCodes.INGREDIENT_DUPLICATE_NAME,
            "Ingredient name already exists"
        );

        ResponseEntity<ErrorResponse> response = handler.handleDomainException(ex, request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getErrorCode()).isEqualTo(ErrorCodes.INGREDIENT_DUPLICATE_NAME);
    }

    @Test
    void shouldHandleValidationException() {
        ValidationException ex = new ValidationException(
            ErrorCodes.VALIDATION_OUT_OF_RANGE,
            "Value out of range",
            Map.of("field", "yield_percentage", "min", 1, "max", 100)
        );

        ResponseEntity<ErrorResponse> response = handler.handleDomainException(ex, request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getDetails()).isNotNull();
        assertThat(response.getBody().getDetails()).containsKey("field");
    }

    @Test
    void shouldHandleInsufficientPermissionsException() {
        InsufficientPermissionsException ex = new InsufficientPermissionsException(
            "Staff users cannot delete ingredients"
        );

        ResponseEntity<ErrorResponse> response = handler.handleDomainException(ex, request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getErrorCode()).isEqualTo(ErrorCodes.AUTH_INSUFFICIENT_PERMISSIONS);
    }

    @Test
    void shouldHandleSubscriptionTierException() {
        SubscriptionTierException ex = new SubscriptionTierException(
            "This feature requires Pro tier"
        );

        ResponseEntity<ErrorResponse> response = handler.handleDomainException(ex, request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.PAYMENT_REQUIRED);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getErrorCode()).isEqualTo(ErrorCodes.SUBSCRIPTION_FEATURE_NOT_AVAILABLE);
    }

    @Test
    void shouldHandleIncompatibleUomException() {
        IncompatibleUomException ex = new IncompatibleUomException(
            UomEnum.GRAM,
            UomEnum.MILLILITRE
        );

        ResponseEntity<ErrorResponse> response = handler.handleIncompatibleUomException(ex, request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getErrorCode()).isEqualTo(ErrorCodes.UOM_INCOMPATIBLE_DIMENSIONS);
        assertThat(response.getBody().getDetails()).isNotNull();
        assertThat(response.getBody().getDetails()).containsKeys("from_unit", "to_unit", "from_dimension", "to_dimension");
    }

    @Test
    void shouldHandleAccessDeniedException() {
        AccessDeniedException ex = new AccessDeniedException("Access denied");

        ResponseEntity<ErrorResponse> response = handler.handleAccessDeniedException(ex, request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getErrorCode()).isEqualTo(ErrorCodes.AUTH_INSUFFICIENT_PERMISSIONS);
    }

    @Test
    void shouldHandleGenericException() {
        Exception ex = new RuntimeException("Unexpected error");

        ResponseEntity<ErrorResponse> response = handler.handleGenericException(ex, request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getErrorCode()).isEqualTo("INTERNAL_ERROR");
        assertThat(response.getBody().getMessage()).contains("unexpected error");
    }
}
