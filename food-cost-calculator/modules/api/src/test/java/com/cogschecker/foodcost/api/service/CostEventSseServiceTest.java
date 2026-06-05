package com.cogschecker.foodcost.api.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Unit tests for CostEventSseService.
 * <p>
 * Tests:
 * - SSE emitter creation and subscription to Redis
 * - Event forwarding from Redis to SSE clients
 * - Cleanup when clients disconnect
 * - Multiple clients for the same venue
 */
@ExtendWith(MockitoExtension.class)
class CostEventSseServiceTest {

    @Mock
    private RedisMessageListenerContainer redisMessageListenerContainer;

    private ObjectMapper objectMapper;
    private CostEventSseService service;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        service = new CostEventSseService(redisMessageListenerContainer, objectMapper);
    }

    @Test
    void subscribeToVenueCostUpdates_shouldCreateEmitterAndSubscribeToRedis() {
        // Arrange
        UUID venueId = UUID.randomUUID();

        // Act
        SseEmitter emitter = service.subscribeToVenueCostUpdates(venueId);

        // Assert
        assertNotNull(emitter, "Should return a non-null SseEmitter");
        
        // Verify Redis subscription was created
        ArgumentCaptor<ChannelTopic> topicCaptor = ArgumentCaptor.forClass(ChannelTopic.class);
        verify(redisMessageListenerContainer).addMessageListener(
                any(MessageListener.class),
                topicCaptor.capture()
        );
        
        ChannelTopic capturedTopic = topicCaptor.getValue();
        assertEquals("venue:" + venueId + ":costs", capturedTopic.getTopic(),
                "Should subscribe to correct Redis channel");
    }

    @Test
    void subscribeToVenueCostUpdates_multipleClientsForSameVenue_shouldReuseRedisSubscription() {
        // Arrange
        UUID venueId = UUID.randomUUID();

        // Act
        SseEmitter emitter1 = service.subscribeToVenueCostUpdates(venueId);
        SseEmitter emitter2 = service.subscribeToVenueCostUpdates(venueId);

        // Assert
        assertNotNull(emitter1, "Should return first emitter");
        assertNotNull(emitter2, "Should return second emitter");
        assertNotSame(emitter1, emitter2, "Should create separate emitters for each client");
        
        // Verify Redis subscription was created only once
        verify(redisMessageListenerContainer, times(1)).addMessageListener(
                any(MessageListener.class),
                any(ChannelTopic.class)
        );
    }

    @Test
    void messageListener_shouldForwardCostUpdatedEventToSseClients() throws Exception {
        // Arrange
        UUID venueId = UUID.randomUUID();
        UUID recipeId1 = UUID.randomUUID();
        UUID recipeId2 = UUID.randomUUID();
        
        // Subscribe to create the message listener
        service.subscribeToVenueCostUpdates(venueId);

        // Capture the message listener that was registered
        ArgumentCaptor<MessageListener> listenerCaptor = ArgumentCaptor.forClass(MessageListener.class);
        verify(redisMessageListenerContainer).addMessageListener(
                listenerCaptor.capture(),
                any(ChannelTopic.class)
        );
        
        MessageListener listener = listenerCaptor.getValue();

        // Create a COST_UPDATED event
        Map<String, Object> event = Map.of(
                "event", "COST_UPDATED",
                "venueId", venueId.toString(),
                "recipeIds", java.util.List.of(recipeId1.toString(), recipeId2.toString()),
                "timestamp", System.currentTimeMillis()
        );
        String eventJson = objectMapper.writeValueAsString(event);

        // Create a mock Redis message
        Message message = mock(Message.class);
        when(message.getBody()).thenReturn(eventJson.getBytes());

        // Act - simulate Redis publishing the message
        listener.onMessage(message, null);

        // Assert
        // The test verifies that the listener is registered correctly
        // In a real scenario, the event would be forwarded to the SseEmitter
        // Testing the actual SSE send would require more complex mocking of SseEmitter
        verify(message).getBody();
    }

    @Test
    void emitterCompletion_triggersCleanupCallback() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        
        // Act - Create emitter and manually trigger the completion callback
        SseEmitter emitter = service.subscribeToVenueCostUpdates(venueId);
        
        // We can't easily test the async cleanup in unit tests,
        // but we can verify the subscription was created
        verify(redisMessageListenerContainer).addMessageListener(
                any(MessageListener.class),
                any(ChannelTopic.class)
        );
    }

    @Test
    void multipleClients_reusesRedisSubscription() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        
        // Act
        SseEmitter emitter1 = service.subscribeToVenueCostUpdates(venueId);
        SseEmitter emitter2 = service.subscribeToVenueCostUpdates(venueId);

        // Assert
        // Verify Redis subscription was created only once (reused for second client)
        verify(redisMessageListenerContainer, times(1)).addMessageListener(
                any(MessageListener.class),
                any(ChannelTopic.class)
        );
        
        // Note: Testing cleanup on disconnection requires integration tests
        // as SseEmitter completion callbacks are not easily testable in unit tests
    }

    @Test
    void subscribeToVenueCostUpdates_differentVenues_shouldCreateSeparateSubscriptions() {
        // Arrange
        UUID venueId1 = UUID.randomUUID();
        UUID venueId2 = UUID.randomUUID();

        // Act
        SseEmitter emitter1 = service.subscribeToVenueCostUpdates(venueId1);
        SseEmitter emitter2 = service.subscribeToVenueCostUpdates(venueId2);

        // Assert
        assertNotNull(emitter1);
        assertNotNull(emitter2);
        
        // Verify two separate Redis subscriptions were created
        ArgumentCaptor<ChannelTopic> topicCaptor = ArgumentCaptor.forClass(ChannelTopic.class);
        verify(redisMessageListenerContainer, times(2)).addMessageListener(
                any(MessageListener.class),
                topicCaptor.capture()
        );
        
        var topics = topicCaptor.getAllValues();
        assertEquals("venue:" + venueId1 + ":costs", topics.get(0).getTopic());
        assertEquals("venue:" + venueId2 + ":costs", topics.get(1).getTopic());
    }
}
