package com.cogschecker.foodcost.workers.worker;

import com.cogschecker.foodcost.workers.service.RecipeCostRecalculationService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for CostPropagationWorker.
 * <p>
 * Tests:
 * - Valid message processing
 * - Invalid message handling (null venueId, invalid UUID)
 * - Redis event publishing
 * - Error handling and retries
 */
@ExtendWith(MockitoExtension.class)
class CostPropagationWorkerTest {

    @Mock
    private RecipeCostRecalculationService recalculationService;

    @Mock
    private StringRedisTemplate redisTemplate;

    private ObjectMapper objectMapper;
    private CostPropagationWorker worker;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        worker = new CostPropagationWorker(recalculationService, redisTemplate, objectMapper);
    }

    @Test
    void processCostPropagation_validMessage_shouldRecalculateAndPublish() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        UUID ingredientId = UUID.randomUUID();
        UUID recipe1 = UUID.randomUUID();
        UUID recipe2 = UUID.randomUUID();
        
        Map<String, String> message = new HashMap<>();
        message.put("venueId", venueId.toString());
        message.put("ingredientId", ingredientId.toString());
        message.put("timestamp", String.valueOf(System.currentTimeMillis()));
        
        when(recalculationService.recalculateDependentRecipeCosts(venueId, ingredientId))
                .thenReturn(Arrays.asList(recipe1, recipe2));
        
        when(redisTemplate.convertAndSend(anyString(), anyString()))
                .thenReturn(2L); // 2 subscribers notified
        
        // Act
        worker.processCostPropagation(message);
        
        // Assert
        verify(recalculationService).recalculateDependentRecipeCosts(venueId, ingredientId);
        verify(redisTemplate).convertAndSend(
                eq("venue:" + venueId + ":costs"),
                contains("COST_UPDATED")
        );
    }

    @Test
    void processCostPropagation_noRecipesToRecalculate_shouldNotPublish() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        UUID ingredientId = UUID.randomUUID();
        
        Map<String, String> message = new HashMap<>();
        message.put("venueId", venueId.toString());
        message.put("ingredientId", ingredientId.toString());
        message.put("timestamp", String.valueOf(System.currentTimeMillis()));
        
        when(recalculationService.recalculateDependentRecipeCosts(venueId, ingredientId))
                .thenReturn(Collections.emptyList());
        
        // Act
        worker.processCostPropagation(message);
        
        // Assert
        verify(recalculationService).recalculateDependentRecipeCosts(venueId, ingredientId);
        verify(redisTemplate, never()).convertAndSend(anyString(), anyString());
    }

    @Test
    void processCostPropagation_nullVenueId_shouldThrowException() {
        // Arrange
        Map<String, String> message = new HashMap<>();
        message.put("venueId", null);
        message.put("ingredientId", UUID.randomUUID().toString());
        message.put("timestamp", String.valueOf(System.currentTimeMillis()));
        
        // Act & Assert
        assertThrows(IllegalArgumentException.class, () -> worker.processCostPropagation(message));
        verify(recalculationService, never()).recalculateDependentRecipeCosts(any(), any());
    }

    @Test
    void processCostPropagation_nullIngredientId_shouldThrowException() {
        // Arrange
        Map<String, String> message = new HashMap<>();
        message.put("venueId", UUID.randomUUID().toString());
        message.put("ingredientId", null);
        message.put("timestamp", String.valueOf(System.currentTimeMillis()));
        
        // Act & Assert
        assertThrows(IllegalArgumentException.class, () -> worker.processCostPropagation(message));
        verify(recalculationService, never()).recalculateDependentRecipeCosts(any(), any());
    }

    @Test
    void processCostPropagation_invalidVenueIdFormat_shouldThrowException() {
        // Arrange
        Map<String, String> message = new HashMap<>();
        message.put("venueId", "not-a-uuid");
        message.put("ingredientId", UUID.randomUUID().toString());
        message.put("timestamp", String.valueOf(System.currentTimeMillis()));
        
        // Act & Assert
        assertThrows(IllegalArgumentException.class, () -> worker.processCostPropagation(message));
        verify(recalculationService, never()).recalculateDependentRecipeCosts(any(), any());
    }

    @Test
    void processCostPropagation_recalculationServiceThrows_shouldPropagateException() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        UUID ingredientId = UUID.randomUUID();
        
        Map<String, String> message = new HashMap<>();
        message.put("venueId", venueId.toString());
        message.put("ingredientId", ingredientId.toString());
        message.put("timestamp", String.valueOf(System.currentTimeMillis()));
        
        when(recalculationService.recalculateDependentRecipeCosts(venueId, ingredientId))
                .thenThrow(new RuntimeException("Database connection failed"));
        
        // Act & Assert
        assertThrows(RuntimeException.class, () -> worker.processCostPropagation(message));
        verify(redisTemplate, never()).convertAndSend(anyString(), anyString());
    }

    @Test
    void processCostPropagation_redisPublishFails_shouldNotFailJob() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        UUID ingredientId = UUID.randomUUID();
        UUID recipe1 = UUID.randomUUID();
        
        Map<String, String> message = new HashMap<>();
        message.put("venueId", venueId.toString());
        message.put("ingredientId", ingredientId.toString());
        message.put("timestamp", String.valueOf(System.currentTimeMillis()));
        
        when(recalculationService.recalculateDependentRecipeCosts(venueId, ingredientId))
                .thenReturn(Collections.singletonList(recipe1));
        
        when(redisTemplate.convertAndSend(anyString(), anyString()))
                .thenThrow(new RuntimeException("Redis connection failed"));
        
        // Act - should not throw exception
        assertDoesNotThrow(() -> worker.processCostPropagation(message));
        
        // Assert - recalculation should still complete
        verify(recalculationService).recalculateDependentRecipeCosts(venueId, ingredientId);
    }
}
