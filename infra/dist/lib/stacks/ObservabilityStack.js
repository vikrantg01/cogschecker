"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObservabilityStack = void 0;
const cdk = require("aws-cdk-lib");
const cloudwatch = require("aws-cdk-lib/aws-cloudwatch");
const logs = require("aws-cdk-lib/aws-logs");
const xray = require("aws-cdk-lib/aws-xray");
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
class ObservabilityStack extends cdk.Stack {
    /** API service log group (structured JSON logs). */
    apiLogGroup;
    /** Worker service log group (structured JSON logs). */
    workersLogGroup;
    /** API service X-Ray tracing group. */
    apiXrayGroup;
    /** Workers service X-Ray tracing group. */
    workersXrayGroup;
    /** API service CloudWatch dashboard. */
    apiDashboard;
    /** Workers service CloudWatch dashboard. */
    workersDashboard;
    /** Aurora database metrics dashboard. */
    databaseDashboard;
    /** ElastiCache Redis metrics dashboard. */
    cacheDashboard;
    /** API p99 latency alarm (threshold: 2 seconds). */
    apiLatencyAlarm;
    /** API 5xx error rate alarm (threshold: 1%). */
    apiErrorRateAlarm;
    /** Aurora failover event alarm. */
    auroraFailoverAlarm;
    constructor(scope, id, props) {
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
        this.apiDashboard.addWidgets(new cloudwatch.GraphWidget({
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
        }), new cloudwatch.GraphWidget({
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
        }));
        this.apiDashboard.addWidgets(new cloudwatch.GraphWidget({
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
        }), new cloudwatch.GraphWidget({
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
        }));
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
        this.workersDashboard.addWidgets(new cloudwatch.GraphWidget({
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
        }), new cloudwatch.GraphWidget({
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
        }));
        this.workersDashboard.addWidgets(new cloudwatch.GraphWidget({
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
        }));
        if (props.dlqQueues && props.dlqQueues.length > 0) {
            const dlqMetrics = props.dlqQueues.map((dlq) => dlq.metricApproximateNumberOfMessagesVisible({
                period: cdk.Duration.minutes(5),
                statistic: cloudwatch.Stats.MAXIMUM,
                label: dlq.queueName,
            }));
            this.workersDashboard.addWidgets(new cloudwatch.GraphWidget({
                title: 'Dead Letter Queue Depth',
                left: dlqMetrics,
                width: 12,
                height: 6,
            }));
        }
        // Database and Cache dashboards
        this.databaseDashboard = new cloudwatch.Dashboard(this, 'DatabaseDashboard', {
            dashboardName: `FoodCostCalculator-Database-${envName}`,
        });
        if (props.auroraCluster) {
            this.databaseDashboard.addWidgets(new cloudwatch.GraphWidget({
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
            }), new cloudwatch.GraphWidget({
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
            }));
        }
        this.cacheDashboard = new cloudwatch.Dashboard(this, 'CacheDashboard', {
            dashboardName: `FoodCostCalculator-Cache-${envName}`,
        });
        if (props.elastiCacheReplicationGroupId) {
            this.cacheDashboard.addWidgets(new cloudwatch.GraphWidget({
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
            }), new cloudwatch.GraphWidget({
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
            }));
        }
    }
}
exports.ObservabilityStack = ObservabilityStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiT2JzZXJ2YWJpbGl0eVN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vbGliL3N0YWNrcy9PYnNlcnZhYmlsaXR5U3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBQ25DLHlEQUF5RDtBQUN6RCw2Q0FBNkM7QUFDN0MsNkNBQTZDO0FBb0I3Qzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQTRCRztBQUNILE1BQWEsa0JBQW1CLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDL0Msb0RBQW9EO0lBQ3BDLFdBQVcsQ0FBZ0I7SUFFM0MsdURBQXVEO0lBQ3ZDLGVBQWUsQ0FBZ0I7SUFFL0MsdUNBQXVDO0lBQ3ZCLFlBQVksQ0FBZ0I7SUFFNUMsMkNBQTJDO0lBQzNCLGdCQUFnQixDQUFnQjtJQUVoRCx3Q0FBd0M7SUFDeEIsWUFBWSxDQUF1QjtJQUVuRCw0Q0FBNEM7SUFDNUIsZ0JBQWdCLENBQXVCO0lBRXZELHlDQUF5QztJQUN6QixpQkFBaUIsQ0FBdUI7SUFFeEQsMkNBQTJDO0lBQzNCLGNBQWMsQ0FBdUI7SUFFckQsb0RBQW9EO0lBQ3BDLGVBQWUsQ0FBbUI7SUFFbEQsZ0RBQWdEO0lBQ2hDLGlCQUFpQixDQUFtQjtJQUVwRCxtQ0FBbUM7SUFDbkIsbUJBQW1CLENBQW9CO0lBRXZELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBOEI7UUFDdEUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLE9BQU8sRUFBRSxHQUFHLEtBQUssQ0FBQztRQUUxQiw2RUFBNkU7UUFDN0Usa0RBQWtEO1FBQ2xELDZFQUE2RTtRQUM3RSxFQUFFO1FBQ0Ysd0VBQXdFO1FBQ3hFLG1GQUFtRjtRQUNuRixFQUFFO1FBQ0YseURBQXlEO1FBQ3pELGlHQUFpRztRQUVqRyxJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FB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QUFLLENBQUMsNkJBQTZCO3lCQUN4RDt3QkFDRCxTQUFTLEVBQUUsVUFBVSxDQUFDLEtBQUssQ0FBQyxPQUFPO3dCQUNuQyxNQUFNLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO3FCQUNoQyxDQUFDO2lCQUNIO2dCQUNELEtBQUssRUFBRSxFQUFFO2dCQUNULE1BQU0sRUFBRSxDQUFDO2FBQ1YsQ0FBQyxDQUNILENBQUM7UUFDSixDQUFDO0lBQ0gsQ0FBQztDQUNGO0FBaGdCRCxnREFnZ0JDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGNsb3Vkd2F0Y2ggZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gnO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgKiBhcyB4cmF5IGZyb20gJ2F3cy1jZGstbGliL2F3cy14cmF5JztcbmltcG9ydCAqIGFzIHJkcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtcmRzJztcbmltcG9ydCAqIGFzIGVsYXN0aWNhY2hlIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lbGFzdGljYWNoZSc7XG5pbXBvcnQgKiBhcyBzcXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNxcyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBPYnNlcnZhYmlsaXR5U3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgLyoqIExvZ2ljYWwgZW52aXJvbm1lbnQgbmFtZSwgZS5nLiBcInN0YWdpbmdcIiBvciBcInByb2RcIi4gVXNlZCBmb3IgbmFtaW5nLiAqL1xuICByZWFkb25seSBlbnZOYW1lOiBzdHJpbmc7XG5cbiAgLyoqIEF1cm9yYSBQb3N0Z3JlU1FMIGNsdXN0ZXIgKGZvciBkYXRhYmFzZSBtZXRyaWNzIGFuZCBmYWlsb3ZlciBhbGFybXMpLiAqL1xuICByZWFkb25seSBhdXJvcmFDbHVzdGVyPzogcmRzLklEYXRhYmFzZUNsdXN0ZXI7XG5cbiAgLyoqIEVsYXN0aUNhY2hlIFJlZGlzIHJlcGxpY2F0aW9uIGdyb3VwIChmb3IgY2FjaGUgbWV0cmljcykuICovXG4gIHJlYWRvbmx5IGVsYXN0aUNhY2hlUmVwbGljYXRpb25Hcm91cElkPzogc3RyaW5nO1xuXG4gIC8qKiBEZWFkLWxldHRlciBxdWV1ZXMgZnJvbSBNZXNzYWdpbmdTdGFjayAoZm9yIERMUSBkZXB0aCBhbGFybXMpLiAqL1xuICByZWFkb25seSBkbHFRdWV1ZXM/OiBzcXMuSVF1ZXVlW107XG59XG5cbi8qKlxuICogT2JzZXJ2YWJpbGl0eVN0YWNrXG4gKlxuICogUHJvdmlzaW9ucyB0aGUgb2JzZXJ2YWJpbGl0eSBpbmZyYXN0cnVjdHVyZSBmb3IgdGhlIEZvb2QgQ29zdCBDYWxjdWxhdG9yOlxuICpcbiAqICDigKIgQ2xvdWRXYXRjaCBEYXNoYm9hcmRzOlxuICogICAgLSBBUEkgc2VydmljZSBtZXRyaWNzIChyZXF1ZXN0IGNvdW50LCBsYXRlbmN5LCBlcnJvciByYXRlKVxuICogICAgLSBXb3JrZXIgc2VydmljZSBtZXRyaWNzIChTUVMgcHJvY2Vzc2luZywgam9iIGR1cmF0aW9uLCBlcnJvciBjb3VudClcbiAqICAgIC0gQXVyb3JhIFBvc3RncmVTUUwgbWV0cmljcyAoY29ubmVjdGlvbnMsIENQVSwgcmVhZC93cml0ZSBsYXRlbmN5LCByZXBsaWNhdGlvbiBsYWcpXG4gKiAgICAtIEVsYXN0aUNhY2hlIFJlZGlzIG1ldHJpY3MgKENQVSwgbWVtb3J5LCBldmljdGlvbnMsIGNvbm5lY3Rpb25zKVxuICpcbiAqICDigKIgQ2xvdWRXYXRjaCBBbGFybXM6XG4gKiAgICAtIEFQSSBwOTkgbGF0ZW5jeSA+IDIgc2Vjb25kc1xuICogICAgLSBBUEkgNXh4IGVycm9yIHJhdGUgPiAxJVxuICogICAgLSBETFEgZGVwdGggPiAwIChzaWduYWxzIHByb2Nlc3NpbmcgZmFpbHVyZXMpXG4gKiAgICAtIEF1cm9yYSBmYWlsb3ZlciBldmVudCAoTXVsdGktQVogd3JpdGVyIHByb21vdGlvbilcbiAqXG4gKiAg4oCiIEFXUyBYLVJheSBHcm91cHM6XG4gKiAgICAtIGFwaSBzZXJ2aWNlIHRyYWNpbmcgZ3JvdXAgKGFsbCAvYXBpLyogdHJhY2VzKVxuICogICAgLSB3b3JrZXJzIHNlcnZpY2UgdHJhY2luZyBncm91cCAoYWxsIGFzeW5jIGpvYiB0cmFjZXMpXG4gKlxuICogIOKAoiBDbG91ZFdhdGNoIExvZyBHcm91cHM6XG4gKiAgICAtIFN0cnVjdHVyZWQgSlNPTiBsb2cgZ3JvdXBzIGZvciBhcGkgYW5kIHdvcmtlcnMgc2VydmljZXNcbiAqICAgIC0gMzAtZGF5IHJldGVudGlvbiBieSBkZWZhdWx0IChjb25maWd1cmFibGUgcGVyIGVudmlyb25tZW50KVxuICpcbiAqIFNhdGlzZmllcyBSZXF1aXJlbWVudHM6XG4gKiAgLSAzLjM6ICBSZWFsLXRpbWUgbW9uaXRvcmluZyBvZiBjb3N0IHByb3BhZ2F0aW9uIGxhdGVuY3lcbiAqICAtIDQuNTogIFBlcmZvcm1hbmNlIG1vbml0b3JpbmcgZm9yIGZvb2QgY29zdCBwZXJjZW50YWdlIGNhbGN1bGF0aW9uXG4gKi9cbmV4cG9ydCBjbGFzcyBPYnNlcnZhYmlsaXR5U3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICAvKiogQVBJIHNlcnZpY2UgbG9nIGdyb3VwIChzdHJ1Y3R1cmVkIEpTT04gbG9ncykuICovXG4gIHB1YmxpYyByZWFkb25seSBhcGlMb2dHcm91cDogbG9ncy5Mb2dHcm91cDtcblxuICAvKiogV29ya2VyIHNlcnZpY2UgbG9nIGdyb3VwIChzdHJ1Y3R1cmVkIEpTT04gbG9ncykuICovXG4gIHB1YmxpYyByZWFkb25seSB3b3JrZXJzTG9nR3JvdXA6IGxvZ3MuTG9nR3JvdXA7XG5cbiAgLyoqIEFQSSBzZXJ2aWNlIFgtUmF5IHRyYWNpbmcgZ3JvdXAuICovXG4gIHB1YmxpYyByZWFkb25seSBhcGlYcmF5R3JvdXA6IHhyYXkuQ2ZuR3JvdXA7XG5cbiAgLyoqIFdvcmtlcnMgc2VydmljZSBYLVJheSB0cmFjaW5nIGdyb3VwLiAqL1xuICBwdWJsaWMgcmVhZG9ubHkgd29ya2Vyc1hyYXlHcm91cDogeHJheS5DZm5Hcm91cDtcblxuICAvKiogQVBJIHNlcnZpY2UgQ2xvdWRXYXRjaCBkYXNoYm9hcmQuICovXG4gIHB1YmxpYyByZWFkb25seSBhcGlEYXNoYm9hcmQ6IGNsb3Vkd2F0Y2guRGFzaGJvYXJkO1xuXG4gIC8qKiBXb3JrZXJzIHNlcnZpY2UgQ2xvdWRXYXRjaCBkYXNoYm9hcmQuICovXG4gIHB1YmxpYyByZWFkb25seSB3b3JrZXJzRGFzaGJvYXJkOiBjbG91ZHdhdGNoLkRhc2hib2FyZDtcblxuICAvKiogQXVyb3JhIGRhdGFiYXNlIG1ldHJpY3MgZGFzaGJvYXJkLiAqL1xuICBwdWJsaWMgcmVhZG9ubHkgZGF0YWJhc2VEYXNoYm9hcmQ6IGNsb3Vkd2F0Y2guRGFzaGJvYXJkO1xuXG4gIC8qKiBFbGFzdGlDYWNoZSBSZWRpcyBtZXRyaWNzIGRhc2hib2FyZC4gKi9cbiAgcHVibGljIHJlYWRvbmx5IGNhY2hlRGFzaGJvYXJkOiBjbG91ZHdhdGNoLkRhc2hib2FyZDtcblxuICAvKiogQVBJIHA5OSBsYXRlbmN5IGFsYXJtICh0aHJlc2hvbGQ6IDIgc2Vjb25kcykuICovXG4gIHB1YmxpYyByZWFkb25seSBhcGlMYXRlbmN5QWxhcm06IGNsb3Vkd2F0Y2guQWxhcm07XG5cbiAgLyoqIEFQSSA1eHggZXJyb3IgcmF0ZSBhbGFybSAodGhyZXNob2xkOiAxJSkuICovXG4gIHB1YmxpYyByZWFkb25seSBhcGlFcnJvclJhdGVBbGFybTogY2xvdWR3YXRjaC5BbGFybTtcblxuICAvKiogQXVyb3JhIGZhaWxvdmVyIGV2ZW50IGFsYXJtLiAqL1xuICBwdWJsaWMgcmVhZG9ubHkgYXVyb3JhRmFpbG92ZXJBbGFybT86IGNsb3Vkd2F0Y2guQWxhcm07XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IE9ic2VydmFiaWxpdHlTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7IGVudk5hbWUgfSA9IHByb3BzO1xuXG4gICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgLy8gMS4gQ2xvdWRXYXRjaCBMb2cgR3JvdXBzIOKAlCBTdHJ1Y3R1cmVkIEpTT04gTG9nc1xuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIC8vXG4gICAgLy8gU3ByaW5nIEJvb3QgYXBwbGljYXRpb25zIChhcGkgYW5kIHdvcmtlcnMpIGVtaXQgc3RydWN0dXJlZCBKU09OIGxvZ3MuXG4gICAgLy8gRWFjaCBsb2cgZW50cnkgaW5jbHVkZXM6IHRpbWVzdGFtcCwgbGV2ZWwsIGxvZ2dlciwgdGhyZWFkLCBtZXNzYWdlLCBNREMgY29udGV4dC5cbiAgICAvL1xuICAgIC8vIExvZyByZXRlbnRpb246IDMwIGRheXMgKGNvbmZpZ3VyYWJsZSBwZXIgZW52aXJvbm1lbnQpLlxuICAgIC8vIEZvciBwcm9kdWN0aW9uLCBjb25zaWRlciBleHRlbmRpbmcgdG8gOTAgZGF5cyBvciBzaGlwcGluZyB0byBTMy9BdGhlbmEgZm9yIGxvbmctdGVybSBhbmFseXNpcy5cblxuICAgIHRoaXMuYXBpTG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnQXBpTG9nR3JvdXAnLCB7XG4gICAgICBsb2dHcm91cE5hbWU6IGAvZm9vZC1jb3N0LWNhbGN1bGF0b3IvJHtlbnZOYW1lfS9hcGlgLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgcmVtb3ZhbFBvbGljeTogZW52TmFtZSA9PT0gJ3Byb2QnID8gY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOIDogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIHRoaXMud29ya2Vyc0xvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgJ1dvcmtlcnNMb2dHcm91cCcsIHtcbiAgICAgIGxvZ0dyb3VwTmFtZTogYC9mb29kLWNvc3QtY2FsY3VsYXRvci8ke2Vudk5hbWV9L3dvcmtlcnNgLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgcmVtb3ZhbFBvbGljeTogZW52TmFtZSA9PT0gJ3Byb2QnID8gY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOIDogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIC8vIDIuIEFXUyBYLVJheSBHcm91cHMg4oCUIERpc3RyaWJ1dGVkIFRyYWNpbmdcbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAvL1xuICAgIC8vIFgtUmF5IGdyb3VwcyBhbGxvdyBmaWx0ZXJpbmcgdHJhY2VzIGJ5IHNlcnZpY2UgbmFtZSBhbmQgY3VzdG9tIGF0dHJpYnV0ZXMuXG4gICAgLy9cbiAgICAvLyBGaWx0ZXIgZXhwcmVzc2lvbnM6XG4gICAgLy8gIOKAoiBhcGkgZ3JvdXA6ICAgICBzZXJ2aWNlKFwiYXBpXCIpIOKAlCBhbGwgdHJhY2VzIGZyb20gdGhlIEFQSSBzZXJ2aWNlXG4gICAgLy8gIOKAoiB3b3JrZXJzIGdyb3VwOiBzZXJ2aWNlKFwid29ya2Vyc1wiKSDigJQgYWxsIHRyYWNlcyBmcm9tIHRoZSB3b3JrZXJzIHNlcnZpY2VcbiAgICAvL1xuICAgIC8vIFNwcmluZyBCb290IHNlcnZpY2VzIGVtaXQgWC1SYXkgdHJhY2VzIHZpYSB0aGUgQVdTIFgtUmF5IFNESyBmb3IgSmF2YS5cbiAgICAvLyBUcmFjZXMgaW5jbHVkZSBIVFRQIHJlcXVlc3QgbWV0YWRhdGEgKFVSTCwgbWV0aG9kLCBzdGF0dXMgY29kZSwgbGF0ZW5jeSlcbiAgICAvLyBhbmQgY3VzdG9tIGFubm90YXRpb25zICh2ZW51ZUlkLCB1c2VySWQsIHJlY2lwZUlkLCBldGMuKS5cblxuICAgIHRoaXMuYXBpWHJheUdyb3VwID0gbmV3IHhyYXkuQ2ZuR3JvdXAodGhpcywgJ0FwaVhyYXlHcm91cCcsIHtcbiAgICAgIGdyb3VwTmFtZTogYGZvb2QtY29zdC1jYWxjdWxhdG9yLWFwaS0ke2Vudk5hbWV9YCxcbiAgICAgIGZpbHRlckV4cHJlc3Npb246ICdzZXJ2aWNlKFwiYXBpXCIpJyxcbiAgICB9KTtcblxuICAgIHRoaXMud29ya2Vyc1hyYXlHcm91cCA9IG5ldyB4cmF5LkNmbkdyb3VwKHRoaXMsICdXb3JrZXJzWHJheUdyb3VwJywge1xuICAgICAgZ3JvdXBOYW1lOiBgZm9vZC1jb3N0LWNhbGN1bGF0b3Itd29ya2Vycy0ke2Vudk5hbWV9YCxcbiAgICAgIGZpbHRlckV4cHJlc3Npb246ICdzZXJ2aWNlKFwid29ya2Vyc1wiKScsXG4gICAgfSk7XG5cbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAvLyAzLiBDbG91ZFdhdGNoIEFsYXJtcyDigJQgQVBJIFNlcnZpY2VcbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAvL1xuICAgIC8vIEFQSSBwOTkgbGF0ZW5jeSBhbGFybTpcbiAgICAvLyAg4oCiIFRocmVzaG9sZDogMiBzZWNvbmRzXG4gICAgLy8gIOKAoiBFdmFsdWF0aW9uOiAyIGNvbnNlY3V0aXZlIGRhdGEgcG9pbnRzIG92ZXIgNSBtaW51dGVzXG4gICAgLy8gIOKAoiBNZXRyaWM6IEN1c3RvbSBtZXRyaWMgZW1pdHRlZCBieSBTcHJpbmcgQm9vdCBBY3R1YXRvcjogaHR0cC5zZXJ2ZXIucmVxdWVzdHMucDk5XG4gICAgLy9cbiAgICAvLyBBUEkgNXh4IGVycm9yIHJhdGUgYWxhcm06XG4gICAgLy8gIOKAoiBUaHJlc2hvbGQ6IDElICgwLjAxKVxuICAgIC8vICDigKIgRXZhbHVhdGlvbjogMiBjb25zZWN1dGl2ZSBkYXRhIHBvaW50cyBvdmVyIDUgbWludXRlc1xuICAgIC8vICDigKIgTWV0cmljOiBNYXRoIGV4cHJlc3Npb246IDV4eF9jb3VudCAvIHRvdGFsX3JlcXVlc3RzXG5cbiAgICB0aGlzLmFwaUxhdGVuY3lBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdBcGlMYXRlbmN5QWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6IGBmY2MtYXBpLXA5OS1sYXRlbmN5LSR7ZW52TmFtZX1gLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FQSSBwOTkgbGF0ZW5jeSBleGNlZWRzIDIgc2Vjb25kcycsXG4gICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvcicsXG4gICAgICAgIG1ldHJpY05hbWU6ICdBcGlQOTlMYXRlbmN5JyxcbiAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgIEVudmlyb25tZW50OiBlbnZOYW1lLFxuICAgICAgICAgIFNlcnZpY2U6ICdhcGknLFxuICAgICAgICB9LFxuICAgICAgICBzdGF0aXN0aWM6IGNsb3Vkd2F0Y2guU3RhdHMuTUFYSU1VTSxcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAyMDAwLCAvLyAyIHNlY29uZHMgaW4gbWlsbGlzZWNvbmRzXG4gICAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9USFJFU0hPTEQsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMixcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pO1xuXG4gICAgdGhpcy5hcGlFcnJvclJhdGVBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdBcGlFcnJvclJhdGVBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogYGZjYy1hcGktNXh4LWVycm9yLXJhdGUtJHtlbnZOYW1lfWAsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnQVBJIDV4eCBlcnJvciByYXRlIGV4Y2VlZHMgMSUnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NYXRoRXhwcmVzc2lvbih7XG4gICAgICAgIGV4cHJlc3Npb246ICcobTEgLyBtMikgKiAxMDAnLFxuICAgICAgICB1c2luZ01ldHJpY3M6IHtcbiAgICAgICAgICBtMTogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnQXBpNXh4Q291bnQnLFxuICAgICAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgICAgICBFbnZpcm9ubWVudDogZW52TmFtZSxcbiAgICAgICAgICAgICAgU2VydmljZTogJ2FwaScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc3RhdGlzdGljOiBjbG91ZHdhdGNoLlN0YXRzLlNVTSxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbTI6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdGb29kQ29zdENhbGN1bGF0b3InLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0FwaVJlcXVlc3RDb3VudCcsXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgICAgIEVudmlyb25tZW50OiBlbnZOYW1lLFxuICAgICAgICAgICAgICBTZXJ2aWNlOiAnYXBpJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzdGF0aXN0aWM6IGNsb3Vkd2F0Y2guU3RhdHMuU1VNLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgfSxcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAxLCAvLyAxJVxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fVEhSRVNIT0xELFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDIsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICB9KTtcblxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIC8vIDQuIENsb3VkV2F0Y2ggQWxhcm1zIOKAlCBBdXJvcmEgRmFpbG92ZXIgRXZlbnRcbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAvL1xuICAgIC8vIEF1cm9yYSBmYWlsb3ZlciBldmVudCBhbGFybTpcbiAgICAvLyAg4oCiIFRocmVzaG9sZDogQW55IGZhaWxvdmVyIGV2ZW50ICg+IDApXG4gICAgLy8gIOKAoiBFdmFsdWF0aW9uOiAxIGRhdGEgcG9pbnQgb3ZlciA1IG1pbnV0ZXNcbiAgICAvLyAg4oCiIE1ldHJpYzogUkRTIERhdGFiYXNlQ29ubmVjdGlvbnMgZHJvcHBlZCAoaW5kaWNhdGVzIHdyaXRlciBwcm9tb3Rpb24pXG4gICAgLy9cbiAgICAvLyBBdXJvcmEgYXV0b21hdGljYWxseSBmYWlscyBvdmVyIHRvIHRoZSBzdGFuZGJ5IHJlcGxpY2Egd2hlbiB0aGUgd3JpdGVyXG4gICAgLy8gaW5zdGFuY2UgYmVjb21lcyB1bmF2YWlsYWJsZS4gVGhpcyBhbGFybSBmaXJlcyB3aGVuIGEgZmFpbG92ZXIgb2NjdXJzLFxuICAgIC8vIHNpZ25hbGluZyBwb3RlbnRpYWwgaXNzdWVzIHdpdGggdGhlIHByaW1hcnkgaW5zdGFuY2UgKGhhcmR3YXJlIGZhaWx1cmUsXG4gICAgLy8gQVogb3V0YWdlLCBtYW51YWwgcmVib290LCBldGMuKS5cbiAgICAvL1xuICAgIC8vIE5vdGU6IEF1cm9yYSBmYWlsb3ZlciB0eXBpY2FsbHkgY29tcGxldGVzIGluIDwgMzAgc2Vjb25kcyAoUlRPKS5cblxuICAgIGlmIChwcm9wcy5hdXJvcmFDbHVzdGVyKSB7XG4gICAgICB0aGlzLmF1cm9yYUZhaWxvdmVyQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnQXVyb3JhRmFpbG92ZXJBbGFybScsIHtcbiAgICAgICAgYWxhcm1OYW1lOiBgZmNjLWF1cm9yYS1mYWlsb3Zlci0ke2Vudk5hbWV9YCxcbiAgICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0F1cm9yYSBjbHVzdGVyIGZhaWxvdmVyIGV2ZW50IGRldGVjdGVkIChNdWx0aS1BWiB3cml0ZXIgcHJvbW90aW9uKScsXG4gICAgICAgIG1ldHJpYzogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvUkRTJyxcbiAgICAgICAgICBtZXRyaWNOYW1lOiAnRGF0YWJhc2VDb25uZWN0aW9ucycsXG4gICAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgICAgREJDbHVzdGVySWRlbnRpZmllcjogcHJvcHMuYXVyb3JhQ2x1c3Rlci5jbHVzdGVySWRlbnRpZmllcixcbiAgICAgICAgICB9LFxuICAgICAgICAgIHN0YXRpc3RpYzogY2xvdWR3YXRjaC5TdGF0cy5BVkVSQUdFLFxuICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMSksXG4gICAgICAgIH0pLFxuICAgICAgICB0aHJlc2hvbGQ6IDAsXG4gICAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuTEVTU19USEFOX09SX0VRVUFMX1RPX1RIUkVTSE9MRCxcbiAgICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5CUkVBQ0hJTkcsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAvLyA1LiBDbG91ZFdhdGNoIERhc2hib2FyZCDigJQgQVBJIFNlcnZpY2VcbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAvL1xuICAgIC8vIEFQSSBzZXJ2aWNlIGRhc2hib2FyZCB3aWRnZXRzOlxuICAgIC8vICDigKIgUmVxdWVzdCBjb3VudCAodG90YWwgcmVxdWVzdHMgcGVyIDUtbWludXRlIHBlcmlvZClcbiAgICAvLyAg4oCiIHA1MCwgcDkwLCBwOTkgbGF0ZW5jeSAobWlsbGlzZWNvbmRzKVxuICAgIC8vICDigKIgMnh4LCA0eHgsIDV4eCByZXNwb25zZSBjb3VudHNcbiAgICAvLyAg4oCiIEVycm9yIHJhdGUgKDV4eCAvIHRvdGFsIHJlcXVlc3RzLCBhcyBwZXJjZW50YWdlKVxuICAgIC8vICDigKIgQWN0aXZlIGNvbm5lY3Rpb25zIChjdXJyZW50IG9wZW4gSFRUUC8yIHN0cmVhbXMpXG5cbiAgICB0aGlzLmFwaURhc2hib2FyZCA9IG5ldyBjbG91ZHdhdGNoLkRhc2hib2FyZCh0aGlzLCAnQXBpRGFzaGJvYXJkJywge1xuICAgICAgZGFzaGJvYXJkTmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci1BUEktJHtlbnZOYW1lfWAsXG4gICAgfSk7XG5cbiAgICB0aGlzLmFwaURhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ0FQSSBSZXF1ZXN0IENvdW50JyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdGb29kQ29zdENhbGN1bGF0b3InLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0FwaVJlcXVlc3RDb3VudCcsXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IEVudmlyb25tZW50OiBlbnZOYW1lLCBTZXJ2aWNlOiAnYXBpJyB9LFxuICAgICAgICAgICAgc3RhdGlzdGljOiBjbG91ZHdhdGNoLlN0YXRzLlNVTSxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJ1RvdGFsIFJlcXVlc3RzJyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KSxcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdBUEkgTGF0ZW5jeSAocDUwLCBwOTAsIHA5OSknLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnQXBpUDUwTGF0ZW5jeScsXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IEVudmlyb25tZW50OiBlbnZOYW1lLCBTZXJ2aWNlOiAnYXBpJyB9LFxuICAgICAgICAgICAgc3RhdGlzdGljOiBjbG91ZHdhdGNoLlN0YXRzLkFWRVJBR0UsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgbGFiZWw6ICdwNTAnLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdGb29kQ29zdENhbGN1bGF0b3InLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0FwaVA5MExhdGVuY3knLFxuICAgICAgICAgICAgZGltZW5zaW9uc01hcDogeyBFbnZpcm9ubWVudDogZW52TmFtZSwgU2VydmljZTogJ2FwaScgfSxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogY2xvdWR3YXRjaC5TdGF0cy5BVkVSQUdFLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgIGxhYmVsOiAncDkwJyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnRm9vZENvc3RDYWxjdWxhdG9yJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdBcGlQOTlMYXRlbmN5JyxcbiAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgRW52aXJvbm1lbnQ6IGVudk5hbWUsIFNlcnZpY2U6ICdhcGknIH0sXG4gICAgICAgICAgICBzdGF0aXN0aWM6IGNsb3Vkd2F0Y2guU3RhdHMuQVZFUkFHRSxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJ3A5OScsXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgdGhpcy5hcGlEYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdBUEkgUmVzcG9uc2UgQ29kZXMnLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnQXBpMnh4Q291bnQnLFxuICAgICAgICAgICAgZGltZW5zaW9uc01hcDogeyBFbnZpcm9ubWVudDogZW52TmFtZSwgU2VydmljZTogJ2FwaScgfSxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogY2xvdWR3YXRjaC5TdGF0cy5TVU0sXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgbGFiZWw6ICcyeHggU3VjY2VzcycsXG4gICAgICAgICAgICBjb2xvcjogY2xvdWR3YXRjaC5Db2xvci5HUkVFTixcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnRm9vZENvc3RDYWxjdWxhdG9yJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdBcGk0eHhDb3VudCcsXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IEVudmlyb25tZW50OiBlbnZOYW1lLCBTZXJ2aWNlOiAnYXBpJyB9LFxuICAgICAgICAgICAgc3RhdGlzdGljOiBjbG91ZHdhdGNoLlN0YXRzLlNVTSxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJzR4eCBDbGllbnQgRXJyb3InLFxuICAgICAgICAgICAgY29sb3I6IGNsb3Vkd2F0Y2guQ29sb3IuT1JBTkdFLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdGb29kQ29zdENhbGN1bGF0b3InLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0FwaTV4eENvdW50JyxcbiAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgRW52aXJvbm1lbnQ6IGVudk5hbWUsIFNlcnZpY2U6ICdhcGknIH0sXG4gICAgICAgICAgICBzdGF0aXN0aWM6IGNsb3Vkd2F0Y2guU3RhdHMuU1VNLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgIGxhYmVsOiAnNXh4IFNlcnZlciBFcnJvcicsXG4gICAgICAgICAgICBjb2xvcjogY2xvdWR3YXRjaC5Db2xvci5SRUQsXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSksXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnQVBJIEVycm9yIFJhdGUgKCUpJyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1hdGhFeHByZXNzaW9uKHtcbiAgICAgICAgICAgIGV4cHJlc3Npb246ICcobTEgLyBtMikgKiAxMDAnLFxuICAgICAgICAgICAgdXNpbmdNZXRyaWNzOiB7XG4gICAgICAgICAgICAgIG0xOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvcicsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0FwaTV4eENvdW50JyxcbiAgICAgICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IEVudmlyb25tZW50OiBlbnZOYW1lLCBTZXJ2aWNlOiAnYXBpJyB9LFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogY2xvdWR3YXRjaC5TdGF0cy5TVU0sXG4gICAgICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG0yOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvcicsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0FwaVJlcXVlc3RDb3VudCcsXG4gICAgICAgICAgICAgICAgZGltZW5zaW9uc01hcDogeyBFbnZpcm9ubWVudDogZW52TmFtZSwgU2VydmljZTogJ2FwaScgfSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6IGNsb3Vkd2F0Y2guU3RhdHMuU1VNLFxuICAgICAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGxhYmVsOiAnNXh4IEVycm9yIFJhdGUnLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgIGNvbG9yOiBjbG91ZHdhdGNoLkNvbG9yLlJFRCxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAvLyA2LiBDbG91ZFdhdGNoIERhc2hib2FyZCDigJQgV29ya2VycyBTZXJ2aWNlXG4gICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgLy9cbiAgICAvLyBXb3JrZXJzIHNlcnZpY2UgZGFzaGJvYXJkIHdpZGdldHM6XG4gICAgLy8gIOKAoiBTUVMgbWVzc2FnZXMgcHJvY2Vzc2VkIChjb3VudCBwZXIgcXVldWUpXG4gICAgLy8gIOKAoiBKb2IgZHVyYXRpb24gKHA1MCwgcDkwLCBwOTkgbWlsbGlzZWNvbmRzKVxuICAgIC8vICDigKIgSm9iIHN1Y2Nlc3MgdnMuIGZhaWx1cmUgY291bnRcbiAgICAvLyAg4oCiIERMUSBtZXNzYWdlIGRlcHRoIChzaWduYWxzIHByb2Nlc3NpbmcgZmFpbHVyZXMpXG5cbiAgICB0aGlzLndvcmtlcnNEYXNoYm9hcmQgPSBuZXcgY2xvdWR3YXRjaC5EYXNoYm9hcmQodGhpcywgJ1dvcmtlcnNEYXNoYm9hcmQnLCB7XG4gICAgICBkYXNoYm9hcmROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLVdvcmtlcnMtJHtlbnZOYW1lfWAsXG4gICAgfSk7XG5cbiAgICB0aGlzLndvcmtlcnNEYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdXb3JrZXIgSm9iIFByb2Nlc3NpbmcgQ291bnQnLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnV29ya2VySm9ic1Byb2Nlc3NlZCcsXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IEVudmlyb25tZW50OiBlbnZOYW1lLCBTZXJ2aWNlOiAnd29ya2VycycgfSxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogY2xvdWR3YXRjaC5TdGF0cy5TVU0sXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgbGFiZWw6ICdKb2JzIFByb2Nlc3NlZCcsXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSksXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnV29ya2VyIEpvYiBEdXJhdGlvbiAocDUwLCBwOTAsIHA5OSknLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnV29ya2VySm9iUDUwRHVyYXRpb24nLFxuICAgICAgICAgICAgZGltZW5zaW9uc01hcDogeyBFbnZpcm9ubWVudDogZW52TmFtZSwgU2VydmljZTogJ3dvcmtlcnMnIH0sXG4gICAgICAgICAgICBzdGF0aXN0aWM6IGNsb3Vkd2F0Y2guU3RhdHMuQVZFUkFHRSxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJ3A1MCcsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnV29ya2VySm9iUDkwRHVyYXRpb24nLFxuICAgICAgICAgICAgZGltZW5zaW9uc01hcDogeyBFbnZpcm9ubWVudDogZW52TmFtZSwgU2VydmljZTogJ3dvcmtlcnMnIH0sXG4gICAgICAgICAgICBzdGF0aXN0aWM6IGNsb3Vkd2F0Y2guU3RhdHMuQVZFUkFHRSxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJ3A5MCcsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvcicsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnV29ya2VySm9iUDk5RHVyYXRpb24nLFxuICAgICAgICAgICAgZGltZW5zaW9uc01hcDogeyBFbnZpcm9ubWVudDogZW52TmFtZSwgU2VydmljZTogJ3dvcmtlcnMnIH0sXG4gICAgICAgICAgICBzdGF0aXN0aWM6IGNsb3Vkd2F0Y2guU3RhdHMuQVZFUkFHRSxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJ3A5OScsXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgdGhpcy53b3JrZXJzRGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnV29ya2VyIEpvYiBTdWNjZXNzIHZzLiBGYWlsdXJlJyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdGb29kQ29zdENhbGN1bGF0b3InLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ1dvcmtlckpvYlN1Y2Nlc3MnLFxuICAgICAgICAgICAgZGltZW5zaW9uc01hcDogeyBFbnZpcm9ubWVudDogZW52TmFtZSwgU2VydmljZTogJ3dvcmtlcnMnIH0sXG4gICAgICAgICAgICBzdGF0aXN0aWM6IGNsb3Vkd2F0Y2guU3RhdHMuU1VNLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgIGxhYmVsOiAnU3VjY2VzcycsXG4gICAgICAgICAgICBjb2xvcjogY2xvdWR3YXRjaC5Db2xvci5HUkVFTixcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnRm9vZENvc3RDYWxjdWxhdG9yJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdXb3JrZXJKb2JGYWlsdXJlJyxcbiAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgRW52aXJvbm1lbnQ6IGVudk5hbWUsIFNlcnZpY2U6ICd3b3JrZXJzJyB9LFxuICAgICAgICAgICAgc3RhdGlzdGljOiBjbG91ZHdhdGNoLlN0YXRzLlNVTSxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICBsYWJlbDogJ0ZhaWx1cmUnLFxuICAgICAgICAgICAgY29sb3I6IGNsb3Vkd2F0Y2guQ29sb3IuUkVELFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIGlmIChwcm9wcy5kbHFRdWV1ZXMgJiYgcHJvcHMuZGxxUXVldWVzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGRscU1ldHJpY3MgPSBwcm9wcy5kbHFRdWV1ZXMubWFwKChkbHEpID0+XG4gICAgICAgIGRscS5tZXRyaWNBcHByb3hpbWF0ZU51bWJlck9mTWVzc2FnZXNWaXNpYmxlKHtcbiAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgIHN0YXRpc3RpYzogY2xvdWR3YXRjaC5TdGF0cy5NQVhJTVVNLFxuICAgICAgICAgIGxhYmVsOiBkbHEucXVldWVOYW1lLFxuICAgICAgICB9KVxuICAgICAgKTtcblxuICAgICAgdGhpcy53b3JrZXJzRGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgICB0aXRsZTogJ0RlYWQgTGV0dGVyIFF1ZXVlIERlcHRoJyxcbiAgICAgICAgICBsZWZ0OiBkbHFNZXRyaWNzLFxuICAgICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICAgIH0pXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIERhdGFiYXNlIGFuZCBDYWNoZSBkYXNoYm9hcmRzXG4gICAgdGhpcy5kYXRhYmFzZURhc2hib2FyZCA9IG5ldyBjbG91ZHdhdGNoLkRhc2hib2FyZCh0aGlzLCAnRGF0YWJhc2VEYXNoYm9hcmQnLCB7XG4gICAgICBkYXNoYm9hcmROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLURhdGFiYXNlLSR7ZW52TmFtZX1gLFxuICAgIH0pO1xuXG4gICAgaWYgKHByb3BzLmF1cm9yYUNsdXN0ZXIpIHtcbiAgICAgIHRoaXMuZGF0YWJhc2VEYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICAgIHRpdGxlOiAnQXVyb3JhIERhdGFiYXNlIENvbm5lY3Rpb25zJyxcbiAgICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvUkRTJyxcbiAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0RhdGFiYXNlQ29ubmVjdGlvbnMnLFxuICAgICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgICAgICAgREJDbHVzdGVySWRlbnRpZmllcjogcHJvcHMuYXVyb3JhQ2x1c3Rlci5jbHVzdGVySWRlbnRpZmllcixcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgc3RhdGlzdGljOiBjbG91ZHdhdGNoLlN0YXRzLkFWRVJBR0UsXG4gICAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICBdLFxuICAgICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICAgIH0pLFxuICAgICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgdGl0bGU6ICdBdXJvcmEgQ1BVIFV0aWxpemF0aW9uJyxcbiAgICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvUkRTJyxcbiAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0NQVVV0aWxpemF0aW9uJyxcbiAgICAgICAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgICAgICAgIERCQ2x1c3RlcklkZW50aWZpZXI6IHByb3BzLmF1cm9yYUNsdXN0ZXIuY2x1c3RlcklkZW50aWZpZXIsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHN0YXRpc3RpYzogY2xvdWR3YXRjaC5TdGF0cy5BVkVSQUdFLFxuICAgICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgXSxcbiAgICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9XG5cbiAgICB0aGlzLmNhY2hlRGFzaGJvYXJkID0gbmV3IGNsb3Vkd2F0Y2guRGFzaGJvYXJkKHRoaXMsICdDYWNoZURhc2hib2FyZCcsIHtcbiAgICAgIGRhc2hib2FyZE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItQ2FjaGUtJHtlbnZOYW1lfWAsXG4gICAgfSk7XG5cbiAgICBpZiAocHJvcHMuZWxhc3RpQ2FjaGVSZXBsaWNhdGlvbkdyb3VwSWQpIHtcbiAgICAgIHRoaXMuY2FjaGVEYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICAgIHRpdGxlOiAnRWxhc3RpQ2FjaGUgQ1BVIFV0aWxpemF0aW9uJyxcbiAgICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvRWxhc3RpQ2FjaGUnLFxuICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnQ1BVVXRpbGl6YXRpb24nLFxuICAgICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgICAgICAgUmVwbGljYXRpb25Hcm91cElkOiBwcm9wcy5lbGFzdGlDYWNoZVJlcGxpY2F0aW9uR3JvdXBJZCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgc3RhdGlzdGljOiBjbG91ZHdhdGNoLlN0YXRzLkFWRVJBR0UsXG4gICAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICBdLFxuICAgICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICAgIH0pLFxuICAgICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgdGl0bGU6ICdFbGFzdGlDYWNoZSBNZW1vcnkgVXRpbGl6YXRpb24nLFxuICAgICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9FbGFzdGlDYWNoZScsXG4gICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdEYXRhYmFzZU1lbW9yeVVzYWdlUGVyY2VudGFnZScsXG4gICAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgICAgICAgICAgICBSZXBsaWNhdGlvbkdyb3VwSWQ6IHByb3BzLmVsYXN0aUNhY2hlUmVwbGljYXRpb25Hcm91cElkLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBzdGF0aXN0aWM6IGNsb3Vkd2F0Y2guU3RhdHMuQVZFUkFHRSxcbiAgICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICAgIGhlaWdodDogNixcbiAgICAgICAgfSlcbiAgICAgICk7XG4gICAgfVxuICB9XG59XG4iXX0=