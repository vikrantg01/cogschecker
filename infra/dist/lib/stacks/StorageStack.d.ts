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
export declare class StorageStack extends cdk.Stack {
    /** S3 bucket for storing uploaded invoice files (PDF, JPEG, PNG). */
    readonly invoicesBucket: s3.Bucket;
    /** S3 bucket for hosting React SPA build artifacts (static website). */
    readonly assetsBucket: s3.Bucket;
    /** KMS Customer Managed Key for encrypting invoice files at rest. */
    readonly invoicesKmsKey: kms.Key;
    constructor(scope: Construct, id: string, props: StorageStackProps);
}
