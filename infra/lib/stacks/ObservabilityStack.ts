import * as cdk from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

export interface ObservabilityStackProps extends cdk.StackProps {
  readonly envName: string;
  readonly alarmEmail?: string;
  readonly ecsCluster?: ecs.ICluster;
  readonly ecsService?: ecs.IService;
  readonly alb?: elbv2.IApplicationLoadBalancer;
}

export class ObservabilityStack extends cdk.Stack {
  public readonly apiLogGroup: logs.LogGroup;
  public readonly alarmTopic: sns.Topic;
  public readonly ecsCpuAlarm?: cloudwatch.Alarm;
  public readonly ecsMemoryAlarm?: cloudwatch.Alarm;
  public readonly albUnhealthyHostAlarm?: cloudwatch.Alarm;
  public readonly alb5xxErrorAlarm?: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
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
      this.alarmTopic.addSubscription(
        new sns_subscriptions.EmailSubscription(props.alarmEmail)
      );
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
      const albFullName = (props.alb as elbv2.ApplicationLoadBalancer).loadBalancerFullName;

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
    const notifications: any[] = [];
    
    if (props.alarmEmail) {
      notifications.push(
        {
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
        },
        {
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
        }
      );
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
