package com.cogschecker.foodcost.api.service;

import io.awspring.cloud.sqs.operations.SqsTemplate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Service for triggering asynchronous cost propagation after ingredient updates.
 * <p>
 * When an ingredient's price, quantity, or yield changes, this service enqueues a message
 * to the cost-propagation.fifo SQS queue. The Worker module consumes these messages and
 * recalculates the cost for all recipes that directly or transitively reference the ingredient.
 * <p>
 * This is a fire-and-forget operation - the API returns immediately without waiting for
 * the recalculation to complete.
 * <p>
 * Requirements: 1.3, 3.3 - Automatic cost recalculation within 2 seconds
 */
@Service
public class CostPropagationService {

    private static final Logger logger = LoggerFactory.getLogger(CostPropagationService.class);

    private final SqsTemplate sqsTemplate;
    private final String queueUrl;

    public CostPropagationService(
            SqsTemplate sqsTemplate,
            @Value("${sqs.queue.cost-propagation}") String queueUrl) {
        this.sqsTemplate = sqsTemplate;
        this.queueUrl = queueUrl;
    }

    /**
     * Enqueue a cost propagation job for the given venue and ingredient.
     * <p>
     * The message is sent to a FIFO queue with the ingredientId as the message group ID,
     * ensuring that updates to the same ingredient are processed in order.
     * <p>
     * The correlation ID from the current request context (MDC) is propagated to the
     * worker for distributed tracing.
     * <p>
     * Requirements: 1.3, 3.3
     *
     * @param venueId      the venue ID
     * @param ingredientId the ingredient ID that was updated
     */
    public void enqueue(UUID venueId, UUID ingredientId) {
        logger.info("Enqueuing cost propagation job for ingredient {} in venue {}", ingredientId, venueId);

        try {
            // Create message payload
            Map<String, String> message = new HashMap<>();
            message.put("venueId", venueId.toString());
            message.put("ingredientId", ingredientId.toString());
            message.put("timestamp", String.valueOf(System.currentTimeMillis()));
            
            // Propagate correlation ID from current request context
            String correlationId = MDC.get("correlationId");
            if (correlationId != null) {
                message.put("correlationId", correlationId);
            }

            // Send to FIFO queue with message group ID = ingredientId
            // This ensures updates to the same ingredient are processed in order
            sqsTemplate.send(to -> to
                    .queue(queueUrl)
                    .payload(message)
                    .header("message-group-id", ingredientId.toString())
                    .header("message-deduplication-id", venueId.toString() + "-" + ingredientId.toString() + "-" + System.currentTimeMillis())
            );

            logger.debug("Successfully enqueued cost propagation job for ingredient {}", ingredientId);

        } catch (Exception e) {
            // Log error but don't fail the ingredient update
            // The worker can be triggered manually or via a scheduled sweep if needed
            logger.error("Failed to enqueue cost propagation job for ingredient {} in venue {}: {}",
                    ingredientId, venueId, e.getMessage(), e);
        }
    }
}
