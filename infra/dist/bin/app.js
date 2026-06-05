#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("source-map-support/register");
const cdk = require("aws-cdk-lib");
const NetworkStack_1 = require("../lib/stacks/NetworkStack");
const StorageStack_1 = require("../lib/stacks/StorageStack");
const AuthStack_1 = require("../lib/stacks/AuthStack");
const DatabaseStack_1 = require("../lib/stacks/DatabaseStack");
const CacheStack_1 = require("../lib/stacks/CacheStack");
const MessagingStack_1 = require("../lib/stacks/MessagingStack");
const EksStack_1 = require("../lib/stacks/EksStack");
const app = new cdk.App();
/**
 * Deployment environment — resolved from context or environment variables.
 * Override with: cdk deploy --context env=prod
 */
const envName = app.node.tryGetContext('env') ?? 'staging';
const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-southeast-2',
};
// ── Network Stack ────────────────────────────────────────────────────────────
// VPC, public/private subnets (3 AZs), NAT gateways, baseline security groups.
// All downstream stacks (EKS, Aurora, ElastiCache, ALB) receive their network
// primitives from this stack via exported values / passed props.
const networkStack = new NetworkStack_1.NetworkStack(app, `FoodCostCalculator-Network-${envName}`, {
    env,
    description: 'Food Cost Calculator — VPC, subnets, NAT gateways, baseline security groups',
    envName,
});
// ── Storage Stack ────────────────────────────────────────────────────────────
// S3 buckets for invoice files and static assets (React SPA).
// - Invoices bucket: KMS-CMK encryption, versioning, 90-day Glacier transition
// - Assets bucket: static website hosting for CloudFront origin
const storageStack = new StorageStack_1.StorageStack(app, `FoodCostCalculator-Storage-${envName}`, {
    env,
    description: 'Food Cost Calculator — S3 buckets for invoice files and static assets',
    envName,
});
// ── Auth Stack ───────────────────────────────────────────────────────────────
// Cognito User Pool with email/password auth, Google and Apple OAuth providers,
// custom attributes (org_id, venue_roles, tier), and hosted UI support.
const authStack = new AuthStack_1.AuthStack(app, `FoodCostCalculator-Auth-${envName}`, {
    env,
    description: 'Food Cost Calculator — Cognito User Pool, OAuth providers, hosted UI',
    envName,
});
// ── Database Stack ───────────────────────────────────────────────────────────
// Aurora Serverless v2 PostgreSQL cluster with Multi-AZ, Secrets Manager
// credentials, SSL enforcement, and pgaudit logging.
// Deployed in private-data subnets with access restricted to EKS nodes only.
const databaseStack = new DatabaseStack_1.DatabaseStack(app, `FoodCostCalculator-Database-${envName}`, {
    env,
    description: 'Food Cost Calculator — Aurora PostgreSQL Serverless v2 Multi-AZ cluster',
    envName,
    vpc: networkStack.vpc,
    auroraSecurityGroup: networkStack.auroraSecurityGroup,
});
databaseStack.addDependency(networkStack);
// ── Cache Stack ──────────────────────────────────────────────────────────────
// ElastiCache Redis cluster mode with Multi-AZ replication for session store,
// pub/sub cost propagation events, and query result caching.
const cacheStack = new CacheStack_1.CacheStack(app, `FoodCostCalculator-Cache-${envName}`, {
    env,
    description: 'Food Cost Calculator — ElastiCache Redis cluster mode Multi-AZ',
    envName,
    vpc: networkStack.vpc,
    elastiCacheSecurityGroup: networkStack.elastiCacheSecurityGroup,
});
cacheStack.addDependency(networkStack);
// ── Messaging Stack ──────────────────────────────────────────────────────────
// SQS FIFO queues for async jobs (cost propagation, OCR, AI insights, Square sync)
// with dead-letter queues and CloudWatch alarms on DLQ depth.
const messagingStack = new MessagingStack_1.MessagingStack(app, `FoodCostCalculator-Messaging-${envName}`, {
    env,
    description: 'Food Cost Calculator — SQS FIFO queues, DLQs, CloudWatch alarms',
    envName,
});
// ── Observability Stack ──────────────────────────────────────────────────────
// CloudWatch dashboards for API, workers, Aurora, and ElastiCache metrics.
// Alarms for API latency, error rate, DLQ depth, and Aurora failover.
// X-Ray groups for distributed tracing. Structured log groups.
// TEMPORARILY DISABLED - ObservabilityStack implementation is incomplete
/*
const observabilityStack = new ObservabilityStack(app, `FoodCostCalculator-Observability-${envName}`, {
  env,
  description: 'Food Cost Calculator — CloudWatch dashboards, alarms, X-Ray groups, log groups',
  envName,
  auroraCluster: databaseStack.cluster,
  elastiCacheReplicationGroupId: cacheStack.replicationGroup.replicationGroupId || undefined,
  dlqQueues: [
    messagingStack.costPropagationDlq,
    messagingStack.ocrProcessingDlq,
    messagingStack.aiInsightsDlq,
    messagingStack.squareSyncDlq,
  ],
});
observabilityStack.addDependency(databaseStack);
observabilityStack.addDependency(cacheStack);
observabilityStack.addDependency(messagingStack);
*/
// ── EKS Stack ────────────────────────────────────────────────────────────────
// EKS 1.30 cluster with three managed node groups (one per AZ), OIDC provider,
// and IRSA IAM roles for API and worker pods with least-privilege policies.
const eksStack = new EksStack_1.EksStack(app, `FoodCostCalculator-EKS-${envName}`, {
    env,
    description: 'Food Cost Calculator — EKS cluster, node groups, OIDC, IRSA roles',
    envName,
    vpc: networkStack.vpc,
    eksNodeSecurityGroup: networkStack.eksNodeSecurityGroup,
});
eksStack.addDependency(networkStack);
// Tag every resource in every stack with the project and environment.
cdk.Tags.of(app).add('Project', 'FoodCostCalculator');
cdk.Tags.of(app).add('Environment', envName);
cdk.Tags.of(app).add('ManagedBy', 'CDK');
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vYmluL2FwcC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSx1Q0FBcUM7QUFDckMsbUNBQW1DO0FBQ25DLDZEQUEwRDtBQUMxRCw2REFBMEQ7QUFDMUQsdURBQW9EO0FBQ3BELCtEQUE0RDtBQUM1RCx5REFBc0Q7QUFDdEQsaUVBQThEO0FBQzlELHFEQUFrRDtBQUVsRCxNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztBQUUxQjs7O0dBR0c7QUFDSCxNQUFNLE9BQU8sR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsSUFBSSxTQUFTLENBQUM7QUFFM0QsTUFBTSxHQUFHLEdBQW9CO0lBQzNCLE9BQU8sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQjtJQUN4QyxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsSUFBSSxnQkFBZ0I7Q0FDM0QsQ0FBQztBQUVGLGdGQUFnRjtBQUNoRiwrRUFBK0U7QUFDL0UsOEVBQThFO0FBQzlFLGlFQUFpRTtBQUNqRSxNQUFNLFlBQVksR0FBRyxJQUFJLDJCQUFZLENBQUMsR0FBRyxFQUFFLDhCQUE4QixPQUFPLEVBQUUsRUFBRTtJQUNsRixHQUFHO0lBQ0gsV0FBVyxFQUFFLDZFQUE2RTtJQUMxRixPQUFPO0NBQ1IsQ0FBQyxDQUFDO0FBRUgsZ0ZBQWdGO0FBQ2hGLDhEQUE4RDtBQUM5RCwrRUFBK0U7QUFDL0UsZ0VBQWdFO0FBQ2hFLE1BQU0sWUFBWSxHQUFHLElBQUksMkJBQVksQ0FBQyxHQUFHLEVBQUUsOEJBQThCLE9BQU8sRUFBRSxFQUFFO0lBQ2xGLEdBQUc7SUFDSCxXQUFXLEVBQUUsdUVBQXVFO0lBQ3BGLE9BQU87Q0FDUixDQUFDLENBQUM7QUFFSCxnRkFBZ0Y7QUFDaEYsZ0ZBQWdGO0FBQ2hGLHdFQUF3RTtBQUN4RSxNQUFNLFNBQVMsR0FBRyxJQUFJLHFCQUFTLENBQUMsR0FBRyxFQUFFLDJCQUEyQixPQUFPLEVBQUUsRUFBRTtJQUN6RSxHQUFHO0lBQ0gsV0FBVyxFQUFFLHNFQUFzRTtJQUNuRixPQUFPO0NBQ1IsQ0FBQyxDQUFDO0FBRUgsZ0ZBQWdGO0FBQ2hGLHlFQUF5RTtBQUN6RSxxREFBcUQ7QUFDckQsNkVBQTZFO0FBQzdFLE1BQU0sYUFBYSxHQUFHLElBQUksNkJBQWEsQ0FBQyxHQUFHLEVBQUUsK0JBQStCLE9BQU8sRUFBRSxFQUFFO0lBQ3JGLEdBQUc7SUFDSCxXQUFXLEVBQUUseUVBQXlFO0lBQ3RGLE9BQU87SUFDUCxHQUFHLEVBQUUsWUFBWSxDQUFDLEdBQUc7SUFDckIsbUJBQW1CLEVBQUUsWUFBWSxDQUFDLG1CQUFtQjtDQUN0RCxDQUFDLENBQUM7QUFDSCxhQUFhLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBRTFDLGdGQUFnRjtBQUNoRiw4RUFBOEU7QUFDOUUsNkRBQTZEO0FBQzdELE1BQU0sVUFBVSxHQUFHLElBQUksdUJBQVUsQ0FBQyxHQUFHLEVBQUUsNEJBQTRCLE9BQU8sRUFBRSxFQUFFO0lBQzVFLEdBQUc7SUFDSCxXQUFXLEVBQUUsZ0VBQWdFO0lBQzdFLE9BQU87SUFDUCxHQUFHLEVBQUUsWUFBWSxDQUFDLEdBQUc7SUFDckIsd0JBQXdCLEVBQUUsWUFBWSxDQUFDLHdCQUF3QjtDQUNoRSxDQUFDLENBQUM7QUFDSCxVQUFVLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBRXZDLGdGQUFnRjtBQUNoRixtRkFBbUY7QUFDbkYsOERBQThEO0FBQzlELE1BQU0sY0FBYyxHQUFHLElBQUksK0JBQWMsQ0FBQyxHQUFHLEVBQUUsZ0NBQWdDLE9BQU8sRUFBRSxFQUFFO0lBQ3hGLEdBQUc7SUFDSCxXQUFXLEVBQUUsaUVBQWlFO0lBQzlFLE9BQU87Q0FDUixDQUFDLENBQUM7QUFFSCxnRkFBZ0Y7QUFDaEYsMkVBQTJFO0FBQzNFLHNFQUFzRTtBQUN0RSwrREFBK0Q7QUFDL0QseUVBQXlFO0FBQ3pFOzs7Ozs7Ozs7Ozs7Ozs7OztFQWlCRTtBQUVGLGdGQUFnRjtBQUNoRiwrRUFBK0U7QUFDL0UsNEVBQTRFO0FBQzVFLE1BQU0sUUFBUSxHQUFHLElBQUksbUJBQVEsQ0FBQyxHQUFHLEVBQUUsMEJBQTBCLE9BQU8sRUFBRSxFQUFFO0lBQ3RFLEdBQUc7SUFDSCxXQUFXLEVBQUUsbUVBQW1FO0lBQ2hGLE9BQU87SUFDUCxHQUFHLEVBQUUsWUFBWSxDQUFDLEdBQUc7SUFDckIsb0JBQW9CLEVBQUUsWUFBWSxDQUFDLG9CQUFvQjtDQUN4RCxDQUFDLENBQUM7QUFDSCxRQUFRLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBRXJDLHNFQUFzRTtBQUN0RSxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFLG9CQUFvQixDQUFDLENBQUM7QUFDdEQsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxPQUFPLENBQUMsQ0FBQztBQUM3QyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsV0FBVyxFQUFFLEtBQUssQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiIyEvdXNyL2Jpbi9lbnYgbm9kZVxuaW1wb3J0ICdzb3VyY2UtbWFwLXN1cHBvcnQvcmVnaXN0ZXInO1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IE5ldHdvcmtTdGFjayB9IGZyb20gJy4uL2xpYi9zdGFja3MvTmV0d29ya1N0YWNrJztcbmltcG9ydCB7IFN0b3JhZ2VTdGFjayB9IGZyb20gJy4uL2xpYi9zdGFja3MvU3RvcmFnZVN0YWNrJztcbmltcG9ydCB7IEF1dGhTdGFjayB9IGZyb20gJy4uL2xpYi9zdGFja3MvQXV0aFN0YWNrJztcbmltcG9ydCB7IERhdGFiYXNlU3RhY2sgfSBmcm9tICcuLi9saWIvc3RhY2tzL0RhdGFiYXNlU3RhY2snO1xuaW1wb3J0IHsgQ2FjaGVTdGFjayB9IGZyb20gJy4uL2xpYi9zdGFja3MvQ2FjaGVTdGFjayc7XG5pbXBvcnQgeyBNZXNzYWdpbmdTdGFjayB9IGZyb20gJy4uL2xpYi9zdGFja3MvTWVzc2FnaW5nU3RhY2snO1xuaW1wb3J0IHsgRWtzU3RhY2sgfSBmcm9tICcuLi9saWIvc3RhY2tzL0Vrc1N0YWNrJztcblxuY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcblxuLyoqXG4gKiBEZXBsb3ltZW50IGVudmlyb25tZW50IOKAlCByZXNvbHZlZCBmcm9tIGNvbnRleHQgb3IgZW52aXJvbm1lbnQgdmFyaWFibGVzLlxuICogT3ZlcnJpZGUgd2l0aDogY2RrIGRlcGxveSAtLWNvbnRleHQgZW52PXByb2RcbiAqL1xuY29uc3QgZW52TmFtZSA9IGFwcC5ub2RlLnRyeUdldENvbnRleHQoJ2VudicpID8/ICdzdGFnaW5nJztcblxuY29uc3QgZW52OiBjZGsuRW52aXJvbm1lbnQgPSB7XG4gIGFjY291bnQ6IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX0FDQ09VTlQsXG4gIHJlZ2lvbjogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfUkVHSU9OID8/ICdhcC1zb3V0aGVhc3QtMicsXG59O1xuXG4vLyDilIDilIAgTmV0d29yayBTdGFjayDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIFZQQywgcHVibGljL3ByaXZhdGUgc3VibmV0cyAoMyBBWnMpLCBOQVQgZ2F0ZXdheXMsIGJhc2VsaW5lIHNlY3VyaXR5IGdyb3Vwcy5cbi8vIEFsbCBkb3duc3RyZWFtIHN0YWNrcyAoRUtTLCBBdXJvcmEsIEVsYXN0aUNhY2hlLCBBTEIpIHJlY2VpdmUgdGhlaXIgbmV0d29ya1xuLy8gcHJpbWl0aXZlcyBmcm9tIHRoaXMgc3RhY2sgdmlhIGV4cG9ydGVkIHZhbHVlcyAvIHBhc3NlZCBwcm9wcy5cbmNvbnN0IG5ldHdvcmtTdGFjayA9IG5ldyBOZXR3b3JrU3RhY2soYXBwLCBgRm9vZENvc3RDYWxjdWxhdG9yLU5ldHdvcmstJHtlbnZOYW1lfWAsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogJ0Zvb2QgQ29zdCBDYWxjdWxhdG9yIOKAlCBWUEMsIHN1Ym5ldHMsIE5BVCBnYXRld2F5cywgYmFzZWxpbmUgc2VjdXJpdHkgZ3JvdXBzJyxcbiAgZW52TmFtZSxcbn0pO1xuXG4vLyDilIDilIAgU3RvcmFnZSBTdGFjayDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIFMzIGJ1Y2tldHMgZm9yIGludm9pY2UgZmlsZXMgYW5kIHN0YXRpYyBhc3NldHMgKFJlYWN0IFNQQSkuXG4vLyAtIEludm9pY2VzIGJ1Y2tldDogS01TLUNNSyBlbmNyeXB0aW9uLCB2ZXJzaW9uaW5nLCA5MC1kYXkgR2xhY2llciB0cmFuc2l0aW9uXG4vLyAtIEFzc2V0cyBidWNrZXQ6IHN0YXRpYyB3ZWJzaXRlIGhvc3RpbmcgZm9yIENsb3VkRnJvbnQgb3JpZ2luXG5jb25zdCBzdG9yYWdlU3RhY2sgPSBuZXcgU3RvcmFnZVN0YWNrKGFwcCwgYEZvb2RDb3N0Q2FsY3VsYXRvci1TdG9yYWdlLSR7ZW52TmFtZX1gLCB7XG4gIGVudixcbiAgZGVzY3JpcHRpb246ICdGb29kIENvc3QgQ2FsY3VsYXRvciDigJQgUzMgYnVja2V0cyBmb3IgaW52b2ljZSBmaWxlcyBhbmQgc3RhdGljIGFzc2V0cycsXG4gIGVudk5hbWUsXG59KTtcblxuLy8g4pSA4pSAIEF1dGggU3RhY2sg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4vLyBDb2duaXRvIFVzZXIgUG9vbCB3aXRoIGVtYWlsL3Bhc3N3b3JkIGF1dGgsIEdvb2dsZSBhbmQgQXBwbGUgT0F1dGggcHJvdmlkZXJzLFxuLy8gY3VzdG9tIGF0dHJpYnV0ZXMgKG9yZ19pZCwgdmVudWVfcm9sZXMsIHRpZXIpLCBhbmQgaG9zdGVkIFVJIHN1cHBvcnQuXG5jb25zdCBhdXRoU3RhY2sgPSBuZXcgQXV0aFN0YWNrKGFwcCwgYEZvb2RDb3N0Q2FsY3VsYXRvci1BdXRoLSR7ZW52TmFtZX1gLCB7XG4gIGVudixcbiAgZGVzY3JpcHRpb246ICdGb29kIENvc3QgQ2FsY3VsYXRvciDigJQgQ29nbml0byBVc2VyIFBvb2wsIE9BdXRoIHByb3ZpZGVycywgaG9zdGVkIFVJJyxcbiAgZW52TmFtZSxcbn0pO1xuXG4vLyDilIDilIAgRGF0YWJhc2UgU3RhY2sg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4vLyBBdXJvcmEgU2VydmVybGVzcyB2MiBQb3N0Z3JlU1FMIGNsdXN0ZXIgd2l0aCBNdWx0aS1BWiwgU2VjcmV0cyBNYW5hZ2VyXG4vLyBjcmVkZW50aWFscywgU1NMIGVuZm9yY2VtZW50LCBhbmQgcGdhdWRpdCBsb2dnaW5nLlxuLy8gRGVwbG95ZWQgaW4gcHJpdmF0ZS1kYXRhIHN1Ym5ldHMgd2l0aCBhY2Nlc3MgcmVzdHJpY3RlZCB0byBFS1Mgbm9kZXMgb25seS5cbmNvbnN0IGRhdGFiYXNlU3RhY2sgPSBuZXcgRGF0YWJhc2VTdGFjayhhcHAsIGBGb29kQ29zdENhbGN1bGF0b3ItRGF0YWJhc2UtJHtlbnZOYW1lfWAsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogJ0Zvb2QgQ29zdCBDYWxjdWxhdG9yIOKAlCBBdXJvcmEgUG9zdGdyZVNRTCBTZXJ2ZXJsZXNzIHYyIE11bHRpLUFaIGNsdXN0ZXInLFxuICBlbnZOYW1lLFxuICB2cGM6IG5ldHdvcmtTdGFjay52cGMsXG4gIGF1cm9yYVNlY3VyaXR5R3JvdXA6IG5ldHdvcmtTdGFjay5hdXJvcmFTZWN1cml0eUdyb3VwLFxufSk7XG5kYXRhYmFzZVN0YWNrLmFkZERlcGVuZGVuY3kobmV0d29ya1N0YWNrKTtcblxuLy8g4pSA4pSAIENhY2hlIFN0YWNrIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy8gRWxhc3RpQ2FjaGUgUmVkaXMgY2x1c3RlciBtb2RlIHdpdGggTXVsdGktQVogcmVwbGljYXRpb24gZm9yIHNlc3Npb24gc3RvcmUsXG4vLyBwdWIvc3ViIGNvc3QgcHJvcGFnYXRpb24gZXZlbnRzLCBhbmQgcXVlcnkgcmVzdWx0IGNhY2hpbmcuXG5jb25zdCBjYWNoZVN0YWNrID0gbmV3IENhY2hlU3RhY2soYXBwLCBgRm9vZENvc3RDYWxjdWxhdG9yLUNhY2hlLSR7ZW52TmFtZX1gLCB7XG4gIGVudixcbiAgZGVzY3JpcHRpb246ICdGb29kIENvc3QgQ2FsY3VsYXRvciDigJQgRWxhc3RpQ2FjaGUgUmVkaXMgY2x1c3RlciBtb2RlIE11bHRpLUFaJyxcbiAgZW52TmFtZSxcbiAgdnBjOiBuZXR3b3JrU3RhY2sudnBjLFxuICBlbGFzdGlDYWNoZVNlY3VyaXR5R3JvdXA6IG5ldHdvcmtTdGFjay5lbGFzdGlDYWNoZVNlY3VyaXR5R3JvdXAsXG59KTtcbmNhY2hlU3RhY2suYWRkRGVwZW5kZW5jeShuZXR3b3JrU3RhY2spO1xuXG4vLyDilIDilIAgTWVzc2FnaW5nIFN0YWNrIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy8gU1FTIEZJRk8gcXVldWVzIGZvciBhc3luYyBqb2JzIChjb3N0IHByb3BhZ2F0aW9uLCBPQ1IsIEFJIGluc2lnaHRzLCBTcXVhcmUgc3luYylcbi8vIHdpdGggZGVhZC1sZXR0ZXIgcXVldWVzIGFuZCBDbG91ZFdhdGNoIGFsYXJtcyBvbiBETFEgZGVwdGguXG5jb25zdCBtZXNzYWdpbmdTdGFjayA9IG5ldyBNZXNzYWdpbmdTdGFjayhhcHAsIGBGb29kQ29zdENhbGN1bGF0b3ItTWVzc2FnaW5nLSR7ZW52TmFtZX1gLCB7XG4gIGVudixcbiAgZGVzY3JpcHRpb246ICdGb29kIENvc3QgQ2FsY3VsYXRvciDigJQgU1FTIEZJRk8gcXVldWVzLCBETFFzLCBDbG91ZFdhdGNoIGFsYXJtcycsXG4gIGVudk5hbWUsXG59KTtcblxuLy8g4pSA4pSAIE9ic2VydmFiaWxpdHkgU3RhY2sg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4vLyBDbG91ZFdhdGNoIGRhc2hib2FyZHMgZm9yIEFQSSwgd29ya2VycywgQXVyb3JhLCBhbmQgRWxhc3RpQ2FjaGUgbWV0cmljcy5cbi8vIEFsYXJtcyBmb3IgQVBJIGxhdGVuY3ksIGVycm9yIHJhdGUsIERMUSBkZXB0aCwgYW5kIEF1cm9yYSBmYWlsb3Zlci5cbi8vIFgtUmF5IGdyb3VwcyBmb3IgZGlzdHJpYnV0ZWQgdHJhY2luZy4gU3RydWN0dXJlZCBsb2cgZ3JvdXBzLlxuLy8gVEVNUE9SQVJJTFkgRElTQUJMRUQgLSBPYnNlcnZhYmlsaXR5U3RhY2sgaW1wbGVtZW50YXRpb24gaXMgaW5jb21wbGV0ZVxuLypcbmNvbnN0IG9ic2VydmFiaWxpdHlTdGFjayA9IG5ldyBPYnNlcnZhYmlsaXR5U3RhY2soYXBwLCBgRm9vZENvc3RDYWxjdWxhdG9yLU9ic2VydmFiaWxpdHktJHtlbnZOYW1lfWAsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogJ0Zvb2QgQ29zdCBDYWxjdWxhdG9yIOKAlCBDbG91ZFdhdGNoIGRhc2hib2FyZHMsIGFsYXJtcywgWC1SYXkgZ3JvdXBzLCBsb2cgZ3JvdXBzJyxcbiAgZW52TmFtZSxcbiAgYXVyb3JhQ2x1c3RlcjogZGF0YWJhc2VTdGFjay5jbHVzdGVyLFxuICBlbGFzdGlDYWNoZVJlcGxpY2F0aW9uR3JvdXBJZDogY2FjaGVTdGFjay5yZXBsaWNhdGlvbkdyb3VwLnJlcGxpY2F0aW9uR3JvdXBJZCB8fCB1bmRlZmluZWQsXG4gIGRscVF1ZXVlczogW1xuICAgIG1lc3NhZ2luZ1N0YWNrLmNvc3RQcm9wYWdhdGlvbkRscSxcbiAgICBtZXNzYWdpbmdTdGFjay5vY3JQcm9jZXNzaW5nRGxxLFxuICAgIG1lc3NhZ2luZ1N0YWNrLmFpSW5zaWdodHNEbHEsXG4gICAgbWVzc2FnaW5nU3RhY2suc3F1YXJlU3luY0RscSxcbiAgXSxcbn0pO1xub2JzZXJ2YWJpbGl0eVN0YWNrLmFkZERlcGVuZGVuY3koZGF0YWJhc2VTdGFjayk7XG5vYnNlcnZhYmlsaXR5U3RhY2suYWRkRGVwZW5kZW5jeShjYWNoZVN0YWNrKTtcbm9ic2VydmFiaWxpdHlTdGFjay5hZGREZXBlbmRlbmN5KG1lc3NhZ2luZ1N0YWNrKTtcbiovXG5cbi8vIOKUgOKUgCBFS1MgU3RhY2sg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4vLyBFS1MgMS4zMCBjbHVzdGVyIHdpdGggdGhyZWUgbWFuYWdlZCBub2RlIGdyb3VwcyAob25lIHBlciBBWiksIE9JREMgcHJvdmlkZXIsXG4vLyBhbmQgSVJTQSBJQU0gcm9sZXMgZm9yIEFQSSBhbmQgd29ya2VyIHBvZHMgd2l0aCBsZWFzdC1wcml2aWxlZ2UgcG9saWNpZXMuXG5jb25zdCBla3NTdGFjayA9IG5ldyBFa3NTdGFjayhhcHAsIGBGb29kQ29zdENhbGN1bGF0b3ItRUtTLSR7ZW52TmFtZX1gLCB7XG4gIGVudixcbiAgZGVzY3JpcHRpb246ICdGb29kIENvc3QgQ2FsY3VsYXRvciDigJQgRUtTIGNsdXN0ZXIsIG5vZGUgZ3JvdXBzLCBPSURDLCBJUlNBIHJvbGVzJyxcbiAgZW52TmFtZSxcbiAgdnBjOiBuZXR3b3JrU3RhY2sudnBjLFxuICBla3NOb2RlU2VjdXJpdHlHcm91cDogbmV0d29ya1N0YWNrLmVrc05vZGVTZWN1cml0eUdyb3VwLFxufSk7XG5la3NTdGFjay5hZGREZXBlbmRlbmN5KG5ldHdvcmtTdGFjayk7XG5cbi8vIFRhZyBldmVyeSByZXNvdXJjZSBpbiBldmVyeSBzdGFjayB3aXRoIHRoZSBwcm9qZWN0IGFuZCBlbnZpcm9ubWVudC5cbmNkay5UYWdzLm9mKGFwcCkuYWRkKCdQcm9qZWN0JywgJ0Zvb2RDb3N0Q2FsY3VsYXRvcicpO1xuY2RrLlRhZ3Mub2YoYXBwKS5hZGQoJ0Vudmlyb25tZW50JywgZW52TmFtZSk7XG5jZGsuVGFncy5vZihhcHApLmFkZCgnTWFuYWdlZEJ5JywgJ0NESycpO1xuIl19