package com.cogschecker.foodcost.workers.config;

import io.awspring.cloud.sqs.config.SqsMessageListenerContainerFactory;
import io.awspring.cloud.sqs.operations.SqsTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sqs.SqsAsyncClient;

import java.time.Duration;

/**
 * Spring Cloud AWS SQS configuration for async job processing.
 * <p>
 * Configures SQS listeners for:
 * <ul>
 *   <li>Cost propagation queue (triggered by ingredient price updates) — Requirement 3.3</li>
 *   <li>Square sync queue (scheduled + on-demand syncs) — Requirement 12.7</li>
 *   <li>OCR processing queue (invoice upload pipeline) — Requirement 12.7</li>
 *   <li>AI insights queue (scheduled insight generation) — Requirement 13.4</li>
 * </ul>
 * <p>
 * All queues use FIFO ordering to prevent out-of-order processing and have DLQs configured.
 */
@Configuration
public class SqsConfig {

    @Value("${aws.region:us-east-1}")
    private String awsRegion;

    /**
     * Async SQS client for high-throughput message processing.
     * Uses DefaultCredentialsProvider to automatically load credentials from:
     * - Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
     * - EC2 instance metadata (IRSA for EKS pods)
     * - AWS CLI credentials file
     */
    @Bean
    public SqsAsyncClient sqsAsyncClient() {
        return SqsAsyncClient.builder()
                .region(Region.of(awsRegion))
                .credentialsProvider(DefaultCredentialsProvider.create())
                .build();
    }

    /**
     * SQS listener container factory with tuned concurrency and visibility timeout settings.
     * <p>
     * Configuration:
     * <ul>
     *   <li><b>Max concurrent messages per queue:</b> 10 (horizontal scaling via multiple pods)</li>
     *   <li><b>Visibility timeout:</b> 300 seconds (5 minutes) — allows long-running OCR/AI jobs</li>
     *   <li><b>Poll timeout:</b> 10 seconds (long polling reduces empty receives)</li>
     *   <li><b>Acknowledgment mode:</b> AUTO (message deleted on successful processing)</li>
     * </ul>
     * <p>
     * If a worker crashes or processing exceeds visibility timeout, the message returns to the queue
     * and is redelivered up to maxReceiveCount (3 attempts) before moving to DLQ.
     */
    @Bean
    public SqsMessageListenerContainerFactory<Object> defaultSqsListenerContainerFactory(
            SqsAsyncClient sqsAsyncClient) {
        return SqsMessageListenerContainerFactory
                .builder()
                .sqsAsyncClient(sqsAsyncClient)
                .configure(options -> options
                        // Maximum number of messages processed concurrently per listener
                        .maxConcurrentMessages(10)
                        // Maximum number of messages to fetch in a single poll (batching)
                        .maxMessagesPerPoll(10)
                        // Time a message is hidden from other consumers while being processed
                        .messageVisibility(Duration.ofSeconds(300))
                        // Long polling: wait up to 10 seconds for messages to arrive
                        .pollTimeout(Duration.ofSeconds(10))
                )
                .build();
    }

    /**
     * SQS template for sending messages to queues from the API or worker orchestration.
     * Workers primarily consume messages, but may also enqueue follow-up jobs
     * (e.g., cost propagation triggering additional recipe recalculations).
     */
    @Bean
    public SqsTemplate sqsTemplate(SqsAsyncClient sqsAsyncClient) {
        return SqsTemplate.newTemplate(sqsAsyncClient);
    }
}
