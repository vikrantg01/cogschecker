"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageStack = void 0;
const cdk = require("aws-cdk-lib");
const s3 = require("aws-cdk-lib/aws-s3");
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
class StorageStack extends cdk.Stack {
    /** S3 bucket for storing uploaded invoice files (PDF, JPEG, PNG). */
    invoicesBucket;
    /** S3 bucket for hosting React SPA build artifacts (static website). */
    frontendBucket;
    constructor(scope, id, props) {
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
exports.StorageStack = StorageStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiU3RvcmFnZVN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vbGliL3N0YWNrcy9TdG9yYWdlU3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBQ25DLHlDQUF5QztBQU96Qzs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FpQkc7QUFDSCxNQUFhLFlBQWEsU0FBUSxHQUFHLENBQUMsS0FBSztJQUN6QyxxRUFBcUU7SUFDckQsY0FBYyxDQUFZO0lBRTFDLHdFQUF3RTtJQUN4RCxjQUFjLENBQVk7SUFFMUMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUF5QjtRQUNqRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QiwyRUFBMkU7UUFDM0UsRUFBRTtRQUNGLGdGQUFnRjtRQUNoRixFQUFFO1FBQ0YsWUFBWTtRQUNaLGtEQUFrRDtRQUNsRCxrRUFBa0U7UUFDbEUsRUFBRTtRQUNGLFVBQVU7UUFDVixtREFBbUQ7UUFDbkQsaUVBQWlFO1FBQ2pFLEVBQUU7UUFDRixhQUFhO1FBQ2IsMkRBQTJEO1FBQzNELHNDQUFzQztRQUN0QyxJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUU7WUFDMUQsVUFBVSxFQUFFLGNBQWM7WUFDMUIsVUFBVSxFQUFFLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQyxVQUFVLEVBQUUsNEJBQTRCO1lBQ3hFLGlCQUFpQixFQUFFLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxTQUFTO1lBQ2pELFVBQVUsRUFBRSxJQUFJO1lBQ2hCLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRSxpQ0FBaUM7WUFDMUUsaUJBQWlCLEVBQUUsS0FBSztTQUN6QixDQUFDLENBQUM7UUFFSCwyRUFBMkU7UUFDM0UsRUFBRTtRQUNGLDJEQUEyRDtRQUMzRCxFQUFFO1FBQ0YsWUFBWTtRQUNaLGtEQUFrRDtRQUNsRCw0REFBNEQ7UUFDNUQsb0RBQW9EO1FBQ3BELEVBQUU7UUFDRixhQUFhO1FBQ2IsOEVBQThFO1FBQzlFLHVFQUF1RTtRQUN2RSwyREFBMkQ7UUFDM0QsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLEVBQUUsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQzFELFVBQVUsRUFBRSxjQUFjO1lBQzFCLFVBQVUsRUFBRSxFQUFFLENBQUMsZ0JBQWdCLENBQUMsVUFBVSxFQUFFLDRCQUE0QjtZQUN4RSxpQkFBaUIsRUFBRSxFQUFFLENBQUMsaUJBQWlCLENBQUMsU0FBUztZQUNqRCxVQUFVLEVBQUUsSUFBSTtZQUNoQixhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUUsaUNBQWlDO1lBQzFFLGlCQUFpQixFQUFFLEtBQUs7WUFDeEIsY0FBYyxFQUFFO2dCQUNkO29CQUNFLEVBQUUsRUFBRSx1QkFBdUI7b0JBQzNCLE9BQU8sRUFBRSxJQUFJO29CQUNiLFdBQVcsRUFBRTt3QkFDWDs0QkFDRSxZQUFZLEVBQUUsRUFBRSxDQUFDLFlBQVksQ0FBQyxPQUFPOzRCQUNyQyxlQUFlLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEVBQUUsa0JBQWtCO3lCQUMzRDtxQkFDRjtpQkFDRjthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsMkVBQTJFO1FBQzNFLHdFQUF3RTtRQUN4RSxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsV0FBVyxFQUFFLFNBQVMsQ0FBQyxDQUFDO1FBQzlDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxZQUFZLEVBQUUsb0JBQW9CLENBQUMsQ0FBQztRQUUxRCw0REFBNEQ7UUFDNUQsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxvQkFBb0IsRUFBRTtZQUM1QyxLQUFLLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxVQUFVO1lBQ3JDLFdBQVcsRUFBRSxpREFBaUQ7WUFDOUQsVUFBVSxFQUFFLHVDQUF1QztTQUNwRCxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQzNDLEtBQUssRUFBRSxJQUFJLENBQUMsY0FBYyxDQUFDLFNBQVM7WUFDcEMsV0FBVyxFQUFFLG1DQUFtQztZQUNoRCxVQUFVLEVBQUUsc0NBQXNDO1NBQ25ELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsbUJBQW1CLEVBQUU7WUFDM0MsS0FBSyxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsVUFBVTtZQUNyQyxXQUFXLEVBQUUsa0NBQWtDO1lBQy9DLFVBQVUsRUFBRSxzQ0FBc0M7U0FDbkQsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUMxQyxLQUFLLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxTQUFTO1lBQ3BDLFdBQVcsRUFBRSxpQ0FBaUM7WUFDOUMsVUFBVSxFQUFFLHFDQUFxQztTQUNsRCxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFsR0Qsb0NBa0dDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBTdG9yYWdlU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgLy8gTm8gZW52aXJvbm1lbnQtc3BlY2lmaWMgY29uZmlndXJhdGlvbiBuZWVkZWQgZm9yIG1pbmltYWwgZGVwbG95bWVudFxufVxuXG4vKipcbiAqIFN0b3JhZ2VTdGFja1xuICpcbiAqIFByb3Zpc2lvbnMgUzMgYnVja2V0cyBmb3IgdGhlIEZvb2QgQ29zdCBDYWxjdWxhdG9yIG1pbmltYWwgZGVwbG95bWVudDpcbiAqXG4gKiAg4oCiIEZyb250ZW5kIGJ1Y2tldCAoZmNjLWZyb250ZW5kKSDigJQgc3RvcmVzIFJlYWN0IFNQQSBzdGF0aWMgYnVpbGQgYXJ0aWZhY3RzXG4gKiAgICAtIFNTRS1TMyBzZXJ2ZXItc2lkZSBlbmNyeXB0aW9uIChBV1MtbWFuYWdlZCBrZXlzKVxuICogICAgLSBCbG9jayBwdWJsaWMgYWNjZXNzIChzZXJ2ZWQgdmlhIENsb3VkRnJvbnQgQ0ROKVxuICogICAgLSBSRVRBSU4gcmVtb3ZhbCBwb2xpY3kgdG8gcHJldmVudCBhY2NpZGVudGFsIGRhdGEgbG9zc1xuICpcbiAqICDigKIgSW52b2ljZXMgYnVja2V0IChmY2MtaW52b2ljZXMpIOKAlCBzdG9yZXMgdXBsb2FkZWQgc3VwcGxpZXIgaW52b2ljZSBmaWxlc1xuICogICAgLSBTU0UtUzMgc2VydmVyLXNpZGUgZW5jcnlwdGlvbiAoQVdTLW1hbmFnZWQga2V5cylcbiAqICAgIC0gQmxvY2sgcHVibGljIGFjY2VzcyAoYXBwbGljYXRpb24gdXNlcyBzaWduZWQgVVJMcylcbiAqICAgIC0gOTAtZGF5IGxpZmVjeWNsZSB0cmFuc2l0aW9uIHRvIEdsYWNpZXIgZm9yIGNvc3Qgb3B0aW1pemF0aW9uXG4gKiAgICAtIFJFVEFJTiByZW1vdmFsIHBvbGljeSB0byBwcmV2ZW50IGFjY2lkZW50YWwgZGF0YSBsb3NzXG4gKlxuICogU2F0aXNmaWVzIFJlcXVpcmVtZW50czogNy4xLCA3LjIsIDcuMywgMS42XG4gKi9cbmV4cG9ydCBjbGFzcyBTdG9yYWdlU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICAvKiogUzMgYnVja2V0IGZvciBzdG9yaW5nIHVwbG9hZGVkIGludm9pY2UgZmlsZXMgKFBERiwgSlBFRywgUE5HKS4gKi9cbiAgcHVibGljIHJlYWRvbmx5IGludm9pY2VzQnVja2V0OiBzMy5CdWNrZXQ7XG5cbiAgLyoqIFMzIGJ1Y2tldCBmb3IgaG9zdGluZyBSZWFjdCBTUEEgYnVpbGQgYXJ0aWZhY3RzIChzdGF0aWMgd2Vic2l0ZSkuICovXG4gIHB1YmxpYyByZWFkb25seSBmcm9udGVuZEJ1Y2tldDogczMuQnVja2V0O1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogU3RvcmFnZVN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vIOKUgOKUgCBGcm9udGVuZCBCdWNrZXQg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBIb3N0cyBSZWFjdCBTUEEgc3RhdGljIGJ1aWxkIGFydGlmYWN0cyAoaW5kZXguaHRtbCwgSlMgYnVuZGxlcywgQ1NTLCBpbWFnZXMpLlxuICAgIC8vXG4gICAgLy8gU2VjdXJpdHk6XG4gICAgLy8gIC0gU1NFLVMzIGVuY3J5cHRpb24gYXQgcmVzdCAoQVdTLW1hbmFnZWQga2V5cylcbiAgICAvLyAgLSBCbG9jayBhbGwgcHVibGljIGFjY2VzcyAoQ2xvdWRGcm9udCBPQUkgaGFuZGxlcyByZWFkIGFjY2VzcylcbiAgICAvL1xuICAgIC8vIEFjY2VzczpcbiAgICAvLyAgLSBTZXJ2ZWQgdmlhIENsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIChDZG5TdGFjaylcbiAgICAvLyAgLSBDbG91ZEZyb250IE9yaWdpbiBBY2Nlc3MgSWRlbnRpdHkgKE9BSSkgZ3JhbnRlZCByZWFkIGFjY2Vzc1xuICAgIC8vXG4gICAgLy8gTGlmZWN5Y2xlOlxuICAgIC8vICAtIFJFVEFJTiByZW1vdmFsIHBvbGljeSB0byBwcmV2ZW50IGFjY2lkZW50YWwgZGF0YSBsb3NzXG4gICAgLy8gIC0gTm8gYXV0by1kZWxldGUgb24gc3RhY2sgdGVhcmRvd25cbiAgICB0aGlzLmZyb250ZW5kQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnRnJvbnRlbmRCdWNrZXQnLCB7XG4gICAgICBidWNrZXROYW1lOiAnZmNjLWZyb250ZW5kJyxcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCwgLy8gU1NFLVMzIChBV1MtbWFuYWdlZCBrZXlzKVxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICAgIGVuZm9yY2VTU0w6IHRydWUsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sIC8vIFJlcXVpcmVtZW50IDEuNjogUkVUQUlOIHBvbGljeVxuICAgICAgYXV0b0RlbGV0ZU9iamVjdHM6IGZhbHNlLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSAIEludm9pY2VzIEJ1Y2tldCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvL1xuICAgIC8vIFN0b3JlcyB1cGxvYWRlZCBzdXBwbGllciBpbnZvaWNlIGZpbGVzIChQREYsIEpQRUcsIFBORykuXG4gICAgLy9cbiAgICAvLyBTZWN1cml0eTpcbiAgICAvLyAgLSBTU0UtUzMgZW5jcnlwdGlvbiBhdCByZXN0IChBV1MtbWFuYWdlZCBrZXlzKVxuICAgIC8vICAtIEJsb2NrIGFsbCBwdWJsaWMgYWNjZXNzIChhcHBsaWNhdGlvbiB1c2VzIHNpZ25lZCBVUkxzKVxuICAgIC8vICAtIFNTTCBlbmZvcmNlbWVudCB2aWEgYnVja2V0IHBvbGljeSAoSFRUUFMtb25seSlcbiAgICAvL1xuICAgIC8vIExpZmVjeWNsZTpcbiAgICAvLyAgLSBUcmFuc2l0aW9uIHRvIEdsYWNpZXIgYWZ0ZXIgOTAgZGF5cyAoUmVxdWlyZW1lbnQgNy4zOiBjb3N0IG9wdGltaXphdGlvbilcbiAgICAvLyAgLSBObyBhdXRvbWF0aWMgZGVsZXRpb24g4oCUIHJldGVudGlvbiBpbmRlZmluaXRlIGZvciBjb21wbGlhbmNlL2F1ZGl0XG4gICAgLy8gIC0gUkVUQUlOIHJlbW92YWwgcG9saWN5IHRvIHByZXZlbnQgYWNjaWRlbnRhbCBkYXRhIGxvc3NcbiAgICB0aGlzLmludm9pY2VzQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnSW52b2ljZXNCdWNrZXQnLCB7XG4gICAgICBidWNrZXROYW1lOiAnZmNjLWludm9pY2VzJyxcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCwgLy8gU1NFLVMzIChBV1MtbWFuYWdlZCBrZXlzKVxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICAgIGVuZm9yY2VTU0w6IHRydWUsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sIC8vIFJlcXVpcmVtZW50IDEuNjogUkVUQUlOIHBvbGljeVxuICAgICAgYXV0b0RlbGV0ZU9iamVjdHM6IGZhbHNlLFxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAndHJhbnNpdGlvbi10by1nbGFjaWVyJyxcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIHRyYW5zaXRpb25zOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHN0b3JhZ2VDbGFzczogczMuU3RvcmFnZUNsYXNzLkdMQUNJRVIsXG4gICAgICAgICAgICAgIHRyYW5zaXRpb25BZnRlcjogY2RrLkR1cmF0aW9uLmRheXMoOTApLCAvLyBSZXF1aXJlbWVudCA3LjNcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgQ2xvdWRGb3JtYXRpb24gT3V0cHV0cyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvLyBSZXF1aXJlbWVudCAxLjc6IFRhZyBhbGwgcmVzb3VyY2VzIHdpdGggQ29tcG9uZW50IGFuZCBDb3N0Q2VudGVyIHRhZ3NcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ0NvbXBvbmVudCcsICdTdG9yYWdlJyk7XG4gICAgY2RrLlRhZ3Mub2YodGhpcykuYWRkKCdDb3N0Q2VudGVyJywgJ0Zvb2RDb3N0Q2FsY3VsYXRvcicpO1xuXG4gICAgLy8gRXhwb3J0IGJ1Y2tldCBkZXRhaWxzIGZvciBjb25zdW1wdGlvbiBieSBkZXBlbmRlbnQgc3RhY2tzXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Zyb250ZW5kQnVja2V0TmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmZyb250ZW5kQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ1MzIGJ1Y2tldCBuYW1lIGZvciBSZWFjdCBmcm9udGVuZCBzdGF0aWMgYXNzZXRzJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdGb29kQ29zdENhbGN1bGF0b3ItRnJvbnRlbmRCdWNrZXROYW1lJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdGcm9udGVuZEJ1Y2tldEFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmZyb250ZW5kQnVja2V0LmJ1Y2tldEFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnUzMgYnVja2V0IEFSTiBmb3IgZnJvbnRlbmQgYXNzZXRzJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdGb29kQ29zdENhbGN1bGF0b3ItRnJvbnRlbmRCdWNrZXRBcm4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0ludm9pY2VCdWNrZXROYW1lJywge1xuICAgICAgdmFsdWU6IHRoaXMuaW52b2ljZXNCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUzMgYnVja2V0IG5hbWUgZm9yIGludm9pY2UgZmlsZXMnLFxuICAgICAgZXhwb3J0TmFtZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvci1JbnZvaWNlQnVja2V0TmFtZScsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnSW52b2ljZUJ1Y2tldEFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmludm9pY2VzQnVja2V0LmJ1Y2tldEFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnUzMgYnVja2V0IEFSTiBmb3IgaW52b2ljZSBmaWxlcycsXG4gICAgICBleHBvcnROYW1lOiAnRm9vZENvc3RDYWxjdWxhdG9yLUludm9pY2VCdWNrZXRBcm4nLFxuICAgIH0pO1xuICB9XG59XG4iXX0=