package com.cogschecker.foodcost.workers.config;

import org.springframework.batch.core.configuration.annotation.EnableBatchProcessing;
import org.springframework.context.annotation.Configuration;

/**
 * Spring Batch configuration for job registry and infrastructure.
 * <p>
 * Spring Batch is used for:
 * <ul>
 *   <li>Cost propagation batch jobs (recalculate all recipes affected by ingredient change)</li>
 *   <li>Square POS sync batch jobs (bulk menu item price updates)</li>
 *   <li>AI insights generation (batch process recipes and sales data)</li>
 * </ul>
 * <p>
 * Spring Batch stores job execution metadata in the same PostgreSQL database
 * (tables: BATCH_JOB_INSTANCE, BATCH_JOB_EXECUTION, BATCH_STEP_EXECUTION).
 * <p>
 * {@code @EnableBatchProcessing} activates Spring Batch auto-configuration, which:
 * <ul>
 *   <li>Creates {@code JobRepository} backed by the application's DataSource</li>
 *   <li>Creates {@code JobLauncher} for programmatic job execution</li>
 *   <li>Creates {@code JobExplorer} for read-only metadata access</li>
 *   <li>Creates {@code JobRegistry} for dynamic job lookup by name</li>
 *   <li>Initializes Spring Batch metadata tables if they don't exist</li>
 * </ul>
 * <p>
 * Job registry allows dynamic lookup and launching of batch jobs by name,
 * which is used for scheduled jobs and SQS-triggered job orchestration.
 * <p>
 * <b>Usage in workers:</b>
 * <pre>{@code
 * @Autowired
 * private JobLauncher jobLauncher;
 * 
 * @Autowired
 * private Job costPropagationJob;
 * 
 * public void processCostPropagation(String ingredientId) throws Exception {
 *     JobParameters params = new JobParametersBuilder()
 *         .addString("ingredientId", ingredientId)
 *         .addLong("timestamp", System.currentTimeMillis())
 *         .toJobParameters();
 *     jobLauncher.run(costPropagationJob, params);
 * }
 * }</pre>
 */
@Configuration
@EnableBatchProcessing
public class BatchConfig {
    // Spring Boot auto-configuration handles all bean creation
    // No custom overrides needed for standard configuration
}
