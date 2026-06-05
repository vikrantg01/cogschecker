"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageStack = void 0;
const cdk = require("aws-cdk-lib");
const s3 = require("aws-cdk-lib/aws-s3");
const kms = require("aws-cdk-lib/aws-kms");
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
class StorageStack extends cdk.Stack {
    /** S3 bucket for storing uploaded invoice files (PDF, JPEG, PNG). */
    invoicesBucket;
    /** S3 bucket for hosting React SPA build artifacts (static website). */
    assetsBucket;
    /** KMS Customer Managed Key for encrypting invoice files at rest. */
    invoicesKmsKey;
    constructor(scope, id, props) {
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
exports.StorageStack = StorageStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiU3RvcmFnZVN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vbGliL3N0YWNrcy9TdG9yYWdlU3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBQ25DLHlDQUF5QztBQUN6QywyQ0FBMkM7QUFRM0M7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBaUJHO0FBQ0gsTUFBYSxZQUFhLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDekMscUVBQXFFO0lBQ3JELGNBQWMsQ0FBWTtJQUUxQyx3RUFBd0U7SUFDeEQsWUFBWSxDQUFZO0lBRXhDLHFFQUFxRTtJQUNyRCxjQUFjLENBQVU7SUFFeEMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUF3QjtRQUNoRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsT0FBTyxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRTFCLDJFQUEyRTtRQUMzRSxFQUFFO1FBQ0YsMEVBQTBFO1FBQzFFLHFEQUFxRDtRQUNyRCw4Q0FBOEM7UUFDOUMscUdBQXFHO1FBQ3JHLElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUN4RCxLQUFLLEVBQUUsZ0JBQWdCLE9BQU8sRUFBRTtZQUNoQyxXQUFXLEVBQUUsK0RBQStELE9BQU8sR0FBRztZQUN0RixpQkFBaUIsRUFBRSxJQUFJO1lBQ3ZCLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRSxrREFBa0Q7U0FDNUYsQ0FBQyxDQUFDO1FBRUgsMkVBQTJFO1FBQzNFLEVBQUU7UUFDRiwyREFBMkQ7UUFDM0Qsb0VBQW9FO1FBQ3BFLEVBQUU7UUFDRixZQUFZO1FBQ1osZ0NBQWdDO1FBQ2hDLDZCQUE2QjtRQUM3QixvRUFBb0U7UUFDcEUsb0RBQW9EO1FBQ3BELEVBQUU7UUFDRixhQUFhO1FBQ2Is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YyxDQUFDLEtBQUs7WUFDaEMsV0FBVyxFQUFFLG1DQUFtQztZQUNoRCxVQUFVLEVBQUUsc0JBQXNCLE9BQU8sbUJBQW1CO1NBQzdELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsbUJBQW1CLEVBQUU7WUFDM0MsS0FBSyxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsTUFBTTtZQUNqQyxXQUFXLEVBQUUsb0NBQW9DO1lBQ2pELFVBQVUsRUFBRSxzQkFBc0IsT0FBTyxvQkFBb0I7U0FDOUQsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUMxQyxLQUFLLEVBQUUsSUFBSSxDQUFDLFlBQVksQ0FBQyxVQUFVO1lBQ25DLFdBQVcsRUFBRSw4Q0FBOEM7WUFDM0QsVUFBVSxFQUFFLHNCQUFzQixPQUFPLG1CQUFtQjtTQUM3RCxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFO1lBQ3pDLEtBQUssRUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLFNBQVM7WUFDbEMsV0FBVyxFQUFFLGlDQUFpQztZQUM5QyxVQUFVLEVBQUUsc0JBQXNCLE9BQU8sa0JBQWtCO1NBQzVELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsd0JBQXdCLEVBQUU7WUFDaEQsS0FBSyxFQUFFLElBQUksQ0FBQyxZQUFZLENBQUMsZ0JBQWdCO1lBQ3pDLFdBQVcsRUFBRSxtRUFBbUU7WUFDaEYsVUFBVSxFQUFFLHNCQUFzQixPQUFPLHlCQUF5QjtTQUNuRSxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF4SUQsb0NBd0lDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgKiBhcyBrbXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWttcyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBTdG9yYWdlU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgLyoqIExvZ2ljYWwgZW52aXJvbm1lbnQgbmFtZSwgZS5nLiBcInN0YWdpbmdcIiBvciBcInByb2RcIi4gVXNlZCBmb3IgbmFtaW5nLiAqL1xuICByZWFkb25seSBlbnZOYW1lOiBzdHJpbmc7XG59XG5cbi8qKlxuICogU3RvcmFnZVN0YWNrXG4gKlxuICogUHJvdmlzaW9ucyBTMyBidWNrZXRzIGZvciB0aGUgRm9vZCBDb3N0IENhbGN1bGF0b3I6XG4gKlxuICogIOKAoiBJbnZvaWNlcyBidWNrZXQg4oCUIHN0b3JlcyB1cGxvYWRlZCBzdXBwbGllciBpbnZvaWNlIGZpbGVzIChQREYsIEpQRUcsIFBORylcbiAqICAgIC0gS01TLUNNSyBzZXJ2ZXItc2lkZSBlbmNyeXB0aW9uXG4gKiAgICAtIEJsb2NrIHB1YmxpYyBhY2Nlc3NcbiAqICAgIC0gVmVyc2lvbmluZyBlbmFibGVkXG4gKiAgICAtIDkwLWRheSBsaWZlY3ljbGUgdHJhbnNpdGlvbiB0byBHbGFjaWVyIGZvciBjb3N0IG9wdGltaXphdGlvblxuICpcbiAqICDigKIgQXNzZXRzIGJ1Y2tldCDigJQgaG9zdHMgUmVhY3QgU1BBIHN0YXRpYyBidWlsZCBhcnRpZmFjdHNcbiAqICAgIC0gU3RhdGljIHdlYnNpdGUgaG9zdGluZyBlbmFibGVkXG4gKiAgICAtIFNlcnZlZCB2aWEgQ2xvdWRGcm9udCBDRE4gKENkblN0YWNrKVxuICogICAgLSBQdWJsaWMgcmVhZCBhY2Nlc3MgKENsb3VkRnJvbnQgT3JpZ2luIEFjY2VzcyBJZGVudGl0eSBpbiBDZG5TdGFjaylcbiAqXG4gKiBTYXRpc2ZpZXMgUmVxdWlyZW1lbnRzOiAxMi42IChpbnZvaWNlIHVwbG9hZCBzdG9yYWdlKSwgMTAuMSAobXVsdGktdmVudWUgZGF0YSBpc29sYXRpb24gdmlhIG9iamVjdCBwcmVmaXhpbmcpXG4gKi9cbmV4cG9ydCBjbGFzcyBTdG9yYWdlU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICAvKiogUzMgYnVja2V0IGZvciBzdG9yaW5nIHVwbG9hZGVkIGludm9pY2UgZmlsZXMgKFBERiwgSlBFRywgUE5HKS4gKi9cbiAgcHVibGljIHJlYWRvbmx5IGludm9pY2VzQnVja2V0OiBzMy5CdWNrZXQ7XG5cbiAgLyoqIFMzIGJ1Y2tldCBmb3IgaG9zdGluZyBSZWFjdCBTUEEgYnVpbGQgYXJ0aWZhY3RzIChzdGF0aWMgd2Vic2l0ZSkuICovXG4gIHB1YmxpYyByZWFkb25seSBhc3NldHNCdWNrZXQ6IHMzLkJ1Y2tldDtcblxuICAvKiogS01TIEN1c3RvbWVyIE1hbmFnZWQgS2V5IGZvciBlbmNyeXB0aW5nIGludm9pY2UgZmlsZXMgYXQgcmVzdC4gKi9cbiAgcHVibGljIHJlYWRvbmx5IGludm9pY2VzS21zS2V5OiBrbXMuS2V5O1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBTdG9yYWdlU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgeyBlbnZOYW1lIH0gPSBwcm9wcztcblxuICAgIC8vIOKUgOKUgCBLTVMgQ01LIGZvciBJbnZvaWNlIEVuY3J5cHRpb24g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBDdXN0b21lci1tYW5hZ2VkIGtleSAoQ01LKSBmb3Igc2VydmVyLXNpZGUgZW5jcnlwdGlvbiBvZiBpbnZvaWNlIGZpbGVzLlxuICAgIC8vIEtleSByb3RhdGlvbiBlbmFibGVkLiBBdXRvbWF0aWMga2V5IHBvbGljeSBncmFudHM6XG4gICAgLy8gIC0gUm9vdCBhY2NvdW50IChhZG1pbikgZnVsbCBrZXkgbWFuYWdlbWVudFxuICAgIC8vICAtIERvd25zdHJlYW0gcm9sZXMgKEFQSSBzZXJ2aWNlLCB3b3JrZXJzKSB3aWxsIGJlIGdyYW50ZWQgZW5jcnlwdC9kZWNyeXB0IHZpYSBhZGRUb1Jlc291cmNlUG9saWN5XG4gICAgdGhpcy5pbnZvaWNlc0ttc0tleSA9IG5ldyBrbXMuS2V5KHRoaXMsICdJbnZvaWNlc0ttc0tleScsIHtcbiAgICAgIGFsaWFzOiBgZmNjLWludm9pY2VzLSR7ZW52TmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246IGBGb29kIENvc3QgQ2FsY3VsYXRvciDigJQgS01TIGtleSBmb3IgaW52b2ljZSBmaWxlIGVuY3J5cHRpb24gKCR7ZW52TmFtZX0pYCxcbiAgICAgIGVuYWJsZUtleVJvdGF0aW9uOiB0cnVlLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLCAvLyBSZXRhaW4ga2V5IG9uIHN0YWNrIGRlbGV0aW9uIHRvIGF2b2lkIGRhdGEgbG9zc1xuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSAIEludm9pY2VzIEJ1Y2tldCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvL1xuICAgIC8vIFN0b3JlcyB1cGxvYWRlZCBzdXBwbGllciBpbnZvaWNlIGZpbGVzIChQREYsIEpQRUcsIFBORykuXG4gICAgLy8gT2JqZWN0IGtleSBzdHJ1Y3R1cmU6IGBpbnZvaWNlcy97dmVudWVJZH0ve2ludm9pY2VJZH0ve2ZpbGVuYW1lfWBcbiAgICAvL1xuICAgIC8vIFNlY3VyaXR5OlxuICAgIC8vICAtIEtNUy1DTUsgZW5jcnlwdGlvbiBhdCByZXN0XG4gICAgLy8gIC0gQmxvY2sgYWxsIHB1YmxpYyBhY2Nlc3NcbiAgICAvLyAgLSBWZXJzaW9uaW5nIGVuYWJsZWQgKGF1ZGl0IHRyYWlsLCBhY2NpZGVudGFsIGRlbGV0aW9uIHJlY292ZXJ5KVxuICAgIC8vICAtIFNTTCBlbmZvcmNlbWVudCB2aWEgYnVja2V0IHBvbGljeSAoSFRUUFMtb25seSlcbiAgICAvL1xuICAgIC8vIExpZmVjeWNsZTpcbiAgICAvLyAgLSBUcmFuc2l0aW9uIHRvIEdsYWNpZXIgYWZ0ZXIgOTAgZGF5cyAoY29zdCBvcHRpbWl6YXRpb24gZm9yIG9sZCBpbnZvaWNlcylcbiAgICAvLyAgLSBObyBhdXRvbWF0aWMgZGVsZXRpb24g4oCUIHJldGVudGlvbiBpbmRlZmluaXRlIGZvciBjb21wbGlhbmNlL2F1ZGl0XG4gICAgdGhpcy5pbnZvaWNlc0J1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ0ludm9pY2VzQnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogYGZjYy1pbnZvaWNlcy0ke2Vudk5hbWV9LSR7Y2RrLlN0YWNrLm9mKHRoaXMpLmFjY291bnR9YCxcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uS01TLFxuICAgICAgZW5jcnlwdGlvbktleTogdGhpcy5pbnZvaWNlc0ttc0tleSxcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICB2ZXJzaW9uZWQ6IHRydWUsXG4gICAgICBlbmZvcmNlU1NMOiB0cnVlLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLCAvLyBSZXRhaW4gYnVja2V0IG9uIHN0YWNrIGRlbGV0aW9uXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogZmFsc2UsIC8vIE5ldmVyIGF1dG8tZGVsZXRlIGludm9pY2UgZmlsZXNcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ3RyYW5zaXRpb24tdG8tZ2xhY2llcicsXG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICB0cmFuc2l0aW9uczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzdG9yYWdlQ2xhc3M6IHMzLlN0b3JhZ2VDbGFzcy5HTEFDSUVSLFxuICAgICAgICAgICAgICB0cmFuc2l0aW9uQWZ0ZXI6IGNkay5EdXJhdGlvbi5kYXlzKDkwKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgQXNzZXRzIEJ1Y2tldCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvL1xuICAgIC8vIEhvc3RzIFJlYWN0IFNQQSBzdGF0aWMgYnVpbGQgYXJ0aWZhY3RzIChpbmRleC5odG1sLCBKUyBidW5kbGVzLCBDU1MsIGltYWdlcykuXG4gICAgLy8gT2JqZWN0IGtleSBzdHJ1Y3R1cmU6IGAve2hhc2h9L3tmaWxlbmFtZX1gIChlLmcuLCBgL2Fzc2V0cy9hcHAuYWJjMTIzLmpzYClcbiAgICAvL1xuICAgIC8vIEFjY2VzczpcbiAgICAvLyAgLSBOb3QgZGlyZWN0bHkgcHVibGljIOKAlCBDbG91ZEZyb250IE9yaWdpbiBBY2Nlc3MgSWRlbnRpdHkgKE9BSSkgaXMgZ3JhbnRlZCByZWFkIGFjY2Vzc1xuICAgIC8vICAgIGluIENkblN0YWNrIHZpYSBidWNrZXQuZ3JhbnRSZWFkKGNsb3VkRnJvbnRPYWkpXG4gICAgLy8gIC0gU3RhdGljIHdlYnNpdGUgaG9zdGluZyBlbmFibGVkIChzbyBTMyBjYW4gc2VydmUgaW5kZXguaHRtbCBhcyBkZWZhdWx0IGRvY3VtZW50KVxuICAgIC8vICAtIE5vIFNTTCBlbmZvcmNlbWVudCBoZXJlIOKAlCBDbG91ZEZyb250IGhhbmRsZXMgSFRUUFMgdGVybWluYXRpb25cbiAgICAvL1xuICAgIC8vIExpZmVjeWNsZTpcbiAgICAvLyAgLSBObyBsaWZlY3ljbGUgcnVsZXMg4oCUIG9sZCBidWlsZCBhcnRpZmFjdHMgYXJlIG92ZXJ3cml0dGVuIG9uIGVhY2ggZGVwbG95bWVudFxuICAgIC8vICAtIFJlbW92YWxQb2xpY3kuREVTVFJPWSBpcyBhY2NlcHRhYmxlIGZvciBub24tcHJvZHVjdGlvbiBlbnZpcm9ubWVudHMgKHN0YWdpbmcsIGRldilcbiAgICAvLyAgLSBQcm9kdWN0aW9uIHNob3VsZCB1c2UgUkVUQUlOIG9yIHZlcnNpb25pbmcgaWYgcm9sbGJhY2sgaXMgcmVxdWlyZWRcbiAgICBjb25zdCBpc1Byb2R1Y3Rpb24gPSBlbnZOYW1lID09PSAncHJvZCc7XG4gICAgdGhpcy5hc3NldHNCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdBc3NldHNCdWNrZXQnLCB7XG4gICAgICBidWNrZXROYW1lOiBgZmNjLWFzc2V0cy0ke2Vudk5hbWV9LSR7Y2RrLlN0YWNrLm9mKHRoaXMpLmFjY291bnR9YCxcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCwgLy8gQUVTLTI1NiAoc3VmZmljaWVudCBmb3IgcHVibGljIGFzc2V0cylcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsIC8vIENsb3VkRnJvbnQgT0FJIGhhbmRsZXMgcmVhZCBhY2Nlc3NcbiAgICAgIHdlYnNpdGVJbmRleERvY3VtZW50OiAnaW5kZXguaHRtbCcsXG4gICAgICB3ZWJzaXRlRXJyb3JEb2N1bWVudDogJ2luZGV4Lmh0bWwnLCAvLyBTUEEgcm91dGluZyDigJQgc2VydmUgaW5kZXguaHRtbCBmb3IgNDA0c1xuICAgICAgcmVtb3ZhbFBvbGljeTogaXNQcm9kdWN0aW9uID8gY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOIDogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiAhaXNQcm9kdWN0aW9uLCAvLyBTdGFnaW5nL2RldiBjYW4gYXV0by1kZWxldGUgb24gc3RhY2sgdGVhcmRvd25cbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCBDbG91ZEZvcm1hdGlvbiBPdXRwdXRzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vIEV4cG9ydGVkIHNvIGRvd25zdHJlYW0gc3RhY2tzIChDZG5TdGFjaywgQVBJIHNlcnZpY2UpIGNhbiByZWZlcmVuY2UgYnkgbG9naWNhbCBuYW1lLlxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0ludm9pY2VzQnVja2V0TmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmludm9pY2VzQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ1MzIGJ1Y2tldCBuYW1lIGZvciBpbnZvaWNlIGZpbGVzJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1JbnZvaWNlc0J1Y2tldE5hbWVgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0ludm9pY2VzQnVja2V0QXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuaW52b2ljZXNCdWNrZXQuYnVja2V0QXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdTMyBidWNrZXQgQVJOIGZvciBpbnZvaWNlIGZpbGVzJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1JbnZvaWNlc0J1Y2tldEFybmAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnSW52b2ljZXNLbXNLZXlJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmludm9pY2VzS21zS2V5LmtleUlkLFxuICAgICAgZGVzY3JpcHRpb246ICdLTVMga2V5IElEIGZvciBpbnZvaWNlIGVuY3J5cHRpb24nLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LUludm9pY2VzS21zS2V5SWRgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0ludm9pY2VzS21zS2V5QXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuaW52b2ljZXNLbXNLZXkua2V5QXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdLTVMga2V5IEFSTiBmb3IgaW52b2ljZSBlbmNyeXB0aW9uJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1JbnZvaWNlc0ttc0tleUFybmAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXNzZXRzQnVja2V0TmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmFzc2V0c0J1Y2tldC5idWNrZXROYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdTMyBidWNrZXQgbmFtZSBmb3Igc3RhdGljIGFzc2V0cyAoUmVhY3QgU1BBKScsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tQXNzZXRzQnVja2V0TmFtZWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXNzZXRzQnVja2V0QXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuYXNzZXRzQnVja2V0LmJ1Y2tldEFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnUzMgYnVja2V0IEFSTiBmb3Igc3RhdGljIGFzc2V0cycsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tQXNzZXRzQnVja2V0QXJuYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBc3NldHNCdWNrZXRXZWJzaXRlVXJsJywge1xuICAgICAgdmFsdWU6IHRoaXMuYXNzZXRzQnVja2V0LmJ1Y2tldFdlYnNpdGVVcmwsXG4gICAgICBkZXNjcmlwdGlvbjogJ1MzIHN0YXRpYyB3ZWJzaXRlIFVSTCAobm90IHVzZWQgZGlyZWN0bHkg4oCUIHNlcnZlZCB2aWEgQ2xvdWRGcm9udCknLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LUFzc2V0c0J1Y2tldFdlYnNpdGVVcmxgLFxuICAgIH0pO1xuICB9XG59XG4iXX0=