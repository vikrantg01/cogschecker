package com.cogschecker.foodcost.workers.worker;

import com.cogschecker.foodcost.workers.service.RecipeCostRecalculationService;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.awspring.cloud.sqs.annotation.SqsListener;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * SQS listener for cost propagation jobs.
 * <p>
 * This worker processes messages from the cost-propagation.fifo SQS queue.
 * When an ingredient's price, quantity, or yield changes, the API enqueues a message
 * containing the venue ID and ingredient ID.
 * <p>
 * The worker then:
 * <ol>
 *   <li>Executes a recursive CTE to find all recipes that transitively depend on the ingredient</li>
 *   <li>Sorts recipes by dependency depth (leaves first)</li>
 *   <li>Recalculates each recipe's cost in order within a single transaction</li>
 *   <li>Batch updates all affected recipes in the database</li>
 *   <li>Publishes a COST_UPDATED event to Redis pub/sub for real-time frontend updates</li>
 * </ol>
 * <p>
 * Requirements: 3.3 - Automatic cost recalculation within 2 seconds of ingredient update
 */
@Component
public class CostPropagationWorker {

    private static final Logger logger = LoggerFactory.getLogger(CostPropagationWorker.class);

    private final RecipeCostRecalculationService recalculationService;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    public CostPropagationWorker(
            RecipeCostRecalculationService recalculationService,
            StringRedisTemplate redisTemplate,
            ObjectMapper objectMapper) {
        this.recalculationService = recalculationService;
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
    }

    /**
     * Process cost propagation messages from the cost-propagation.fifo SQS queue.
     * <p>
     * Message payload format:
     * <pre>
     * {
     *   "venueId": "uuid",
     *   "ingredientId": "uuid",
     *   "timestamp": 1234567890
     * }
     * </pre>
     * <p>
     * The @SqsListener annotation:
     * <ul>
     *   <li>Automatically polls the queue for messages</li>
     *   <li>Deserializes JSON payload to Map</li>
     *   <li>Acknowledges (deletes) message on successful processing</li>
     *   <li>Returns message to queue on exception (up to maxReceiveCount, then moves to DLQ)</li>
     * </ul>
     * <p>
     * FIFO queue guarantees:
     * <ul>
     *   <li>Messages for the same ingredient are processed in order (message group ID = ingredientId)</li>
     *   <li>Exactly-once processing (message deduplication)</li>
     * </ul>
     * <p>
     * Requirements: 3.3
     * 
     * @param message the SQS message payload
     */
    @SqsListener("${sqs.queue.cost-propagation}")
    public void processCostPropagation(Map<String, String> message) {
        String venueIdStr = message.get("venueId");
        String ingredientIdStr = message.get("ingredientId");
        String timestamp = message.get("timestamp");
        
        logger.info("Received cost propagation job for ingredient {} in venue {} (timestamp: {})",
                ingredientIdStr, venueIdStr, timestamp);
        
        // Validate message payload
        if (venueIdStr == null || ingredientIdStr == null) {
            logger.error("Invalid message payload: venueId or ingredientId is null");
            throw new IllegalArgumentException("Invalid message payload: venueId and ingredientId are required");
        }
        
        UUID venueId;
        UUID ingredientId;
        try {
            venueId = UUID.fromString(venueIdStr);
            ingredientId = UUID.fromString(ingredientIdStr);
        } catch (IllegalArgumentException e) {
            logger.error("Invalid UUID format in message: venueId={}, ingredientId={}", venueIdStr, ingredientIdStr);
            throw new IllegalArgumentException("Invalid UUID format in message payload", e);
        }
        
        try {
            // Step 1: Recalculate all dependent recipes
            List<UUID> recalculatedRecipeIds = recalculationService.recalculateDependentRecipeCosts(venueId, ingredientId);
            
            if (recalculatedRecipeIds.isEmpty()) {
                logger.info("No recipes to recalculate for ingredient {}", ingredientId);
                return;
            }
            
            // Step 2: Publish COST_UPDATED event to Redis pub/sub
            publishCostUpdatedEvent(venueId, recalculatedRecipeIds);
            
            logger.info("Successfully processed cost propagation for ingredient {} - {} recipes recalculated",
                    ingredientId, recalculatedRecipeIds.size());
            
        } catch (Exception e) {
            logger.error("Failed to process cost propagation for ingredient {} in venue {}: {}",
                    ingredientId, venueId, e.getMessage(), e);
            // Re-throw to trigger SQS retry and eventual DLQ delivery
            throw new RuntimeException("Cost propagation failed", e);
        }
    }

    /**
     * Publish a COST_UPDATED event to the Redis pub/sub channel for the venue.
     * <p>
     * Frontend clients subscribe to the channel: venue:{venueId}:costs
     * <p>
     * When they receive a COST_UPDATED event, they invalidate cached recipe data
     * and refetch the updated costs from the API.
     * <p>
     * Event payload format:
     * <pre>
     * {
     *   "event": "COST_UPDATED",
     *   "venueId": "uuid",
     *   "recipeIds": ["uuid1", "uuid2", ...],
     *   "timestamp": 1234567890
     * }
     * </pre>
     * <p>
     * Requirements: 3.3 - Real-time frontend notification of cost updates
     * 
     * @param venueId the venue ID
     * @param recipeIds the list of recipe IDs that were recalculated
     */
    private void publishCostUpdatedEvent(UUID venueId, List<UUID> recipeIds) {
        try {
            String channel = "venue:" + venueId + ":costs";
            
            Map<String, Object> event = Map.of(
                    "event", "COST_UPDATED",
                    "venueId", venueId.toString(),
                    "recipeIds", recipeIds.stream().map(UUID::toString).toList(),
                    "timestamp", System.currentTimeMillis()
            );
            
            String eventJson = objectMapper.writeValueAsString(event);
            
            Long subscriberCount = redisTemplate.convertAndSend(channel, eventJson);
            
            logger.debug("Published COST_UPDATED event to channel {} - {} subscribers notified",
                    channel, subscriberCount);
            
        } catch (Exception e) {
            // Log error but don't fail the job - the API can still fetch updated costs via polling
            logger.error("Failed to publish COST_UPDATED event to Redis for venue {}: {}",
                    venueId, e.getMessage(), e);
        }
    }
}
