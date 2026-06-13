package com.cogschecker.foodcost.api.config;

import com.amazonaws.xray.AWSXRay;
import com.amazonaws.xray.AWSXRayRecorderBuilder;
import com.amazonaws.xray.jakarta.servlet.AWSXRayServletFilter;
import com.amazonaws.xray.plugins.EC2Plugin;
import com.amazonaws.xray.plugins.EKSPlugin;
import com.amazonaws.xray.strategy.sampling.LocalizedSamplingStrategy;
import jakarta.servlet.Filter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;

import java.net.URL;

/**
 * AWS X-Ray distributed tracing configuration.
 * 
 * This configuration:
 * - Enables X-Ray tracing for all HTTP requests via servlet filter
 * - Configures sampling rules to control trace collection rate
 * - Registers EC2 and EKS plugins for metadata enrichment
 * - Enables automatic instrumentation of AWS SDK v2 clients (S3, SQS, etc.)
 * 
 * X-Ray tracing is enabled by default in non-local profiles.
 * To disable, set: aws.xray.enabled=false
 */
@Configuration
@ConditionalOnProperty(name = "aws.xray.enabled", havingValue = "true", matchIfMissing = true)
public class XRayConfig {
    
    private static final Logger logger = LoggerFactory.getLogger(XRayConfig.class);
    
    @Value("${spring.application.name:food-cost-calculator-api}")
    private String applicationName;
    
    @Value("${aws.xray.sampling-rules:classpath:xray-sampling-rules.json}")
    private String samplingRulesPath;
    
    /**
     * Initialize AWS X-Ray recorder with plugins and sampling strategy.
     * 
     * The recorder is configured with:
     * - EKS plugin: adds Kubernetes metadata (pod name, namespace, cluster name)
     * - EC2 plugin: adds EC2 instance metadata (instance ID, availability zone)
     * - Sampling rules: controls which requests to trace (default: sample all in dev/staging, 10% in prod)
     * 
     * @return the configured AWSXRayRecorderBuilder for injection if needed
     */
    @Bean
    public AWSXRayRecorderBuilder xrayRecorderBuilder() {
        logger.info("Configuring AWS X-Ray distributed tracing for {}", applicationName);
        
        try {
            AWSXRayRecorderBuilder builder = AWSXRayRecorderBuilder.standard()
                    // Add EKS and EC2 metadata to traces
                    .withPlugin(new EKSPlugin())
                    .withPlugin(new EC2Plugin());
            
            // Configure sampling strategy from rules file if available
            try {
                ClassPathResource samplingResource = new ClassPathResource("xray-sampling-rules.json");
                if (samplingResource.exists()) {
                    URL samplingRulesUrl = samplingResource.getURL();
                    builder.withSamplingStrategy(new LocalizedSamplingStrategy(samplingRulesUrl));
                    logger.info("Loaded X-Ray sampling rules from {}", samplingRulesPath);
                } else {
                    logger.info("No custom sampling rules found, using default X-Ray sampling");
                }
            } catch (Exception e) {
                logger.warn("Failed to load X-Ray sampling rules, using defaults", e);
            }
            
            // Set the global recorder
            AWSXRay.setGlobalRecorder(builder.build());
            
            logger.info("AWS X-Ray recorder initialized successfully");
            
            return builder;
            
        } catch (Exception e) {
            logger.error("Failed to initialize AWS X-Ray recorder", e);
            // Don't fail startup if X-Ray initialization fails
            return AWSXRayRecorderBuilder.standard();
        }
    }
    
    /**
     * Register X-Ray servlet filter to trace incoming HTTP requests.
     * 
     * This filter:
     * - Creates a new X-Ray segment for each request
     * - Captures request/response metadata (URL, method, status code)
     * - Automatically propagates trace context to outbound AWS SDK calls
     * - Ends the segment when the request completes
     */
    @Bean
    public Filter tracingFilter() {
        logger.info("Registering AWS X-Ray servlet filter");
        return new AWSXRayServletFilter(applicationName);
    }
}
