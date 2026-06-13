package com.cogschecker.foodcost.workers.config;

import com.amazonaws.xray.AWSXRay;
import com.amazonaws.xray.entities.Segment;
import com.amazonaws.xray.entities.Subsegment;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.messaging.Message;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;

/**
 * AOP interceptor for SQS message processing to add correlation ID and X-Ray tracing.
 * 
 * This aspect:
 * - Intercepts all @SqsListener methods
 * - Extracts or generates a correlation ID from the message
 * - Adds the correlation ID to MDC for structured logging
 * - Creates an X-Ray subsegment for the message processing
 * - Cleans up MDC after processing
 * 
 * The correlation ID is propagated from the API when it sends the message,
 * or generated if not present.
 */
@Aspect
@Component
public class SqsMessageTracingInterceptor {
    
    private static final Logger logger = LoggerFactory.getLogger(SqsMessageTracingInterceptor.class);
    private static final String CORRELATION_ID_KEY = "correlationId";
    private static final String XRAY_TRACE_ID_KEY = "xrayTraceId";
    private static final String SQS_MESSAGE_ID_KEY = "sqsMessageId";
    
    /**
     * Intercept all methods annotated with @SqsListener.
     * 
     * The pointcut matches any method with the @SqsListener annotation,
     * extracts the message payload, and adds tracing context.
     */
    @Around("@annotation(io.awspring.cloud.sqs.annotation.SqsListener)")
    public Object aroundSqsListener(ProceedingJoinPoint joinPoint) throws Throwable {
        Subsegment subsegment = null;
        
        try {
            // Extract message from method arguments
            Object[] args = joinPoint.getArgs();
            String correlationId = null;
            String messageId = null;
            String jobName = joinPoint.getSignature().getDeclaringType().getSimpleName() + "." + 
                            joinPoint.getSignature().getName();
            
            // Try to extract correlation ID from message
            for (Object arg : args) {
                if (arg instanceof Message<?>) {
                    Message<?> message = (Message<?>) arg;
                    messageId = (String) message.getHeaders().get("MessageId");
                    
                    // Try to extract correlation ID from message attributes
                    Object payload = message.getPayload();
                    if (payload instanceof Map) {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> payloadMap = (Map<String, Object>) payload;
                        correlationId = (String) payloadMap.get(CORRELATION_ID_KEY);
                    }
                } else if (arg instanceof Map) {
                    // Direct map payload
                    @SuppressWarnings("unchecked")
                    Map<String, Object> payloadMap = (Map<String, Object>) arg;
                    correlationId = (String) payloadMap.get(CORRELATION_ID_KEY);
                } else if (arg instanceof String) {
                    // Could be message ID
                    if (messageId == null && arg.toString().matches("[a-f0-9-]{36}")) {
                        messageId = (String) arg;
                    }
                }
            }
            
            // Generate correlation ID if not present
            if (correlationId == null || correlationId.trim().isEmpty()) {
                correlationId = UUID.randomUUID().toString();
            }
            
            // Add to MDC for structured logging
            MDC.put(CORRELATION_ID_KEY, correlationId);
            MDC.put("jobName", jobName);
            
            if (messageId != null) {
                MDC.put(SQS_MESSAGE_ID_KEY, messageId);
            }
            
            // Create X-Ray subsegment for this SQS message processing
            try {
                subsegment = AWSXRay.beginSubsegment(jobName);
                if (subsegment != null) {
                    subsegment.putAnnotation(CORRELATION_ID_KEY, correlationId);
                    subsegment.putAnnotation("jobName", jobName);
                    if (messageId != null) {
                        subsegment.putAnnotation(SQS_MESSAGE_ID_KEY, messageId);
                    }
                    
                    // Add X-Ray trace ID to MDC for cross-referencing
                    Segment segment = AWSXRay.getCurrentSegmentOptional().orElse(null);
                    if (segment != null) {
                        String traceId = segment.getTraceId().toString();
                        MDC.put(XRAY_TRACE_ID_KEY, traceId);
                    }
                }
            } catch (Exception e) {
                logger.debug("X-Ray subsegment creation failed, continuing without it", e);
            }
            
            logger.info("Processing SQS message for job: {}", jobName);
            
            // Proceed with the actual method execution
            Object result = joinPoint.proceed();
            
            // Mark subsegment as successful
            if (subsegment != null) {
                subsegment.putMetadata("status", "success");
            }
            
            logger.info("Successfully processed SQS message for job: {}", jobName);
            
            return result;
            
        } catch (Throwable t) {
            // Mark subsegment as failed and add exception
            if (subsegment != null) {
                subsegment.addException(t);
                subsegment.putMetadata("status", "error");
            }
            
            logger.error("Failed to process SQS message", t);
            throw t;
            
        } finally {
            // End X-Ray subsegment
            if (subsegment != null) {
                try {
                    AWSXRay.endSubsegment();
                } catch (Exception e) {
                    logger.debug("Failed to end X-Ray subsegment", e);
                }
            }
            
            // Always clear MDC to prevent memory leaks
            MDC.clear();
        }
    }
}
