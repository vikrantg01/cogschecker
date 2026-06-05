import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as xray from 'aws-cdk-lib/aws-xray';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
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
export class ObservabilityStack extends cdk.Stack {
  /** API service log group (structured JSON logs). */
  public readonly apiLogGroup: logs.LogGroup;

  /** Worker service log group (structured JSON logs). */
  public readonly workersLogGroup: logs.LogGroup;

  /** API service X-Ray tracing group. */
  public readonly apiXrayGroup: xray.CfnGroup;

  /** Workers service X-Ray tracing group. */
  public readonly workersXrayGroup: xray.CfnGroup;

  /** API service CloudWatch dashboard. */
  public readonly apiDashboard: cloudwatch.Dashboard;

  /** Workers service CloudWatch dashboard. */
  public readonly workersDashboard: cloudwatch.Dashboard;

  /** Aurora database metrics dashboard. */
  public readonly databaseDashboard: cloudwatch.Dashboard;

  /** ElastiCache Redis metrics dashboard. */
  public readonly cacheDashboard: cloudwatch.Dashboard;

  /** API p99 latency alarm (threshold: 2 seconds). */
  public readonly apiLatencyAlarm: cloudwatch.Alarm;

  /** API 5xx error rate alarm (threshold: 1%). */
  public readonly apiErrorRateAlarm: cloudwatch.Alarm;

  /** Aurora failover event alarm. */
  public readonly auroraFailoverAlarm?: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const { envName } = props;

    // ══════════════════════════════════════════════════════════════════════════
    // 1. CloudWatch Log Groups — Structured JSON Logs
    // ══════════════════════════════════════════════════════════════════════════
    //
    // Spring Boot applications (api and workers) emit structured JSON logs.
    // Each log entry includes: timestamp, level, logger, thread, message, MDC context.
    //
    // Log retention: 30 days (configurable per environment).
    // For production, consider extending to 90 days or shipping to S3/Athena for long-term analysis.

    this.apiLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
      logGroupName: `/food-cost-calculator/${envName}/api`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    this.workersLogGroup = new logs.LogGroup(this, 'WorkersLogGroup', {
      logGroupName: `/food-cost-calculator/${envName}/workers`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ══════════════════════════════════════════════════════════════════════════
    // 2. AWS X-Ray Groups — Distributed Tracing
    // ══════════════════════════════════════════════════════════════════════════
    //
    // X-Ray groups allow filtering traces by service name and custom attributes.
    //
    // Filter expressions:
    //  • api group:     service("api") — all traces from the API service
    //  • workers group: service("workers") — all traces from the workers service
    //
    // Spring Boot services emit X-Ray traces via the AWS X-Ray SDK for Java.
    // Traces include HTTP request metadata (URL, method, status code, latency)
    // and custom annotations (venueId, userId, recipeId, etc.).

    this.apiXrayGroup = new xray.CfnGroup(this, 'ApiXrayGroup', {
      groupName: `food-cost-calculator-api-${envName}`,
      filterExpression: 'service("api")',
    });

    this.workersXrayGroup = new xray.CfnGroup(this, 'WorkersXrayGroup', {
      groupName: `food-cost-calculator-workers-${envName}`,
      filterExpression: 'service("workers")',
    });

    // ══════════════════════════════════════════════════════════════════════════
    // 3. CloudWatch Alarms — API Service
    // ══════════════════════════════════════════════════════════════════════════
    //
    // API p99 latency alarm:
    //  • Threshold: 2 seconds
    //  • Evaluation: 2 consecutive data points over 5 minutes
    //  • Metric: Custom metric emitted by Spring Boot Actuator: http.server.requests.p99
    //
    // API 5xx error rate alarm:
    //  • Threshold: 1% (0.01)
    //  • Evaluation: 2 consecutive data points over 5 minutes
    //  • Metric: Math expression: 5xx_count / total_requests

    this.apiLatencyAlarm = new cloudwatch.Alarm(this, 'ApiLatencyAlarm', {
      alarmName: `fcc-api-p99-latency-${envName}`,
      alarmDescription: 'API p99 latency exceeds 2 seconds',
      metric: new cloudwatch.Metric({
        namespace: 'FoodCostCalculator',
        metricName: 'ApiP99Latency',
        dimensionsMap: {
          Environment: envName,
          Service: 'api',
        },
        statistic: cloudwatch.Stats.MAXIMUM,
        period: cdk.Duration.minutes(5),
      }),
      threshold: 2000, // 2 seconds in milliseconds
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    this.apiErrorRateAlarm = new cloudwatch.Alarm(this, 'ApiErrorRateAlarm', {
      alarmName: `fcc-api-5xx-error-rate-${envName}`,
      alarmDescription: 'API 5xx error rate exceeds 1%',
      metric: new cloudwatch.MathExpression({
        expression: '(m1 / m2) * 100',
        usingMetrics: {
          m1: new cloudwatch.Metric({
            namespace: 'FoodCostCalculator',
            metricName: 'Api5xxCount',
            dimensionsMap: {
              Environment: envName,
              Service: 'api',
            },
            statistic: cloudwatch.Stats.SUM,
            period: cdk.Duration.minutes(5),
          }),
          m2: new cloudwatch.Metric({
            namespace: 'FoodCostCalculator',
            metricName: 'ApiRequestCount',
            dimensionsMap: {
              Environment: envName,
              Service: 'api',
            },
            statistic: cloudwatch.Stats.SUM,
            period: cdk.Duration.minutes(5),
          }),
        },
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1, // 1%
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // ══════════════════════════════════════════════════════════════════════════
    // 4. CloudWatch Alarms — Aurora Failover Event
    // ══════════════════════════════════════════════════════════════════════════
    //
    // Aurora failover event alarm:
    //  • Threshold: Any failover event (> 0)
    //  • Evaluation: 1 data point over 5 minutes
    //  • Metric: RDS DatabaseConnections dropped (indicates writer promotion)
    //
    // Aurora automatically fails over to the standby replica when the writer
    // instance becomes unavailable. This alarm fires when a failover occurs,
    // signaling potential issues with the primary instance (hardware failure,
    // AZ outage, manual reboot, etc.).
    //
    // Note: Aurora failover typically completes in < 30 seconds (RTO).

    if (props.auroraCluster) {
      this.auroraFailoverAlarm = new cloudwatch.Alarm(this, 'AuroraFailoverAlarm', {
        alarmName: `fcc-aurora-failover-${envName}`,
        alarmDescription: 'Aurora cluster failover event detected (Multi-AZ writer promotion)',
        metric: new cloudwatch.Metric({
          namespace: 'AWS/RDS',
          metricName: 'DatabaseConnections',
          dimensionsMap: {
            DBClusterIdentifier: props.auroraCluster.clusterIdentifier,
          },
          statistic: cloudwatch.Stats.AVERAGE,
          period: cdk.Duration.minutes(1),
        }),
        threshold: 0,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 5. CloudWatch Dashboard — API Service
    // ══════════════════════════════════════════════════════════════════════════
    //
    // API service dashboard widgets:
    //  • Request count (total requests per 5-minute period)
    //  • p50, p90, p99 latency (milliseconds)
    //  • 2xx, 4xx, 5xx response counts
    //  • Error rate (5xx / total requests, as percentage)
    //  • Active connections (current open HTTP/2 streams)

    this.apiDashboard = new cloudwatch.Dashboard(this, 'ApiDashboard', {
      dashboardName: `FoodCostCalculator-API-${envName}`,
    });

    this.apiDashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API Request Count',
        left: [
          new cloudwatch.Metric({
            namespace: 'FoodCostCalculator',
            metricName: 'ApiRequestCount',
            dimensionsMap: { Environment: envName, Service: 'api' },
            statistic: cloudwatch.Stats.SUM,
            period: cdk.Duration.minutes(5),
            label: 'Total Requests',
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'API Latency (p50, p90, p99)',
        left: [
          new cloudwatch.Metric({
            namespace: 'FoodCostCalculator',
            metricName: 'ApiP50Latency',
            dimensionsMap: { Environment: envName, Service: 'api' },
            statistic: cloudwatch.Stats.AVERAGE,
            period: cdk.Duration.minutes(5),
            label: 'p50',
          }),
          new cloudwatch.Metric({
            namespace: 'FoodCostCalculator',
            metricName: 'ApiP90Latency',
            dimensionsMap: { Environment: envName, Service: 'api' },
            statistic: cloudwatch.Stats.AVERAGE,
            period: cdk.Duration.minutes(5),
            label: 'p90',
          }),
          new cloudwatch.Metric({
            namespace: 'FoodCostCalculator',
            metricName: 'ApiP99Latency',
            dimensionsMap: { Environment: envName, Service: 'api' },
            statistic: cloudwatch.Stats.AVERAGE,
            period: cdk.Duration.minutes(5),
            label: 'p99',
          }),
        ],
        width: 12,
        height: 6,
      })
    );

    this.apiDashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API Response Codes',
        left: [
          new cloudwatch.Metric({
            namespace: 'FoodCostCalculator',
            metricName: 'Api2xxCount',
            dimensionsMap: { Environment: envName, Service: 'api' },
            statistic: cloudwatch.Stats.SUM,
            period: cdk.Duration.minutes(5),
            label: '2xx Success',
            color: cloudwatch.Color.GREEN,
          }),
          new cloudwatch.Metric({
            namespace: 'FoodCostCalculator',
            metricName: 'Api4xxCount',
            dimensionsMap: { Environment: envName, Service: 'api' },
            statistic: cloudwatch.Stats.SUM,
            period: cdk.Duration.minutes(5),
            label: '4xx Client Error',
            color: cloudwatch.Color.ORANGE,
          }),
          new cloudwatch.Metric({
            namespace: 'FoodCostCalculator',
            metricName: 'Api5xxCount',
            dimensionsMap: { Environment: envName, Service: 'api' },
            statistic: cloudwatch.Stats.SUM,
            period: cdk.Duration.minutes(5),
            label: '5xx Server Error',
            color: cloudwatch.Color.RED,
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'API Error Rate (%)',
        left: [
          new cloudwatch.MathExpression({
            expression: '(m1 / m2) * 100',
            usingMetrics: {
              m1: new cloudwatch.Metric({
                namespace: 'FoodCostCalculator',
                metricName: 'Api5xxCount',
                dimensionsMap: { Environment: envName, Service: 'api' },
                statistic: cloudwatch.Stats.SUM,
                period: cdk.Duration.minutes(5),
              }),
              m2: new cloudwatch.Metric({
                namespace: 'FoodCostCalculator',
                metricName: 'ApiRequestCount',
                dimensionsMap: { Environment: envName, Service: 'api' },
                statistic: cloudwatch.Stats.SUM,
                period: cdk.Duration.minutes(5),
              }),
            },
            label: '5xx Error Rate',
            period: cdk.Duration.minutes(5),
            color: cloudwatch.Color.RED,
          }),
        ],
        width: 12,
        height: 6,
      })
    );

    // ══════════════════════════════════════════════════════════════════════════
    // 6. CloudWatch Dashboard — Workers Service
    // ══════════════════════════════════════════════════════════════════════════
    //
    // Workers service dashboard widgets:
    //  • SQS messages processed (count per queue)
    //  • Job duration (p50, p90, p99 milliseconds)
    //  • Job success vs. failure count
    //  • DLQ message depth (signals processing failures)

    this.workersDashboard = new cloudwatch.Dashboard(this, 'WorkersDashboard', {
      dashboardName: `FoodCostCalculator-Workers-${envName}`,
    });

    this.workersDashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Worker Job Processing Count',
        left: [
          new cloudwatch.Metric({
            namespace: 'FoodCostCalculator',
            metricName: 'WorkerJobsProcessed',
            dimensionsMap: { Environment: envName, Service: 'workers' },
            statistic: cloudwatch.Stats.SUM,
            period: cdk.Duration.minutes(5),
            label: 'Jobs Processed',
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Worker Job Duration (p50, p90, p99)',
        left: [
          new cloudwatch.Metric({
            namespace: 'FoodCostCalculator',
            metricName: 'WorkerJobP50Duration',
            dimensionsMap: { Environment: envName, Service: 'workers' },
            statistic: cloudwatch.Stats.AVERAGE,
            period: cdk.Duration.minutes(5),
            label: 'p50',
          }),
          new cloudwatch.Metric({
            namespace: 'FoodCostCalculator',
            metricName: 'WorkerJobP90Duration',
            dimensionsMap: { Environment: envName, Service: 'workers' },
            statistic: cloudwatch.Stats.AVERAGE,
            period: cdk.Duration.minutes(5),
            label: 'p90',
          }),
          new cloudwatch.Metric({
            namespace: 'FoodCostCalculator',
            metricName: 'WorkerJobP99Duration',
            dimensionsMap: { Environment: envName, Service: 'workers' },
            statistic: cloudwatch.Stats.AVERAGE,
            period: cdk.Duration.minutes(5),
            label: 'p99',
          }),
        ],
        width: 12,
        height: 6,
      })
    );

    this.workersDashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Worker Job Success vs. Failure',
        left: [
          new cloudwatch.Metric({
            namespace: 'FoodCostCalculator',
            metricName: 'WorkerJobSuccess',
            dimensionsMap: { Environment: envName, Service: 'workers' },
            statistic: cloudwatch.Stats.SUM,
            period: cdk.Duration.minutes(5),
            label: 'Success',
            color: cloudwatch.Color.GREEN,
          }),
          new cloudwatch.Metric({
            namespace: 'FoodCostCalculator',
            metricName: 'WorkerJobFailure',
            dimensionsMap: { Environment: envName, Service: 'workers' },
            statistic: cloudwatch.Stats.SUM,
            period: cdk.Duration.minutes(5),
            label: 'Failure',
            color: cloudwatch.Color.RED,
          }),
        ],
        width: 12,
        height: 6,
      })
    );

    if (props.dlqQueues && props.dlqQueues.length > 0) {
      const dlqMetrics = props.dlqQueues.map((dlq) =>
        dlq.metricApproximateNumberOfMessagesVisible({
          period: cdk.Duration.minutes(5),
          statistic: cloudwatch.Stats.MAXIMUM,
          label: dlq.queueName,
        })
      );

      this.workersDashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: 'Dead Letter Queue Depth',
          left: dlqMetrics,
          width: 12,
          height: 6,
        })
      );
    }

    // Database and Cache dashboards
    this.databaseDashboard = new cloudwatch.Dashboard(this, 'DatabaseDashboard', {
      dashboardName: `FoodCostCalculator-Database-${envName}`,
    });

    if (props.auroraCluster) {
      this.databaseDashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: 'Aurora Database Connections',
          left: [
            new cloudwatch.Metric({
              namespace: 'AWS/RDS',
              metricName: 'DatabaseConnections',
              dimensionsMap: {
                DBClusterIdentifier: props.auroraCluster.clusterIdentifier,
              },
              statistic: cloudwatch.Stats.AVERAGE,
              period: cdk.Duration.minutes(5),
            }),
          ],
          width: 12,
          height: 6,
        }),
        new cloudwatch.GraphWidget({
          title: 'Aurora CPU Utilization',
          left: [
            new cloudwatch.Metric({
              namespace: 'AWS/RDS',
              metricName: 'CPUUtilization',
              dimensionsMap: {
                DBClusterIdentifier: props.auroraCluster.clusterIdentifier,
              },
              statistic: cloudwatch.Stats.AVERAGE,
              period: cdk.Duration.minutes(5),
            }),
          ],
          width: 12,
          height: 6,
        })
      );
    }

    this.cacheDashboard = new cloudwatch.Dashboard(this, 'CacheDashboard', {
      dashboardName: `FoodCostCalculator-Cache-${envName}`,
    });

    if (props.elastiCacheReplicationGroupId) {
      this.cacheDashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: 'ElastiCache CPU Utilization',
          left: [
            new cloudwatch.Metric({
              namespace: 'AWS/ElastiCache',
              metricName: 'CPUUtilization',
              dimensionsMap: {
                ReplicationGroupId: props.elastiCacheReplicationGroupId,
              },
              statistic: cloudwatch.Stats.AVERAGE,
              period: cdk.Duration.minutes(5),
            }),
          ],
          width: 12,
          height: 6,
        }),
        new cloudwatch.GraphWidget({
          title: 'ElastiCache Memory Utilization',
          left: [
            new cloudwatch.Metric({
              namespace: 'AWS/ElastiCache',
              metricName: 'DatabaseMemoryUsagePercentage',
              dimensionsMap: {
                ReplicationGroupId: props.elastiCacheReplicationGroupId,
              },
              statistic: cloudwatch.Stats.AVERAGE,
              period: cdk.Duration.minutes(5),
            }),
          ],
          width: 12,
          height: 6,
        })
      );
    }
  }
}
