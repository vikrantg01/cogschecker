#!/usr/bin/env node
"use strict";
/**
 * AWS CDK App - Cost-Optimized Minimal Deployment
 *
 * Modular infrastructure for Food Cost Calculator using ECS Fargate.
 * Targets $137-200/month for minimal production deployment (2 venues).
 *
 * Architecture:
 *  - ECS Fargate compute (vs EKS - saves $72/month control plane)
 *  - RDS PostgreSQL t4g.micro single-AZ (vs Aurora - saves $200-350/month)
 *  - Single NAT Gateway (vs 2 - saves $35/month)
 *  - ElastiCache Redis t4g.micro single-node
 *
 * Deployment:
 *   cdk bootstrap
 *   cdk deploy --all
 *
 * Requirements: 1.1, 1.2, 9.1
 */
Object.defineProperty(exports, "__esModule", { value: true });
require("source-map-support/register");
const cdk = require("aws-cdk-lib");
const NetworkStackOptimized_1 = require("../lib/stacks/NetworkStackOptimized");
const RdsStack_1 = require("../lib/stacks/RdsStack");
const CacheStack_1 = require("../lib/stacks/CacheStack");
const AuthStack_1 = require("../lib/stacks/AuthStack");
const StorageStack_1 = require("../lib/stacks/StorageStack");
const EcsStack_1 = require("../lib/stacks/EcsStack");
const ObservabilityStack_1 = require("../lib/stacks/ObservabilityStack");
const app = new cdk.App();
// Simplified deployment - no environment context switching needed
// Default to 'prod' for minimal deployment
const envName = 'prod';
const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};
// ══════════════════════════════════════════════════════════════════════════════
// Stack Deployment Order (per Requirement 1.5):
// 1. NetworkStackOptimized (foundation)
// 2. DatabaseStack + CacheStack + AuthStack (parallel)
// 3. ComputeStack (depends on Network, Database, Cache, Auth)
// 4. StorageStack (can be deployed anytime)
// 5. ObservabilityStack (depends on all infrastructure stacks)
// ══════════════════════════════════════════════════════════════════════════════
// ── 1. Network Stack ─────────────────────────────────────────────────────────
// VPC with 2 AZs, 1 NAT Gateway, security groups for all tiers
// Requirements: 2.1-2.10, 1.7
const networkStack = new NetworkStackOptimized_1.NetworkStackOptimized(app, 'FoodCostCalculator-Network', {
    env,
    envName,
    description: 'Food Cost Calculator — VPC, subnets, NAT gateway, security groups',
});
// ── 2. Database Stack ────────────────────────────────────────────────────────
// RDS PostgreSQL t4g.micro single-AZ with Secrets Manager integration
// Requirements: 4.1-4.11
const databaseStack = new RdsStack_1.RdsStack(app, 'FoodCostCalculator-Database', {
    env,
    envName,
    description: 'Food Cost Calculator — RDS PostgreSQL t4g.micro single-AZ',
    vpc: networkStack.vpc,
    rdsSecurityGroup: networkStack.rdsSecurityGroup,
});
databaseStack.addDependency(networkStack);
// ── 3. Cache Stack ───────────────────────────────────────────────────────────
// ElastiCache Redis t4g.micro single-node with TLS encryption
// Requirements: 5.1-5.9
const cacheStack = new CacheStack_1.CacheStack(app, 'FoodCostCalculator-Cache', {
    env,
    envName,
    description: 'Food Cost Calculator — ElastiCache Redis t4g.micro single-node',
    vpc: networkStack.vpc,
    redisSecurityGroup: networkStack.redisSecurityGroup,
});
cacheStack.addDependency(networkStack);
// ── 4. Auth Stack ────────────────────────────────────────────────────────────
// Cognito User Pool with Google and Apple OAuth integration
// Requirements: 6.1-6.9
const authStack = new AuthStack_1.AuthStack(app, 'FoodCostCalculator-Auth', {
    env,
    envName,
    description: 'Food Cost Calculator — Cognito User Pool with OAuth providers',
});
// ── 5. Compute Stack ─────────────────────────────────────────────────────────
// ECS Fargate with ALB, auto-scaling, and health checks
// Requirements: 3.1-3.15
const computeStack = new EcsStack_1.EcsStack(app, 'FoodCostCalculator-Compute', {
    env,
    envName,
    description: 'Food Cost Calculator — ECS Fargate cluster with ALB',
    vpc: networkStack.vpc,
    ecsSecurityGroup: networkStack.ecsSecurityGroup,
    albSecurityGroup: networkStack.albSecurityGroup,
    databaseEndpoint: databaseStack.endpoint,
    databaseSecretArn: databaseStack.secret.secretArn,
    redisEndpoint: cacheStack.replicationGroup.attrPrimaryEndPointAddress,
    cognitoUserPoolId: authStack.userPool.userPoolId,
    cognitoClientId: authStack.userPoolClient.userPoolClientId,
});
computeStack.addDependency(networkStack);
computeStack.addDependency(databaseStack);
computeStack.addDependency(cacheStack);
computeStack.addDependency(authStack);
// ── 6. Storage Stack ─────────────────────────────────────────────────────────
// S3 buckets for frontend assets and invoice uploads
// Requirements: 7.1-7.5
const storageStack = new StorageStack_1.StorageStack(app, 'FoodCostCalculator-Storage', {
    env,
    description: 'Food Cost Calculator — S3 buckets for assets and invoices',
});
// ── 7. Observability Stack ───────────────────────────────────────────────────
// CloudWatch logs, metrics, alarms, and SNS notifications
// Requirements: 8.1-8.9
const observabilityStack = new ObservabilityStack_1.ObservabilityStack(app, 'FoodCostCalculator-Observability', {
    env,
    envName,
    description: 'Food Cost Calculator — CloudWatch logs and alarm notifications',
    ecsCluster: computeStack.cluster,
    ecsService: computeStack.service,
    alb: computeStack.alb,
    alarmEmail: process.env.ALARM_EMAIL, // Optional: set via environment variable
});
observabilityStack.addDependency(computeStack);
// ══════════════════════════════════════════════════════════════════════════════
// Resource Tagging (Requirement 1.7)
// ══════════════════════════════════════════════════════════════════════════════
cdk.Tags.of(app).add('Component', 'FoodCostCalculator');
cdk.Tags.of(app).add('CostCenter', 'Engineering');
cdk.Tags.of(app).add('ManagedBy', 'CDK');
// ══════════════════════════════════════════════════════════════════════════════
// Cost Breakdown Outputs (Requirements 10.1, 10.6)
// ══════════════════════════════════════════════════════════════════════════════
new cdk.CfnOutput(computeStack, 'CostBreakdown-Compute', {
    value: 'ECS Fargate (1-2 tasks × 1 vCPU × 2 GB) + ALB: $45-90/month',
    description: 'Compute tier estimated monthly cost',
    exportName: 'FoodCostCalculator-ComputeCost',
});
new cdk.CfnOutput(databaseStack, 'CostBreakdown-Database', {
    value: 'RDS PostgreSQL (db.t4g.micro single-AZ + 20 GB gp3): $15-25/month',
    description: 'Database tier estimated monthly cost',
    exportName: 'FoodCostCalculator-DatabaseCost',
});
new cdk.CfnOutput(cacheStack, 'CostBreakdown-Cache', {
    value: 'ElastiCache Redis (cache.t4g.micro single-node): $15-20/month',
    description: 'Cache tier estimated monthly cost',
    exportName: 'FoodCostCalculator-CacheCost',
});
new cdk.CfnOutput(networkStack, 'CostBreakdown-Network', {
    value: 'NAT Gateway (1 gateway + data transfer): $35/month',
    description: 'Network tier estimated monthly cost',
    exportName: 'FoodCostCalculator-NetworkCost',
});
new cdk.CfnOutput(storageStack, 'CostBreakdown-Storage', {
    value: 'S3 (frontend assets + invoice files): $1-5/month',
    description: 'Storage tier estimated monthly cost',
    exportName: 'FoodCostCalculator-StorageCost',
});
new cdk.CfnOutput(observabilityStack, 'CostBreakdown-Observability', {
    value: 'CloudWatch (logs + metrics + alarms): $5-10/month',
    description: 'Observability tier estimated monthly cost',
    exportName: 'FoodCostCalculator-ObservabilityCost',
});
new cdk.CfnOutput(computeStack, 'CostBreakdown-Total', {
    value: 'TOTAL ESTIMATED COST: $116-185/month (minimal deployment)',
    description: 'Total estimated monthly cost for all services',
    exportName: 'FoodCostCalculator-TotalCost',
});
// ══════════════════════════════════════════════════════════════════════════════
// Deployment Summary
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════════════════');
console.log('  Food Cost Calculator - Minimal AWS Deployment');
console.log('══════════════════════════════════════════════════════════════');
console.log(`  Region: ${env.region}`);
console.log('──────────────────────────────────────────────────────────────');
console.log('  Stack Architecture:');
console.log('    1. NetworkStackOptimized (VPC, 1 NAT Gateway)');
console.log('    2. DatabaseStack (RDS PostgreSQL t4g.micro)');
console.log('    3. CacheStack (ElastiCache Redis t4g.micro)');
console.log('    4. AuthStack (Cognito User Pool)');
console.log('    5. ComputeStack (ECS Fargate)');
console.log('    6. StorageStack (S3 buckets)');
console.log('    7. ObservabilityStack (CloudWatch)');
console.log('──────────────────────────────────────────────────────────────');
console.log('  Estimated Monthly Cost Breakdown:');
console.log('    • Compute (ECS Fargate + ALB):     $45-90');
console.log('    • Database (RDS PostgreSQL):       $15-25');
console.log('    • Cache (Redis):                   $15-20');
console.log('    • Network (NAT Gateway):           $35');
console.log('    • Storage (S3):                    $1-5');
console.log('    • Observability (CloudWatch):      $5-10');
console.log('    ─────────────────────────────────────────');
console.log('    TOTAL:                             $116-185/month');
console.log('──────────────────────────────────────────────────────────────');
console.log('  Target: 2 initial venues');
console.log('  Cost Monitoring: AWS Budget alerts at 80% and 100%');
console.log('══════════════════════════════════════════════════════════════\n');
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLW9wdGltaXplZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL2Jpbi9hcHAtb3B0aW1pemVkLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQ0E7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBaUJHOztBQUVILHVDQUFxQztBQUNyQyxtQ0FBbUM7QUFDbkMsK0VBQTRFO0FBQzVFLHFEQUFrRDtBQUNsRCx5REFBc0Q7QUFDdEQsdURBQW9EO0FBQ3BELDZEQUEwRDtBQUMxRCxxREFBa0Q7QUFDbEQseUVBQXNFO0FBRXRFLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBRTFCLGtFQUFrRTtBQUNsRSwyQ0FBMkM7QUFDM0MsTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFDO0FBRXZCLE1BQU0sR0FBRyxHQUFvQjtJQUMzQixPQUFPLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBbUI7SUFDeEMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLElBQUksV0FBVztDQUN0RCxDQUFDO0FBRUYsaUZBQWlGO0FBQ2pGLGdEQUFnRDtBQUNoRCx3Q0FBd0M7QUFDeEMsdURBQXVEO0FBQ3ZELDhEQUE4RDtBQUM5RCw0Q0FBNEM7QUFDNUMsK0RBQStEO0FBQy9ELGlGQUFpRjtBQUVqRixnRkFBZ0Y7QUFDaEYsK0RBQStEO0FBQy9ELDhCQUE4QjtBQUM5QixNQUFNLFlBQVksR0FBRyxJQUFJLDZDQUFxQixDQUFDLEdBQUcsRUFBRSw0QkFBNEIsRUFBRTtJQUNoRixHQUFHO0lBQ0gsT0FBTztJQUNQLFdBQVcsRUFBRSxtRUFBbUU7Q0FDakYsQ0FBQyxDQUFDO0FBRUgsZ0ZBQWdGO0FBQ2hGLHNFQUFzRTtBQUN0RSx5QkFBeUI7QUFDekIsTUFBTSxhQUFhLEdBQUcsSUFBSSxtQkFBUSxDQUFDLEdBQUcsRUFBRSw2QkFBNkIsRUFBRTtJQUNyRSxHQUFHO0lBQ0gsT0FBTztJQUNQLFdBQVcsRUFBRSwyREFB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RyxDQUFDLGdFQUFnRSxDQUFDLENBQUM7QUFDOUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDO0FBQ25ELE9BQU8sQ0FBQyxHQUFHLENBQUMsK0NBQStDLENBQUMsQ0FBQztBQUM3RCxPQUFPLENBQUMsR0FBRyxDQUFDLCtDQUErQyxDQUFDLENBQUM7QUFDN0QsT0FBTyxDQUFDLEdBQUcsQ0FBQywrQ0FBK0MsQ0FBQyxDQUFDO0FBQzdELE9BQU8sQ0FBQyxHQUFHLENBQUMsNENBQTRDLENBQUMsQ0FBQztBQUMxRCxPQUFPLENBQUMsR0FBRyxDQUFDLDZDQUE2QyxDQUFDLENBQUM7QUFDM0QsT0FBTyxDQUFDLEdBQUcsQ0FBQyw4Q0FBOEMsQ0FBQyxDQUFDO0FBQzVELE9BQU8sQ0FBQyxHQUFHLENBQUMsK0NBQStDLENBQUMsQ0FBQztBQUM3RCxPQUFPLENBQUMsR0FBRyxDQUFDLHVEQUF1RCxDQUFDLENBQUM7QUFDckUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnRUFBZ0UsQ0FBQyxDQUFDO0FBQzlFLE9BQU8sQ0FBQyxHQUFHLENBQUMsNEJBQTRCLENBQUMsQ0FBQztBQUMxQyxPQUFPLENBQUMsR0FBRyxDQUFDLHNEQUFzRCxDQUFDLENBQUM7QUFDcEUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrRUFBa0UsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiIyEvdXNyL2Jpbi9lbnYgbm9kZVxuLyoqXG4gKiBBV1MgQ0RLIEFwcCAtIENvc3QtT3B0aW1pemVkIE1pbmltYWwgRGVwbG95bWVudFxuICpcbiAqIE1vZHVsYXIgaW5mcmFzdHJ1Y3R1cmUgZm9yIEZvb2QgQ29zdCBDYWxjdWxhdG9yIHVzaW5nIEVDUyBGYXJnYXRlLlxuICogVGFyZ2V0cyAkMTM3LTIwMC9tb250aCBmb3IgbWluaW1hbCBwcm9kdWN0aW9uIGRlcGxveW1lbnQgKDIgdmVudWVzKS5cbiAqXG4gKiBBcmNoaXRlY3R1cmU6XG4gKiAgLSBFQ1MgRmFyZ2F0ZSBjb21wdXRlICh2cyBFS1MgLSBzYXZlcyAkNzIvbW9udGggY29udHJvbCBwbGFuZSlcbiAqICAtIFJEUyBQb3N0Z3JlU1FMIHQ0Zy5taWNybyBzaW5nbGUtQVogKHZzIEF1cm9yYSAtIHNhdmVzICQyMDAtMzUwL21vbnRoKVxuICogIC0gU2luZ2xlIE5BVCBHYXRld2F5ICh2cyAyIC0gc2F2ZXMgJDM1L21vbnRoKVxuICogIC0gRWxhc3RpQ2FjaGUgUmVkaXMgdDRnLm1pY3JvIHNpbmdsZS1ub2RlXG4gKlxuICogRGVwbG95bWVudDpcbiAqICAgY2RrIGJvb3RzdHJhcFxuICogICBjZGsgZGVwbG95IC0tYWxsXG4gKlxuICogUmVxdWlyZW1lbnRzOiAxLjEsIDEuMiwgOS4xXG4gKi9cblxuaW1wb3J0ICdzb3VyY2UtbWFwLXN1cHBvcnQvcmVnaXN0ZXInO1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IE5ldHdvcmtTdGFja09wdGltaXplZCB9IGZyb20gJy4uL2xpYi9zdGFja3MvTmV0d29ya1N0YWNrT3B0aW1pemVkJztcbmltcG9ydCB7IFJkc1N0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9SZHNTdGFjayc7XG5pbXBvcnQgeyBDYWNoZVN0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9DYWNoZVN0YWNrJztcbmltcG9ydCB7IEF1dGhTdGFjayB9IGZyb20gJy4uL2xpYi9zdGFja3MvQXV0aFN0YWNrJztcbmltcG9ydCB7IFN0b3JhZ2VTdGFjayB9IGZyb20gJy4uL2xpYi9zdGFja3MvU3RvcmFnZVN0YWNrJztcbmltcG9ydCB7IEVjc1N0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9FY3NTdGFjayc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5U3RhY2sgfSBmcm9tICcuLi9saWIvc3RhY2tzL09ic2VydmFiaWxpdHlTdGFjayc7XG5cbmNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG5cbi8vIFNpbXBsaWZpZWQgZGVwbG95bWVudCAtIG5vIGVudmlyb25tZW50IGNvbnRleHQgc3dpdGNoaW5nIG5lZWRlZFxuLy8gRGVmYXVsdCB0byAncHJvZCcgZm9yIG1pbmltYWwgZGVwbG95bWVudFxuY29uc3QgZW52TmFtZSA9ICdwcm9kJztcblxuY29uc3QgZW52OiBjZGsuRW52aXJvbm1lbnQgPSB7XG4gIGFjY291bnQ6IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX0FDQ09VTlQsXG4gIHJlZ2lvbjogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfUkVHSU9OID8/ICd1cy1lYXN0LTEnLFxufTtcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBTdGFjayBEZXBsb3ltZW50IE9yZGVyIChwZXIgUmVxdWlyZW1lbnQgMS41KTpcbi8vIDEuIE5ldHdvcmtTdGFja09wdGltaXplZCAoZm91bmRhdGlvbilcbi8vIDIuIERhdGFiYXNlU3RhY2sgKyBDYWNoZVN0YWNrICsgQXV0aFN0YWNrIChwYXJhbGxlbClcbi8vIDMuIENvbXB1dGVTdGFjayAoZGVwZW5kcyBvbiBOZXR3b3JrLCBEYXRhYmFzZSwgQ2FjaGUsIEF1dGgpXG4vLyA0LiBTdG9yYWdlU3RhY2sgKGNhbiBiZSBkZXBsb3llZCBhbnl0aW1lKVxuLy8gNS4gT2JzZXJ2YWJpbGl0eVN0YWNrIChkZXBlbmRzIG9uIGFsbCBpbmZyYXN0cnVjdHVyZSBzdGFja3MpXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuLy8g4pSA4pSAIDEuIE5ldHdvcmsgU3RhY2sg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4vLyBWUEMgd2l0aCAyIEFacywgMSBOQVQgR2F0ZXdheSwgc2VjdXJpdHkgZ3JvdXBzIGZvciBhbGwgdGllcnNcbi8vIFJlcXVpcmVtZW50czogMi4xLTIuMTAsIDEuN1xuY29uc3QgbmV0d29ya1N0YWNrID0gbmV3IE5ldHdvcmtTdGFja09wdGltaXplZChhcHAsICdGb29kQ29zdENhbGN1bGF0b3ItTmV0d29yaycsIHtcbiAgZW52LFxuICBlbnZOYW1lLFxuICBkZXNjcmlwdGlvbjogJ0Zvb2QgQ29zdCBDYWxjdWxhdG9yIOKAlCBWUEMsIHN1Ym5ldHMsIE5BVCBnYXRld2F5LCBzZWN1cml0eSBncm91cHMnLFxufSk7XG5cbi8vIOKUgOKUgCAyLiBEYXRhYmFzZSBTdGFjayDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIFJEUyBQb3N0Z3JlU1FMIHQ0Zy5taWNybyBzaW5nbGUtQVogd2l0aCBTZWNyZXRzIE1hbmFnZXIgaW50ZWdyYXRpb25cbi8vIFJlcXVpcmVtZW50czogNC4xLTQuMTFcbmNvbnN0IGRhdGFiYXNlU3RhY2sgPSBuZXcgUmRzU3RhY2soYXBwLCAnRm9vZENvc3RDYWxjdWxhdG9yLURhdGFiYXNlJywge1xuICBlbnYsXG4gIGVudk5hbWUsXG4gIGRlc2NyaXB0aW9uOiAnRm9vZCBDb3N0IENhbGN1bGF0b3Ig4oCUIFJEUyBQb3N0Z3JlU1FMIHQ0Zy5taWNybyBzaW5nbGUtQVonLFxuICB2cGM6IG5ldHdvcmtTdGFjay52cGMsXG4gIHJkc1NlY3VyaXR5R3JvdXA6IG5ldHdvcmtTdGFjay5yZHNTZWN1cml0eUdyb3VwLFxufSk7XG5kYXRhYmFzZVN0YWNrLmFkZERlcGVuZGVuY3kobmV0d29ya1N0YWNrKTtcblxuLy8g4pSA4pSAIDMuIENhY2hlIFN0YWNrIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy8gRWxhc3RpQ2FjaGUgUmVkaXMgdDRnLm1pY3JvIHNpbmdsZS1ub2RlIHdpdGggVExTIGVuY3J5cHRpb25cbi8vIFJlcXVpcmVtZW50czogNS4xLTUuOVxuY29uc3QgY2FjaGVTdGFjayA9IG5ldyBDYWNoZVN0YWNrKGFwcCwgJ0Zvb2RDb3N0Q2FsY3VsYXRvci1DYWNoZScsIHtcbiAgZW52LFxuICBlbnZOYW1lLFxuICBkZXNjcmlwdGlvbjogJ0Zvb2QgQ29zdCBDYWxjdWxhdG9yIOKAlCBFbGFzdGlDYWNoZSBSZWRpcyB0NGcubWljcm8gc2luZ2xlLW5vZGUnLFxuICB2cGM6IG5ldHdvcmtTdGFjay52cGMsXG4gIHJlZGlzU2VjdXJpdHlHcm91cDogbmV0d29ya1N0YWNrLnJlZGlzU2VjdXJpdHlHcm91cCxcbn0pO1xuY2FjaGVTdGFjay5hZGREZXBlbmRlbmN5KG5ldHdvcmtTdGFjayk7XG5cbi8vIOKUgOKUgCA0LiBBdXRoIFN0YWNrIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy8gQ29nbml0byBVc2VyIFBvb2wgd2l0aCBHb29nbGUgYW5kIEFwcGxlIE9BdXRoIGludGVncmF0aW9uXG4vLyBSZXF1aXJlbWVudHM6IDYuMS02LjlcbmNvbnN0IGF1dGhTdGFjayA9IG5ldyBBdXRoU3RhY2soYXBwLCAnRm9vZENvc3RDYWxjdWxhdG9yLUF1dGgnLCB7XG4gIGVudixcbiAgZW52TmFtZSxcbiAgZGVzY3JpcHRpb246ICdGb29kIENvc3QgQ2FsY3VsYXRvciDigJQgQ29nbml0byBVc2VyIFBvb2wgd2l0aCBPQXV0aCBwcm92aWRlcnMnLFxufSk7XG5cbi8vIOKUgOKUgCA1LiBDb21wdXRlIFN0YWNrIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy8gRUNTIEZhcmdhdGUgd2l0aCBBTEIsIGF1dG8tc2NhbGluZywgYW5kIGhlYWx0aCBjaGVja3Ncbi8vIFJlcXVpcmVtZW50czogMy4xLTMuMTVcbmNvbnN0IGNvbXB1dGVTdGFjayA9IG5ldyBFY3NTdGFjayhhcHAsICdGb29kQ29zdENhbGN1bGF0b3ItQ29tcHV0ZScsIHtcbiAgZW52LFxuICBlbnZOYW1lLFxuICBkZXNjcmlwdGlvbjogJ0Zvb2QgQ29zdCBDYWxjdWxhdG9yIOKAlCBFQ1MgRmFyZ2F0ZSBjbHVzdGVyIHdpdGggQUxCJyxcbiAgdnBjOiBuZXR3b3JrU3RhY2sudnBjLFxuICBlY3NTZWN1cml0eUdyb3VwOiBuZXR3b3JrU3RhY2suZWNzU2VjdXJpdHlHcm91cCxcbiAgYWxiU2VjdXJpdHlHcm91cDogbmV0d29ya1N0YWNrLmFsYlNlY3VyaXR5R3JvdXAsXG4gIGRhdGFiYXNlRW5kcG9pbnQ6IGRhdGFiYXNlU3RhY2suZW5kcG9pbnQsXG4gIGRhdGFiYXNlU2VjcmV0QXJuOiBkYXRhYmFzZVN0YWNrLnNlY3JldC5zZWNyZXRBcm4sXG4gIHJlZGlzRW5kcG9pbnQ6IGNhY2hlU3RhY2sucmVwbGljYXRpb25Hcm91cC5hdHRyUHJpbWFyeUVuZFBvaW50QWRkcmVzcyxcbiAgY29nbml0b1VzZXJQb29sSWQ6IGF1dGhTdGFjay51c2VyUG9vbC51c2VyUG9vbElkLFxuICBjb2duaXRvQ2xpZW50SWQ6IGF1dGhTdGFjay51c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkLFxufSk7XG5jb21wdXRlU3RhY2suYWRkRGVwZW5kZW5jeShuZXR3b3JrU3RhY2spO1xuY29tcHV0ZVN0YWNrLmFkZERlcGVuZGVuY3koZGF0YWJhc2VTdGFjayk7XG5jb21wdXRlU3RhY2suYWRkRGVwZW5kZW5jeShjYWNoZVN0YWNrKTtcbmNvbXB1dGVTdGFjay5hZGREZXBlbmRlbmN5KGF1dGhTdGFjayk7XG5cbi8vIOKUgOKUgCA2LiBTdG9yYWdlIFN0YWNrIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy8gUzMgYnVja2V0cyBmb3IgZnJvbnRlbmQgYXNzZXRzIGFuZCBpbnZvaWNlIHVwbG9hZHNcbi8vIFJlcXVpcmVtZW50czogNy4xLTcuNVxuY29uc3Qgc3RvcmFnZVN0YWNrID0gbmV3IFN0b3JhZ2VTdGFjayhhcHAsICdGb29kQ29zdENhbGN1bGF0b3ItU3RvcmFnZScsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogJ0Zvb2QgQ29zdCBDYWxjdWxhdG9yIOKAlCBTMyBidWNrZXRzIGZvciBhc3NldHMgYW5kIGludm9pY2VzJyxcbn0pO1xuXG4vLyDilIDilIAgNy4gT2JzZXJ2YWJpbGl0eSBTdGFjayDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIENsb3VkV2F0Y2ggbG9ncywgbWV0cmljcywgYWxhcm1zLCBhbmQgU05TIG5vdGlmaWNhdGlvbnNcbi8vIFJlcXVpcmVtZW50czogOC4xLTguOVxuY29uc3Qgb2JzZXJ2YWJpbGl0eVN0YWNrID0gbmV3IE9ic2VydmFiaWxpdHlTdGFjayhhcHAsICdGb29kQ29zdENhbGN1bGF0b3ItT2JzZXJ2YWJpbGl0eScsIHtcbiAgZW52LFxuICBlbnZOYW1lLFxuICBkZXNjcmlwdGlvbjogJ0Zvb2QgQ29zdCBDYWxjdWxhdG9yIOKAlCBDbG91ZFdhdGNoIGxvZ3MgYW5kIGFsYXJtIG5vdGlmaWNhdGlvbnMnLFxuICBlY3NDbHVzdGVyOiBjb21wdXRlU3RhY2suY2x1c3RlcixcbiAgZWNzU2VydmljZTogY29tcHV0ZVN0YWNrLnNlcnZpY2UsXG4gIGFsYjogY29tcHV0ZVN0YWNrLmFsYixcbiAgYWxhcm1FbWFpbDogcHJvY2Vzcy5lbnYuQUxBUk1fRU1BSUwsIC8vIE9wdGlvbmFsOiBzZXQgdmlhIGVudmlyb25tZW50IHZhcmlhYmxlXG59KTtcbm9ic2VydmFiaWxpdHlTdGFjay5hZGREZXBlbmRlbmN5KGNvbXB1dGVTdGFjayk7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gUmVzb3VyY2UgVGFnZ2luZyAoUmVxdWlyZW1lbnQgMS43KVxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmNkay5UYWdzLm9mKGFwcCkuYWRkKCdDb21wb25lbnQnLCAnRm9vZENvc3RDYWxjdWxhdG9yJyk7XG5jZGsuVGFncy5vZihhcHApLmFkZCgnQ29zdENlbnRlcicsICdFbmdpbmVlcmluZycpO1xuY2RrLlRhZ3Mub2YoYXBwKS5hZGQoJ01hbmFnZWRCeScsICdDREsnKTtcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBDb3N0IEJyZWFrZG93biBPdXRwdXRzIChSZXF1aXJlbWVudHMgMTAuMSwgMTAuNilcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5uZXcgY2RrLkNmbk91dHB1dChjb21wdXRlU3RhY2ssICdDb3N0QnJlYWtkb3duLUNvbXB1dGUnLCB7XG4gIHZhbHVlOiAnRUNTIEZhcmdhdGUgKDEtMiB0YXNrcyDDlyAxIHZDUFUgw5cgMiBHQikgKyBBTEI6ICQ0NS05MC9tb250aCcsXG4gIGRlc2NyaXB0aW9uOiAnQ29tcHV0ZSB0aWVyIGVzdGltYXRlZCBtb250aGx5IGNvc3QnLFxuICBleHBvcnROYW1lOiAnRm9vZENvc3RDYWxjdWxhdG9yLUNvbXB1dGVDb3N0Jyxcbn0pO1xuXG5uZXcgY2RrLkNmbk91dHB1dChkYXRhYmFzZVN0YWNrLCAnQ29zdEJyZWFrZG93bi1EYXRhYmFzZScsIHtcbiAgdmFsdWU6ICdSRFMgUG9zdGdyZVNRTCAoZGIudDRnLm1pY3JvIHNpbmdsZS1BWiArIDIwIEdCIGdwMyk6ICQxNS0yNS9tb250aCcsXG4gIGRlc2NyaXB0aW9uOiAnRGF0YWJhc2UgdGllciBlc3RpbWF0ZWQgbW9udGhseSBjb3N0JyxcbiAgZXhwb3J0TmFtZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvci1EYXRhYmFzZUNvc3QnLFxufSk7XG5cbm5ldyBjZGsuQ2ZuT3V0cHV0KGNhY2hlU3RhY2ssICdDb3N0QnJlYWtkb3duLUNhY2hlJywge1xuICB2YWx1ZTogJ0VsYXN0aUNhY2hlIFJlZGlzIChjYWNoZS50NGcubWljcm8gc2luZ2xlLW5vZGUpOiAkMTUtMjAvbW9udGgnLFxuICBkZXNjcmlwdGlvbjogJ0NhY2hlIHRpZXIgZXN0aW1hdGVkIG1vbnRobHkgY29zdCcsXG4gIGV4cG9ydE5hbWU6ICdGb29kQ29zdENhbGN1bGF0b3ItQ2FjaGVDb3N0Jyxcbn0pO1xuXG5uZXcgY2RrLkNmbk91dHB1dChuZXR3b3JrU3RhY2ssICdDb3N0QnJlYWtkb3duLU5ldHdvcmsnLCB7XG4gIHZhbHVlOiAnTkFUIEdhdGV3YXkgKDEgZ2F0ZXdheSArIGRhdGEgdHJhbnNmZXIpOiAkMzUvbW9udGgnLFxuICBkZXNjcmlwdGlvbjogJ05ldHdvcmsgdGllciBlc3RpbWF0ZWQgbW9udGhseSBjb3N0JyxcbiAgZXhwb3J0TmFtZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvci1OZXR3b3JrQ29zdCcsXG59KTtcblxubmV3IGNkay5DZm5PdXRwdXQoc3RvcmFnZVN0YWNrLCAnQ29zdEJyZWFrZG93bi1TdG9yYWdlJywge1xuICB2YWx1ZTogJ1MzIChmcm9udGVuZCBhc3NldHMgKyBpbnZvaWNlIGZpbGVzKTogJDEtNS9tb250aCcsXG4gIGRlc2NyaXB0aW9uOiAnU3RvcmFnZSB0aWVyIGVzdGltYXRlZCBtb250aGx5IGNvc3QnLFxuICBleHBvcnROYW1lOiAnRm9vZENvc3RDYWxjdWxhdG9yLVN0b3JhZ2VDb3N0Jyxcbn0pO1xuXG5uZXcgY2RrLkNmbk91dHB1dChvYnNlcnZhYmlsaXR5U3RhY2ssICdDb3N0QnJlYWtkb3duLU9ic2VydmFiaWxpdHknLCB7XG4gIHZhbHVlOiAnQ2xvdWRXYXRjaCAobG9ncyArIG1ldHJpY3MgKyBhbGFybXMpOiAkNS0xMC9tb250aCcsXG4gIGRlc2NyaXB0aW9uOiAnT2JzZXJ2YWJpbGl0eSB0aWVyIGVzdGltYXRlZCBtb250aGx5IGNvc3QnLFxuICBleHBvcnROYW1lOiAnRm9vZENvc3RDYWxjdWxhdG9yLU9ic2VydmFiaWxpdHlDb3N0Jyxcbn0pO1xuXG5uZXcgY2RrLkNmbk91dHB1dChjb21wdXRlU3RhY2ssICdDb3N0QnJlYWtkb3duLVRvdGFsJywge1xuICB2YWx1ZTogJ1RPVEFMIEVTVElNQVRFRCBDT1NUOiAkMTE2LTE4NS9tb250aCAobWluaW1hbCBkZXBsb3ltZW50KScsXG4gIGRlc2NyaXB0aW9uOiAnVG90YWwgZXN0aW1hdGVkIG1vbnRobHkgY29zdCBmb3IgYWxsIHNlcnZpY2VzJyxcbiAgZXhwb3J0TmFtZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvci1Ub3RhbENvc3QnLFxufSk7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gRGVwbG95bWVudCBTdW1tYXJ5XG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuY29uc29sZS5sb2coJ1xcbuKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkCcpO1xuY29uc29sZS5sb2coJyAgRm9vZCBDb3N0IENhbGN1bGF0b3IgLSBNaW5pbWFsIEFXUyBEZXBsb3ltZW50Jyk7XG5jb25zb2xlLmxvZygn4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQJyk7XG5jb25zb2xlLmxvZyhgICBSZWdpb246ICR7ZW52LnJlZ2lvbn1gKTtcbmNvbnNvbGUubG9nKCfilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAnKTtcbmNvbnNvbGUubG9nKCcgIFN0YWNrIEFyY2hpdGVjdHVyZTonKTtcbmNvbnNvbGUubG9nKCcgICAgMS4gTmV0d29ya1N0YWNrT3B0aW1pemVkIChWUEMsIDEgTkFUIEdhdGV3YXkpJyk7XG5jb25zb2xlLmxvZygnICAgIDIuIERhdGFiYXNlU3RhY2sgKFJEUyBQb3N0Z3JlU1FMIHQ0Zy5taWNybyknKTtcbmNvbnNvbGUubG9nKCcgICAgMy4gQ2FjaGVTdGFjayAoRWxhc3RpQ2FjaGUgUmVkaXMgdDRnLm1pY3JvKScpO1xuY29uc29sZS5sb2coJyAgICA0LiBBdXRoU3RhY2sgKENvZ25pdG8gVXNlciBQb29sKScpO1xuY29uc29sZS5sb2coJyAgICA1LiBDb21wdXRlU3RhY2sgKEVDUyBGYXJnYXRlKScpO1xuY29uc29sZS5sb2coJyAgICA2LiBTdG9yYWdlU3RhY2sgKFMzIGJ1Y2tldHMpJyk7XG5jb25zb2xlLmxvZygnICAgIDcuIE9ic2VydmFiaWxpdHlTdGFjayAoQ2xvdWRXYXRjaCknKTtcbmNvbnNvbGUubG9nKCfilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAnKTtcbmNvbnNvbGUubG9nKCcgIEVzdGltYXRlZCBNb250aGx5IENvc3QgQnJlYWtkb3duOicpO1xuY29uc29sZS5sb2coJyAgICDigKIgQ29tcHV0ZSAoRUNTIEZhcmdhdGUgKyBBTEIpOiAgICAgJDQ1LTkwJyk7XG5jb25zb2xlLmxvZygnICAgIOKAoiBEYXRhYmFzZSAoUkRTIFBvc3RncmVTUUwpOiAgICAgICAkMTUtMjUnKTtcbmNvbnNvbGUubG9nKCcgICAg4oCiIENhY2hlIChSZWRpcyk6ICAgICAgICAgICAgICAgICAgICQxNS0yMCcpO1xuY29uc29sZS5sb2coJyAgICDigKIgTmV0d29yayAoTkFUIEdhdGV3YXkpOiAgICAgICAgICAgJDM1Jyk7XG5jb25zb2xlLmxvZygnICAgIOKAoiBTdG9yYWdlIChTMyk6ICAgICAgICAgICAgICAgICAgICAkMS01Jyk7XG5jb25zb2xlLmxvZygnICAgIOKAoiBPYnNlcnZhYmlsaXR5IChDbG91ZFdhdGNoKTogICAgICAkNS0xMCcpO1xuY29uc29sZS5sb2coJyAgICDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAnKTtcbmNvbnNvbGUubG9nKCcgICAgVE9UQUw6ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAkMTE2LTE4NS9tb250aCcpO1xuY29uc29sZS5sb2coJ+KUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCcpO1xuY29uc29sZS5sb2coJyAgVGFyZ2V0OiAyIGluaXRpYWwgdmVudWVzJyk7XG5jb25zb2xlLmxvZygnICBDb3N0IE1vbml0b3Jpbmc6IEFXUyBCdWRnZXQgYWxlcnRzIGF0IDgwJSBhbmQgMTAwJScpO1xuY29uc29sZS5sb2coJ+KVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxcbicpO1xuIl19