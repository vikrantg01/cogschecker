"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecretsStack = void 0;
const cdk = require("aws-cdk-lib");
const kms = require("aws-cdk-lib/aws-kms");
const secretsmanager = require("aws-cdk-lib/aws-secretsmanager");
const iam = require("aws-cdk-lib/aws-iam");
/**
 * SecretsStack
 *
 * Provisions KMS Customer Managed Keys (CMKs) and AWS Secrets Manager secrets
 * for the Food Cost Calculator application.
 *
 * **KMS CMKs:**
 *  • Database encryption key      — encrypts Aurora cluster at rest + Secrets Manager DB secret
 *  • Square OAuth token key       — encrypts Square access/refresh tokens in the database
 *  • Stripe webhook secret key    — encrypts Stripe webhook signing secret
 *  • Application secrets key      — encrypts Bedrock API keys and other app-level secrets
 *
 * **Secrets Manager Secrets:**
 *  • Database credentials         — Aurora PostgreSQL master user + password (auto-rotation enabled)
 *  • Stripe API key               — Stripe secret key for subscription billing
 *  • Stripe webhook secret        — Stripe webhook signing secret for signature verification
 *  • Square OAuth credentials     — Square application ID and secret for OAuth flow
 *  • Bedrock configuration        — Amazon Bedrock model configuration (Pro+ tier AI insights)
 *
 * **Security:**
 *  • All CMKs have automatic key rotation enabled (365-day cycle)
 *  • CMK key policies grant least-privilege access to EKS service accounts (via IRSA)
 *  • Database secret has automatic rotation enabled (30-day rotation window)
 *  • Secrets are tagged for cost allocation and compliance auditing
 *
 * Satisfies Requirement 12.1: Secure storage and encryption of sensitive API keys and OAuth tokens.
 */
class SecretsStack extends cdk.Stack {
    /** KMS CMK for database encryption (Aurora at-rest + DB credentials secret). */
    databaseEncryptionKey;
    /** KMS CMK for encrypting Square OAuth access/refresh tokens in RDS. */
    squareTokenEncryptionKey;
    /** KMS CMK for Stripe webhook signing secret. */
    stripeWebhookSecretKey;
    /** KMS CMK for application-level secrets (Bedrock, etc.). */
    applicationSecretsKey;
    /** Secrets Manager secret: Aurora PostgreSQL master credentials (with auto-rotation). */
    databaseCredentialsSecret;
    /** Secrets Manager secret: Stripe API secret key for billing. */
    stripeApiKeySecret;
    /** Secrets Manager secret: Stripe webhook signing secret. */
    stripeWebhookSecret;
    /** Secrets Manager secret: Square OAuth application credentials. */
    squareOAuthSecret;
    /** Secrets Manager secret: Amazon Bedrock configuration (Pro+ AI insights). */
    bedrockConfigSecret;
    constructor(scope, id, props) {
        super(scope, id, props);
        const { envName } = props;
        // ── KMS CMKs ─────────────────────────────────────────────────────────────
        // 1. Database Encryption Key
        //    Used for: Aurora cluster storage encryption + Secrets Manager DB secret encryption
        this.databaseEncryptionKey = new kms.Key(this, 'DatabaseEncryptionKey', {
            alias: `fcc-db-${envName}`,
            description: 'CMK for Aurora PostgreSQL cluster and DB credentials secret encryption',
            enableKeyRotation: true, // Automatic annual key rotation
            removalPolicy: cdk.RemovalPolicy.RETAIN, // Prevent accidental deletion of encryption keys
            pendingWindow: cdk.Duration.days(30), // 30-day waiting period before key deletion if removed
        });
        // Tag for cost allocation and compliance
        cdk.Tags.of(this.databaseEncryptionKey).add('Component', 'Database');
        cdk.Tags.of(this.databaseEncryptionKey).add('Environment', envName);
        // 2. Square Token Encryption Key
        //    Used for: Encrypting Square OAuth access/refresh tokens stored in the `square_connections` table
        this.squareTokenEncryptionKey = new kms.Key(this, 'SquareTokenEncryptionKey', {
            alias: `fcc-square-token-${envName}`,
            description: 'CMK for encrypting Square OAuth tokens in RDS',
            enableKeyRotation: true,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            pendingWindow: cdk.Duration.days(30),
        });
        cdk.Tags.of(this.squareTokenEncryptionKey).add('Component', 'Square Integration');
        cdk.Tags.of(this.squareTokenEncryptionKey).add('Environment', envName);
        // 3. Stripe Webhook Secret Key
        //    Used for: Encrypting the Stripe webhook signing secret used for signature verification
        this.stripeWebhookSecretKey = new kms.Key(this, 'StripeWebhookSecretKey', {
            alias: `fcc-stripe-webhook-${envName}`,
            description: 'CMK for Stripe webhook signing secret',
            enableKeyRotation: true,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            pendingWindow: cdk.Duration.days(30),
        });
        cdk.Tags.of(this.stripeWebhookSecretKey).add('Component', 'Billing');
        cdk.Tags.of(this.stripeWebhookSecretKey).add('Environment', envName);
        // 4. Application Secrets Key
        //    Used for: General application secrets (Bedrock API configuration, future secrets)
        this.applicationSecretsKey = new kms.Key(this, 'ApplicationSecretsKey', {
            alias: `fcc-app-secrets-${envName}`,
            description: 'CMK for application secrets (Bedrock, future integrations)',
            enableKeyRotation: true,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            pendingWindow: cdk.Duration.days(30),
        });
        cdk.Tags.of(this.applicationSecretsKey).add('Component', 'Application');
        cdk.Tags.of(this.applicationSecretsKey).add('Environment', envName);
        // ── Secrets Manager Secrets ──────────────────────────────────────────────
        // 1. Database Credentials Secret
        //    Stores: PostgreSQL master username and password
        //    Rotation: Enabled with 30-day rotation window (Aurora native rotation)
        this.databaseCredentialsSecret = new secretsmanager.Secret(this, 'DatabaseCredentialsSecret', {
            secretName: `fcc-db-credentials-${envName}`,
            description: 'Aurora PostgreSQL master credentials with automatic rotation',
            encryptionKey: this.databaseEncryptionKey,
            generateSecretString: {
                secretStringTemplate: JSON.stringify({ username: 'foodcost_admin' }),
                generateStringKey: 'password',
                excludeCharacters: '"@/\\', // Exclude problematic characters for JDBC URLs
                passwordLength: 32,
                requireEachIncludedType: true,
            },
            removalPolicy: cdk.RemovalPolicy.RETAIN, // Prevent accidental deletion
        });
        // Automatic rotation configuration
        // Note: The rotation Lambda is created by DatabaseStack when the Aurora cluster
        // is provisioned, using `cluster.addRotationSingleUser()`. This secret will be
        // passed to that method to wire the rotation schedule.
        // We configure the rotation schedule intent here via tags; actual Lambda wiring
        // happens in DatabaseStack.
        cdk.Tags.of(this.databaseCredentialsSecret).add('RotationEnabled', 'true');
        cdk.Tags.of(this.databaseCredentialsSecret).add('RotationDays', '30');
        cdk.Tags.of(this.databaseCredentialsSecret).add('Component', 'Database');
        cdk.Tags.of(this.databaseCredentialsSecret).add('Environment', envName);
        // 2. Stripe API Key Secret
        //    Stores: Stripe secret key (sk_live_... or sk_test_...)
        //    Rotation: Manual (Stripe does not support programmatic key rotation)
        this.stripeApiKeySecret = new secretsmanager.Secret(this, 'StripeApiKeySecret', {
            secretName: `fcc-stripe-api-key-${envName}`,
            description: 'Stripe secret key for subscription billing API',
            encryptionKey: this.applicationSecretsKey,
            // No generateSecretString — must be manually populated after Stripe account setup
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
        cdk.Tags.of(this.stripeApiKeySecret).add('Component', 'Billing');
        cdk.Tags.of(this.stripeApiKeySecret).add('Environment', envName);
        // 3. Stripe Webhook Secret
        //    Stores: Stripe webhook signing secret (whsec_...)
        //    Used for: Verifying Stripe webhook signatures to prevent replay attacks
        this.stripeWebhookSecret = new secretsmanager.Secret(this, 'StripeWebhookSecret', {
            secretName: `fcc-stripe-webhook-secret-${envName}`,
            description: 'Stripe webhook signing secret for signature verification',
            encryptionKey: this.stripeWebhookSecretKey,
            // No generateSecretString — provided by Stripe when webhook endpoint is registered
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
        cdk.Tags.of(this.stripeWebhookSecret).add('Component', 'Billing');
        cdk.Tags.of(this.stripeWebhookSecret).add('Environment', envName);
        // 4. Square OAuth Secret
        //    Stores: Square application ID and application secret for OAuth flow
        //    Format: { "application_id": "sq0...", "application_secret": "sq0atp-..." }
        this.squareOAuthSecret = new secretsmanager.Secret(this, 'SquareOAuthSecret', {
            secretName: `fcc-square-oauth-${envName}`,
            description: 'Square OAuth application credentials (app ID + secret)',
            encryptionKey: this.applicationSecretsKey,
            // No generateSecretString — must be manually populated from Square Developer Dashboard
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
        cdk.Tags.of(this.squareOAuthSecret).add('Component', 'Square Integration');
        cdk.Tags.of(this.squareOAuthSecret).add('Environment', envName);
        // 5. Bedrock Configuration Secret
        //    Stores: Amazon Bedrock model ID and configuration for Pro+ AI insights
        //    Format: { "model_id": "anthropic.claude-v2", "region": "us-east-1", "max_tokens": 4096 }
        //    Note: Bedrock access is governed by IAM, not API keys. This secret stores configuration.
        this.bedrockConfigSecret = new secretsmanager.Secret(this, 'BedrockConfigSecret', {
            secretName: `fcc-bedrock-config-${envName}`,
            description: 'Amazon Bedrock model configuration for Pro+ AI insights',
            encryptionKey: this.applicationSecretsKey,
            secretObjectValue: {
                model_id: cdk.SecretValue.unsafePlainText('anthropic.claude-v2'),
                region: cdk.SecretValue.unsafePlainText(this.region),
                max_tokens: cdk.SecretValue.unsafePlainText('4096'),
                temperature: cdk.SecretValue.unsafePlainText('0.7'),
            },
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
        cdk.Tags.of(this.bedrockConfigSecret).add('Component', 'AI Insights');
        cdk.Tags.of(this.bedrockConfigSecret).add('Environment', envName);
        // ── Grant Access Policies ────────────────────────────────────────────────
        //
        // KMS key policies are defined here to allow EKS service accounts (via IRSA)
        // to decrypt secrets. The actual IAM role ARNs are not known until EksStack
        // is created, so we use wildcard principals scoped to the account and add
        // explicit grants in EksStack when wiring IRSA roles.
        //
        // For now, we add the default key policy that allows the account root to
        // manage the keys, and grant the AWS Secrets Manager service permission to
        // use the keys for secret encryption/decryption.
        // Grant Secrets Manager service permission to use all CMKs
        const secretsManagerServicePrincipal = new iam.ServicePrincipal('secretsmanager.amazonaws.com');
        this.databaseEncryptionKey.grantEncryptDecrypt(secretsManagerServicePrincipal);
        this.squareTokenEncryptionKey.grantEncryptDecrypt(secretsManagerServicePrincipal);
        this.stripeWebhookSecretKey.grantEncryptDecrypt(secretsManagerServicePrincipal);
        this.applicationSecretsKey.grantEncryptDecrypt(secretsManagerServicePrincipal);
        // Additional grants for RDS to encrypt database storage using the DB CMK
        const rdsServicePrincipal = new iam.ServicePrincipal('rds.amazonaws.com');
        this.databaseEncryptionKey.grantEncryptDecrypt(rdsServicePrincipal);
        // ── CloudFormation Outputs ───────────────────────────────────────────────
        // Exported so downstream stacks can import by logical name.
        new cdk.CfnOutput(this, 'DatabaseEncryptionKeyId', {
            value: this.databaseEncryptionKey.keyId,
            description: 'KMS CMK ID for database encryption',
            exportName: `FoodCostCalculator-${envName}-DatabaseEncryptionKeyId`,
        });
        new cdk.CfnOutput(this, 'DatabaseEncryptionKeyArn', {
            value: this.databaseEncryptionKey.keyArn,
            description: 'KMS CMK ARN for database encryption',
            exportName: `FoodCostCalculator-${envName}-DatabaseEncryptionKeyArn`,
        });
        new cdk.CfnOutput(this, 'SquareTokenEncryptionKeyId', {
            value: this.squareTokenEncryptionKey.keyId,
            description: 'KMS CMK ID for Square token encryption',
            exportName: `FoodCostCalculator-${envName}-SquareTokenEncryptionKeyId`,
        });
        new cdk.CfnOutput(this, 'SquareTokenEncryptionKeyArn', {
            value: this.squareTokenEncryptionKey.keyArn,
            description: 'KMS CMK ARN for Square token encryption',
            exportName: `FoodCostCalculator-${envName}-SquareTokenEncryptionKeyArn`,
        });
        new cdk.CfnOutput(this, 'StripeWebhookSecretKeyArn', {
            value: this.stripeWebhookSecretKey.keyArn,
            description: 'KMS CMK ARN for Stripe webhook secret',
            exportName: `FoodCostCalculator-${envName}-StripeWebhookSecretKeyArn`,
        });
        new cdk.CfnOutput(this, 'ApplicationSecretsKeyArn', {
            value: this.applicationSecretsKey.keyArn,
            description: 'KMS CMK ARN for application secrets',
            exportName: `FoodCostCalculator-${envName}-ApplicationSecretsKeyArn`,
        });
        new cdk.CfnOutput(this, 'DatabaseCredentialsSecretArn', {
            value: this.databaseCredentialsSecret.secretArn,
            description: 'Secrets Manager ARN for Aurora DB credentials',
            exportName: `FoodCostCalculator-${envName}-DatabaseCredentialsSecretArn`,
        });
        new cdk.CfnOutput(this, 'StripeApiKeySecretArn', {
            value: this.stripeApiKeySecret.secretArn,
            description: 'Secrets Manager ARN for Stripe API key',
            exportName: `FoodCostCalculator-${envName}-StripeApiKeySecretArn`,
        });
        new cdk.CfnOutput(this, 'StripeWebhookSecretArn', {
            value: this.stripeWebhookSecret.secretArn,
            description: 'Secrets Manager ARN for Stripe webhook secret',
            exportName: `FoodCostCalculator-${envName}-StripeWebhookSecretArn`,
        });
        new cdk.CfnOutput(this, 'SquareOAuthSecretArn', {
            value: this.squareOAuthSecret.secretArn,
            description: 'Secrets Manager ARN for Square OAuth credentials',
            exportName: `FoodCostCalculator-${envName}-SquareOAuthSecretArn`,
        });
        new cdk.CfnOutput(this, 'BedrockConfigSecretArn', {
            value: this.bedrockConfigSecret.secretArn,
            description: 'Secrets Manager ARN for Bedrock configuration',
            exportName: `FoodCostCalculator-${envName}-BedrockConfigSecretArn`,
        });
    }
}
exports.SecretsStack = SecretsStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiU2VjcmV0c1N0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vbGliL3N0YWNrcy9TZWNyZXRzU3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBQ25DLDJDQUEyQztBQUMzQyxpRUFBaUU7QUFDakUsMkNBQTJDO0FBUTNDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQTBCRztBQUNILE1BQWEsWUFBYSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3pDLGdGQUFnRjtJQUNoRSxxQkFBcUIsQ0FBVTtJQUUvQyx3RUFBd0U7SUFDeEQsd0JBQXdCLENBQVU7SUFFbEQsaURBQWlEO0lBQ2pDLHNCQUFzQixDQUFVO0lBRWhELDZEQUE2RDtJQUM3QyxxQkFBcUIsQ0FBVTtJQUUvQyx5RkFBeUY7SUFDekUseUJBQXlCLENBQXdCO0lBRWpFLGlFQUFpRTtJQUNqRCxrQkFBa0IsQ0FBd0I7SUFFMUQsNkRBQTZEO0lBQzdDLG1CQUFtQixDQUF3QjtJQUUzRCxvRUFBb0U7SUFDcEQsaUJBQWlCLENBQXdCO0lBRXpELCtFQUErRTtJQUMvRCxtQkFBbUIsQ0FBd0I7SUFFM0QsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUF3QjtRQUNoRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsT0FBTyxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRTFCLDRFQUE0RTtRQUU1RSw2QkFBNkI7UUFDN0Isd0ZBQXdGO1FBQ3hGLElBQUksQ0FBQyxxQkFBcUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLHVCQUF1QixFQUFFO1lBQ3RFLEtBQUssRUFBRSxVQUFVLE9BQU8sRUFBRTtZQUMxQixXQUFXLEVBQUUsd0VBQXdFO1lBQ3JGLGlCQUFpQixFQUFFLElBQUksRUFBRSxnQ0FBZ0M7WUFDekQsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFLGlEQUFpRDtZQUMxRixhQUFhLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEVBQUUsdURBQXVEO1NBQzlGLENBQUMsQ0FBQztRQUVILHlDQUF5QztRQUN6QyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQyxHQUFHLENBQUMsV0FBVyxFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBQ3JFLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxhQUFhLEVBQUUsT0FBTyxDQUFDLENBQUM7UUFFcEUsaUNBQWlDO1FBQ2pDLHNHQUFzRztRQUN0RyxJQUFJLENBQUMsd0JBQXdCLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSwwQkFBMEIsRUFBRTtZQUM1RSxLQUFLLEVBQUUsb0JBQW9CLE9BQU8sRUFBRTtZQUNwQyxXQUFXLEVBQUUsK0NBQStDO1lBQzVELGlCQUFpQixFQUFFLElBQUk7WUFDdkIsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsTUFBTTtZQUN2QyxhQUFhLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1NBQ3JDLENBQUMsQ0FBQztRQUVILEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsb0JBQW9CLENBQUMsQ0FBQztRQUNsRixHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBRXZFLCtCQUErQjtRQUMvQiw0RkFBNEY7UUFDNUYsSUFBSSxDQUFDLHNCQUFzQixHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsd0JBQXdCLEVBQUU7WUFDeEUsS0FBSyxFQUFFLHNCQUFzQixPQUFPLEVBQUU7WUFDdEMsV0FBVyxFQUFFLHVDQUF1QztZQUNwRCxpQkFBaUIsRUFBRSxJQUFJO1lBQ3ZCLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE1BQU07WUFDdkMsYUFBYSxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztTQUNyQyxDQUFDLENBQUM7UUFFSCxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxHQUFHLENBQUMsV0FBVyxFQUFFLFNBQVMsQ0FBQyxDQUFDO1FBQ3JFLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxhQUFhLEVBQUUsT0FBTyxDQUFDLENBQUM7UUFFckUsNkJBQTZCO1FBQzdCLHVGQUF1RjtRQUN2RixJQUFJLENBQUMscUJBQXFCLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSx1QkFBdUIsRUFBRTtZQUN0RSxLQUFLLEVBQUUsbUJBQW1CLE9BQU8sRUFBRTtZQUNuQyxXQUFXLEVBQUUsNERBQTREO1lBQ3pFLGlCQUFpQixFQUFFLElBQUk7WUFDdkIsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsTUFBTTtZQUN2QyxhQUFhLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1NBQ3JDLENBQUMsQ0FBQztRQUVILEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsYUFBYSxDQUFDLENBQUM7UUFDeEUsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLHFCQUFxQixDQUFDLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxPQUFPLENBQUMsQ0FBQztRQUVwRSw0RUFBNEU7UUFFNUUsaUNBQWlDO1FBQ2pDLHFEQUFxRDtRQUNyRCw0RUFBNEU7UUFDNUUsSUFBSSxDQUFDLHlCQUF5QixHQUFHLElBQUksY0FBYyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsMkJBQTJCLEVBQUU7WUFDNUYsVUFBVSxFQUFFLHNCQUFzQixPQUFPLEVBQUU7WUFDM0MsV0FBVyxFQUFFLDhEQUE4RDtZQUMzRSxhQUFhLEVBQUUsSUFBSSxDQUFDLHFCQUFxQjtZQUN6QyxvQkFBb0IsRUFBRTtnQkFDcEIsb0JBQW9CLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLFFBQVEsRUFBRSxnQkFBZ0IsRUFBRSxDQUFDO2dCQUNwRSxpQkFBaUIsRUFBRSxVQUFVO2dCQUM3QixpQkFBaUIsRUFBRSxPQUFPLEVBQUUsK0NBQStDO2dCQUMzRSxjQUFjLEVBQUUsRUFBRTtnQkFDbEIsdUJBQXVCLEVBQUUsSUFBSTthQUM5QjtZQUNELGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRSw4QkFBOEI7U0FDeEUsQ0FBQyxDQUFDO1FBRUgsbUNBQW1DO1FBQ25DLGdGQUFnRjtRQUNoRiwrRUFBK0U7UUFDL0UsdURBQXVEO1FBQ3ZELGdGQUFnRjtRQUNoRiw0QkFBNEI7UUFDNUIsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLHlCQUF5QixDQUFDLENBQUMsR0FBRyxDQUFDLGlCQUFpQixFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBQzNFLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxjQUFjLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFDdEUsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLHlCQUF5QixDQUFDLENBQUMsR0FBRyxDQUFDLFdBQVcsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUN6RSxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMseUJBQXlCLENBQUMsQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBRXhFLDJCQUEyQjtRQUMzQiw0REFBNEQ7UUFDNUQsMEVBQTBFO1FBQzFFLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxJQUFJLGNBQWMsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFO1lBQzlFLFVBQVUsRUFBRSxzQkFBc0IsT0FBTyxFQUFFO1lBQzNDLFdBQVcsRUFBRSxnREFBZ0Q7WUFDN0QsYUFBYSxFQUFFLElBQUksQ0FBQyxxQkFBcUI7WUFDekMsa0ZBQWtGO1lBQ2xGLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE1BQU07U0FDeEMsQ0FBQyxDQUFDO1FBRUgsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLENBQUMsR0FBRyxDQUFDLFdBQVcsRUFBRSxTQUFTLENBQUMsQ0FBQztRQUNqRSxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBRWpFLDJCQUEyQjtRQUMzQix1REFBdUQ7UUFDdkQsNkVBQTZFO1FBQzdFLElBQUksQ0FBQyxtQkFBbUIsR0FBRyxJQUFJLGNBQWMsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLHFCQUFxQixFQUFFO1lBQ2hGLFVBQVUsRUFBRSw2QkFBNkIsT0FBTyxFQUFFO1lBQ2xELFdBQVcsRUFBRSwwREFBMEQ7WUFDdkUsYUFBYSxFQUFFLElBQUksQ0FBQyxzQkFBc0I7WUFDMUMsbUZBQW1GO1lBQ25GLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE1BQU07U0FDeEMsQ0FBQyxDQUFDO1FBRUgsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLG1CQUFtQixDQUFDLENBQUMsR0FBRyxDQUFDLFdBQVcsRUFBRSxTQUFTLENBQUMsQ0FBQztRQUNsRSxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBRWxFLHlCQUF5QjtRQUN6Qix5RUFBeUU7UUFDekUsZ0ZBQWdGO1FBQ2hGLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxJQUFJLGNBQWMsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQzVFLFVBQVUsRUFBRSxvQkFBb0IsT0FBTyxFQUFFO1lBQ3pDLFdBQVcsRUFBRSx3REFBd0Q7WUFDckUsYUFBYSxFQUFFLElBQUksQ0FBQyxxQkFBcUI7WUFDekMsdUZBQXVGO1lBQ3ZGLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE1BQU07U0FDeEMsQ0FBQyxDQUFDO1FBRUgsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUMsR0FBRyxDQUFDLFdBQVcsRUFBRSxvQkFBb0IsQ0FBQyxDQUFDO1FBQzNFLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxhQUFhLEVBQUUsT0FBTyxDQUFDLENBQUM7UUFFaEUsa0NBQWtDO1FBQ2xDLDRFQUE0RTtRQUM1RSw4RkFBOEY7UUFDOUYsOEZBQThGO1FBQzlGLElBQUksQ0FBQyxtQkFBbUIsR0FBRyxJQUFJLGNBQWMsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLHFCQUFxQixFQUFFO1lBQ2hGLFVBQVUsRUFBRSxzQkFBc0IsT0FBTyxFQUFFO1lBQzNDLFdBQVcsRUFBRSx5REFBeUQ7WUFDdEUsYUFBYSxFQUFFLElBQUksQ0FBQyxxQkFBcUI7WUFDekMsaUJBQWlCLEVBQUU7Z0JBQ2pCLFFBQVEsRUFBRSxHQUFHLENBQUMsV0FBVyxDQUFDLGVBQWUsQ0FBQyxxQkFBcUIsQ0FBQztnQkFDaEUsTUFBTSxFQUFFLEdBQUcsQ0FBQyxXQUFXLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUM7Z0JBQ3BELFVBQVUsRUFBRSxHQUFHLENBQUMsV0FBVyxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUM7Z0JBQ25ELFdBQVcsRUFBRSxHQUFHLENBQUMsV0FBVyxDQUFDLGVBQWUsQ0FBQyxLQUFLLENBQUM7YUFDcEQ7WUFDRCxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxNQUFNO1NBQ3hDLENBQUMsQ0FBQztRQUVILEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsYUFBYSxDQUFDLENBQUM7UUFDdEUsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLG1CQUFtQixDQUFDLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxPQUFPLENBQUMsQ0FBQztRQUVsRSw0RUFBNEU7UUFDNUUsRUFBRTtRQUNGLDZFQUE2RTtRQUM3RSw0RUFBNEU7UUFDNUUsMEVBQTBFO1FBQzFFLHNEQUFzRDtRQUN0RCxFQUFFO1FBQ0YseUVBQXlFO1FBQ3pFLDJFQUEyRTtRQUMzRSxpREFBaUQ7UUFFakQsMkRBQTJEO1FBQzNELE1BQU0sOEJBQThCLEdBQUcsSUFBSSxHQUFHLENBQUMsZ0JBQWdCLENBQUMsOEJBQThCLENBQUMsQ0FBQztRQUVoRyxJQUFJLENBQUMscUJBQXFCLENBQUMsbUJBQW1CLENBQUMsOEJBQThCLENBQUMsQ0FBQztRQUMvRSxJQUFJLENBQUMsd0JBQXdCLENBQUMsbUJBQW1CLENBQUMsOEJBQThCLENBQUMsQ0FBQztRQUNsRixJQUFJLENBQUMsc0JBQXNCLENBQUMsbUJBQW1CLENBQUMsOEJBQThCLENBQUMsQ0FBQztRQUNoRixJQUFJLENBQUMscUJBQXFCLENBQUMsbUJBQW1CLENBQUMsOEJBQThCLENBQUMsQ0FBQztRQUUvRSx5RUFBeUU7UUFDekUsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO1FBQzFFLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxtQkFBbUIsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO1FBRXBFLDRFQUE0RTtRQUM1RSw0REFBNEQ7UUFFNUQsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSx5QkFBeUIsRUFBRTtZQUNqRCxLQUFLLEVBQUUsSUFBSSxDQUFDLHFCQUFxQixDQUFDLEtBQUs7WUFDdkMsV0FBVyxFQUFFLG9DQUFvQztZQUNqRCxVQUFVLEVBQUUsc0JBQXNCLE9BQU8sMEJBQTBCO1NBQ3BFLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsMEJBQTBCLEVBQUU7WUFDbEQsS0FBSyxFQUFFLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxNQUFNO1lBQ3hDLFdBQVcsRUFBRSxxQ0FBcUM7WUFDbEQsVUFBVSxFQUFFLHNCQUFzQixPQUFPLDJCQUEyQjtTQUNyRSxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLDRCQUE0QixFQUFFO1lBQ3BELEtBQUssRUFBRSxJQUFJLENBQUMsd0JBQXdCLENBQUMsS0FBSztZQUMxQyxXQUFXLEVBQUUsd0NBQXdDO1lBQ3JELFVBQVUsRUFBRSxzQkFBc0IsT0FBTyw2QkFBNkI7U0FDdkUsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSw2QkFBNkIsRUFBRTtZQUNyRCxLQUFLLEVBQUUsSUFBSSxDQUFDLHdCQUF3QixDQUFDLE1BQU07WUFDM0MsV0FBVyxFQUFFLHlDQUF5QztZQUN0RCxVQUFVLEVBQUUsc0JBQXNCLE9BQU8sOEJBQThCO1NBQ3hFLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsMkJBQTJCLEVBQUU7WUFDbkQsS0FBSyxFQUFFLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxNQUFNO1lBQ3pDLFdBQVcsRUFBRSx1Q0FBdUM7WUFDcEQsVUFBVSxFQUFFLHNCQUFzQixPQUFPLDRCQUE0QjtTQUN0RSxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLDBCQUEwQixFQUFFO1lBQ2xELEtBQUssRUFBRSxJQUFJLENBQUMscUJBQXFCLENBQUMsTUFBTTtZQUN4QyxXQUFXLEVBQUUscUNBQXFDO1lBQ2xELFVBQVUsRUFBRSxzQkFBc0IsT0FBTywyQkFBMkI7U0FDckUsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSw4QkFBOEIsRUFBRTtZQUN0RCxLQUFLLEVBQUUsSUFBSSxDQUFDLHlCQUF5QixDQUFDLFNBQVM7WUFDL0MsV0FBVyxFQUFFLCtDQUErQztZQUM1RCxVQUFVLEVBQUUsc0JBQXNCLE9BQU8sK0JBQStCO1NBQ3pFLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsdUJBQXVCLEVBQUU7WUFDL0MsS0FBSyxFQUFFLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxTQUFTO1lBQ3hDLFdBQVcsRUFBRSx3Q0FBd0M7WUFDckQsVUFBVSxFQUFFLHNCQUFzQixPQUFPLHdCQUF3QjtTQUNsRSxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLHdCQUF3QixFQUFFO1lBQ2hELEtBQUssRUFBRSxJQUFJLENBQUMsbUJBQW1CLENBQUMsU0FBUztZQUN6QyxXQUFXLEVBQUUsK0NBQStDO1lBQzVELFVBQVUsRUFBRSxzQkFBc0IsT0FBTyx5QkFBeUI7U0FDbkUsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxzQkFBc0IsRUFBRTtZQUM5QyxLQUFLLEVBQUUsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFNBQVM7WUFDdkMsV0FBVyxFQUFFLGtEQUFrRDtZQUMvRCxVQUFVLEVBQUUsc0JBQXNCLE9BQU8sdUJBQXVCO1NBQ2pFLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsd0JBQXdCLEVBQUU7WUFDaEQsS0FBSyxFQUFFLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxTQUFTO1lBQ3pDLFdBQVcsRUFBRSwrQ0FBK0M7WUFDNUQsVUFBVSxFQUFFLHNCQUFzQixPQUFPLHlCQUF5QjtTQUNuRSxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFoUkQsb0NBZ1JDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGttcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mta21zJztcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcic7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBTZWNyZXRzU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgLyoqIExvZ2ljYWwgZW52aXJvbm1lbnQgbmFtZSwgZS5nLiBcInN0YWdpbmdcIiBvciBcInByb2RcIi4gVXNlZCBmb3IgbmFtaW5nLiAqL1xuICByZWFkb25seSBlbnZOYW1lOiBzdHJpbmc7XG59XG5cbi8qKlxuICogU2VjcmV0c1N0YWNrXG4gKlxuICogUHJvdmlzaW9ucyBLTVMgQ3VzdG9tZXIgTWFuYWdlZCBLZXlzIChDTUtzKSBhbmQgQVdTIFNlY3JldHMgTWFuYWdlciBzZWNyZXRzXG4gKiBmb3IgdGhlIEZvb2QgQ29zdCBDYWxjdWxhdG9yIGFwcGxpY2F0aW9uLlxuICpcbiAqICoqS01TIENNS3M6KipcbiAqICDigKIgRGF0YWJhc2UgZW5jcnlwdGlvbiBrZXkgICAgICDigJQgZW5jcnlwdHMgQXVyb3JhIGNsdXN0ZXIgYXQgcmVzdCArIFNlY3JldHMgTWFuYWdlciBEQiBzZWNyZXRcbiAqICDigKIgU3F1YXJlIE9BdXRoIHRva2VuIGtleSAgICAgICDigJQgZW5jcnlwdHMgU3F1YXJlIGFjY2Vzcy9yZWZyZXNoIHRva2VucyBpbiB0aGUgZGF0YWJhc2VcbiAqICDigKIgU3RyaXBlIHdlYmhvb2sgc2VjcmV0IGtleSAgICDigJQgZW5jcnlwdHMgU3RyaXBlIHdlYmhvb2sgc2lnbmluZyBzZWNyZXRcbiAqICDigKIgQXBwbGljYXRpb24gc2VjcmV0cyBrZXkgICAgICDigJQgZW5jcnlwdHMgQmVkcm9jayBBUEkga2V5cyBhbmQgb3RoZXIgYXBwLWxldmVsIHNlY3JldHNcbiAqXG4gKiAqKlNlY3JldHMgTWFuYWdlciBTZWNyZXRzOioqXG4gKiAg4oCiIERhdGFiYXNlIGNyZWRlbnRpYWxzICAgICAgICAg4oCUIEF1cm9yYSBQb3N0Z3JlU1FMIG1hc3RlciB1c2VyICsgcGFzc3dvcmQgKGF1dG8tcm90YXRpb24gZW5hYmxlZClcbiAqICDigKIgU3RyaXBlIEFQSSBrZXkgICAgICAgICAgICAgICDigJQgU3RyaXBlIHNlY3JldCBrZXkgZm9yIHN1YnNjcmlwdGlvbiBiaWxsaW5nXG4gKiAg4oCiIFN0cmlwZSB3ZWJob29rIHNlY3JldCAgICAgICAg4oCUIFN0cmlwZSB3ZWJob29rIHNpZ25pbmcgc2VjcmV0IGZvciBzaWduYXR1cmUgdmVyaWZpY2F0aW9uXG4gKiAg4oCiIFNxdWFyZSBPQXV0aCBjcmVkZW50aWFscyAgICAg4oCUIFNxdWFyZSBhcHBsaWNhdGlvbiBJRCBhbmQgc2VjcmV0IGZvciBPQXV0aCBmbG93XG4gKiAg4oCiIEJlZHJvY2sgY29uZmlndXJhdGlvbiAgICAgICAg4oCUIEFtYXpvbiBCZWRyb2NrIG1vZGVsIGNvbmZpZ3VyYXRpb24gKFBybysgdGllciBBSSBpbnNpZ2h0cylcbiAqXG4gKiAqKlNlY3VyaXR5OioqXG4gKiAg4oCiIEFsbCBDTUtzIGhhdmUgYXV0b21hdGljIGtleSByb3RhdGlvbiBlbmFibGVkICgzNjUtZGF5IGN5Y2xlKVxuICogIOKAoiBDTUsga2V5IHBvbGljaWVzIGdyYW50IGxlYXN0LXByaXZpbGVnZSBhY2Nlc3MgdG8gRUtTIHNlcnZpY2UgYWNjb3VudHMgKHZpYSBJUlNBKVxuICogIOKAoiBEYXRhYmFzZSBzZWNyZXQgaGFzIGF1dG9tYXRpYyByb3RhdGlvbiBlbmFibGVkICgzMC1kYXkgcm90YXRpb24gd2luZG93KVxuICogIOKAoiBTZWNyZXRzIGFyZSB0YWdnZWQgZm9yIGNvc3QgYWxsb2NhdGlvbiBhbmQgY29tcGxpYW5jZSBhdWRpdGluZ1xuICpcbiAqIFNhdGlzZmllcyBSZXF1aXJlbWVudCAxMi4xOiBTZWN1cmUgc3RvcmFnZSBhbmQgZW5jcnlwdGlvbiBvZiBzZW5zaXRpdmUgQVBJIGtleXMgYW5kIE9BdXRoIHRva2Vucy5cbiAqL1xuZXhwb3J0IGNsYXNzIFNlY3JldHNTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIC8qKiBLTVMgQ01LIGZvciBkYXRhYmFzZSBlbmNyeXB0aW9uIChBdXJvcmEgYXQtcmVzdCArIERCIGNyZWRlbnRpYWxzIHNlY3JldCkuICovXG4gIHB1YmxpYyByZWFkb25seSBkYXRhYmFzZUVuY3J5cHRpb25LZXk6IGttcy5LZXk7XG5cbiAgLyoqIEtNUyBDTUsgZm9yIGVuY3J5cHRpbmcgU3F1YXJlIE9BdXRoIGFjY2Vzcy9yZWZyZXNoIHRva2VucyBpbiBSRFMuICovXG4gIHB1YmxpYyByZWFkb25seSBzcXVhcmVUb2tlbkVuY3J5cHRpb25LZXk6IGttcy5LZXk7XG5cbiAgLyoqIEtNUyBDTUsgZm9yIFN0cmlwZSB3ZWJob29rIHNpZ25pbmcgc2VjcmV0LiAqL1xuICBwdWJsaWMgcmVhZG9ubHkgc3RyaXBlV2ViaG9va1NlY3JldEtleToga21zLktleTtcblxuICAvKiogS01TIENNSyBmb3IgYXBwbGljYXRpb24tbGV2ZWwgc2VjcmV0cyAoQmVkcm9jaywgZXRjLikuICovXG4gIHB1YmxpYyByZWFkb25seSBhcHBsaWNhdGlvblNlY3JldHNLZXk6IGttcy5LZXk7XG5cbiAgLyoqIFNlY3JldHMgTWFuYWdlciBzZWNyZXQ6IEF1cm9yYSBQb3N0Z3JlU1FMIG1hc3RlciBjcmVkZW50aWFscyAod2l0aCBhdXRvLXJvdGF0aW9uKS4gKi9cbiAgcHVibGljIHJlYWRvbmx5IGRhdGFiYXNlQ3JlZGVudGlhbHNTZWNyZXQ6IHNlY3JldHNtYW5hZ2VyLlNlY3JldDtcblxuICAvKiogU2VjcmV0cyBNYW5hZ2VyIHNlY3JldDogU3RyaXBlIEFQSSBzZWNyZXQga2V5IGZvciBiaWxsaW5nLiAqL1xuICBwdWJsaWMgcmVhZG9ubHkgc3RyaXBlQXBpS2V5U2VjcmV0OiBzZWNyZXRzbWFuYWdlci5TZWNyZXQ7XG5cbiAgLyoqIFNlY3JldHMgTWFuYWdlciBzZWNyZXQ6IFN0cmlwZSB3ZWJob29rIHNpZ25pbmcgc2VjcmV0LiAqL1xuICBwdWJsaWMgcmVhZG9ubHkgc3RyaXBlV2ViaG9va1NlY3JldDogc2VjcmV0c21hbmFnZXIuU2VjcmV0O1xuXG4gIC8qKiBTZWNyZXRzIE1hbmFnZXIgc2VjcmV0OiBTcXVhcmUgT0F1dGggYXBwbGljYXRpb24gY3JlZGVudGlhbHMuICovXG4gIHB1YmxpYyByZWFkb25seSBzcXVhcmVPQXV0aFNlY3JldDogc2VjcmV0c21hbmFnZXIuU2VjcmV0O1xuXG4gIC8qKiBTZWNyZXRzIE1hbmFnZXIgc2VjcmV0OiBBbWF6b24gQmVkcm9jayBjb25maWd1cmF0aW9uIChQcm8rIEFJIGluc2lnaHRzKS4gKi9cbiAgcHVibGljIHJlYWRvbmx5IGJlZHJvY2tDb25maWdTZWNyZXQ6IHNlY3JldHNtYW5hZ2VyLlNlY3JldDtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogU2VjcmV0c1N0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgZW52TmFtZSB9ID0gcHJvcHM7XG5cbiAgICAvLyDilIDilIAgS01TIENNS3Mg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbiAgICAvLyAxLiBEYXRhYmFzZSBFbmNyeXB0aW9uIEtleVxuICAgIC8vICAgIFVzZWQgZm9yOiBBdXJvcmEgY2x1c3RlciBzdG9yYWdlIGVuY3J5cHRpb24gKyBTZWNyZXRzIE1hbmFnZXIgREIgc2VjcmV0IGVuY3J5cHRpb25cbiAgICB0aGlzLmRhdGFiYXNlRW5jcnlwdGlvbktleSA9IG5ldyBrbXMuS2V5KHRoaXMsICdEYXRhYmFzZUVuY3J5cHRpb25LZXknLCB7XG4gICAgICBhbGlhczogYGZjYy1kYi0ke2Vudk5hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ01LIGZvciBBdXJvcmEgUG9zdGdyZVNRTCBjbHVzdGVyIGFuZCBEQiBjcmVkZW50aWFscyBzZWNyZXQgZW5jcnlwdGlvbicsXG4gICAgICBlbmFibGVLZXlSb3RhdGlvbjogdHJ1ZSwgLy8gQXV0b21hdGljIGFubnVhbCBrZXkgcm90YXRpb25cbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTiwgLy8gUHJldmVudCBhY2NpZGVudGFsIGRlbGV0aW9uIG9mIGVuY3J5cHRpb24ga2V5c1xuICAgICAgcGVuZGluZ1dpbmRvdzogY2RrLkR1cmF0aW9uLmRheXMoMzApLCAvLyAzMC1kYXkgd2FpdGluZyBwZXJpb2QgYmVmb3JlIGtleSBkZWxldGlvbiBpZiByZW1vdmVkXG4gICAgfSk7XG5cbiAgICAvLyBUYWcgZm9yIGNvc3QgYWxsb2NhdGlvbiBhbmQgY29tcGxpYW5jZVxuICAgIGNkay5UYWdzLm9mKHRoaXMuZGF0YWJhc2VFbmNyeXB0aW9uS2V5KS5hZGQoJ0NvbXBvbmVudCcsICdEYXRhYmFzZScpO1xuICAgIGNkay5UYWdzLm9mKHRoaXMuZGF0YWJhc2VFbmNyeXB0aW9uS2V5KS5hZGQoJ0Vudmlyb25tZW50JywgZW52TmFtZSk7XG5cbiAgICAvLyAyLiBTcXVhcmUgVG9rZW4gRW5jcnlwdGlvbiBLZXlcbiAgICAvLyAgICBVc2VkIGZvcjogRW5jcnlwdGluZyBTcXVhcmUgT0F1dGggYWNjZXNzL3JlZnJlc2ggdG9rZW5zIHN0b3JlZCBpbiB0aGUgYHNxdWFyZV9jb25uZWN0aW9uc2AgdGFibGVcbiAgICB0aGlzLnNxdWFyZVRva2VuRW5jcnlwdGlvbktleSA9IG5ldyBrbXMuS2V5KHRoaXMsICdTcXVhcmVUb2tlbkVuY3J5cHRpb25LZXknLCB7XG4gICAgICBhbGlhczogYGZjYy1zcXVhcmUtdG9rZW4tJHtlbnZOYW1lfWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NNSyBmb3IgZW5jcnlwdGluZyBTcXVhcmUgT0F1dGggdG9rZW5zIGluIFJEUycsXG4gICAgICBlbmFibGVLZXlSb3RhdGlvbjogdHJ1ZSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICAgIHBlbmRpbmdXaW5kb3c6IGNkay5EdXJhdGlvbi5kYXlzKDMwKSxcbiAgICB9KTtcblxuICAgIGNkay5UYWdzLm9mKHRoaXMuc3F1YXJlVG9rZW5FbmNyeXB0aW9uS2V5KS5hZGQoJ0NvbXBvbmVudCcsICdTcXVhcmUgSW50ZWdyYXRpb24nKTtcbiAgICBjZGsuVGFncy5vZih0aGlzLnNxdWFyZVRva2VuRW5jcnlwdGlvbktleSkuYWRkKCdFbnZpcm9ubWVudCcsIGVudk5hbWUpO1xuXG4gICAgLy8gMy4gU3RyaXBlIFdlYmhvb2sgU2VjcmV0IEtleVxuICAgIC8vICAgIFVzZWQgZm9yOiBFbmNyeXB0aW5nIHRoZSBTdHJpcGUgd2ViaG9vayBzaWduaW5nIHNlY3JldCB1c2VkIGZvciBzaWduYXR1cmUgdmVyaWZpY2F0aW9uXG4gICAgdGhpcy5zdHJpcGVXZWJob29rU2VjcmV0S2V5ID0gbmV3IGttcy5LZXkodGhpcywgJ1N0cmlwZVdlYmhvb2tTZWNyZXRLZXknLCB7XG4gICAgICBhbGlhczogYGZjYy1zdHJpcGUtd2ViaG9vay0ke2Vudk5hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ01LIGZvciBTdHJpcGUgd2ViaG9vayBzaWduaW5nIHNlY3JldCcsXG4gICAgICBlbmFibGVLZXlSb3RhdGlvbjogdHJ1ZSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICAgIHBlbmRpbmdXaW5kb3c6IGNkay5EdXJhdGlvbi5kYXlzKDMwKSxcbiAgICB9KTtcblxuICAgIGNkay5UYWdzLm9mKHRoaXMuc3RyaXBlV2ViaG9va1NlY3JldEtleSkuYWRkKCdDb21wb25lbnQnLCAnQmlsbGluZycpO1xuICAgIGNkay5UYWdzLm9mKHRoaXMuc3RyaXBlV2ViaG9va1NlY3JldEtleSkuYWRkKCdFbnZpcm9ubWVudCcsIGVudk5hbWUpO1xuXG4gICAgLy8gNC4gQXBwbGljYXRpb24gU2VjcmV0cyBLZXlcbiAgICAvLyAgICBVc2VkIGZvcjogR2VuZXJhbCBhcHBsaWNhdGlvbiBzZWNyZXRzIChCZWRyb2NrIEFQSSBjb25maWd1cmF0aW9uLCBmdXR1cmUgc2VjcmV0cylcbiAgICB0aGlzLmFwcGxpY2F0aW9uU2VjcmV0c0tleSA9IG5ldyBrbXMuS2V5KHRoaXMsICdBcHBsaWNhdGlvblNlY3JldHNLZXknLCB7XG4gICAgICBhbGlhczogYGZjYy1hcHAtc2VjcmV0cy0ke2Vudk5hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ01LIGZvciBhcHBsaWNhdGlvbiBzZWNyZXRzIChCZWRyb2NrLCBmdXR1cmUgaW50ZWdyYXRpb25zKScsXG4gICAgICBlbmFibGVLZXlSb3RhdGlvbjogdHJ1ZSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICAgIHBlbmRpbmdXaW5kb3c6IGNkay5EdXJhdGlvbi5kYXlzKDMwKSxcbiAgICB9KTtcblxuICAgIGNkay5UYWdzLm9mKHRoaXMuYXBwbGljYXRpb25TZWNyZXRzS2V5KS5hZGQoJ0NvbXBvbmVudCcsICdBcHBsaWNhdGlvbicpO1xuICAgIGNkay5UYWdzLm9mKHRoaXMuYXBwbGljYXRpb25TZWNyZXRzS2V5KS5hZGQoJ0Vudmlyb25tZW50JywgZW52TmFtZSk7XG5cbiAgICAvLyDilIDilIAgU2VjcmV0cyBNYW5hZ2VyIFNlY3JldHMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbiAgICAvLyAxLiBEYXRhYmFzZSBDcmVkZW50aWFscyBTZWNyZXRcbiAgICAvLyAgICBTdG9yZXM6IFBvc3RncmVTUUwgbWFzdGVyIHVzZXJuYW1lIGFuZCBwYXNzd29yZFxuICAgIC8vICAgIFJvdGF0aW9uOiBFbmFibGVkIHdpdGggMzAtZGF5IHJvdGF0aW9uIHdpbmRvdyAoQXVyb3JhIG5hdGl2ZSByb3RhdGlvbilcbiAgICB0aGlzLmRhdGFiYXNlQ3JlZGVudGlhbHNTZWNyZXQgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdEYXRhYmFzZUNyZWRlbnRpYWxzU2VjcmV0Jywge1xuICAgICAgc2VjcmV0TmFtZTogYGZjYy1kYi1jcmVkZW50aWFscy0ke2Vudk5hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQXVyb3JhIFBvc3RncmVTUUwgbWFzdGVyIGNyZWRlbnRpYWxzIHdpdGggYXV0b21hdGljIHJvdGF0aW9uJyxcbiAgICAgIGVuY3J5cHRpb25LZXk6IHRoaXMuZGF0YWJhc2VFbmNyeXB0aW9uS2V5LFxuICAgICAgZ2VuZXJhdGVTZWNyZXRTdHJpbmc6IHtcbiAgICAgICAgc2VjcmV0U3RyaW5nVGVtcGxhdGU6IEpTT04uc3RyaW5naWZ5KHsgdXNlcm5hbWU6ICdmb29kY29zdF9hZG1pbicgfSksXG4gICAgICAgIGdlbmVyYXRlU3RyaW5nS2V5OiAncGFzc3dvcmQnLFxuICAgICAgICBleGNsdWRlQ2hhcmFjdGVyczogJ1wiQC9cXFxcJywgLy8gRXhjbHVkZSBwcm9ibGVtYXRpYyBjaGFyYWN0ZXJzIGZvciBKREJDIFVSTHNcbiAgICAgICAgcGFzc3dvcmRMZW5ndGg6IDMyLFxuICAgICAgICByZXF1aXJlRWFjaEluY2x1ZGVkVHlwZTogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sIC8vIFByZXZlbnQgYWNjaWRlbnRhbCBkZWxldGlvblxuICAgIH0pO1xuXG4gICAgLy8gQXV0b21hdGljIHJvdGF0aW9uIGNvbmZpZ3VyYXRpb25cbiAgICAvLyBOb3RlOiBUaGUgcm90YXRpb24gTGFtYmRhIGlzIGNyZWF0ZWQgYnkgRGF0YWJhc2VTdGFjayB3aGVuIHRoZSBBdXJvcmEgY2x1c3RlclxuICAgIC8vIGlzIHByb3Zpc2lvbmVkLCB1c2luZyBgY2x1c3Rlci5hZGRSb3RhdGlvblNpbmdsZVVzZXIoKWAuIFRoaXMgc2VjcmV0IHdpbGwgYmVcbiAgICAvLyBwYXNzZWQgdG8gdGhhdCBtZXRob2QgdG8gd2lyZSB0aGUgcm90YXRpb24gc2NoZWR1bGUuXG4gICAgLy8gV2UgY29uZmlndXJlIHRoZSByb3RhdGlvbiBzY2hlZHVsZSBpbnRlbnQgaGVyZSB2aWEgdGFnczsgYWN0dWFsIExhbWJkYSB3aXJpbmdcbiAgICAvLyBoYXBwZW5zIGluIERhdGFiYXNlU3RhY2suXG4gICAgY2RrLlRhZ3Mub2YodGhpcy5kYXRhYmFzZUNyZWRlbnRpYWxzU2VjcmV0KS5hZGQoJ1JvdGF0aW9uRW5hYmxlZCcsICd0cnVlJyk7XG4gICAgY2RrLlRhZ3Mub2YodGhpcy5kYXRhYmFzZUNyZWRlbnRpYWxzU2VjcmV0KS5hZGQoJ1JvdGF0aW9uRGF5cycsICczMCcpO1xuICAgIGNkay5UYWdzLm9mKHRoaXMuZGF0YWJhc2VDcmVkZW50aWFsc1NlY3JldCkuYWRkKCdDb21wb25lbnQnLCAnRGF0YWJhc2UnKTtcbiAgICBjZGsuVGFncy5vZih0aGlzLmRhdGFiYXNlQ3JlZGVudGlhbHNTZWNyZXQpLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZOYW1lKTtcblxuICAgIC8vIDIuIFN0cmlwZSBBUEkgS2V5IFNlY3JldFxuICAgIC8vICAgIFN0b3JlczogU3RyaXBlIHNlY3JldCBrZXkgKHNrX2xpdmVfLi4uIG9yIHNrX3Rlc3RfLi4uKVxuICAgIC8vICAgIFJvdGF0aW9uOiBNYW51YWwgKFN0cmlwZSBkb2VzIG5vdCBzdXBwb3J0IHByb2dyYW1tYXRpYyBrZXkgcm90YXRpb24pXG4gICAgdGhpcy5zdHJpcGVBcGlLZXlTZWNyZXQgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdTdHJpcGVBcGlLZXlTZWNyZXQnLCB7XG4gICAgICBzZWNyZXROYW1lOiBgZmNjLXN0cmlwZS1hcGkta2V5LSR7ZW52TmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdTdHJpcGUgc2VjcmV0IGtleSBmb3Igc3Vic2NyaXB0aW9uIGJpbGxpbmcgQVBJJyxcbiAgICAgIGVuY3J5cHRpb25LZXk6IHRoaXMuYXBwbGljYXRpb25TZWNyZXRzS2V5LFxuICAgICAgLy8gTm8gZ2VuZXJhdGVTZWNyZXRTdHJpbmcg4oCUIG11c3QgYmUgbWFudWFsbHkgcG9wdWxhdGVkIGFmdGVyIFN0cmlwZSBhY2NvdW50IHNldHVwXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgfSk7XG5cbiAgICBjZGsuVGFncy5vZih0aGlzLnN0cmlwZUFwaUtleVNlY3JldCkuYWRkKCdDb21wb25lbnQnLCAnQmlsbGluZycpO1xuICAgIGNkay5UYWdzLm9mKHRoaXMuc3RyaXBlQXBpS2V5U2VjcmV0KS5hZGQoJ0Vudmlyb25tZW50JywgZW52TmFtZSk7XG5cbiAgICAvLyAzLiBTdHJpcGUgV2ViaG9vayBTZWNyZXRcbiAgICAvLyAgICBTdG9yZXM6IFN0cmlwZSB3ZWJob29rIHNpZ25pbmcgc2VjcmV0ICh3aHNlY18uLi4pXG4gICAgLy8gICAgVXNlZCBmb3I6IFZlcmlmeWluZyBTdHJpcGUgd2ViaG9vayBzaWduYXR1cmVzIHRvIHByZXZlbnQgcmVwbGF5IGF0dGFja3NcbiAgICB0aGlzLnN0cmlwZVdlYmhvb2tTZWNyZXQgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdTdHJpcGVXZWJob29rU2VjcmV0Jywge1xuICAgICAgc2VjcmV0TmFtZTogYGZjYy1zdHJpcGUtd2ViaG9vay1zZWNyZXQtJHtlbnZOYW1lfWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ1N0cmlwZSB3ZWJob29rIHNpZ25pbmcgc2VjcmV0IGZvciBzaWduYXR1cmUgdmVyaWZpY2F0aW9uJyxcbiAgICAgIGVuY3J5cHRpb25LZXk6IHRoaXMuc3RyaXBlV2ViaG9va1NlY3JldEtleSxcbiAgICAgIC8vIE5vIGdlbmVyYXRlU2VjcmV0U3RyaW5nIOKAlCBwcm92aWRlZCBieSBTdHJpcGUgd2hlbiB3ZWJob29rIGVuZHBvaW50IGlzIHJlZ2lzdGVyZWRcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICB9KTtcblxuICAgIGNkay5UYWdzLm9mKHRoaXMuc3RyaXBlV2ViaG9va1NlY3JldCkuYWRkKCdDb21wb25lbnQnLCAnQmlsbGluZycpO1xuICAgIGNkay5UYWdzLm9mKHRoaXMuc3RyaXBlV2ViaG9va1NlY3JldCkuYWRkKCdFbnZpcm9ubWVudCcsIGVudk5hbWUpO1xuXG4gICAgLy8gNC4gU3F1YXJlIE9BdXRoIFNlY3JldFxuICAgIC8vICAgIFN0b3JlczogU3F1YXJlIGFwcGxpY2F0aW9uIElEIGFuZCBhcHBsaWNhdGlvbiBzZWNyZXQgZm9yIE9BdXRoIGZsb3dcbiAgICAvLyAgICBGb3JtYXQ6IHsgXCJhcHBsaWNhdGlvbl9pZFwiOiBcInNxMC4uLlwiLCBcImFwcGxpY2F0aW9uX3NlY3JldFwiOiBcInNxMGF0cC0uLi5cIiB9XG4gICAgdGhpcy5zcXVhcmVPQXV0aFNlY3JldCA9IG5ldyBzZWNyZXRzbWFuYWdlci5TZWNyZXQodGhpcywgJ1NxdWFyZU9BdXRoU2VjcmV0Jywge1xuICAgICAgc2VjcmV0TmFtZTogYGZjYy1zcXVhcmUtb2F1dGgtJHtlbnZOYW1lfWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NxdWFyZSBPQXV0aCBhcHBsaWNhdGlvbiBjcmVkZW50aWFscyAoYXBwIElEICsgc2VjcmV0KScsXG4gICAgICBlbmNyeXB0aW9uS2V5OiB0aGlzLmFwcGxpY2F0aW9uU2VjcmV0c0tleSxcbiAgICAgIC8vIE5vIGdlbmVyYXRlU2VjcmV0U3RyaW5nIOKAlCBtdXN0IGJlIG1hbnVhbGx5IHBvcHVsYXRlZCBmcm9tIFNxdWFyZSBEZXZlbG9wZXIgRGFzaGJvYXJkXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgfSk7XG5cbiAgICBjZGsuVGFncy5vZih0aGlzLnNxdWFyZU9BdXRoU2VjcmV0KS5hZGQoJ0NvbXBvbmVudCcsICdTcXVhcmUgSW50ZWdyYXRpb24nKTtcbiAgICBjZGsuVGFncy5vZih0aGlzLnNxdWFyZU9BdXRoU2VjcmV0KS5hZGQoJ0Vudmlyb25tZW50JywgZW52TmFtZSk7XG5cbiAgICAvLyA1LiBCZWRyb2NrIENvbmZpZ3VyYXRpb24gU2VjcmV0XG4gICAgLy8gICAgU3RvcmVzOiBBbWF6b24gQmVkcm9jayBtb2RlbCBJRCBhbmQgY29uZmlndXJhdGlvbiBmb3IgUHJvKyBBSSBpbnNpZ2h0c1xuICAgIC8vICAgIEZvcm1hdDogeyBcIm1vZGVsX2lkXCI6IFwiYW50aHJvcGljLmNsYXVkZS12MlwiLCBcInJlZ2lvblwiOiBcInVzLWVhc3QtMVwiLCBcIm1heF90b2tlbnNcIjogNDA5NiB9XG4gICAgLy8gICAgTm90ZTogQmVkcm9jayBhY2Nlc3MgaXMgZ292ZXJuZWQgYnkgSUFNLCBub3QgQVBJIGtleXMuIFRoaXMgc2VjcmV0IHN0b3JlcyBjb25maWd1cmF0aW9uLlxuICAgIHRoaXMuYmVkcm9ja0NvbmZpZ1NlY3JldCA9IG5ldyBzZWNyZXRzbWFuYWdlci5TZWNyZXQodGhpcywgJ0JlZHJvY2tDb25maWdTZWNyZXQnLCB7XG4gICAgICBzZWNyZXROYW1lOiBgZmNjLWJlZHJvY2stY29uZmlnLSR7ZW52TmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdBbWF6b24gQmVkcm9jayBtb2RlbCBjb25maWd1cmF0aW9uIGZvciBQcm8rIEFJIGluc2lnaHRzJyxcbiAgICAgIGVuY3J5cHRpb25LZXk6IHRoaXMuYXBwbGljYXRpb25TZWNyZXRzS2V5LFxuICAgICAgc2VjcmV0T2JqZWN0VmFsdWU6IHtcbiAgICAgICAgbW9kZWxfaWQ6IGNkay5TZWNyZXRWYWx1ZS51bnNhZmVQbGFpblRleHQoJ2FudGhyb3BpYy5jbGF1ZGUtdjInKSxcbiAgICAgICAgcmVnaW9uOiBjZGsuU2VjcmV0VmFsdWUudW5zYWZlUGxhaW5UZXh0KHRoaXMucmVnaW9uKSxcbiAgICAgICAgbWF4X3Rva2VuczogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dCgnNDA5NicpLFxuICAgICAgICB0ZW1wZXJhdHVyZTogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dCgnMC43JyksXG4gICAgICB9LFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgIH0pO1xuXG4gICAgY2RrLlRhZ3Mub2YodGhpcy5iZWRyb2NrQ29uZmlnU2VjcmV0KS5hZGQoJ0NvbXBvbmVudCcsICdBSSBJbnNpZ2h0cycpO1xuICAgIGNkay5UYWdzLm9mKHRoaXMuYmVkcm9ja0NvbmZpZ1NlY3JldCkuYWRkKCdFbnZpcm9ubWVudCcsIGVudk5hbWUpO1xuXG4gICAgLy8g4pSA4pSAIEdyYW50IEFjY2VzcyBQb2xpY2llcyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvL1xuICAgIC8vIEtNUyBrZXkgcG9saWNpZXMgYXJlIGRlZmluZWQgaGVyZSB0byBhbGxvdyBFS1Mgc2VydmljZSBhY2NvdW50cyAodmlhIElSU0EpXG4gICAgLy8gdG8gZGVjcnlwdCBzZWNyZXRzLiBUaGUgYWN0dWFsIElBTSByb2xlIEFSTnMgYXJlIG5vdCBrbm93biB1bnRpbCBFa3NTdGFja1xuICAgIC8vIGlzIGNyZWF0ZWQsIHNvIHdlIHVzZSB3aWxkY2FyZCBwcmluY2lwYWxzIHNjb3BlZCB0byB0aGUgYWNjb3VudCBhbmQgYWRkXG4gICAgLy8gZXhwbGljaXQgZ3JhbnRzIGluIEVrc1N0YWNrIHdoZW4gd2lyaW5nIElSU0Egcm9sZXMuXG4gICAgLy9cbiAgICAvLyBGb3Igbm93LCB3ZSBhZGQgdGhlIGRlZmF1bHQga2V5IHBvbGljeSB0aGF0IGFsbG93cyB0aGUgYWNjb3VudCByb290IHRvXG4gICAgLy8gbWFuYWdlIHRoZSBrZXlzLCBhbmQgZ3JhbnQgdGhlIEFXUyBTZWNyZXRzIE1hbmFnZXIgc2VydmljZSBwZXJtaXNzaW9uIHRvXG4gICAgLy8gdXNlIHRoZSBrZXlzIGZvciBzZWNyZXQgZW5jcnlwdGlvbi9kZWNyeXB0aW9uLlxuXG4gICAgLy8gR3JhbnQgU2VjcmV0cyBNYW5hZ2VyIHNlcnZpY2UgcGVybWlzc2lvbiB0byB1c2UgYWxsIENNS3NcbiAgICBjb25zdCBzZWNyZXRzTWFuYWdlclNlcnZpY2VQcmluY2lwYWwgPSBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ3NlY3JldHNtYW5hZ2VyLmFtYXpvbmF3cy5jb20nKTtcblxuICAgIHRoaXMuZGF0YWJhc2VFbmNyeXB0aW9uS2V5LmdyYW50RW5jcnlwdERlY3J5cHQoc2VjcmV0c01hbmFnZXJTZXJ2aWNlUHJpbmNpcGFsKTtcbiAgICB0aGlzLnNxdWFyZVRva2VuRW5jcnlwdGlvbktleS5ncmFudEVuY3J5cHREZWNyeXB0KHNlY3JldHNNYW5hZ2VyU2VydmljZVByaW5jaXBhbCk7XG4gICAgdGhpcy5zdHJpcGVXZWJob29rU2VjcmV0S2V5LmdyYW50RW5jcnlwdERlY3J5cHQoc2VjcmV0c01hbmFnZXJTZXJ2aWNlUHJpbmNpcGFsKTtcbiAgICB0aGlzLmFwcGxpY2F0aW9uU2VjcmV0c0tleS5ncmFudEVuY3J5cHREZWNyeXB0KHNlY3JldHNNYW5hZ2VyU2VydmljZVByaW5jaXBhbCk7XG5cbiAgICAvLyBBZGRpdGlvbmFsIGdyYW50cyBmb3IgUkRTIHRvIGVuY3J5cHQgZGF0YWJhc2Ugc3RvcmFnZSB1c2luZyB0aGUgREIgQ01LXG4gICAgY29uc3QgcmRzU2VydmljZVByaW5jaXBhbCA9IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgncmRzLmFtYXpvbmF3cy5jb20nKTtcbiAgICB0aGlzLmRhdGFiYXNlRW5jcnlwdGlvbktleS5ncmFudEVuY3J5cHREZWNyeXB0KHJkc1NlcnZpY2VQcmluY2lwYWwpO1xuXG4gICAgLy8g4pSA4pSAIENsb3VkRm9ybWF0aW9uIE91dHB1dHMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy8gRXhwb3J0ZWQgc28gZG93bnN0cmVhbSBzdGFja3MgY2FuIGltcG9ydCBieSBsb2dpY2FsIG5hbWUuXG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGF0YWJhc2VFbmNyeXB0aW9uS2V5SWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5kYXRhYmFzZUVuY3J5cHRpb25LZXkua2V5SWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0tNUyBDTUsgSUQgZm9yIGRhdGFiYXNlIGVuY3J5cHRpb24nLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LURhdGFiYXNlRW5jcnlwdGlvbktleUlkYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEYXRhYmFzZUVuY3J5cHRpb25LZXlBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5kYXRhYmFzZUVuY3J5cHRpb25LZXkua2V5QXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdLTVMgQ01LIEFSTiBmb3IgZGF0YWJhc2UgZW5jcnlwdGlvbicsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tRGF0YWJhc2VFbmNyeXB0aW9uS2V5QXJuYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTcXVhcmVUb2tlbkVuY3J5cHRpb25LZXlJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnNxdWFyZVRva2VuRW5jcnlwdGlvbktleS5rZXlJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnS01TIENNSyBJRCBmb3IgU3F1YXJlIHRva2VuIGVuY3J5cHRpb24nLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LVNxdWFyZVRva2VuRW5jcnlwdGlvbktleUlkYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTcXVhcmVUb2tlbkVuY3J5cHRpb25LZXlBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5zcXVhcmVUb2tlbkVuY3J5cHRpb25LZXkua2V5QXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdLTVMgQ01LIEFSTiBmb3IgU3F1YXJlIHRva2VuIGVuY3J5cHRpb24nLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LVNxdWFyZVRva2VuRW5jcnlwdGlvbktleUFybmAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU3RyaXBlV2ViaG9va1NlY3JldEtleUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnN0cmlwZVdlYmhvb2tTZWNyZXRLZXkua2V5QXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdLTVMgQ01LIEFSTiBmb3IgU3RyaXBlIHdlYmhvb2sgc2VjcmV0JyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1TdHJpcGVXZWJob29rU2VjcmV0S2V5QXJuYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcHBsaWNhdGlvblNlY3JldHNLZXlBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5hcHBsaWNhdGlvblNlY3JldHNLZXkua2V5QXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdLTVMgQ01LIEFSTiBmb3IgYXBwbGljYXRpb24gc2VjcmV0cycsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tQXBwbGljYXRpb25TZWNyZXRzS2V5QXJuYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEYXRhYmFzZUNyZWRlbnRpYWxzU2VjcmV0QXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuZGF0YWJhc2VDcmVkZW50aWFsc1NlY3JldC5zZWNyZXRBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ1NlY3JldHMgTWFuYWdlciBBUk4gZm9yIEF1cm9yYSBEQiBjcmVkZW50aWFscycsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tRGF0YWJhc2VDcmVkZW50aWFsc1NlY3JldEFybmAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU3RyaXBlQXBpS2V5U2VjcmV0QXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuc3RyaXBlQXBpS2V5U2VjcmV0LnNlY3JldEFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjcmV0cyBNYW5hZ2VyIEFSTiBmb3IgU3RyaXBlIEFQSSBrZXknLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LVN0cmlwZUFwaUtleVNlY3JldEFybmAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU3RyaXBlV2ViaG9va1NlY3JldEFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnN0cmlwZVdlYmhvb2tTZWNyZXQuc2VjcmV0QXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdTZWNyZXRzIE1hbmFnZXIgQVJOIGZvciBTdHJpcGUgd2ViaG9vayBzZWNyZXQnLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LVN0cmlwZVdlYmhvb2tTZWNyZXRBcm5gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1NxdWFyZU9BdXRoU2VjcmV0QXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuc3F1YXJlT0F1dGhTZWNyZXQuc2VjcmV0QXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdTZWNyZXRzIE1hbmFnZXIgQVJOIGZvciBTcXVhcmUgT0F1dGggY3JlZGVudGlhbHMnLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LVNxdWFyZU9BdXRoU2VjcmV0QXJuYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdCZWRyb2NrQ29uZmlnU2VjcmV0QXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuYmVkcm9ja0NvbmZpZ1NlY3JldC5zZWNyZXRBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ1NlY3JldHMgTWFuYWdlciBBUk4gZm9yIEJlZHJvY2sgY29uZmlndXJhdGlvbicsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tQmVkcm9ja0NvbmZpZ1NlY3JldEFybmAsXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==