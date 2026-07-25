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
// import { ObservabilityStack } from '../lib/stacks/ObservabilityStack';
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
    elastiCacheSecurityGroup: networkStack.redisSecurityGroup,
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
    redisEndpoint: cacheStack.replicationGroup.attrConfigurationEndPointAddress,
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
    envName,
    description: 'Food Cost Calculator — S3 buckets for assets and invoices',
});
// ── 7. Observability Stack ───────────────────────────────────────────────────
// CloudWatch logs, metrics, alarms, and SNS notifications
// Requirements: 8.1-8.10
// TODO: Adapt ObservabilityStack for ECS instead of EKS/workers architecture
// const observabilityStack = new ObservabilityStack(app, 'FoodCostCalculator-Observability', {
//   env,
//   description: 'Food Cost Calculator — CloudWatch logs, metrics, and alarms',
// });
// observabilityStack.addDependency(computeStack);
// ══════════════════════════════════════════════════════════════════════════════
// Resource Tagging (Requirement 1.7)
// ══════════════════════════════════════════════════════════════════════════════
cdk.Tags.of(app).add('Component', 'FoodCostCalculator');
cdk.Tags.of(app).add('CostCenter', 'Engineering');
cdk.Tags.of(app).add('ManagedBy', 'CDK');
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
console.log('    7. ObservabilityStack (CloudWatch) - TODO');
console.log('──────────────────────────────────────────────────────────────');
console.log('  Estimated Monthly Cost: $137-200');
console.log('  Target: 2 initial venues');
console.log('══════════════════════════════════════════════════════════════\n');
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLW9wdGltaXplZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL2Jpbi9hcHAtb3B0aW1pemVkLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQ0E7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBaUJHOztBQUVILHVDQUFxQztBQUNyQyxtQ0FBbUM7QUFDbkMsK0VBQTRFO0FBQzVFLHFEQUFrRDtBQUNsRCx5REFBc0Q7QUFDdEQsdURBQW9EO0FBQ3BELDZEQUEwRDtBQUMxRCxxREFBa0Q7QUFDbEQseUVBQXlFO0FBRXpFLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBRTFCLGtFQUFrRTtBQUNsRSwyQ0FBMkM7QUFDM0MsTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFDO0FBRXZCLE1BQU0sR0FBRyxHQUFvQjtJQUMzQixPQUFPLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBbUI7SUFDeEMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLElBQUksV0FBVztDQUN0RCxDQUFDO0FBRUYsaUZBQWlGO0FBQ2pGLGdEQUFnRDtBQUNoRCx3Q0FBd0M7QUFDeEMsdURBQXVEO0FBQ3ZELDhEQUE4RDtBQUM5RCw0Q0FBNEM7QUFDNUMsK0RBQStEO0FBQy9ELGlGQUFpRjtBQUVqRixnRkFBZ0Y7QUFDaEYsK0RBQStEO0FBQy9ELDhCQUE4QjtBQUM5QixNQUFNLFlBQVksR0FBRyxJQUFJLDZDQUFxQixDQUFDLEdBQUcsRUFBRSw0QkFBNEIsRUFBRTtJQUNoRixHQUFHO0lBQ0gsT0FBTztJQUNQLFdBQVcsRUFBRSxtRUFBbUU7Q0FDakYsQ0FBQyxDQUFDO0FBRUgsZ0ZBQWdGO0FBQ2hGLHNFQUFzRTtBQUN0RSx5QkFBeUI7QUFDekIsTUFBTSxhQUFhLEdBQUcsSUFBSSxtQkFBUSxDQUFDLEdBQUcsRUFBRSw2QkFBNkIsRUFBRTtJQUNyRSxHQUFHO0lBQ0gsT0FBTztJQUNQLFdBQVcsRUFBRSwyREFB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QUMsa0VBQWtFLENBQUMsQ0FBQztBQUNoRixPQUFPLENBQUMsR0FBRyxDQUFDLGlEQUFpRCxDQUFDLENBQUM7QUFDL0QsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnRUFBZ0UsQ0FBQyxDQUFDO0FBQzlFLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxHQUFHLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztBQUN2QyxPQUFPLENBQUMsR0FBRyxDQUFDLGdFQUFnRSxDQUFDLENBQUM7QUFDOUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDO0FBQ3JDLE9BQU8sQ0FBQyxHQUFHLENBQUMsbURBQW1ELENBQUMsQ0FBQztBQUNqRSxPQUFPLENBQUMsR0FBRyxDQUFDLGlEQUFpRCxDQUFDLENBQUM7QUFDL0QsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpREFBaUQsQ0FBQyxDQUFDO0FBQy9ELE9BQU8sQ0FBQyxHQUFHLENBQUMsc0NBQXNDLENBQUMsQ0FBQztBQUNwRCxPQUFPLENBQUMsR0FBRyxDQUFDLG1DQUFtQyxDQUFDLENBQUM7QUFDakQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDO0FBQ2hELE9BQU8sQ0FBQyxHQUFHLENBQUMsK0NBQStDLENBQUMsQ0FBQztBQUM3RCxPQUFPLENBQUMsR0FBRyxDQUFDLGdFQUFnRSxDQUFDLENBQUM7QUFDOUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxvQ0FBb0MsQ0FBQyxDQUFDO0FBQ2xELE9BQU8sQ0FBQyxHQUFHLENBQUMsNEJBQTRCLENBQUMsQ0FBQztBQUMxQyxPQUFPLENBQUMsR0FBRyxDQUFDLGtFQUFrRSxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIjIS91c3IvYmluL2VudiBub2RlXG4vKipcbiAqIEFXUyBDREsgQXBwIC0gQ29zdC1PcHRpbWl6ZWQgTWluaW1hbCBEZXBsb3ltZW50XG4gKlxuICogTW9kdWxhciBpbmZyYXN0cnVjdHVyZSBmb3IgRm9vZCBDb3N0IENhbGN1bGF0b3IgdXNpbmcgRUNTIEZhcmdhdGUuXG4gKiBUYXJnZXRzICQxMzctMjAwL21vbnRoIGZvciBtaW5pbWFsIHByb2R1Y3Rpb24gZGVwbG95bWVudCAoMiB2ZW51ZXMpLlxuICpcbiAqIEFyY2hpdGVjdHVyZTpcbiAqICAtIEVDUyBGYXJnYXRlIGNvbXB1dGUgKHZzIEVLUyAtIHNhdmVzICQ3Mi9tb250aCBjb250cm9sIHBsYW5lKVxuICogIC0gUkRTIFBvc3RncmVTUUwgdDRnLm1pY3JvIHNpbmdsZS1BWiAodnMgQXVyb3JhIC0gc2F2ZXMgJDIwMC0zNTAvbW9udGgpXG4gKiAgLSBTaW5nbGUgTkFUIEdhdGV3YXkgKHZzIDIgLSBzYXZlcyAkMzUvbW9udGgpXG4gKiAgLSBFbGFzdGlDYWNoZSBSZWRpcyB0NGcubWljcm8gc2luZ2xlLW5vZGVcbiAqXG4gKiBEZXBsb3ltZW50OlxuICogICBjZGsgYm9vdHN0cmFwXG4gKiAgIGNkayBkZXBsb3kgLS1hbGxcbiAqXG4gKiBSZXF1aXJlbWVudHM6IDEuMSwgMS4yLCA5LjFcbiAqL1xuXG5pbXBvcnQgJ3NvdXJjZS1tYXAtc3VwcG9ydC9yZWdpc3Rlcic7XG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgTmV0d29ya1N0YWNrT3B0aW1pemVkIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9OZXR3b3JrU3RhY2tPcHRpbWl6ZWQnO1xuaW1wb3J0IHsgUmRzU3RhY2sgfSBmcm9tICcuLi9saWIvc3RhY2tzL1Jkc1N0YWNrJztcbmltcG9ydCB7IENhY2hlU3RhY2sgfSBmcm9tICcuLi9saWIvc3RhY2tzL0NhY2hlU3RhY2snO1xuaW1wb3J0IHsgQXV0aFN0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9BdXRoU3RhY2snO1xuaW1wb3J0IHsgU3RvcmFnZVN0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9TdG9yYWdlU3RhY2snO1xuaW1wb3J0IHsgRWNzU3RhY2sgfSBmcm9tICcuLi9saWIvc3RhY2tzL0Vjc1N0YWNrJztcbi8vIGltcG9ydCB7IE9ic2VydmFiaWxpdHlTdGFjayB9IGZyb20gJy4uL2xpYi9zdGFja3MvT2JzZXJ2YWJpbGl0eVN0YWNrJztcblxuY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcblxuLy8gU2ltcGxpZmllZCBkZXBsb3ltZW50IC0gbm8gZW52aXJvbm1lbnQgY29udGV4dCBzd2l0Y2hpbmcgbmVlZGVkXG4vLyBEZWZhdWx0IHRvICdwcm9kJyBmb3IgbWluaW1hbCBkZXBsb3ltZW50XG5jb25zdCBlbnZOYW1lID0gJ3Byb2QnO1xuXG5jb25zdCBlbnY6IGNkay5FbnZpcm9ubWVudCA9IHtcbiAgYWNjb3VudDogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfQUNDT1VOVCxcbiAgcmVnaW9uOiBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9SRUdJT04gPz8gJ3VzLWVhc3QtMScsXG59O1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIFN0YWNrIERlcGxveW1lbnQgT3JkZXIgKHBlciBSZXF1aXJlbWVudCAxLjUpOlxuLy8gMS4gTmV0d29ya1N0YWNrT3B0aW1pemVkIChmb3VuZGF0aW9uKVxuLy8gMi4gRGF0YWJhc2VTdGFjayArIENhY2hlU3RhY2sgKyBBdXRoU3RhY2sgKHBhcmFsbGVsKVxuLy8gMy4gQ29tcHV0ZVN0YWNrIChkZXBlbmRzIG9uIE5ldHdvcmssIERhdGFiYXNlLCBDYWNoZSwgQXV0aClcbi8vIDQuIFN0b3JhZ2VTdGFjayAoY2FuIGJlIGRlcGxveWVkIGFueXRpbWUpXG4vLyA1LiBPYnNlcnZhYmlsaXR5U3RhY2sgKGRlcGVuZHMgb24gYWxsIGluZnJhc3RydWN0dXJlIHN0YWNrcylcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4vLyDilIDilIAgMS4gTmV0d29yayBTdGFjayDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIFZQQyB3aXRoIDIgQVpzLCAxIE5BVCBHYXRld2F5LCBzZWN1cml0eSBncm91cHMgZm9yIGFsbCB0aWVyc1xuLy8gUmVxdWlyZW1lbnRzOiAyLjEtMi4xMCwgMS43XG5jb25zdCBuZXR3b3JrU3RhY2sgPSBuZXcgTmV0d29ya1N0YWNrT3B0aW1pemVkKGFwcCwgJ0Zvb2RDb3N0Q2FsY3VsYXRvci1OZXR3b3JrJywge1xuICBlbnYsXG4gIGVudk5hbWUsXG4gIGRlc2NyaXB0aW9uOiAnRm9vZCBDb3N0IENhbGN1bGF0b3Ig4oCUIFZQQywgc3VibmV0cywgTkFUIGdhdGV3YXksIHNlY3VyaXR5IGdyb3VwcycsXG59KTtcblxuLy8g4pSA4pSAIDIuIERhdGFiYXNlIFN0YWNrIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy8gUkRTIFBvc3RncmVTUUwgdDRnLm1pY3JvIHNpbmdsZS1BWiB3aXRoIFNlY3JldHMgTWFuYWdlciBpbnRlZ3JhdGlvblxuLy8gUmVxdWlyZW1lbnRzOiA0LjEtNC4xMVxuY29uc3QgZGF0YWJhc2VTdGFjayA9IG5ldyBSZHNTdGFjayhhcHAsICdGb29kQ29zdENhbGN1bGF0b3ItRGF0YWJhc2UnLCB7XG4gIGVudixcbiAgZW52TmFtZSxcbiAgZGVzY3JpcHRpb246ICdGb29kIENvc3QgQ2FsY3VsYXRvciDigJQgUkRTIFBvc3RncmVTUUwgdDRnLm1pY3JvIHNpbmdsZS1BWicsXG4gIHZwYzogbmV0d29ya1N0YWNrLnZwYyxcbiAgcmRzU2VjdXJpdHlHcm91cDogbmV0d29ya1N0YWNrLnJkc1NlY3VyaXR5R3JvdXAsXG59KTtcbmRhdGFiYXNlU3RhY2suYWRkRGVwZW5kZW5jeShuZXR3b3JrU3RhY2spO1xuXG4vLyDilIDilIAgMy4gQ2FjaGUgU3RhY2sg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4vLyBFbGFzdGlDYWNoZSBSZWRpcyB0NGcubWljcm8gc2luZ2xlLW5vZGUgd2l0aCBUTFMgZW5jcnlwdGlvblxuLy8gUmVxdWlyZW1lbnRzOiA1LjEtNS45XG5jb25zdCBjYWNoZVN0YWNrID0gbmV3IENhY2hlU3RhY2soYXBwLCAnRm9vZENvc3RDYWxjdWxhdG9yLUNhY2hlJywge1xuICBlbnYsXG4gIGVudk5hbWUsXG4gIGRlc2NyaXB0aW9uOiAnRm9vZCBDb3N0IENhbGN1bGF0b3Ig4oCUIEVsYXN0aUNhY2hlIFJlZGlzIHQ0Zy5taWNybyBzaW5nbGUtbm9kZScsXG4gIHZwYzogbmV0d29ya1N0YWNrLnZwYyxcbiAgZWxhc3RpQ2FjaGVTZWN1cml0eUdyb3VwOiBuZXR3b3JrU3RhY2sucmVkaXNTZWN1cml0eUdyb3VwLFxufSk7XG5jYWNoZVN0YWNrLmFkZERlcGVuZGVuY3kobmV0d29ya1N0YWNrKTtcblxuLy8g4pSA4pSAIDQuIEF1dGggU3RhY2sg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4vLyBDb2duaXRvIFVzZXIgUG9vbCB3aXRoIEdvb2dsZSBhbmQgQXBwbGUgT0F1dGggaW50ZWdyYXRpb25cbi8vIFJlcXVpcmVtZW50czogNi4xLTYuOVxuY29uc3QgYXV0aFN0YWNrID0gbmV3IEF1dGhTdGFjayhhcHAsICdGb29kQ29zdENhbGN1bGF0b3ItQXV0aCcsIHtcbiAgZW52LFxuICBlbnZOYW1lLFxuICBkZXNjcmlwdGlvbjogJ0Zvb2QgQ29zdCBDYWxjdWxhdG9yIOKAlCBDb2duaXRvIFVzZXIgUG9vbCB3aXRoIE9BdXRoIHByb3ZpZGVycycsXG59KTtcblxuLy8g4pSA4pSAIDUuIENvbXB1dGUgU3RhY2sg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4vLyBFQ1MgRmFyZ2F0ZSB3aXRoIEFMQiwgYXV0by1zY2FsaW5nLCBhbmQgaGVhbHRoIGNoZWNrc1xuLy8gUmVxdWlyZW1lbnRzOiAzLjEtMy4xNVxuY29uc3QgY29tcHV0ZVN0YWNrID0gbmV3IEVjc1N0YWNrKGFwcCwgJ0Zvb2RDb3N0Q2FsY3VsYXRvci1Db21wdXRlJywge1xuICBlbnYsXG4gIGVudk5hbWUsXG4gIGRlc2NyaXB0aW9uOiAnRm9vZCBDb3N0IENhbGN1bGF0b3Ig4oCUIEVDUyBGYXJnYXRlIGNsdXN0ZXIgd2l0aCBBTEInLFxuICB2cGM6IG5ldHdvcmtTdGFjay52cGMsXG4gIGVjc1NlY3VyaXR5R3JvdXA6IG5ldHdvcmtTdGFjay5lY3NTZWN1cml0eUdyb3VwLFxuICBhbGJTZWN1cml0eUdyb3VwOiBuZXR3b3JrU3RhY2suYWxiU2VjdXJpdHlHcm91cCxcbiAgZGF0YWJhc2VFbmRwb2ludDogZGF0YWJhc2VTdGFjay5lbmRwb2ludCxcbiAgZGF0YWJhc2VTZWNyZXRBcm46IGRhdGFiYXNlU3RhY2suc2VjcmV0LnNlY3JldEFybixcbiAgcmVkaXNFbmRwb2ludDogY2FjaGVTdGFjay5yZXBsaWNhdGlvbkdyb3VwLmF0dHJDb25maWd1cmF0aW9uRW5kUG9pbnRBZGRyZXNzLFxuICBjb2duaXRvVXNlclBvb2xJZDogYXV0aFN0YWNrLnVzZXJQb29sLnVzZXJQb29sSWQsXG4gIGNvZ25pdG9DbGllbnRJZDogYXV0aFN0YWNrLnVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQsXG59KTtcbmNvbXB1dGVTdGFjay5hZGREZXBlbmRlbmN5KG5ldHdvcmtTdGFjayk7XG5jb21wdXRlU3RhY2suYWRkRGVwZW5kZW5jeShkYXRhYmFzZVN0YWNrKTtcbmNvbXB1dGVTdGFjay5hZGREZXBlbmRlbmN5KGNhY2hlU3RhY2spO1xuY29tcHV0ZVN0YWNrLmFkZERlcGVuZGVuY3koYXV0aFN0YWNrKTtcblxuLy8g4pSA4pSAIDYuIFN0b3JhZ2UgU3RhY2sg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4vLyBTMyBidWNrZXRzIGZvciBmcm9udGVuZCBhc3NldHMgYW5kIGludm9pY2UgdXBsb2Fkc1xuLy8gUmVxdWlyZW1lbnRzOiA3LjEtNy41XG5jb25zdCBzdG9yYWdlU3RhY2sgPSBuZXcgU3RvcmFnZVN0YWNrKGFwcCwgJ0Zvb2RDb3N0Q2FsY3VsYXRvci1TdG9yYWdlJywge1xuICBlbnYsXG4gIGVudk5hbWUsXG4gIGRlc2NyaXB0aW9uOiAnRm9vZCBDb3N0IENhbGN1bGF0b3Ig4oCUIFMzIGJ1Y2tldHMgZm9yIGFzc2V0cyBhbmQgaW52b2ljZXMnLFxufSk7XG5cbi8vIOKUgOKUgCA3LiBPYnNlcnZhYmlsaXR5IFN0YWNrIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy8gQ2xvdWRXYXRjaCBsb2dzLCBtZXRyaWNzLCBhbGFybXMsIGFuZCBTTlMgbm90aWZpY2F0aW9uc1xuLy8gUmVxdWlyZW1lbnRzOiA4LjEtOC4xMFxuLy8gVE9ETzogQWRhcHQgT2JzZXJ2YWJpbGl0eVN0YWNrIGZvciBFQ1MgaW5zdGVhZCBvZiBFS1Mvd29ya2VycyBhcmNoaXRlY3R1cmVcbi8vIGNvbnN0IG9ic2VydmFiaWxpdHlTdGFjayA9IG5ldyBPYnNlcnZhYmlsaXR5U3RhY2soYXBwLCAnRm9vZENvc3RDYWxjdWxhdG9yLU9ic2VydmFiaWxpdHknLCB7XG4vLyAgIGVudixcbi8vICAgZGVzY3JpcHRpb246ICdGb29kIENvc3QgQ2FsY3VsYXRvciDigJQgQ2xvdWRXYXRjaCBsb2dzLCBtZXRyaWNzLCBhbmQgYWxhcm1zJyxcbi8vIH0pO1xuLy8gb2JzZXJ2YWJpbGl0eVN0YWNrLmFkZERlcGVuZGVuY3koY29tcHV0ZVN0YWNrKTtcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBSZXNvdXJjZSBUYWdnaW5nIChSZXF1aXJlbWVudCAxLjcpXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuY2RrLlRhZ3Mub2YoYXBwKS5hZGQoJ0NvbXBvbmVudCcsICdGb29kQ29zdENhbGN1bGF0b3InKTtcbmNkay5UYWdzLm9mKGFwcCkuYWRkKCdDb3N0Q2VudGVyJywgJ0VuZ2luZWVyaW5nJyk7XG5jZGsuVGFncy5vZihhcHApLmFkZCgnTWFuYWdlZEJ5JywgJ0NESycpO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIERlcGxveW1lbnQgU3VtbWFyeVxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmNvbnNvbGUubG9nKCdcXG7ilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZAnKTtcbmNvbnNvbGUubG9nKCcgIEZvb2QgQ29zdCBDYWxjdWxhdG9yIC0gTWluaW1hbCBBV1MgRGVwbG95bWVudCcpO1xuY29uc29sZS5sb2coJ+KVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkCcpO1xuY29uc29sZS5sb2coYCAgUmVnaW9uOiAke2Vudi5yZWdpb259YCk7XG5jb25zb2xlLmxvZygn4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAJyk7XG5jb25zb2xlLmxvZygnICBTdGFjayBBcmNoaXRlY3R1cmU6Jyk7XG5jb25zb2xlLmxvZygnICAgIDEuIE5ldHdvcmtTdGFja09wdGltaXplZCAoVlBDLCAxIE5BVCBHYXRld2F5KScpO1xuY29uc29sZS5sb2coJyAgICAyLiBEYXRhYmFzZVN0YWNrIChSRFMgUG9zdGdyZVNRTCB0NGcubWljcm8pJyk7XG5jb25zb2xlLmxvZygnICAgIDMuIENhY2hlU3RhY2sgKEVsYXN0aUNhY2hlIFJlZGlzIHQ0Zy5taWNybyknKTtcbmNvbnNvbGUubG9nKCcgICAgNC4gQXV0aFN0YWNrIChDb2duaXRvIFVzZXIgUG9vbCknKTtcbmNvbnNvbGUubG9nKCcgICAgNS4gQ29tcHV0ZVN0YWNrIChFQ1MgRmFyZ2F0ZSknKTtcbmNvbnNvbGUubG9nKCcgICAgNi4gU3RvcmFnZVN0YWNrIChTMyBidWNrZXRzKScpO1xuY29uc29sZS5sb2coJyAgICA3LiBPYnNlcnZhYmlsaXR5U3RhY2sgKENsb3VkV2F0Y2gpIC0gVE9ETycpO1xuY29uc29sZS5sb2coJ+KUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCcpO1xuY29uc29sZS5sb2coJyAgRXN0aW1hdGVkIE1vbnRobHkgQ29zdDogJDEzNy0yMDAnKTtcbmNvbnNvbGUubG9nKCcgIFRhcmdldDogMiBpbml0aWFsIHZlbnVlcycpO1xuY29uc29sZS5sb2coJ+KVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxcbicpO1xuIl19