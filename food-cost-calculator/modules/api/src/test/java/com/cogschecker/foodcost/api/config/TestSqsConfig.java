package com.cogschecker.foodcost.api.config;

import io.awspring.cloud.sqs.operations.SqsTemplate;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

import static org.mockito.Mockito.mock;

/**
 * Test configuration that provides a mock SqsTemplate for integration tests.
 * This allows services that depend on SQS to be tested without an actual SQS connection.
 */
@TestConfiguration
public class TestSqsConfig {

    @Bean
    @Primary
    public SqsTemplate sqsTemplate() {
        return mock(SqsTemplate.class);
    }
}
