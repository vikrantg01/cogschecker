package com.cogschecker.foodcost.api.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.web.client.RestTemplate;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.kms.KmsClient;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;

/**
 * AWS SDK configuration for KMS and Secrets Manager clients.
 * Requirements: 12.1 (KMS for Square token encryption)
 */
@Configuration
@Profile("!test")
public class AwsConfig {
    
    @Value("${aws.region:ap-southeast-2}")
    private String awsRegion;
    
    @Bean
    public KmsClient kmsClient() {
        return KmsClient.builder()
                .region(Region.of(awsRegion))
                .build();
    }
    
    @Bean
    public SecretsManagerClient secretsManagerClient() {
        return SecretsManagerClient.builder()
                .region(Region.of(awsRegion))
                .build();
    }
    
    @Bean
    public S3Client s3Client() {
        return S3Client.builder()
                .region(Region.of(awsRegion))
                .build();
    }
    
    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }
}
