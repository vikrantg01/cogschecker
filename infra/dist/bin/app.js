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
    redisSecurityGroup: networkStack.elastiCacheSecurityGroup,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vYmluL2FwcC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSx1Q0FBcUM7QUFDckMsbUNBQW1DO0FBQ25DLDZEQUEwRDtBQUMxRCw2REFBMEQ7QUFDMUQsdURBQW9EO0FBQ3BELCtEQUE0RDtBQUM1RCx5REFBc0Q7QUFDdEQsaUVBQThEO0FBQzlELHFEQUFrRDtBQUVsRCxNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztBQUUxQjs7O0dBR0c7QUFDSCxNQUFNLE9BQU8sR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsSUFBSSxTQUFTLENBQUM7QUFFM0QsTUFBTSxHQUFHLEdBQW9CO0lBQzNCLE9BQU8sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQjtJQUN4QyxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsSUFBSSxnQkFBZ0I7Q0FDM0QsQ0FBQztBQUVGLGdGQUFnRjtBQUNoRiwrRUFBK0U7QUFDL0UsOEVBQThFO0FBQzlFLGlFQUFpRTtBQUNqRSxNQUFNLFlBQVksR0FBRyxJQUFJLDJCQUFZLENBQUMsR0FBRyxFQUFFLDhCQUE4QixPQUFPLEVBQUUsRUFBRTtJQUNsRixHQUFHO0lBQ0gsV0FBVyxFQUFFLDZFQUE2RTtJQUMxRixPQUFPO0NBQ1IsQ0FBQyxDQUFDO0FBRUgsZ0ZBQWdGO0FBQ2hGLDhEQUE4RDtBQUM5RCwrRUFBK0U7QUFDL0UsZ0VBQWdFO0FBQ2hFLE1BQU0sWUFBWSxHQUFHLElBQUksMkJBQVksQ0FBQyxHQUFHLEVBQUUsOEJBQThCLE9BQU8sRUFBRSxFQUFFO0lBQ2xGLEdBQUc7SUFDSCxXQUFXLEVBQUUsdUVBQXVFO0NBQ3JGLENBQUMsQ0FBQztBQUVILGdGQUFnRjtBQUNoRixnRkFBZ0Y7QUFDaEYsd0VBQXdFO0FBQ3hFLE1BQU0sU0FBUyxHQUFHLElBQUkscUJBQVMsQ0FBQyxHQUFHLEVBQUUsMkJBQTJCLE9BQU8sRUFBRSxFQUFFO0lBQ3pFLEdBQUc7SUFDSCxXQUFXLEVBQUUsc0VBQXNFO0lBQ25GLE9BQU87Q0FDUixDQUFDLENBQUM7QUFFSCxnRkFBZ0Y7QUFDaEYseUVBQXlFO0FBQ3pFLHFEQUFxRDtBQUNyRCw2RUFBNkU7QUFDN0UsTUFBTSxhQUFhLEdBQUcsSUFBSSw2QkFBYSxDQUFDLEdBQUcsRUFBRSwrQkFBK0IsT0FBTyxFQUFFLEVBQUU7SUFDckYsR0FBRztJQUNILFdBQVcsRUFBRSx5RUFBeUU7SUFDdEYsT0FBTztJQUNQLEdBQUcsRUFBRSxZQUFZLENBQUMsR0FBRztJQUNyQixtQkFBbUIsRUFBRSxZQUFZLENBQUMsbUJBQW1CO0NBQ3RELENBQUMsQ0FBQztBQUNILGFBQWEsQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLENBQUM7QUFFMUMsZ0ZBQWdGO0FBQ2hGLDhFQUE4RTtBQUM5RSw2REFBNkQ7QUFDN0QsTUFBTSxVQUFVLEdBQUcsSUFBSSx1QkFBVSxDQUFDLEdBQUcsRUFBRSw0QkFBNEIsT0FBTyxFQUFFLEVBQUU7SUFDNUUsR0FBRztJQUNILFdBQVcsRUFBRSxnRUFBZ0U7SUFDN0UsT0FBTztJQUNQLEdBQUcsRUFBRSxZQUFZLENBQUMsR0FBRztJQUNyQixrQkFBa0IsRUFBRSxZQUFZLENBQUMsd0JBQXdCO0NBQzFELENBQUMsQ0FBQztBQUNILFVBQVUsQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLENBQUM7QUFFdkMsZ0ZBQWdGO0FBQ2hGLG1GQUFtRjtBQUNuRiw4REFBOEQ7QUFDOUQsTUFBTSxjQUFjLEdBQUcsSUFBSSwrQkFBYyxDQUFDLEdBQUcsRUFBRSxnQ0FBZ0MsT0FBTyxFQUFFLEVBQUU7SUFDeEYsR0FBRztJQUNILFdBQVcsRUFBRSxpRUFBaUU7SUFDOUUsT0FBTztDQUNSLENBQUMsQ0FBQztBQUVILGdGQUFnRjtBQUNoRiwyRUFBMkU7QUFDM0Usc0VBQXNFO0FBQ3RFLCtEQUErRDtBQUMvRCx5RUFBeUU7QUFDekU7Ozs7Ozs7Ozs7Ozs7Ozs7O0VBaUJFO0FBRUYsZ0ZBQWdGO0FBQ2hGLCtFQUErRTtBQUMvRSw0RUFBNEU7QUFDNUUsTUFBTSxRQUFRLEdBQUcsSUFBSSxtQkFBUSxDQUFDLEdBQUcsRUFBRSwwQkFBMEIsT0FBTyxFQUFFLEVBQUU7SUFDdEUsR0FBRztJQUNILFdBQVcsRUFBRSxtRUFBbUU7SUFDaEYsT0FBTztJQUNQLEdBQUcsRUFBRSxZQUFZLENBQUMsR0FBRztJQUNyQixvQkFBb0IsRUFBRSxZQUFZLENBQUMsb0JBQW9CO0NBQ3hELENBQUMsQ0FBQztBQUNILFFBQVEsQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLENBQUM7QUFFckMsc0VBQXNFO0FBQ3RFLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsb0JBQW9CLENBQUMsQ0FBQztBQUN0RCxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLE9BQU8sQ0FBQyxDQUFDO0FBQzdDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsS0FBSyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIjIS91c3IvYmluL2VudiBub2RlXG5pbXBvcnQgJ3NvdXJjZS1tYXAtc3VwcG9ydC9yZWdpc3Rlcic7XG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgTmV0d29ya1N0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9OZXR3b3JrU3RhY2snO1xuaW1wb3J0IHsgU3RvcmFnZVN0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9TdG9yYWdlU3RhY2snO1xuaW1wb3J0IHsgQXV0aFN0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9BdXRoU3RhY2snO1xuaW1wb3J0IHsgRGF0YWJhc2VTdGFjayB9IGZyb20gJy4uL2xpYi9zdGFja3MvRGF0YWJhc2VTdGFjayc7XG5pbXBvcnQgeyBDYWNoZVN0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9DYWNoZVN0YWNrJztcbmltcG9ydCB7IE1lc3NhZ2luZ1N0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9NZXNzYWdpbmdTdGFjayc7XG5pbXBvcnQgeyBFa3NTdGFjayB9IGZyb20gJy4uL2xpYi9zdGFja3MvRWtzU3RhY2snO1xuXG5jb25zdCBhcHAgPSBuZXcgY2RrLkFwcCgpO1xuXG4vKipcbiAqIERlcGxveW1lbnQgZW52aXJvbm1lbnQg4oCUIHJlc29sdmVkIGZyb20gY29udGV4dCBvciBlbnZpcm9ubWVudCB2YXJpYWJsZXMuXG4gKiBPdmVycmlkZSB3aXRoOiBjZGsgZGVwbG95IC0tY29udGV4dCBlbnY9cHJvZFxuICovXG5jb25zdCBlbnZOYW1lID0gYXBwLm5vZGUudHJ5R2V0Q29udGV4dCgnZW52JykgPz8gJ3N0YWdpbmcnO1xuXG5jb25zdCBlbnY6IGNkay5FbnZpcm9ubWVudCA9IHtcbiAgYWNjb3VudDogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfQUNDT1VOVCxcbiAgcmVnaW9uOiBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9SRUdJT04gPz8gJ2FwLXNvdXRoZWFzdC0yJyxcbn07XG5cbi8vIOKUgOKUgCBOZXR3b3JrIFN0YWNrIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy8gVlBDLCBwdWJsaWMvcHJpdmF0ZSBzdWJuZXRzICgzIEFacyksIE5BVCBnYXRld2F5cywgYmFzZWxpbmUgc2VjdXJpdHkgZ3JvdXBzLlxuLy8gQWxsIGRvd25zdHJlYW0gc3RhY2tzIChFS1MsIEF1cm9yYSwgRWxhc3RpQ2FjaGUsIEFMQikgcmVjZWl2ZSB0aGVpciBuZXR3b3JrXG4vLyBwcmltaXRpdmVzIGZyb20gdGhpcyBzdGFjayB2aWEgZXhwb3J0ZWQgdmFsdWVzIC8gcGFzc2VkIHByb3BzLlxuY29uc3QgbmV0d29ya1N0YWNrID0gbmV3IE5ldHdvcmtTdGFjayhhcHAsIGBGb29kQ29zdENhbGN1bGF0b3ItTmV0d29yay0ke2Vudk5hbWV9YCwge1xuICBlbnYsXG4gIGRlc2NyaXB0aW9uOiAnRm9vZCBDb3N0IENhbGN1bGF0b3Ig4oCUIFZQQywgc3VibmV0cywgTkFUIGdhdGV3YXlzLCBiYXNlbGluZSBzZWN1cml0eSBncm91cHMnLFxuICBlbnZOYW1lLFxufSk7XG5cbi8vIOKUgOKUgCBTdG9yYWdlIFN0YWNrIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy8gUzMgYnVja2V0cyBmb3IgaW52b2ljZSBmaWxlcyBhbmQgc3RhdGljIGFzc2V0cyAoUmVhY3QgU1BBKS5cbi8vIC0gSW52b2ljZXMgYnVja2V0OiBLTVMtQ01LIGVuY3J5cHRpb24sIHZlcnNpb25pbmcsIDkwLWRheSBHbGFjaWVyIHRyYW5zaXRpb25cbi8vIC0gQXNzZXRzIGJ1Y2tldDogc3RhdGljIHdlYnNpdGUgaG9zdGluZyBmb3IgQ2xvdWRGcm9udCBvcmlnaW5cbmNvbnN0IHN0b3JhZ2VTdGFjayA9IG5ldyBTdG9yYWdlU3RhY2soYXBwLCBgRm9vZENvc3RDYWxjdWxhdG9yLVN0b3JhZ2UtJHtlbnZOYW1lfWAsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogJ0Zvb2QgQ29zdCBDYWxjdWxhdG9yIOKAlCBTMyBidWNrZXRzIGZvciBpbnZvaWNlIGZpbGVzIGFuZCBzdGF0aWMgYXNzZXRzJyxcbn0pO1xuXG4vLyDilIDilIAgQXV0aCBTdGFjayDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIENvZ25pdG8gVXNlciBQb29sIHdpdGggZW1haWwvcGFzc3dvcmQgYXV0aCwgR29vZ2xlIGFuZCBBcHBsZSBPQXV0aCBwcm92aWRlcnMsXG4vLyBjdXN0b20gYXR0cmlidXRlcyAob3JnX2lkLCB2ZW51ZV9yb2xlcywgdGllciksIGFuZCBob3N0ZWQgVUkgc3VwcG9ydC5cbmNvbnN0IGF1dGhTdGFjayA9IG5ldyBBdXRoU3RhY2soYXBwLCBgRm9vZENvc3RDYWxjdWxhdG9yLUF1dGgtJHtlbnZOYW1lfWAsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogJ0Zvb2QgQ29zdCBDYWxjdWxhdG9yIOKAlCBDb2duaXRvIFVzZXIgUG9vbCwgT0F1dGggcHJvdmlkZXJzLCBob3N0ZWQgVUknLFxuICBlbnZOYW1lLFxufSk7XG5cbi8vIOKUgOKUgCBEYXRhYmFzZSBTdGFjayDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIEF1cm9yYSBTZXJ2ZXJsZXNzIHYyIFBvc3RncmVTUUwgY2x1c3RlciB3aXRoIE11bHRpLUFaLCBTZWNyZXRzIE1hbmFnZXJcbi8vIGNyZWRlbnRpYWxzLCBTU0wgZW5mb3JjZW1lbnQsIGFuZCBwZ2F1ZGl0IGxvZ2dpbmcuXG4vLyBEZXBsb3llZCBpbiBwcml2YXRlLWRhdGEgc3VibmV0cyB3aXRoIGFjY2VzcyByZXN0cmljdGVkIHRvIEVLUyBub2RlcyBvbmx5LlxuY29uc3QgZGF0YWJhc2VTdGFjayA9IG5ldyBEYXRhYmFzZVN0YWNrKGFwcCwgYEZvb2RDb3N0Q2FsY3VsYXRvci1EYXRhYmFzZS0ke2Vudk5hbWV9YCwge1xuICBlbnYsXG4gIGRlc2NyaXB0aW9uOiAnRm9vZCBDb3N0IENhbGN1bGF0b3Ig4oCUIEF1cm9yYSBQb3N0Z3JlU1FMIFNlcnZlcmxlc3MgdjIgTXVsdGktQVogY2x1c3RlcicsXG4gIGVudk5hbWUsXG4gIHZwYzogbmV0d29ya1N0YWNrLnZwYyxcbiAgYXVyb3JhU2VjdXJpdHlHcm91cDogbmV0d29ya1N0YWNrLmF1cm9yYVNlY3VyaXR5R3JvdXAsXG59KTtcbmRhdGFiYXNlU3RhY2suYWRkRGVwZW5kZW5jeShuZXR3b3JrU3RhY2spO1xuXG4vLyDilIDilIAgQ2FjaGUgU3RhY2sg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4vLyBFbGFzdGlDYWNoZSBSZWRpcyBjbHVzdGVyIG1vZGUgd2l0aCBNdWx0aS1BWiByZXBsaWNhdGlvbiBmb3Igc2Vzc2lvbiBzdG9yZSxcbi8vIHB1Yi9zdWIgY29zdCBwcm9wYWdhdGlvbiBldmVudHMsIGFuZCBxdWVyeSByZXN1bHQgY2FjaGluZy5cbmNvbnN0IGNhY2hlU3RhY2sgPSBuZXcgQ2FjaGVTdGFjayhhcHAsIGBGb29kQ29zdENhbGN1bGF0b3ItQ2FjaGUtJHtlbnZOYW1lfWAsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogJ0Zvb2QgQ29zdCBDYWxjdWxhdG9yIOKAlCBFbGFzdGlDYWNoZSBSZWRpcyBjbHVzdGVyIG1vZGUgTXVsdGktQVonLFxuICBlbnZOYW1lLFxuICB2cGM6IG5ldHdvcmtTdGFjay52cGMsXG4gIHJlZGlzU2VjdXJpdHlHcm91cDogbmV0d29ya1N0YWNrLmVsYXN0aUNhY2hlU2VjdXJpdHlHcm91cCxcbn0pO1xuY2FjaGVTdGFjay5hZGREZXBlbmRlbmN5KG5ldHdvcmtTdGFjayk7XG5cbi8vIOKUgOKUgCBNZXNzYWdpbmcgU3RhY2sg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4vLyBTUVMgRklGTyBxdWV1ZXMgZm9yIGFzeW5jIGpvYnMgKGNvc3QgcHJvcGFnYXRpb24sIE9DUiwgQUkgaW5zaWdodHMsIFNxdWFyZSBzeW5jKVxuLy8gd2l0aCBkZWFkLWxldHRlciBxdWV1ZXMgYW5kIENsb3VkV2F0Y2ggYWxhcm1zIG9uIERMUSBkZXB0aC5cbmNvbnN0IG1lc3NhZ2luZ1N0YWNrID0gbmV3IE1lc3NhZ2luZ1N0YWNrKGFwcCwgYEZvb2RDb3N0Q2FsY3VsYXRvci1NZXNzYWdpbmctJHtlbnZOYW1lfWAsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogJ0Zvb2QgQ29zdCBDYWxjdWxhdG9yIOKAlCBTUVMgRklGTyBxdWV1ZXMsIERMUXMsIENsb3VkV2F0Y2ggYWxhcm1zJyxcbiAgZW52TmFtZSxcbn0pO1xuXG4vLyDilIDilIAgT2JzZXJ2YWJpbGl0eSBTdGFjayDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIENsb3VkV2F0Y2ggZGFzaGJvYXJkcyBmb3IgQVBJLCB3b3JrZXJzLCBBdXJvcmEsIGFuZCBFbGFzdGlDYWNoZSBtZXRyaWNzLlxuLy8gQWxhcm1zIGZvciBBUEkgbGF0ZW5jeSwgZXJyb3IgcmF0ZSwgRExRIGRlcHRoLCBhbmQgQXVyb3JhIGZhaWxvdmVyLlxuLy8gWC1SYXkgZ3JvdXBzIGZvciBkaXN0cmlidXRlZCB0cmFjaW5nLiBTdHJ1Y3R1cmVkIGxvZyBncm91cHMuXG4vLyBURU1QT1JBUklMWSBESVNBQkxFRCAtIE9ic2VydmFiaWxpdHlTdGFjayBpbXBsZW1lbnRhdGlvbiBpcyBpbmNvbXBsZXRlXG4vKlxuY29uc3Qgb2JzZXJ2YWJpbGl0eVN0YWNrID0gbmV3IE9ic2VydmFiaWxpdHlTdGFjayhhcHAsIGBGb29kQ29zdENhbGN1bGF0b3ItT2JzZXJ2YWJpbGl0eS0ke2Vudk5hbWV9YCwge1xuICBlbnYsXG4gIGRlc2NyaXB0aW9uOiAnRm9vZCBDb3N0IENhbGN1bGF0b3Ig4oCUIENsb3VkV2F0Y2ggZGFzaGJvYXJkcywgYWxhcm1zLCBYLVJheSBncm91cHMsIGxvZyBncm91cHMnLFxuICBlbnZOYW1lLFxuICBhdXJvcmFDbHVzdGVyOiBkYXRhYmFzZVN0YWNrLmNsdXN0ZXIsXG4gIGVsYXN0aUNhY2hlUmVwbGljYXRpb25Hcm91cElkOiBjYWNoZVN0YWNrLnJlcGxpY2F0aW9uR3JvdXAucmVwbGljYXRpb25Hcm91cElkIHx8IHVuZGVmaW5lZCxcbiAgZGxxUXVldWVzOiBbXG4gICAgbWVzc2FnaW5nU3RhY2suY29zdFByb3BhZ2F0aW9uRGxxLFxuICAgIG1lc3NhZ2luZ1N0YWNrLm9jclByb2Nlc3NpbmdEbHEsXG4gICAgbWVzc2FnaW5nU3RhY2suYWlJbnNpZ2h0c0RscSxcbiAgICBtZXNzYWdpbmdTdGFjay5zcXVhcmVTeW5jRGxxLFxuICBdLFxufSk7XG5vYnNlcnZhYmlsaXR5U3RhY2suYWRkRGVwZW5kZW5jeShkYXRhYmFzZVN0YWNrKTtcbm9ic2VydmFiaWxpdHlTdGFjay5hZGREZXBlbmRlbmN5KGNhY2hlU3RhY2spO1xub2JzZXJ2YWJpbGl0eVN0YWNrLmFkZERlcGVuZGVuY3kobWVzc2FnaW5nU3RhY2spO1xuKi9cblxuLy8g4pSA4pSAIEVLUyBTdGFjayDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIEVLUyAxLjMwIGNsdXN0ZXIgd2l0aCB0aHJlZSBtYW5hZ2VkIG5vZGUgZ3JvdXBzIChvbmUgcGVyIEFaKSwgT0lEQyBwcm92aWRlcixcbi8vIGFuZCBJUlNBIElBTSByb2xlcyBmb3IgQVBJIGFuZCB3b3JrZXIgcG9kcyB3aXRoIGxlYXN0LXByaXZpbGVnZSBwb2xpY2llcy5cbmNvbnN0IGVrc1N0YWNrID0gbmV3IEVrc1N0YWNrKGFwcCwgYEZvb2RDb3N0Q2FsY3VsYXRvci1FS1MtJHtlbnZOYW1lfWAsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogJ0Zvb2QgQ29zdCBDYWxjdWxhdG9yIOKAlCBFS1MgY2x1c3Rlciwgbm9kZSBncm91cHMsIE9JREMsIElSU0Egcm9sZXMnLFxuICBlbnZOYW1lLFxuICB2cGM6IG5ldHdvcmtTdGFjay52cGMsXG4gIGVrc05vZGVTZWN1cml0eUdyb3VwOiBuZXR3b3JrU3RhY2suZWtzTm9kZVNlY3VyaXR5R3JvdXAsXG59KTtcbmVrc1N0YWNrLmFkZERlcGVuZGVuY3kobmV0d29ya1N0YWNrKTtcblxuLy8gVGFnIGV2ZXJ5IHJlc291cmNlIGluIGV2ZXJ5IHN0YWNrIHdpdGggdGhlIHByb2plY3QgYW5kIGVudmlyb25tZW50LlxuY2RrLlRhZ3Mub2YoYXBwKS5hZGQoJ1Byb2plY3QnLCAnRm9vZENvc3RDYWxjdWxhdG9yJyk7XG5jZGsuVGFncy5vZihhcHApLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZOYW1lKTtcbmNkay5UYWdzLm9mKGFwcCkuYWRkKCdNYW5hZ2VkQnknLCAnQ0RLJyk7XG4iXX0=