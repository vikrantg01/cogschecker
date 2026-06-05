import * as cdk from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface SecretsStackProps extends cdk.StackProps {
  /** Logical environment name, e.g. "staging" or "prod". Used for naming. */
  readonly envName: string;
}

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
export class SecretsStack extends cdk.Stack {
  /** KMS CMK for database encryption (Aurora at-rest + DB credentials secret). */
  public readonly databaseEncryptionKey: kms.Key;

  /** KMS CMK for encrypting Square OAuth access/refresh tokens in RDS. */
  public readonly squareTokenEncryptionKey: kms.Key;

  /** KMS CMK for Stripe webhook signing secret. */
  public readonly stripeWebhookSecretKey: kms.Key;

  /** KMS CMK for application-level secrets (Bedrock, etc.). */
  public readonly applicationSecretsKey: kms.Key;

  /** Secrets Manager secret: Aurora PostgreSQL master credentials (with auto-rotation). */
  public readonly databaseCredentialsSecret: secretsmanager.Secret;

  /** Secrets Manager secret: Stripe API secret key for billing. */
  public readonly stripeApiKeySecret: secretsmanager.Secret;

  /** Secrets Manager secret: Stripe webhook signing secret. */
  public readonly stripeWebhookSecret: secretsmanager.Secret;

  /** Secrets Manager secret: Square OAuth application credentials. */
  public readonly squareOAuthSecret: secretsmanager.Secret;

  /** Secrets Manager secret: Amazon Bedrock configuration (Pro+ AI insights). */
  public readonly bedrockConfigSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: SecretsStackProps) {
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
