package com.cogschecker.foodcost.api.service;

import io.awspring.cloud.sqs.operations.SqsTemplate;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;

/**
 * Unit tests for CostPropagationService.
 * Tests Requirements: 1.3, 3.3
 */
@ExtendWith(MockitoExtension.class)
class CostPropagationServiceTest {

    @Mock
    private SqsTemplate sqsTemplate;

    private CostPropagationService costPropagationService;

    private final String queueUrl = "https://sqs.us-east-1.amazonaws.com/123456789012/cost-propagation.fifo";

    @BeforeEach
    void setUp() {
        costPropagationService = new CostPropagationService(sqsTemplate, queueUrl);
    }

    @Test
    void enqueue_ValidVenueAndIngredient_SendsMessageToSqs() {
        // Given
        UUID venueId = UUID.randomUUID();
        UUID ingredientId = UUID.randomUUID();

        // When
        costPropagationService.enqueue(venueId, ingredientId);

        // Then - verify that send was called on SqsTemplate
        verify(sqsTemplate).send(any());
    }
}
