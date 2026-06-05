package com.cogschecker.foodcost.workers.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.bedrockruntime.BedrockRuntimeClient;
import software.amazon.awssdk.services.kms.KmsClient;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;
import software.amazon.awssdk.services.ses.SesClient;
import software.amazon.awssdk.services.textract.TextractClient;

/**
 * AWS service client configuration for OCR, AI, and email services.
 * <p>
 * Configures:
 * <ul>
 *   <li><b>Textract:</b> Invoice OCR processing (Requirement 12.7)</li>
 *   <li><b>Bedrock:</b> AI insights generation using Anthropic Claude (Requirement 13.4)</li>
 *   <li><b>SES:</b> Transactional email notifications (password reset, processing failures)</li>
 * </ul>
 * <p>
 * All clients use {@link DefaultCredentialsProvider} which automatically loads credentials from:
 * <ul>
 *   <li>IAM Roles for Service Accounts (IRSA) when running in EKS</li>
 *   <li>EC2 instance metadata when running on EC2</li>
 *   <li>Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) for local dev</li>
 *   <li>AWS CLI credentials file (~/.aws/credentials) as fallback</li>
 * </ul>
 * <p>
 * In production, workers run in EKS with IRSA-granted IAM roles that have least-privilege policies:
 * <ul>
 *   <li>Textract: {@code textract:AnalyzeDocument}</li>
 *   <li>Bedrock: {@code bedrock:InvokeModel} (claude-3-sonnet only)</li>
 *   <li>SES: {@code ses:SendEmail}, {@code ses:SendTemplatedEmail}</li>
 * </ul>
 */
@Configuration
public class AwsServicesConfig {

    @Value("${aws.region:us-east-1}")
    private String awsRegion;

    /**
     * AWS Textract client for invoice OCR processing.
     * <p>
     * Used by {@code OcrProcessingWorker} to extract structured table data from
     * uploaded PDF and image invoices. Calls {@code AnalyzeDocument} API with TABLES feature.
     * <p>
     * <b>IAM Permissions Required:</b>
     * <pre>
     * {
     *   "Effect": "Allow",
     *   "Action": "textract:AnalyzeDocument",
     *   "Resource": "*"
     * }
     * </pre>
     *
     * @see <a href="https://docs.aws.amazon.com/textract/latest/dg/API_AnalyzeDocument.html">Textract API</a>
     */
    @Bean
    public TextractClient textractClient() {
        return TextractClient.builder()
                .region(Region.of(awsRegion))
                .credentialsProvider(DefaultCredentialsProvider.create())
                .build();
    }

    /**
     * Amazon Bedrock Runtime client for AI-powered insights generation.
     * <p>
     * Used by {@code AiInsightsWorker} to generate:
     * <ul>
     *   <li>Recipe profitability recommendations (ingredient substitutions, portion adjustments)</li>
     *   <li>Supplier cost analysis (price change alerts, negotiation recommendations)</li>
     * </ul>
     * <p>
     * Invokes the Anthropic Claude 3 Sonnet model via Bedrock's {@code InvokeModel} API.
     * Model ID: {@code anthropic.claude-3-sonnet-20240229-v1:0}
     * <p>
     * <b>IAM Permissions Required:</b>
     * <pre>
     * {
     *   "Effect": "Allow",
     *   "Action": "bedrock:InvokeModel",
     *   "Resource": "arn:aws:bedrock:*::foundation-model/anthropic.claude-3-sonnet-*"
     * }
     * </pre>
     * <p>
     * <b>Data Residency:</b> All inference data stays in the configured AWS region.
     * No data is sent to third-party AI providers.
     *
     * @see <a href="https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-claude.html">Bedrock Claude Models</a>
     */
    @Bean
    public BedrockRuntimeClient bedrockRuntimeClient() {
        return BedrockRuntimeClient.builder()
                .region(Region.of(awsRegion))
                .credentialsProvider(DefaultCredentialsProvider.create())
                .build();
    }

    /**
     * Amazon SES client for transactional email delivery.
     * <p>
     * Used to send:
     * <ul>
     *   <li>Password reset emails (Requirement 8.7)</li>
     *   <li>User invitation emails (Requirement 9.7)</li>
     *   <li>Invoice processing failure notifications (Requirement 12.7)</li>
     *   <li>Subscription payment failure alerts (Requirement 11.8)</li>
     * </ul>
     * <p>
     * <b>IAM Permissions Required:</b>
     * <pre>
     * {
     *   "Effect": "Allow",
     *   "Action": [
     *     "ses:SendEmail",
     *     "ses:SendTemplatedEmail"
     *   ],
     *   "Resource": "arn:aws:ses:*:*:identity/*"
     * }
     * </pre>
     * <p>
     * <b>Verified Identities:</b> SES requires sender email addresses or domains to be verified.
     * In production, verify the domain (e.g., noreply@cogschecker.com).
     * In development, verify individual test email addresses.
     *
     * @see <a href="https://docs.aws.amazon.com/ses/latest/dg/send-email-api.html">SES API Reference</a>
     */
    @Bean
    public SesClient sesClient() {
        return SesClient.builder()
                .region(Region.of(awsRegion))
                .credentialsProvider(DefaultCredentialsProvider.create())
                .build();
    }
    
    /**
     * AWS Secrets Manager client for retrieving sensitive configuration.
     * <p>
     * Used to fetch:
     * <ul>
     *   <li>Square OAuth client ID and secret (for token refresh)</li>
     *   <li>Stripe webhook signing secret</li>
     *   <li>Database credentials (in production)</li>
     * </ul>
     * <p>
     * <b>IAM Permissions Required:</b>
     * <pre>
     * {
     *   "Effect": "Allow",
     *   "Action": "secretsmanager:GetSecretValue",
     *   "Resource": "arn:aws:secretsmanager:*:*:secret:food-cost-calculator/*"
     * }
     * </pre>
     */
    @Bean
    public SecretsManagerClient secretsManagerClient() {
        return SecretsManagerClient.builder()
                .region(Region.of(awsRegion))
                .credentialsProvider(DefaultCredentialsProvider.create())
                .build();
    }
    
    /**
     * AWS KMS client for encrypting and decrypting sensitive data.
     * <p>
     * Used to encrypt/decrypt Square OAuth tokens before storing in the database.
     * <p>
     * <b>IAM Permissions Required:</b>
     * <pre>
     * {
     *   "Effect": "Allow",
     *   "Action": [
     *     "kms:Decrypt",
     *     "kms:Encrypt"
     *   ],
     *   "Resource": "arn:aws:kms:*:*:key/*"
     * }
     * </pre>
     */
    @Bean
    public KmsClient kmsClient() {
        return KmsClient.builder()
                .region(Region.of(awsRegion))
                .credentialsProvider(DefaultCredentialsProvider.create())
                .build();
    }
}
