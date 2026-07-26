"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObservabilityStack = void 0;
const cdk = require("aws-cdk-lib");
const budgets = require("aws-cdk-lib/aws-budgets");
const cloudwatch = require("aws-cdk-lib/aws-cloudwatch");
const cloudwatch_actions = require("aws-cdk-lib/aws-cloudwatch-actions");
const logs = require("aws-cdk-lib/aws-logs");
const sns = require("aws-cdk-lib/aws-sns");
const sns_subscriptions = require("aws-cdk-lib/aws-sns-subscriptions");
class ObservabilityStack extends cdk.Stack {
    apiLogGroup;
    alarmTopic;
    ecsCpuAlarm;
    ecsMemoryAlarm;
    albUnhealthyHostAlarm;
    alb5xxErrorAlarm;
    constructor(scope, id, props) {
        super(scope, id, props);
        const { envName } = props;
        this.apiLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
            logGroupName: `/ecs/foodcost-api-${envName}`,
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
            topicName: `foodcost-alarms-${envName}`,
            displayName: 'Food Cost Calculator Alarms',
        });
        if (props.alarmEmail) {
            this.alarmTopic.addSubscription(new sns_subscriptions.EmailSubscription(props.alarmEmail));
        }
        if (props.ecsCluster && props.ecsService) {
            this.ecsCpuAlarm = new cloudwatch.Alarm(this, 'EcsCpuAlarm', {
                alarmName: `fcc-ecs-cpu-${envName}`,
                alarmDescription: 'ECS service CPU utilization exceeds 85% for 2 consecutive 5-minute periods',
                metric: new cloudwatch.Metric({
                    namespace: 'AWS/ECS',
                    metricName: 'CPUUtilization',
                    dimensionsMap: {
                        ClusterName: props.ecsCluster.clusterName,
                        ServiceName: props.ecsService.serviceName,
                    },
                    statistic: cloudwatch.Stats.AVERAGE,
                    period: cdk.Duration.minutes(5),
                }),
                threshold: 85,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                evaluationPeriods: 2,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            this.ecsCpuAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alarmTopic));
            this.ecsMemoryAlarm = new cloudwatch.Alarm(this, 'EcsMemoryAlarm', {
                alarmName: `fcc-ecs-memory-${envName}`,
                alarmDescription: 'ECS service memory utilization exceeds 90% for 2 consecutive 5-minute periods',
                metric: new cloudwatch.Metric({
                    namespace: 'AWS/ECS',
                    metricName: 'MemoryUtilization',
                    dimensionsMap: {
                        ClusterName: props.ecsCluster.clusterName,
                        ServiceName: props.ecsService.serviceName,
                    },
                    statistic: cloudwatch.Stats.AVERAGE,
                    period: cdk.Duration.minutes(5),
                }),
                threshold: 90,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                evaluationPeriods: 2,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            this.ecsMemoryAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alarmTopic));
        }
        if (props.alb) {
            // Extract the load balancer suffix for CloudWatch metrics
            // The dimension format for ALB metrics is: app/load-balancer-name/1234567890123456
            // This comes from the loadBalancerFullName property on concrete ALB instances
            const albFullName = props.alb.loadBalancerFullName;
            // ALB Unhealthy Host Count Alarm
            // Requirement 8.6: Alert if > 0 for 2 consecutive 1-minute periods
            this.albUnhealthyHostAlarm = new cloudwatch.Alarm(this, 'AlbUnhealthyHostAlarm', {
                alarmName: `fcc-alb-unhealthy-hosts-${envName}`,
                alarmDescription: 'ALB unhealthy target count exceeds 0 for 2 consecutive 1-minute periods',
                metric: new cloudwatch.Metric({
                    namespace: 'AWS/ApplicationELB',
                    metricName: 'UnHealthyHostCount',
                    dimensionsMap: {
                        LoadBalancer: albFullName,
                    },
                    statistic: cloudwatch.Stats.MAXIMUM,
                    period: cdk.Duration.minutes(1),
                }),
                threshold: 0,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                evaluationPeriods: 2,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            this.albUnhealthyHostAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alarmTopic));
            // ALB 5xx Error Rate Alarm
            // Requirement 8.7: Alert if > 5% over 5-minute period
            // Calculate error rate as (5xx count / total request count) * 100
            const http5xxMetric = new cloudwatch.Metric({
                namespace: 'AWS/ApplicationELB',
                metricName: 'HTTPCode_Target_5XX_Count',
                dimensionsMap: {
                    LoadBalancer: albFullName,
                },
                statistic: cloudwatch.Stats.SUM,
                period: cdk.Duration.minutes(5),
            });
            const requestCountMetric = new cloudwatch.Metric({
                namespace: 'AWS/ApplicationELB',
                metricName: 'RequestCount',
                dimensionsMap: {
                    LoadBalancer: albFullName,
                },
                statistic: cloudwatch.Stats.SUM,
                period: cdk.Duration.minutes(5),
            });
            // Create a math expression for error rate percentage
            const errorRateMetric = new cloudwatch.MathExpression({
                expression: '(m1 / m2) * 100',
                usingMetrics: {
                    m1: http5xxMetric,
                    m2: requestCountMetric,
                },
                period: cdk.Duration.minutes(5),
            });
            this.alb5xxErrorAlarm = new cloudwatch.Alarm(this, 'Alb5xxErrorAlarm', {
                alarmName: `fcc-alb-5xx-errors-${envName}`,
                alarmDescription: 'ALB HTTP 5xx error rate exceeds 5% over 5-minute period',
                metric: errorRateMetric,
                threshold: 5,
                comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                evaluationPeriods: 1,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            this.alb5xxErrorAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alarmTopic));
        }
        // AWS Budget Configuration
        // Requirement 10.3: Budget with $200 monthly limit
        // Requirement 10.4: Alert thresholds at 80% ($160) and 100% ($200)
        // Note: Email notifications require ALARM_EMAIL environment variable
        const notifications = [];
        if (props.alarmEmail) {
            notifications.push({
                notification: {
                    notificationType: 'ACTUAL',
                    comparisonOperator: 'GREATER_THAN',
                    threshold: 80, // Alert at $160 (80% of $200)
                    thresholdType: 'PERCENTAGE',
                },
                subscribers: [
                    {
                        subscriptionType: 'EMAIL',
                        address: props.alarmEmail,
                    },
                ],
            }, {
                notification: {
                    notificationType: 'ACTUAL',
                    comparisonOperator: 'GREATER_THAN',
                    threshold: 100, // Alert at $200 (100% of $200)
                    thresholdType: 'PERCENTAGE',
                },
                subscribers: [
                    {
                        subscriptionType: 'EMAIL',
                        address: props.alarmEmail,
                    },
                ],
            });
        }
        new budgets.CfnBudget(this, 'MonthlyBudget', {
            budget: {
                budgetName: `foodcost-budget-${envName}`,
                budgetType: 'COST',
                timeUnit: 'MONTHLY',
                budgetLimit: {
                    amount: 200,
                    unit: 'USD',
                },
            },
            notificationsWithSubscribers: notifications.length > 0 ? notifications : undefined,
        });
        new cdk.CfnOutput(this, 'LogGroupName', {
            value: this.apiLogGroup.logGroupName,
            description: 'CloudWatch log group for ECS tasks',
            exportName: `FoodCostCalculator-${envName}-LogGroupName`,
        });
        new cdk.CfnOutput(this, 'AlarmTopicArn', {
            value: this.alarmTopic.topicArn,
            description: 'SNS topic ARN for alarm notifications',
            exportName: `FoodCostCalculator-${envName}-AlarmTopicArn`,
        });
        cdk.Tags.of(this).add('Component', 'Observability');
        cdk.Tags.of(this).add('CostCenter', 'FoodCostCalculator');
    }
}
exports.ObservabilityStack = ObservabilityStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiT2JzZXJ2YWJpbGl0eVN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vbGliL3N0YWNrcy9PYnNlcnZhYmlsaXR5U3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBQ25DLG1EQUFtRDtBQUNuRCx5REFBeUQ7QUFDekQseUVBQXlFO0FBR3pFLDZDQUE2QztBQUM3QywyQ0FBMkM7QUFDM0MsdUVBQXVFO0FBV3ZFLE1BQWEsa0JBQW1CLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDL0IsV0FBVyxDQUFnQjtJQUMzQixVQUFVLENBQVk7SUFDdEIsV0FBVyxDQUFvQjtJQUMvQixjQUFjLENBQW9CO0lBQ2xDLHFCQUFxQixDQUFvQjtJQUN6QyxnQkFBZ0IsQ0FBb0I7SUFFcEQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUE4QjtRQUN0RSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsT0FBTyxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRTFCLElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDeEQsWUFBWSxFQUFFLHFCQUFxQixPQUFPLEVBQUU7WUFDNUMsU0FBUyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUTtZQUN0QyxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1NBQ3pDLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxVQUFVLEdBQUcsSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7WUFDbEQsU0FBUyxFQUFFLG1CQUFtQixPQUFPLEVBQUU7WUFDdkMsV0FBVyxFQUFFLDZCQUE2QjtTQUMzQyxDQUFDLENBQUM7UUFFSCxJQUFJLEtBQUssQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUNyQixJQUFJLENBQUMs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QUNwQyxXQUFXLEVBQUUsb0NBQW9DO1lBQ2pELFVBQVUsRUFBRSxzQkFBc0IsT0FBTyxlQUFlO1NBQ3pELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQ3ZDLEtBQUssRUFBRSxJQUFJLENBQUMsVUFBVSxDQUFDLFFBQVE7WUFDL0IsV0FBVyxFQUFFLHVDQUF1QztZQUNwRCxVQUFVLEVBQUUsc0JBQXNCLE9BQU8sZ0JBQWdCO1NBQzFELENBQUMsQ0FBQztRQUVILEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsZUFBZSxDQUFDLENBQUM7UUFDcEQsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLFlBQVksRUFBRSxvQkFBb0IsQ0FBQyxDQUFDO0lBQzVELENBQUM7Q0FDRjtBQXZORCxnREF1TkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgYnVkZ2V0cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYnVkZ2V0cyc7XG5pbXBvcnQgKiBhcyBjbG91ZHdhdGNoIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZHdhdGNoJztcbmltcG9ydCAqIGFzIGNsb3Vkd2F0Y2hfYWN0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaC1hY3Rpb25zJztcbmltcG9ydCAqIGFzIGVjcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNzJztcbmltcG9ydCAqIGFzIGVsYnYyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lbGFzdGljbG9hZGJhbGFuY2luZ3YyJztcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0ICogYXMgc25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMnO1xuaW1wb3J0ICogYXMgc25zX3N1YnNjcmlwdGlvbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucy1zdWJzY3JpcHRpb25zJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIE9ic2VydmFiaWxpdHlTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICByZWFkb25seSBlbnZOYW1lOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGFsYXJtRW1haWw/OiBzdHJpbmc7XG4gIHJlYWRvbmx5IGVjc0NsdXN0ZXI/OiBlY3MuSUNsdXN0ZXI7XG4gIHJlYWRvbmx5IGVjc1NlcnZpY2U/OiBlY3MuSVNlcnZpY2U7XG4gIHJlYWRvbmx5IGFsYj86IGVsYnYyLklBcHBsaWNhdGlvbkxvYWRCYWxhbmNlcjtcbn1cblxuZXhwb3J0IGNsYXNzIE9ic2VydmFiaWxpdHlTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBhcGlMb2dHcm91cDogbG9ncy5Mb2dHcm91cDtcbiAgcHVibGljIHJlYWRvbmx5IGFsYXJtVG9waWM6IHNucy5Ub3BpYztcbiAgcHVibGljIHJlYWRvbmx5IGVjc0NwdUFsYXJtPzogY2xvdWR3YXRjaC5BbGFybTtcbiAgcHVibGljIHJlYWRvbmx5IGVjc01lbW9yeUFsYXJtPzogY2xvdWR3YXRjaC5BbGFybTtcbiAgcHVibGljIHJlYWRvbmx5IGFsYlVuaGVhbHRoeUhvc3RBbGFybT86IGNsb3Vkd2F0Y2guQWxhcm07XG4gIHB1YmxpYyByZWFkb25seSBhbGI1eHhFcnJvckFsYXJtPzogY2xvdWR3YXRjaC5BbGFybTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogT2JzZXJ2YWJpbGl0eVN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgZW52TmFtZSB9ID0gcHJvcHM7XG5cbiAgICB0aGlzLmFwaUxvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgJ0FwaUxvZ0dyb3VwJywge1xuICAgICAgbG9nR3JvdXBOYW1lOiBgL2Vjcy9mb29kY29zdC1hcGktJHtlbnZOYW1lfWAsXG4gICAgICByZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICB0aGlzLmFsYXJtVG9waWMgPSBuZXcgc25zLlRvcGljKHRoaXMsICdBbGFybVRvcGljJywge1xuICAgICAgdG9waWNOYW1lOiBgZm9vZGNvc3QtYWxhcm1zLSR7ZW52TmFtZX1gLFxuICAgICAgZGlzcGxheU5hbWU6ICdGb29kIENvc3QgQ2FsY3VsYXRvciBBbGFybXMnLFxuICAgIH0pO1xuXG4gICAgaWYgKHByb3BzLmFsYXJtRW1haWwpIHtcbiAgICAgIHRoaXMuYWxhcm1Ub3BpYy5hZGRTdWJzY3JpcHRpb24oXG4gICAgICAgIG5ldyBzbnNfc3Vic2NyaXB0aW9ucy5FbWFpbFN1YnNjcmlwdGlvbihwcm9wcy5hbGFybUVtYWlsKVxuICAgICAgKTtcbiAgICB9XG5cbiAgICBpZiAocHJvcHMuZWNzQ2x1c3RlciAmJiBwcm9wcy5lY3NTZXJ2aWNlKSB7XG4gICAgICB0aGlzLmVjc0NwdUFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0Vjc0NwdUFsYXJtJywge1xuICAgICAgICBhbGFybU5hbWU6IGBmY2MtZWNzLWNwdS0ke2Vudk5hbWV9YCxcbiAgICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0VDUyBzZXJ2aWNlIENQVSB1dGlsaXphdGlvbiBleGNlZWRzIDg1JSBmb3IgMiBjb25zZWN1dGl2ZSA1LW1pbnV0ZSBwZXJpb2RzJyxcbiAgICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9FQ1MnLFxuICAgICAgICAgIG1ldHJpY05hbWU6ICdDUFVVdGlsaXphdGlvbicsXG4gICAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgICAgQ2x1c3Rlck5hbWU6IHByb3BzLmVjc0NsdXN0ZXIuY2x1c3Rlck5hbWUsXG4gICAgICAgICAgICBTZXJ2aWNlTmFtZTogcHJvcHMuZWNzU2VydmljZS5zZXJ2aWNlTmFtZSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHN0YXRpc3RpYzogY2xvdWR3YXRjaC5TdGF0cy5BVkVSQUdFLFxuICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIH0pLFxuICAgICAgICB0aHJlc2hvbGQ6IDg1LFxuICAgICAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9USFJFU0hPTEQsXG4gICAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAyLFxuICAgICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLmVjc0NwdUFsYXJtLmFkZEFsYXJtQWN0aW9uKG5ldyBjbG91ZHdhdGNoX2FjdGlvbnMuU25zQWN0aW9uKHRoaXMuYWxhcm1Ub3BpYykpO1xuXG4gICAgICB0aGlzLmVjc01lbW9yeUFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0Vjc01lbW9yeUFsYXJtJywge1xuICAgICAgICBhbGFybU5hbWU6IGBmY2MtZWNzLW1lbW9yeS0ke2Vudk5hbWV9YCxcbiAgICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0VDUyBzZXJ2aWNlIG1lbW9yeSB1dGlsaXphdGlvbiBleGNlZWRzIDkwJSBmb3IgMiBjb25zZWN1dGl2ZSA1LW1pbnV0ZSBwZXJpb2RzJyxcbiAgICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9FQ1MnLFxuICAgICAgICAgIG1ldHJpY05hbWU6ICdNZW1vcnlVdGlsaXphdGlvbicsXG4gICAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgICAgQ2x1c3Rlck5hbWU6IHByb3BzLmVjc0NsdXN0ZXIuY2x1c3Rlck5hbWUsXG4gICAgICAgICAgICBTZXJ2aWNlTmFtZTogcHJvcHMuZWNzU2VydmljZS5zZXJ2aWNlTmFtZSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHN0YXRpc3RpYzogY2xvdWR3YXRjaC5TdGF0cy5BVkVSQUdFLFxuICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIH0pLFxuICAgICAgICB0aHJlc2hvbGQ6IDkwLFxuICAgICAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9USFJFU0hPTEQsXG4gICAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAyLFxuICAgICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLmVjc01lbW9yeUFsYXJtLmFkZEFsYXJtQWN0aW9uKG5ldyBjbG91ZHdhdGNoX2FjdGlvbnMuU25zQWN0aW9uKHRoaXMuYWxhcm1Ub3BpYykpO1xuICAgIH1cblxuICAgIGlmIChwcm9wcy5hbGIpIHtcbiAgICAgIC8vIEV4dHJhY3QgdGhlIGxvYWQgYmFsYW5jZXIgc3VmZml4IGZvciBDbG91ZFdhdGNoIG1ldHJpY3NcbiAgICAgIC8vIFRoZSBkaW1lbnNpb24gZm9ybWF0IGZvciBBTEIgbWV0cmljcyBpczogYXBwL2xvYWQtYmFsYW5jZXItbmFtZS8xMjM0NTY3ODkwMTIzNDU2XG4gICAgICAvLyBUaGlzIGNvbWVzIGZyb20gdGhlIGxvYWRCYWxhbmNlckZ1bGxOYW1lIHByb3BlcnR5IG9uIGNvbmNyZXRlIEFMQiBpbnN0YW5jZXNcbiAgICAgIGNvbnN0IGFsYkZ1bGxOYW1lID0gKHByb3BzLmFsYiBhcyBlbGJ2Mi5BcHBsaWNhdGlvbkxvYWRCYWxhbmNlcikubG9hZEJhbGFuY2VyRnVsbE5hbWU7XG5cbiAgICAgIC8vIEFMQiBVbmhlYWx0aHkgSG9zdCBDb3VudCBBbGFybVxuICAgICAgLy8gUmVxdWlyZW1lbnQgOC42OiBBbGVydCBpZiA+IDAgZm9yIDIgY29uc2VjdXRpdmUgMS1taW51dGUgcGVyaW9kc1xuICAgICAgdGhpcy5hbGJVbmhlYWx0aHlIb3N0QWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnQWxiVW5oZWFsdGh5SG9zdEFsYXJtJywge1xuICAgICAgICBhbGFybU5hbWU6IGBmY2MtYWxiLXVuaGVhbHRoeS1ob3N0cy0ke2Vudk5hbWV9YCxcbiAgICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FMQiB1bmhlYWx0aHkgdGFyZ2V0IGNvdW50IGV4Y2VlZHMgMCBmb3IgMiBjb25zZWN1dGl2ZSAxLW1pbnV0ZSBwZXJpb2RzJyxcbiAgICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9BcHBsaWNhdGlvbkVMQicsXG4gICAgICAgICAgbWV0cmljTmFtZTogJ1VuSGVhbHRoeUhvc3RDb3VudCcsXG4gICAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgICAgTG9hZEJhbGFuY2VyOiBhbGJGdWxsTmFtZSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHN0YXRpc3RpYzogY2xvdWR3YXRjaC5TdGF0cy5NQVhJTVVNLFxuICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMSksXG4gICAgICAgIH0pLFxuICAgICAgICB0aHJlc2hvbGQ6IDAsXG4gICAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX1RIUkVTSE9MRCxcbiAgICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDIsXG4gICAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgICAgfSk7XG5cbiAgICAgIHRoaXMuYWxiVW5oZWFsdGh5SG9zdEFsYXJtLmFkZEFsYXJtQWN0aW9uKG5ldyBjbG91ZHdhdGNoX2FjdGlvbnMuU25zQWN0aW9uKHRoaXMuYWxhcm1Ub3BpYykpO1xuXG4gICAgICAvLyBBTEIgNXh4IEVycm9yIFJhdGUgQWxhcm1cbiAgICAgIC8vIFJlcXVpcmVtZW50IDguNzogQWxlcnQgaWYgPiA1JSBvdmVyIDUtbWludXRlIHBlcmlvZFxuICAgICAgLy8gQ2FsY3VsYXRlIGVycm9yIHJhdGUgYXMgKDV4eCBjb3VudCAvIHRvdGFsIHJlcXVlc3QgY291bnQpICogMTAwXG4gICAgICBjb25zdCBodHRwNXh4TWV0cmljID0gbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgbmFtZXNwYWNlOiAnQVdTL0FwcGxpY2F0aW9uRUxCJyxcbiAgICAgICAgbWV0cmljTmFtZTogJ0hUVFBDb2RlX1RhcmdldF81WFhfQ291bnQnLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgTG9hZEJhbGFuY2VyOiBhbGJGdWxsTmFtZSxcbiAgICAgICAgfSxcbiAgICAgICAgc3RhdGlzdGljOiBjbG91ZHdhdGNoLlN0YXRzLlNVTSxcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCByZXF1ZXN0Q291bnRNZXRyaWMgPSBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdBV1MvQXBwbGljYXRpb25FTEInLFxuICAgICAgICBtZXRyaWNOYW1lOiAnUmVxdWVzdENvdW50JyxcbiAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgIExvYWRCYWxhbmNlcjogYWxiRnVsbE5hbWUsXG4gICAgICAgIH0sXG4gICAgICAgIHN0YXRpc3RpYzogY2xvdWR3YXRjaC5TdGF0cy5TVU0sXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICB9KTtcblxuICAgICAgLy8gQ3JlYXRlIGEgbWF0aCBleHByZXNzaW9uIGZvciBlcnJvciByYXRlIHBlcmNlbnRhZ2VcbiAgICAgIGNvbnN0IGVycm9yUmF0ZU1ldHJpYyA9IG5ldyBjbG91ZHdhdGNoLk1hdGhFeHByZXNzaW9uKHtcbiAgICAgICAgZXhwcmVzc2lvbjogJyhtMSAvIG0yKSAqIDEwMCcsXG4gICAgICAgIHVzaW5nTWV0cmljczoge1xuICAgICAgICAgIG0xOiBodHRwNXh4TWV0cmljLFxuICAgICAgICAgIG0yOiByZXF1ZXN0Q291bnRNZXRyaWMsXG4gICAgICAgIH0sXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICB9KTtcblxuICAgICAgdGhpcy5hbGI1eHhFcnJvckFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0FsYjV4eEVycm9yQWxhcm0nLCB7XG4gICAgICAgIGFsYXJtTmFtZTogYGZjYy1hbGItNXh4LWVycm9ycy0ke2Vudk5hbWV9YCxcbiAgICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FMQiBIVFRQIDV4eCBlcnJvciByYXRlIGV4Y2VlZHMgNSUgb3ZlciA1LW1pbnV0ZSBwZXJpb2QnLFxuICAgICAgICBtZXRyaWM6IGVycm9yUmF0ZU1ldHJpYyxcbiAgICAgICAgdGhyZXNob2xkOiA1LFxuICAgICAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9USFJFU0hPTEQsXG4gICAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLmFsYjV4eEVycm9yQWxhcm0uYWRkQWxhcm1BY3Rpb24obmV3IGNsb3Vkd2F0Y2hfYWN0aW9ucy5TbnNBY3Rpb24odGhpcy5hbGFybVRvcGljKSk7XG4gICAgfVxuXG4gICAgLy8gQVdTIEJ1ZGdldCBDb25maWd1cmF0aW9uXG4gICAgLy8gUmVxdWlyZW1lbnQgMTAuMzogQnVkZ2V0IHdpdGggJDIwMCBtb250aGx5IGxpbWl0XG4gICAgLy8gUmVxdWlyZW1lbnQgMTAuNDogQWxlcnQgdGhyZXNob2xkcyBhdCA4MCUgKCQxNjApIGFuZCAxMDAlICgkMjAwKVxuICAgIC8vIE5vdGU6IEVtYWlsIG5vdGlmaWNhdGlvbnMgcmVxdWlyZSBBTEFSTV9FTUFJTCBlbnZpcm9ubWVudCB2YXJpYWJsZVxuICAgIGNvbnN0IG5vdGlmaWNhdGlvbnM6IGFueVtdID0gW107XG4gICAgXG4gICAgaWYgKHByb3BzLmFsYXJtRW1haWwpIHtcbiAgICAgIG5vdGlmaWNhdGlvbnMucHVzaChcbiAgICAgICAge1xuICAgICAgICAgIG5vdGlmaWNhdGlvbjoge1xuICAgICAgICAgICAgbm90aWZpY2F0aW9uVHlwZTogJ0FDVFVBTCcsXG4gICAgICAgICAgICBjb21wYXJpc29uT3BlcmF0b3I6ICdHUkVBVEVSX1RIQU4nLFxuICAgICAgICAgICAgdGhyZXNob2xkOiA4MCwgLy8gQWxlcnQgYXQgJDE2MCAoODAlIG9mICQyMDApXG4gICAgICAgICAgICB0aHJlc2hvbGRUeXBlOiAnUEVSQ0VOVEFHRScsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzdWJzY3JpYmVyczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzdWJzY3JpcHRpb25UeXBlOiAnRU1BSUwnLFxuICAgICAgICAgICAgICBhZGRyZXNzOiBwcm9wcy5hbGFybUVtYWlsLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgbm90aWZpY2F0aW9uOiB7XG4gICAgICAgICAgICBub3RpZmljYXRpb25UeXBlOiAnQUNUVUFMJyxcbiAgICAgICAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogJ0dSRUFURVJfVEhBTicsXG4gICAgICAgICAgICB0aHJlc2hvbGQ6IDEwMCwgLy8gQWxlcnQgYXQgJDIwMCAoMTAwJSBvZiAkMjAwKVxuICAgICAgICAgICAgdGhyZXNob2xkVHlwZTogJ1BFUkNFTlRBR0UnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgc3Vic2NyaWJlcnM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3Vic2NyaXB0aW9uVHlwZTogJ0VNQUlMJyxcbiAgICAgICAgICAgICAgYWRkcmVzczogcHJvcHMuYWxhcm1FbWFpbCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfVxuICAgICAgKTtcbiAgICB9XG5cbiAgICBuZXcgYnVkZ2V0cy5DZm5CdWRnZXQodGhpcywgJ01vbnRobHlCdWRnZXQnLCB7XG4gICAgICBidWRnZXQ6IHtcbiAgICAgICAgYnVkZ2V0TmFtZTogYGZvb2Rjb3N0LWJ1ZGdldC0ke2Vudk5hbWV9YCxcbiAgICAgICAgYnVkZ2V0VHlwZTogJ0NPU1QnLFxuICAgICAgICB0aW1lVW5pdDogJ01PTlRITFknLFxuICAgICAgICBidWRnZXRMaW1pdDoge1xuICAgICAgICAgIGFtb3VudDogMjAwLFxuICAgICAgICAgIHVuaXQ6ICdVU0QnLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIG5vdGlmaWNhdGlvbnNXaXRoU3Vic2NyaWJlcnM6IG5vdGlmaWNhdGlvbnMubGVuZ3RoID4gMCA/IG5vdGlmaWNhdGlvbnMgOiB1bmRlZmluZWQsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTG9nR3JvdXBOYW1lJywge1xuICAgICAgdmFsdWU6IHRoaXMuYXBpTG9nR3JvdXAubG9nR3JvdXBOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZFdhdGNoIGxvZyBncm91cCBmb3IgRUNTIHRhc2tzJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1Mb2dHcm91cE5hbWVgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FsYXJtVG9waWNBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5hbGFybVRvcGljLnRvcGljQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdTTlMgdG9waWMgQVJOIGZvciBhbGFybSBub3RpZmljYXRpb25zJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1BbGFybVRvcGljQXJuYCxcbiAgICB9KTtcblxuICAgIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnQ29tcG9uZW50JywgJ09ic2VydmFiaWxpdHknKTtcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ0Nvc3RDZW50ZXInLCAnRm9vZENvc3RDYWxjdWxhdG9yJyk7XG4gIH1cbn1cbiJdfQ==