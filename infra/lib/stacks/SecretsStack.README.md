# SecretsStack Implementation

## Overview

The `SecretsStack` provisions KMS Customer Managed Keys (CMKs) and AWS Secrets Manager secrets for the Food Cost Calculator application, fulfilling **Requirement 12.1**: secure storage and encryption of sensitive API keys and OAuth tokens.

## Architecture

### KMS Customer Managed Keys (CMKs)

Four separate CMKs are created for defense-in-depth security, isolating different categories of sensitive data:

1. **Database Encryption Key** (`fcc-db-{envName}`)
   - Encrypts Aurora PostgreSQL cluster storage at rest
   - Encrypts the database credentials secret in Secrets Manager
   - Grants permission to both RDS and Secrets Manager services

2. **Square Token Encryption Key** (`fcc-square-token-{envName}`)
   - Encrypts Square OAuth access/refresh tokens stored in the `square_connections` table
   - Used by application code when encrypting/decrypting tokens before database storage

3. **Stripe Webhook Secret Key** (`fcc-stripe-webhook-{envName}`)
   - Encrypts the Stripe webhook signing secret
   - Used to verify webhook signatures and prevent replay attacks

4. **Application Secrets Key** (`fcc-app-secrets-{envName}`)
   - General-purpose key for application secrets (Bedrock config, future integrations)
   - Provides flexibility for additional secrets without creating new keys

### Key Features

All CMKs are configured with:
- **Automatic key rotation**: Enabled with 365-day rotation cycle (AWS-managed)
- **Retention policy**: `RETAIN` - prevents accidental deletion during stack teardown
- **Pending deletion window**: 30 days - provides safety window to recover from accidental deletion requests
- **Least-privilege access**: Default policy grants account root, with explicit grants to AWS services

### Secrets Manager Secrets

Five secrets are created to store sensitive credentials and configuration:

1. **Database Credentials** (`fcc-db-credentials-{envName}`)
   - **Auto-generated**: Master username `foodcost_admin` with 32-character random password
   - **Rotation**: Enabled (30-day rotation window) - wired in `DatabaseStack` when Aurora cluster is created
   - **Character exclusions**: `"@/\` to ensure JDBC URL compatibility
   - **Encrypted with**: Database Encryption Key

2. **Stripe API Key** (`fcc-stripe-api-key-{envName}`)
   - **Manual entry required**: Must be populated after Stripe account setup
   - **Format**: `sk_live_...` or `sk_test_...`
   - **Rotation**: Manual (Stripe does not support programmatic key rotation)
   - **Encrypted with**: Application Secrets Key

3. **Stripe Webhook Secret** (`fcc-stripe-webhook-secret-{envName}`)
   - **Manual entry required**: Provided by Stripe when webhook endpoint is registered
   - **Format**: `whsec_...`
   - **Purpose**: Signature verification to prevent replay attacks
   - **Encrypted with**: Stripe Webhook Secret Key

4. **Square OAuth Credentials** (`fcc-square-oauth-{envName}`)
   - **Manual entry required**: Must be populated from Square Developer Dashboard
   - **Format**: JSON with `application_id` and `application_secret`
   - **Purpose**: OAuth flow to connect Square POS accounts (Pro/Pro+ feature)
   - **Encrypted with**: Application Secrets Key

5. **Bedrock Configuration** (`fcc-bedrock-config-{envName}`)
   - **Auto-generated**: Pre-populated with default Bedrock model settings
   - **Contents**: Model ID (`anthropic.claude-v2`), region, max tokens, temperature
   - **Purpose**: Configuration for Pro+ AI insights feature
   - **Note**: Bedrock access is governed by IAM, not API keys
   - **Encrypted with**: Application Secrets Key

## Security Design

### Encryption at Rest

- All secrets are encrypted using KMS CMKs (envelope encryption)
- Database secret is encrypted with a dedicated CMK for isolation
- Application secrets share a common key for operational simplicity

### IAM Access Control

Service principals are granted least-privilege access:
- `secretsmanager.amazonaws.com` can encrypt/decrypt all secrets
- `rds.amazonaws.com` can use the Database Encryption Key for cluster storage

Application access (EKS pods via IRSA) is granted in `EksStack` when IAM roles are created.

### Automatic Rotation

The Database Credentials secret has automatic rotation enabled:
- Rotation Lambda is created by `DatabaseStack` using `cluster.addRotationSingleUser()`
- 30-day rotation window (tagged on the secret for reference)
- Single-user rotation strategy (master credentials only)

Other secrets (Stripe, Square) require manual rotation as the external services do not support programmatic key rotation.

### Deletion Protection

All KMS keys and secrets use `RETAIN` removal policy:
- CloudFormation stack deletion does NOT delete these resources
- Prevents accidental data loss during infrastructure updates
- Must be manually deleted if truly needed

## Outputs

The stack exports CloudFormation outputs for all KMS keys and secrets:

**KMS Keys:**
- `DatabaseEncryptionKeyId` / `DatabaseEncryptionKeyArn`
- `SquareTokenEncryptionKeyId` / `SquareTokenEncryptionKeyArn`
- `StripeWebhookSecretKeyArn`
- `ApplicationSecretsKeyArn`

**Secrets:**
- `DatabaseCredentialsSecretArn`
- `StripeApiKeySecretArn`
- `StripeWebhookSecretArn`
- `SquareOAuthSecretArn`
- `BedrockConfigSecretArn`

These outputs are imported by downstream stacks (`DatabaseStack`, `EksStack`) to wire encryption and secret access.

## Manual Setup Required

After deploying this stack, the following secrets must be manually populated:

### 1. Stripe API Key

```bash
aws secretsmanager put-secret-value \
  --secret-id fcc-stripe-api-key-{envName} \
  --secret-string "sk_live_..."
```

### 2. Stripe Webhook Secret

```bash
aws secretsmanager put-secret-value \
  --secret-id fcc-stripe-webhook-secret-{envName} \
  --secret-string "whsec_..."
```

### 3. Square OAuth Credentials

```bash
aws secretsmanager put-secret-value \
  --secret-id fcc-square-oauth-{envName} \
  --secret-string '{
    "application_id": "sq0idp-...",
    "application_secret": "sq0csp-..."
  }'
```

## Usage by Application Code

### Reading Secrets

Spring Boot applications read secrets via environment variables populated from Secrets Manager:

```yaml
# Kubernetes Deployment manifest
env:
  - name: DB_SECRET_ARN
    value: arn:aws:secretsmanager:...
  - name: STRIPE_API_KEY_SECRET_ARN
    value: arn:aws:secretsmanager:...
```

Application code uses AWS SDK to fetch secret values at runtime:

```java
@Value("${db.secret.arn}")
private String dbSecretArn;

String secretJson = secretsManagerClient.getSecretValue(
  GetSecretValueRequest.builder()
    .secretId(dbSecretArn)
    .build()
).secretString();
```

### Encrypting Square Tokens

When storing Square OAuth tokens in the database, the application uses the Square Token Encryption Key:

```java
// Encrypt before INSERT
ByteBuffer encryptedAccessToken = kmsClient.encrypt(
  EncryptRequest.builder()
    .keyId("arn:aws:kms:region:account:key/...")
    .plaintext(SdkBytes.fromUtf8String(accessToken))
    .build()
).ciphertextBlob().asByteBuffer();

// Decrypt after SELECT
String accessToken = kmsClient.decrypt(
  DecryptRequest.builder()
    .ciphertextBlob(SdkBytes.fromByteBuffer(encryptedToken))
    .build()
).plaintext().asUtf8String();
```

## Testing

Comprehensive unit tests are provided in `test/SecretsStack.test.ts`:

- ✓ All KMS keys created with rotation enabled
- ✓ All secrets created with correct encryption keys
- ✓ IAM policies grant correct service principals
- ✓ CloudFormation outputs are exported
- ✓ RETAIN policies prevent accidental deletion

Run tests:
```bash
npm test -- SecretsStack.test.ts
```

## Dependencies

This stack has no dependencies on other stacks and can be deployed independently.

## Dependent Stacks

The following stacks depend on `SecretsStack`:

1. **DatabaseStack** - imports Database Encryption Key and Database Credentials Secret
2. **EksStack** - grants IRSA roles access to decrypt secrets

## Deployment

Deploy as part of the full CDK app:

```bash
cd infra
npm run build
npx cdk deploy SecretsStack --context envName=staging
```

## Compliance and Auditing

All resources are tagged with:
- `Component` - identifies the functional area (Database, Billing, Square Integration, etc.)
- `Environment` - identifies the deployment environment (staging, prod)

Tags support:
- Cost allocation and reporting
- Compliance auditing
- Resource organization

## References

- [AWS KMS Best Practices](https://docs.aws.amazon.com/kms/latest/developerguide/best-practices.html)
- [AWS Secrets Manager Rotation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html)
- [CDK KMS Module](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_kms-readme.html)
- [CDK Secrets Manager Module](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_secretsmanager-readme.html)
