package com.cogschecker.foodcost.api.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Service for managing Server-Sent Events (SSE) connections and Redis pub/sub subscriptions
 * for real-time cost update notifications.
 * <p>
 * When a client connects to the SSE endpoint, this service:
 * <ol>
 *   <li>Creates an SseEmitter for the client</li>
 *   <li>Subscribes to the Redis pub/sub channel: venue:{venueId}:costs</li>
 *   <li>Forwards COST_UPDATED events from Redis to the client via SSE</li>
 *   <li>Cleans up the subscription when the client disconnects</li>
 * </ol>
 * <p>
 * Multiple clients can subscribe to the same venue's cost updates. The service manages
 * per-venue subscriptions and only subscribes to Redis once per venue (shared subscription).
 * <p>
 * Requirements: 3.3 - Real-time cost propagation notifications
 * <p>
 * Note: This service is only active when RedisMessageListenerContainer bean is available
 * (provided by Spring Boot auto-configuration when spring-data-redis is on the classpath).
 */
@Service
@ConditionalOnBean(RedisMessageListenerContainer.class)
public class CostEventSseService {

    private static final Logger logger = LoggerFactory.getLogger(CostEventSseService.class);
    private static final long SSE_TIMEOUT = 30 * 60 * 1000; // 30 minutes

    private final RedisMessageListenerContainer redisMessageListenerContainer;
    private final ObjectMapper objectMapper;

    // Map of venueId -> list of SSE emitters subscribed to that venue
    private final Map<UUID, CopyOnWriteArrayList<SseEmitter>> venueEmitters = new ConcurrentHashMap<>();

    // Map of venueId -> Redis message listener (one listener per venue, shared by all clients)
    private final Map<UUID, MessageListener> venueListeners = new ConcurrentHashMap<>();

    public CostEventSseService(
            RedisMessageListenerContainer redisMessageListenerContainer,
            ObjectMapper objectMapper) {
        this.redisMessageListenerContainer = redisMessageListenerContainer;
        this.objectMapper = objectMapper;
    }

    /**
     * Create an SSE emitter for a client subscribing to cost updates for a venue.
     * <p>
     * This method:
     * <ol>
     *   <li>Creates a new SseEmitter with a 30-minute timeout</li>
     *   <li>Subscribes to the Redis channel venue:{venueId}:costs (if not already subscribed)</li>
     *   <li>Registers the emitter to receive events from Redis</li>
     *   <li>Sets up cleanup handlers for completion, timeout, and error</li>
     * </ol>
     * <p>
     * The SSE connection stays open until:
     * <ul>
     *   <li>The client closes the connection</li>
     *   <li>30 minutes elapse without activity</li>
     *   <li>An error occurs</li>
     * </ul>
     * 
     * @param venueId the venue ID to subscribe to
     * @return an SseEmitter for the client
     */
    public SseEmitter subscribeToVenueCostUpdates(UUID venueId) {
        logger.info("Client subscribing to cost updates for venue: {}", venueId);

        SseEmitter emitter = new SseEmitter(SSE_TIMEOUT);

        // Add emitter to venue's subscriber list
        venueEmitters.computeIfAbsent(venueId, k -> new CopyOnWriteArrayList<>()).add(emitter);

        // Subscribe to Redis channel if this is the first client for this venue
        if (!venueListeners.containsKey(venueId)) {
            subscribeToRedisChannel(venueId);
        }

        // Setup cleanup handlers
        Runnable cleanup = () -> {
            logger.debug("Cleaning up SSE connection for venue: {}", venueId);
            CopyOnWriteArrayList<SseEmitter> emitters = venueEmitters.get(venueId);
            if (emitters != null) {
                emitters.remove(emitter);
                
                // If no more clients for this venue, unsubscribe from Redis
                if (emitters.isEmpty()) {
                    unsubscribeFromRedisChannel(venueId);
                    venueEmitters.remove(venueId);
                }
            }
        };

        emitter.onCompletion(cleanup);
        emitter.onTimeout(cleanup);
        emitter.onError(e -> {
            logger.warn("SSE error for venue {}: {}", venueId, e.getMessage());
            cleanup.run();
        });

        // Send initial connection confirmation
        try {
            emitter.send(SseEmitter.event()
                    .name("connected")
                    .data(Map.of("venueId", venueId.toString())));
        } catch (IOException e) {
            logger.error("Failed to send connection confirmation to client for venue {}: {}",
                    venueId, e.getMessage());
            emitter.completeWithError(e);
        }

        logger.info("Client successfully subscribed to cost updates for venue: {}", venueId);
        return emitter;
    }

    /**
     * Subscribe to the Redis pub/sub channel for a venue's cost updates.
     * <p>
     * Creates a MessageListener that forwards COST_UPDATED events to all connected SSE clients
     * for this venue.
     * <p>
     * The listener parses the JSON event payload and sends it to each client via SSE.
     * If a client's emitter fails, it is automatically cleaned up.
     */
    private void subscribeToRedisChannel(UUID venueId) {
        String channelName = "venue:" + venueId + ":costs";
        logger.info("Subscribing to Redis channel: {}", channelName);

        MessageListener listener = (Message message, byte[] pattern) -> {
            try {
                String messageBody = new String(message.getBody());
                logger.debug("Received COST_UPDATED event on channel {}: {}", channelName, messageBody);

                // Parse event to extract recipeIds
                @SuppressWarnings("unchecked")
                Map<String, Object> event = objectMapper.readValue(messageBody, Map.class);

                // Forward to all SSE clients subscribed to this venue
                CopyOnWriteArrayList<SseEmitter> emitters = venueEmitters.get(venueId);
                if (emitters != null && !emitters.isEmpty()) {
                    for (SseEmitter emitter : emitters) {
                        try {
                            emitter.send(SseEmitter.event()
                                    .name("COST_UPDATED")
                                    .data(event));
                            logger.debug("Forwarded COST_UPDATED event to SSE client for venue {}", venueId);
                        } catch (IOException e) {
                            logger.warn("Failed to send event to SSE client for venue {}: {}",
                                    venueId, e.getMessage());
                            // The emitter error handler will clean it up
                            emitter.completeWithError(e);
                        }
                    }
                } else {
                    logger.debug("No SSE clients connected for venue {}", venueId);
                }
            } catch (Exception e) {
                logger.error("Error processing COST_UPDATED event for venue {}: {}",
                        venueId, e.getMessage(), e);
            }
        };

        venueListeners.put(venueId, listener);
        redisMessageListenerContainer.addMessageListener(listener, new ChannelTopic(channelName));

        logger.info("Successfully subscribed to Redis channel: {}", channelName);
    }

    /**
     * Unsubscribe from the Redis pub/sub channel for a venue.
     * <p>
     * Called when the last SSE client for a venue disconnects.
     */
    private void unsubscribeFromRedisChannel(UUID venueId) {
        String channelName = "venue:" + venueId + ":costs";
        logger.info("Unsubscribing from Redis channel: {}", channelName);

        MessageListener listener = venueListeners.remove(venueId);
        if (listener != null) {
            redisMessageListenerContainer.removeMessageListener(listener);
            logger.info("Successfully unsubscribed from Redis channel: {}", channelName);
        }
    }
}
