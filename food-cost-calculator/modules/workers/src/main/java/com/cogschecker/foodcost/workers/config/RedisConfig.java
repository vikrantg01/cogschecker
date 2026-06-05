package com.cogschecker.foodcost.workers.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

/**
 * Redis configuration for cost update event publishing.
 * <p>
 * Redis is used for real-time pub/sub notifications to frontend clients when recipe costs change.
 * After the CostPropagationWorker recalculates recipe costs, it publishes a COST_UPDATED event
 * to the channel: venue:{venueId}:costs
 * <p>
 * Requirements: 3.3 - Real-time cost propagation notifications
 */
@Configuration
public class RedisConfig {

    @Value("${redis.host:localhost}")
    private String redisHost;

    @Value("${redis.port:6379}")
    private int redisPort;

    @Value("${redis.password:}")
    private String redisPassword;

    /**
     * Redis connection factory using Lettuce client (async, high-performance).
     * <p>
     * In production (EKS), connects to Amazon ElastiCache Redis cluster (Cluster mode).
     * Connection details are injected via environment variables from Kubernetes Secrets.
     * <p>
     * In local development, connects to localhost:6379 (standard Redis port).
     */
    @Bean
    public RedisConnectionFactory redisConnectionFactory() {
        RedisStandaloneConfiguration config = new RedisStandaloneConfiguration();
        config.setHostName(redisHost);
        config.setPort(redisPort);
        
        // Set password only if provided (not set in local dev)
        if (redisPassword != null && !redisPassword.trim().isEmpty()) {
            config.setPassword(redisPassword);
        }
        
        return new LettuceConnectionFactory(config);
    }

    /**
     * Redis template for publishing string messages to pub/sub channels.
     * <p>
     * Used by CostPropagationWorker to publish COST_UPDATED events after recipe recalculation.
     * <p>
     * Message format: JSON string with fields:
     * <pre>
     * {
     *   "event": "COST_UPDATED",
     *   "venueId": "uuid",
     *   "recipeIds": ["uuid1", "uuid2", ...],
     *   "timestamp": 1234567890
     * }
     * </pre>
     */
    @Bean
    public StringRedisTemplate stringRedisTemplate(RedisConnectionFactory connectionFactory) {
        return new StringRedisTemplate(connectionFactory);
    }
}
