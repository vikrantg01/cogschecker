import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface StorageStackProps extends cdk.StackProps {
  // No environment-specific configuration needed for minimal deployment
}

/**
 * StorageStack
 *
 * Provisions S3 buckets for the Food Cost Calculator minimal deployment:
 *
 *  • Frontend bucket (fcc-frontend) — stores React SPA static build artifacts
 *    - SSE-S3 server-side encryption (AWS-managed keys)
 *    - Block public access (served via CloudFront CDN)
 *    - RETAIN removal policy to prevent accidental data loss
 *
 *  • Invoices bucket (fcc-invoices) — stores uploaded supplier invoice files
 *    - SSE-S3 server-side encryption (AWS-managed keys)
 *    - Block public access (application uses signed URLs)
 *    - 90-day lifecycle transition to Glacier for cost optimization
 *    - RETAIN removal policy to prevent accidental data loss
 *
 * Satisfies Requirements: 7.1, 7.2, 7.3, 1.6
 */
export class StorageStack extends cdk.Stack {
  /** S3 bucket for storing uploaded invoice files (PDF, JPEG, PNG). */
  public readonly invoicesBucket: s3.Bucket;

  /** S3 bucket for hosting React SPA build artifacts (static website). */
  public readonly frontendBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: StorageStackProps) {
    super(scope, id, props);

    // ── Frontend Bucket ─────────────────────────────────────────────────────
    //
    // Hosts React SPA static build artifacts (index.html, JS bundles, CSS, images).
    //
    // Security:
    //  - SSE-S3 encryption at rest (AWS-managed keys)
    //  - Block all public access (CloudFront OAI handles read access)
    //
    // Access:
    //  - Served via CloudFront distribution (CdnStack)
    //  - CloudFront Origin Access Identity (OAI) granted read access
    //
    // Lifecycle:
    //  - RETAIN removal policy to prevent accidental data loss
    //  - No auto-delete on stack teardown
    this.frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: 'fcc-frontend',
      encryption: s3.BucketEncryption.S3_MANAGED, // SSE-S3 (AWS-managed keys)
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Requirement 1.6: RETAIN policy
      autoDeleteObjects: false,
    });

    // ── Invoices Bucket ─────────────────────────────────────────────────────
    //
    // Stores uploaded supplier invoice files (PDF, JPEG, PNG).
    //
    // Security:
    //  - SSE-S3 encryption at rest (AWS-managed keys)
    //  - Block all public access (application uses signed URLs)
    //  - SSL enforcement via bucket policy (HTTPS-only)
    //
    // Lifecycle:
    //  - Transition to Glacier after 90 days (Requirement 7.3: cost optimization)
    //  - No automatic deletion — retention indefinite for compliance/audit
    //  - RETAIN removal policy to prevent accidental data loss
    this.invoicesBucket = new s3.Bucket(this, 'InvoicesBucket', {
      bucketName: 'fcc-invoices',
      encryption: s3.BucketEncryption.S3_MANAGED, // SSE-S3 (AWS-managed keys)
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Requirement 1.6: RETAIN policy
      autoDeleteObjects: false,
      lifecycleRules: [
        {
          id: 'transition-to-glacier',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90), // Requirement 7.3
            },
          ],
        },
      ],
    });

    // ── CloudFormation Outputs ──────────────────────────────────────────────
    // Requirement 1.7: Tag all resources with Component and CostCenter tags
    cdk.Tags.of(this).add('Component', 'Storage');
    cdk.Tags.of(this).add('CostCenter', 'FoodCostCalculator');

    // Export bucket details for consumption by dependent stacks
    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: this.frontendBucket.bucketName,
      description: 'S3 bucket name for React frontend static assets',
      exportName: 'FoodCostCalculator-FrontendBucketName',
    });

    new cdk.CfnOutput(this, 'FrontendBucketArn', {
      value: this.frontendBucket.bucketArn,
      description: 'S3 bucket ARN for frontend assets',
      exportName: 'FoodCostCalculator-FrontendBucketArn',
    });

    new cdk.CfnOutput(this, 'InvoiceBucketName', {
      value: this.invoicesBucket.bucketName,
      description: 'S3 bucket name for invoice files',
      exportName: 'FoodCostCalculator-InvoiceBucketName',
    });

    new cdk.CfnOutput(this, 'InvoiceBucketArn', {
      value: this.invoicesBucket.bucketArn,
      description: 'S3 bucket ARN for invoice files',
      exportName: 'FoodCostCalculator-InvoiceBucketArn',
    });
  }
}
