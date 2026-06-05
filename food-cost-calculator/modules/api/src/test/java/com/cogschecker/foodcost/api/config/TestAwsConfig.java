package com.cogschecker.foodcost.api.config;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Profile;
import org.springframework.web.client.RestTemplate;
import software.amazon.awssdk.services.kms.KmsClient;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;

import static org.mockito.Mockito.mock;

/**
 * Test configuration for AWS services.
 * Provides mock implementations of AWS SDK clients for testing.
 */
@TestConfiguration
@Profile("test")
public class TestAwsConfig {
    
    @Bean
    public KmsClient kmsClient() {
        return mock(KmsClient.class);
    }
    
    @Bean
    public SecretsManagerClient secretsManagerClient() {
        return mock(SecretsManagerClient.class);
    }
    
    @Bean
    public RestTemplate restTemplate() {
        return mock(RestTemplate.class);
    }
}
