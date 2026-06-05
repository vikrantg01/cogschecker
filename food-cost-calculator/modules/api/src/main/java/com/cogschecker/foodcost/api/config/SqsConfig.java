package com.cogschecker.foodcost.api.config;

import io.awspring.cloud.sqs.operations.SqsTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sqs.SqsAsyncClient;

/**
 * AWS SQS configuration for the API module.
 * <p>
 * The API module uses SQS to enqueue asynchronous jobs that are processed by the Worker module.
 * This configuration provides an SqsTemplate for fire-and-forget message sending.
 * <p>
 * Requirements: 3.3 - Cost propagation triggered after ingredient updates
 */
@Configuration
public class SqsConfig {

    @Value("${aws.region:ap-southeast-2}")
    private String awsRegion;

    /**
     * Async SQS client for sending messages to queues.
     * Uses DefaultCredentialsProvider to automatically load credentials from:
     * - Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
     * - IAM role (IRSA in EKS)
     * - AWS credentials file
     */
    @Bean
    public SqsAsyncClient sqsAsyncClient() {
        return SqsAsyncClient.builder()
                .region(Region.of(awsRegion))
                .credentialsProvider(DefaultCredentialsProvider.create())
                .build();
    }

    /**
     * SQS template for sending messages to queues from the API.
     * Used by services to enqueue async jobs (cost propagation, OCR, etc.).
     */
    @Bean
    public SqsTemplate sqsTemplate(SqsAsyncClient sqsAsyncClient) {
        return SqsTemplate.newTemplate(sqsAsyncClient);
    }
}
