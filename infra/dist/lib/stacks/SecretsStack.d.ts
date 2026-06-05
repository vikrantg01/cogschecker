import * as cdk from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
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
export declare class SecretsStack extends cdk.Stack {
    /** KMS CMK for database encryption (Aurora at-rest + DB credentials secret). */
    readonly databaseEncryptionKey: kms.Key;
    /** KMS CMK for encrypting Square OAuth access/refresh tokens in RDS. */
    readonly squareTokenEncryptionKey: kms.Key;
    /** KMS CMK for Stripe webhook signing secret. */
    readonly stripeWebhookSecretKey: kms.Key;
    /** KMS CMK for application-level secrets (Bedrock, etc.). */
    readonly applicationSecretsKey: kms.Key;
    /** Secrets Manager secret: Aurora PostgreSQL master credentials (with auto-rotation). */
    readonly databaseCredentialsSecret: secretsmanager.Secret;
    /** Secrets Manager secret: Stripe API secret key for billing. */
    readonly stripeApiKeySecret: secretsmanager.Secret;
    /** Secrets Manager secret: Stripe webhook signing secret. */
    readonly stripeWebhookSecret: secretsmanager.Secret;
    /** Secrets Manager secret: Square OAuth application credentials. */
    readonly squareOAuthSecret: secretsmanager.Secret;
    /** Secrets Manager secret: Amazon Bedrock configuration (Pro+ AI insights). */
    readonly bedrockConfigSecret: secretsmanager.Secret;
    constructor(scope: Construct, id: string, props: SecretsStackProps);
}
