#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/stacks/NetworkStack';
import { StorageStack } from '../lib/stacks/StorageStack';
import { AuthStack } from '../lib/stacks/AuthStack';
import { DatabaseStack } from '../lib/stacks/DatabaseStack';
import { CacheStack } from '../lib/stacks/CacheStack';
import { MessagingStack } from '../lib/stacks/MessagingStack';
import { EksStack } from '../lib/stacks/EksStack';

const app = new cdk.App();

/**
 * Deployment environment — resolved from context or environment variables.
 * Override with: cdk deploy --context env=prod
 */
const envName = app.node.tryGetContext('env') ?? 'staging';

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-southeast-2',
};

// ── Network Stack ────────────────────────────────────────────────────────────
// VPC, public/private subnets (3 AZs), NAT gateways, baseline security groups.
// All downstream stacks (EKS, Aurora, ElastiCache, ALB) receive their network
// primitives from this stack via exported values / passed props.
const networkStack = new NetworkStack(app, `FoodCostCalculator-Network-${envName}`, {
  env,
  description: 'Food Cost Calculator — VPC, subnets, NAT gateways, baseline security groups',
  envName,
});

// ── Storage Stack ────────────────────────────────────────────────────────────
// S3 buckets for invoice files and static assets (React SPA).
// - Invoices bucket: KMS-CMK encryption, versioning, 90-day Glacier transition
// - Assets bucket: static website hosting for CloudFront origin
const storageStack = new StorageStack(app, `FoodCostCalculator-Storage-${envName}`, {
  env,
  description: 'Food Cost Calculator — S3 buckets for invoice files and static assets',
});

// ── Auth Stack ───────────────────────────────────────────────────────────────
// Cognito User Pool with email/password auth, Google and Apple OAuth providers,
// custom attributes (org_id, venue_roles, tier), and hosted UI support.
const authStack = new AuthStack(app, `FoodCostCalculator-Auth-${envName}`, {
  env,
  description: 'Food Cost Calculator — Cognito User Pool, OAuth providers, hosted UI',
  envName,
});

// ── Database Stack ───────────────────────────────────────────────────────────
// Aurora Serverless v2 PostgreSQL cluster with Multi-AZ, Secrets Manager
// credentials, SSL enforcement, and pgaudit logging.
// Deployed in private-data subnets with access restricted to EKS nodes only.
const databaseStack = new DatabaseStack(app, `FoodCostCalculator-Database-${envName}`, {
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
const cacheStack = new CacheStack(app, `FoodCostCalculator-Cache-${envName}`, {
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
const messagingStack = new MessagingStack(app, `FoodCostCalculator-Messaging-${envName}`, {
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
const eksStack = new EksStack(app, `FoodCostCalculator-EKS-${envName}`, {
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
