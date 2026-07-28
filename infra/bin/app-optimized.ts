#!/usr/bin/env node
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

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStackOptimized } from '../lib/stacks/NetworkStackOptimized';
import { RdsStack } from '../lib/stacks/RdsStack';
import { CacheStack } from '../lib/stacks/CacheStack';
import { AuthStack } from '../lib/stacks/AuthStack';
import { StorageStack } from '../lib/stacks/StorageStack';
import { EcsStack } from '../lib/stacks/EcsStack';
import { ObservabilityStack } from '../lib/stacks/ObservabilityStack';

const app = new cdk.App();

// Simplified deployment - no environment context switching needed
// Default to 'prod' for minimal deployment
const envName = 'prod';

const env: cdk.Environment = {
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
const networkStack = new NetworkStackOptimized(app, 'FoodCostCalculator-Network', {
  env,
  envName,
  description: 'Food Cost Calculator — VPC, subnets, NAT gateway, security groups',
});

// ── 2. Database Stack ────────────────────────────────────────────────────────
// RDS PostgreSQL t4g.micro single-AZ with Secrets Manager integration
// Requirements: 4.1-4.11
const databaseStack = new RdsStack(app, 'FoodCostCalculator-Database', {
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
// TEMPORARILY DISABLED: ElastiCache deployment issues on free tier account
/*
const cacheStack = new CacheStack(app, 'FoodCostCalculator-Cache', {
  env,
  envName,
  description: 'Food Cost Calculator — ElastiCache Redis t4g.micro single-node',
  vpc: networkStack.vpc,
  redisSecurityGroup: networkStack.redisSecurityGroup,
});
cacheStack.addDependency(networkStack);
*/

// ── 4. Auth Stack ────────────────────────────────────────────────────────────
// Cognito User Pool with Google and Apple OAuth integration
// Requirements: 6.1-6.9
const authStack = new AuthStack(app, 'FoodCostCalculator-Auth', {
  env,
  envName,
  description: 'Food Cost Calculator — Cognito User Pool with OAuth providers',
});

// ── 5. Compute Stack ─────────────────────────────────────────────────────────
// ECS Fargate with ALB, auto-scaling, and health checks
// Requirements: 3.1-3.15
const computeStack = new EcsStack(app, 'FoodCostCalculator-Compute', {
  env,
  envName,
  description: 'Food Cost Calculator — ECS Fargate cluster with ALB',
  vpc: networkStack.vpc,
  ecsSecurityGroup: networkStack.ecsSecurityGroup,
  albSecurityGroup: networkStack.albSecurityGroup,
  databaseEndpoint: databaseStack.endpoint,
  databaseSecretArn: databaseStack.secret.secretArn,
  // redisEndpoint: cacheStack.replicationGroup.attrPrimaryEndPointAddress, // DISABLED: Redis unavailable
  cognitoUserPoolId: authStack.userPool.userPoolId,
  cognitoClientId: authStack.userPoolClient.userPoolClientId,
});
computeStack.addDependency(networkStack);
computeStack.addDependency(databaseStack);
// computeStack.addDependency(cacheStack); // DISABLED: Redis unavailable
computeStack.addDependency(authStack);

// ── 6. Storage Stack ─────────────────────────────────────────────────────────
// S3 buckets for frontend assets and invoice uploads
// Requirements: 7.1-7.5
const storageStack = new StorageStack(app, 'FoodCostCalculator-Storage', {
  env,
  description: 'Food Cost Calculator — S3 buckets for assets and invoices',
});

// ── 7. Observability Stack ───────────────────────────────────────────────────
// CloudWatch logs, metrics, alarms, and SNS notifications
// Requirements: 8.1-8.9
const observabilityStack = new ObservabilityStack(app, 'FoodCostCalculator-Observability', {
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

/*
new cdk.CfnOutput(cacheStack, 'CostBreakdown-Cache', {
  value: 'ElastiCache Redis (cache.t4g.micro single-node): $15-20/month',
  description: 'Cache tier estimated monthly cost',
  exportName: 'FoodCostCalculator-CacheCost',
});
*/

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
  value: 'TOTAL ESTIMATED COST: $101-165/month (without Redis cache)',
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
console.log('    3. [DISABLED] CacheStack (Redis unavailable on free tier)');
console.log('    4. AuthStack (Cognito User Pool)');
console.log('    5. ComputeStack (ECS Fargate)');
console.log('    6. StorageStack (S3 buckets)');
console.log('    7. ObservabilityStack (CloudWatch)');
console.log('──────────────────────────────────────────────────────────────');
console.log('  Estimated Monthly Cost Breakdown:');
console.log('    • Compute (ECS Fargate + ALB):     $45-90');
console.log('    • Database (RDS PostgreSQL):       $15-25');
console.log('    • Cache (Redis):                   [DISABLED]');
console.log('    • Network (NAT Gateway):           $35');
console.log('    • Storage (S3):                    $1-5');
console.log('    • Observability (CloudWatch):      $5-10');
console.log('    ─────────────────────────────────────────');
console.log('    TOTAL:                             $101-165/month');
console.log('──────────────────────────────────────────────────────────────');
console.log('  Target: 2 initial venues');
console.log('  Cost Monitoring: AWS Budget alerts at 80% and 100%');
console.log('══════════════════════════════════════════════════════════════\n');
