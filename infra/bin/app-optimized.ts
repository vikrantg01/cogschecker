#!/usr/bin/env node
/**
 * AWS CDK App - Cost-Optimized Architecture
 *
 * This is the optimized deployment using ECS Fargate instead of EKS.
 *
 * Cost comparison (100 cafes):
 *  - Original (EKS): $1,500-2,000/month
 *  - Optimized (ECS): $550-700/month
 *  - Savings: $950-1,300/month (65% reduction)
 *
 * To deploy:
 *   cdk deploy --all --app "npx ts-node bin/app-optimized.ts"
 *
 * Or set default in cdk.json:
 *   "app": "npx ts-node --prefer-ts-exts bin/app-optimized.ts"
 */

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStackOptimized } from '../lib/stacks/NetworkStackOptimized';
import { RdsStack } from '../lib/stacks/RdsStack';
import { CacheStack } from '../lib/stacks/CacheStack';
import { AuthStack } from '../lib/stacks/AuthStack';
import { StorageStack } from '../lib/stacks/StorageStack';
import { MessagingStack } from '../lib/stacks/MessagingStack';
import { EcsStack } from '../lib/stacks/EcsStack';

const app = new cdk.App();

// Environment
const envName = app.node.tryGetContext('env') ?? 'staging';

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1', // Cheapest region
};

// ══════════════════════════════════════════════════════════════════════════════
// Phase 1: Core Infrastructure (Network, Database, Cache)
// ══════════════════════════════════════════════════════════════════════════════

// ── Network Stack (Optimized) ────────────────────────────────────────────────
// VPC with 1 NAT gateway instead of 2 (save $35/month)
const networkStack = new NetworkStackOptimized(app, `FoodCost-Network-${envName}`, {
  env,
  description: 'Food Cost Calculator — Optimized VPC (1 NAT gateway, 2 AZs)',
  envName,
});

// ── RDS Stack (PostgreSQL) ───────────────────────────────────────────────────
// RDS PostgreSQL t4g.micro instead of Aurora Serverless v2 (save $200-350/month)
const rdsStack = new RdsStack(app, `FoodCost-RDS-${envName}`, {
  env,
  description: 'Food Cost Calculator — RDS PostgreSQL t4g.micro Multi-AZ',
  envName,
  vpc: networkStack.vpc,
  rdsSecurityGroup: networkStack.rdsSecurityGroup,
});
rdsStack.addDependency(networkStack);

// ── Cache Stack (Redis) ──────────────────────────────────────────────────────
// ElastiCache Redis single node (can be upgraded to cluster later)
const cacheStack = new CacheStack(app, `FoodCost-Cache-${envName}`, {
  env,
  description: 'Food Cost Calculator — ElastiCache Redis',
  envName,
  vpc: networkStack.vpc,
  elastiCacheSecurityGroup: networkStack.redisSecurityGroup,
});
cacheStack.addDependency(networkStack);

// ══════════════════════════════════════════════════════════════════════════════
// Phase 2: Authentication & Storage
// ══════════════════════════════════════════════════════════════════════════════

// ── Auth Stack (Cognito) ─────────────────────────────────────────────────────
// AWS Cognito (free tier up to 50K MAUs)
const authStack = new AuthStack(app, `FoodCost-Auth-${envName}`, {
  env,
  description: 'Food Cost Calculator — Cognito User Pool with OAuth',
  envName,
});

// ── Storage Stack (S3) ───────────────────────────────────────────────────────
// S3 buckets for invoices and frontend assets
const storageStack = new StorageStack(app, `FoodCost-Storage-${envName}`, {
  env,
  description: 'Food Cost Calculator — S3 buckets',
  envName,
});

// ── Messaging Stack (SQS) ────────────────────────────────────────────────────
// SQS FIFO queues for async processing
const messagingStack = new MessagingStack(app, `FoodCost-Messaging-${envName}`, {
  env,
  description: 'Food Cost Calculator — SQS FIFO queues',
  envName,
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 3: Compute (ECS Fargate)
// ══════════════════════════════════════════════════════════════════════════════

// ── ECS Stack (Fargate) ──────────────────────────────────────────────────────
// ECS Fargate instead of EKS (save $300-400/month)
const ecsStack = new EcsStack(app, `FoodCost-ECS-${envName}`, {
  env,
  description: 'Food Cost Calculator — ECS Fargate cluster with ALB',
  envName,
  vpc: networkStack.vpc,
  ecsSecurityGroup: networkStack.ecsSecurityGroup,
  albSecurityGroup: networkStack.albSecurityGroup,
  databaseEndpoint: rdsStack.endpoint,
  databaseSecretArn: rdsStack.secret.secretArn,
  redisEndpoint: cacheStack.replicationGroup.attrConfigurationEndPointAddress,
  cognitoUserPoolId: authStack.userPool.userPoolId,
  cognitoClientId: authStack.userPoolClient.userPoolClientId,
});
ecsStack.addDependency(networkStack);
ecsStack.addDependency(rdsStack);
ecsStack.addDependency(cacheStack);
ecsStack.addDependency(authStack);

// ══════════════════════════════════════════════════════════════════════════════
// Global Tags
// ══════════════════════════════════════════════════════════════════════════════

cdk.Tags.of(app).add('Project', 'FoodCostCalculator');
cdk.Tags.of(app).add('Environment', envName);
cdk.Tags.of(app).add('ManagedBy', 'CDK');
cdk.Tags.of(app).add('Architecture', 'ECS-Optimized');
cdk.Tags.of(app).add('CostOptimized', 'true');

// ══════════════════════════════════════════════════════════════════════════════
// Cost Summary
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  Food Cost Calculator - Optimized AWS Deployment');
console.log('══════════════════════════════════════════════════════════════');
console.log(`  Environment: ${envName}`);
console.log(`  Region: ${env.region}`);
console.log('──────────────────────────────────────────────────────────────');
console.log('  Estimated Monthly Costs:');
console.log('    • Network (VPC + 1 NAT):       $40-50');
console.log('    • RDS PostgreSQL (t4g.micro):  $50-60');
console.log('    • ElastiCache Redis:           $15-25');
console.log('    • ECS Fargate (2 tasks):       $45-60');
console.log('    • ALB:                         $20-25');
console.log('    • Cognito:                     $0-10 (free tier)');
console.log('    • S3 + CloudWatch:             $10-20');
console.log('  ──────────────────────────────────────────────────────────');
console.log('  TOTAL:                           $180-250/month');
console.log('══════════════════════════════════════════════════════════════');
console.log('  For 100 cafes: $1.80-2.50 per cafe/month');
console.log('  Recommended pricing: $49-99/month per cafe');
console.log('  Gross margin: 95-98%');
console.log('══════════════════════════════════════════════════════════════\n');
