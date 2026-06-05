package com.cogschecker.foodcost.workers;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.web.servlet.WebMvcAutoConfiguration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Spring Boot entry point for the Workers application.
 * <p>
 * This application processes asynchronous jobs such as:
 * <ul>
 *   <li>Cost propagation when ingredient prices change (Requirement 3.3)</li>
 *   <li>Square POS menu sync (Requirement 12.2, 12.7)</li>
 *   <li>Invoice OCR processing with Textract (Requirement 12.7)</li>
 *   <li>AI insights generation with Bedrock (Requirement 13.4)</li>
 * </ul>
 * <p>
 * Spring MVC is explicitly excluded because workers expose no HTTP endpoints.
 * All work is triggered by SQS messages or scheduled jobs.
 */
@SpringBootApplication(
    exclude = {WebMvcAutoConfiguration.class},
    scanBasePackages = {
        "com.cogschecker.foodcost.workers",
        "com.cogschecker.foodcost.api.service",
        "com.cogschecker.foodcost.shared"
    }
)
@EnableScheduling
@org.springframework.boot.autoconfigure.domain.EntityScan(basePackages = {
    "com.cogschecker.foodcost.api.domain",
    "com.cogschecker.foodcost.workers.domain"
})
@org.springframework.data.jpa.repository.config.EnableJpaRepositories(basePackages = {
    "com.cogschecker.foodcost.workers.repository",
    "com.cogschecker.foodcost.api.repository"
})
public class WorkerApplication {

    public static void main(String[] args) {
        SpringApplication.run(WorkerApplication.class, args);
    }
}
