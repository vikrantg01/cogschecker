import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';

export interface StorageStackProps extends cdk.StackProps {
  /** Logical environment name, e.g. "staging" or "prod". Used for naming. */
  readonly envName: string;
}

/**
 * StorageStack
 *
 * Provisions S3 buckets for the Food Cost Calculator:
 *
 *  • Invoices bucket — stores uploaded supplier invoice files (PDF, JPEG, PNG)
 *    - KMS-CMK server-side encryption
 *    - Block public access
 *    - Versioning enabled
 *    - 90-day lifecycle transition to Glacier for cost optimization
 *
 *  • Assets bucket — hosts React SPA static build artifacts
 *    - Static website hosting enabled
 *    - Served via CloudFront CDN (CdnStack)
 *    - Public read access (CloudFront Origin Access Identity in CdnStack)
 *
 * Satisfies Requirements: 12.6 (invoice upload storage), 10.1 (multi-venue data isolation via object prefixing)
 */
export class StorageStack extends cdk.Stack {
  /** S3 bucket for storing uploaded invoice files (PDF, JPEG, PNG). */
  public readonly invoicesBucket: s3.Bucket;

  /** S3 bucket for hosting React SPA build artifacts (static website). */
  public readonly assetsBucket: s3.Bucket;

  /** KMS Customer Managed Key for encrypting invoice files at rest. */
  public readonly invoicesKmsKey: kms.Key;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { envName } = props;

    // ── KMS CMK for Invoice Encryption ──────────────────────────────────────
    //
    // Customer-managed key (CMK) for server-side encryption of invoice files.
    // Key rotation enabled. Automatic key policy grants:
    //  - Root account (admin) full key management
    //  - Downstream roles (API service, workers) will be granted encrypt/decrypt via addToResourcePolicy
    this.invoicesKmsKey = new kms.Key(this, 'InvoicesKmsKey', {
      alias: `fcc-invoices-${envName}`,
      description: `Food Cost Calculator — KMS key for invoice file encryption (${envName})`,
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Retain key on stack deletion to avoid data loss
    });

    // ── Invoices Bucket ─────────────────────────────────────────────────────
    //
    // Stores uploaded supplier invoice files (PDF, JPEG, PNG).
    // Object key structure: `invoices/{venueId}/{invoiceId}/{filename}`
    //
    // Security:
    //  - KMS-CMK encryption at rest
    //  - Block all public access
    //  - Versioning enabled (audit trail, accidental deletion recovery)
    //  - SSL enforcement via bucket policy (HTTPS-only)
    //
    // Lifecycle:
    //  - Transition to Glacier after 90 days (cost optimization for old invoices)
    //  - No automatic deletion — retention indefinite for compliance/audit
    this.invoicesBucket = new s3.Bucket(this, 'InvoicesBucket', {
      bucketName: `fcc-invoices-${envName}-${cdk.Stack.of(this).account}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.invoicesKmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Retain bucket on stack deletion
      autoDeleteObjects: false, // Never auto-delete invoice files
      lifecycleRules: [
        {
          id: 'transition-to-glacier',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
    });

    // ── Assets Bucket ───────────────────────────────────────────────────────
    //
    // Hosts React SPA static build artifacts (index.html, JS bundles, CSS, images).
    // Object key structure: `/{hash}/{filename}` (e.g., `/assets/app.abc123.js`)
    //
    // Access:
    //  - Not directly public — CloudFront Origin Access Identity (OAI) is granted read access
    //    in CdnStack via bucket.grantRead(cloudFrontOai)
    //  - Static website hosting enabled (so S3 can serve index.html as default document)
    //  - No SSL enforcement here — CloudFront handles HTTPS termination
    //
    // Lifecycle:
    //  - No lifecycle rules — old build artifacts are overwritten on each deployment
    //  - RemovalPolicy.DESTROY is acceptable for non-production environments (staging, dev)
    //  - Production should use RETAIN or versioning if rollback is required
    const isProduction = envName === 'prod';
    this.assetsBucket = new s3.Bucket(this, 'AssetsBucket', {
      bucketName: `fcc-assets-${envName}-${cdk.Stack.of(this).account}`,
      encryption: s3.BucketEncryption.S3_MANAGED, // AES-256 (sufficient for public assets)
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // CloudFront OAI handles read access
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html', // SPA routing — serve index.html for 404s
      removalPolicy: isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProduction, // Staging/dev can auto-delete on stack teardown
    });

    // ── CloudFormation Outputs ──────────────────────────────────────────────
    // Exported so downstream stacks (CdnStack, API service) can reference by logical name.

    new cdk.CfnOutput(this, 'InvoicesBucketName', {
      value: this.invoicesBucket.bucketName,
      description: 'S3 bucket name for invoice files',
      exportName: `FoodCostCalculator-${envName}-InvoicesBucketName`,
    });

    new cdk.CfnOutput(this, 'InvoicesBucketArn', {
      value: this.invoicesBucket.bucketArn,
      description: 'S3 bucket ARN for invoice files',
      exportName: `FoodCostCalculator-${envName}-InvoicesBucketArn`,
    });

    new cdk.CfnOutput(this, 'InvoicesKmsKeyId', {
      value: this.invoicesKmsKey.keyId,
      description: 'KMS key ID for invoice encryption',
      exportName: `FoodCostCalculator-${envName}-InvoicesKmsKeyId`,
    });

    new cdk.CfnOutput(this, 'InvoicesKmsKeyArn', {
      value: this.invoicesKmsKey.keyArn,
      description: 'KMS key ARN for invoice encryption',
      exportName: `FoodCostCalculator-${envName}-InvoicesKmsKeyArn`,
    });

    new cdk.CfnOutput(this, 'AssetsBucketName', {
      value: this.assetsBucket.bucketName,
      description: 'S3 bucket name for static assets (React SPA)',
      exportName: `FoodCostCalculator-${envName}-AssetsBucketName`,
    });

    new cdk.CfnOutput(this, 'AssetsBucketArn', {
      value: this.assetsBucket.bucketArn,
      description: 'S3 bucket ARN for static assets',
      exportName: `FoodCostCalculator-${envName}-AssetsBucketArn`,
    });

    new cdk.CfnOutput(this, 'AssetsBucketWebsiteUrl', {
      value: this.assetsBucket.bucketWebsiteUrl,
      description: 'S3 static website URL (not used directly — served via CloudFront)',
      exportName: `FoodCostCalculator-${envName}-AssetsBucketWebsiteUrl`,
    });
  }
}
