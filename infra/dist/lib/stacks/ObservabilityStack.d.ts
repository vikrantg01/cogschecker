import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as xray from 'aws-cdk-lib/aws-xray';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
export interface ObservabilityStackProps extends cdk.StackProps {
    /** Logical environment name, e.g. "staging" or "prod". Used for naming. */
    readonly envName: string;
    /** Aurora PostgreSQL cluster (for database metrics and failover alarms). */
    readonly auroraCluster?: rds.IDatabaseCluster;
    /** ElastiCache Redis replication group (for cache metrics). */
    readonly elastiCacheReplicationGroupId?: string;
    /** Dead-letter queues from MessagingStack (for DLQ depth alarms). */
    readonly dlqQueues?: sqs.IQueue[];
}
/**
 * ObservabilityStack
 *
 * Provisions the observability infrastructure for the Food Cost Calculator:
 *
 *  • CloudWatch Dashboards:
 *    - API service metrics (request count, latency, error rate)
 *    - Worker service metrics (SQS processing, job duration, error count)
 *    - Aurora PostgreSQL metrics (connections, CPU, read/write latency, replication lag)
 *    - ElastiCache Redis metrics (CPU, memory, evictions, connections)
 *
 *  • CloudWatch Alarms:
 *    - API p99 latency > 2 seconds
 *    - API 5xx error rate > 1%
 *    - DLQ depth > 0 (signals processing failures)
 *    - Aurora failover event (Multi-AZ writer promotion)
 *
 *  • AWS X-Ray Groups:
 *    - api service tracing group (all /api/* traces)
 *    - workers service tracing group (all async job traces)
 *
 *  • CloudWatch Log Groups:
 *    - Structured JSON log groups for api and workers services
 *    - 30-day retention by default (configurable per environment)
 *
 * Satisfies Requirements:
 *  - 3.3:  Real-time monitoring of cost propagation latency
 *  - 4.5:  Performance monitoring for food cost percentage calculation
 */
export declare class ObservabilityStack extends cdk.Stack {
    /** API service log group (structured JSON logs). */
    readonly apiLogGroup: logs.LogGroup;
    /** Worker service log group (structured JSON logs). */
    readonly workersLogGroup: logs.LogGroup;
    /** API service X-Ray tracing group. */
    readonly apiXrayGroup: xray.CfnGroup;
    /** Workers service X-Ray tracing group. */
    readonly workersXrayGroup: xray.CfnGroup;
    /** API service CloudWatch dashboard. */
    readonly apiDashboard: cloudwatch.Dashboard;
    /** Workers service CloudWatch dashboard. */
    readonly workersDashboard: cloudwatch.Dashboard;
    /** Aurora database metrics dashboard. */
    readonly databaseDashboard: cloudwatch.Dashboard;
    /** ElastiCache Redis metrics dashboard. */
    readonly cacheDashboard: cloudwatch.Dashboard;
    /** API p99 latency alarm (threshold: 2 seconds). */
    readonly apiLatencyAlarm: cloudwatch.Alarm;
    /** API 5xx error rate alarm (threshold: 1%). */
    readonly apiErrorRateAlarm: cloudwatch.Alarm;
    /** Aurora failover event alarm. */
    readonly auroraFailoverAlarm?: cloudwatch.Alarm;
    constructor(scope: Construct, id: string, props: ObservabilityStackProps);
}
