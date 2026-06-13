# Multi-stage Docker build for Spring Boot Workers
# Optimized for minimal image size and security

# Stage 1: Build layer extraction
FROM eclipse-temurin:21-jre-jammy AS builder
WORKDIR /app

# Copy the pre-built JAR file
COPY build/libs/*.jar app.jar

# Extract layers for better Docker layer caching
RUN java -Djarmode=layertools -jar app.jar extract

# Stage 2: Runtime image
FROM eclipse-temurin:21-jre-jammy

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Set working directory
WORKDIR /app

# Copy extracted layers from builder stage
COPY --from=builder /app/dependencies/ ./
COPY --from=builder /app/spring-boot-loader/ ./
COPY --from=builder /app/snapshot-dependencies/ ./
COPY --from=builder /app/application/ ./

# Change ownership to non-root user
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# No port exposure needed for workers (they consume from SQS queues)

# Health check for worker liveness (if health endpoint exists)
# HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
#   CMD curl -f http://localhost:8081/actuator/health || exit 1

# Run the application
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
