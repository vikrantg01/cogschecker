import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
export interface StorageStackProps extends cdk.StackProps {
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
export declare class StorageStack extends cdk.Stack {
    /** S3 bucket for storing uploaded invoice files (PDF, JPEG, PNG). */
    readonly invoicesBucket: s3.Bucket;
    /** S3 bucket for hosting React SPA build artifacts (static website). */
    readonly frontendBucket: s3.Bucket;
    constructor(scope: Construct, id: string, props?: StorageStackProps);
}
