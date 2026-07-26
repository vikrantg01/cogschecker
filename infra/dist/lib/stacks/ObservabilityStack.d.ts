import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
export interface ObservabilityStackProps extends cdk.StackProps {
    readonly envName: string;
    readonly alarmEmail?: string;
    readonly ecsCluster?: ecs.ICluster;
    readonly ecsService?: ecs.IService;
    readonly alb?: elbv2.IApplicationLoadBalancer;
}
export declare class ObservabilityStack extends cdk.Stack {
    readonly apiLogGroup: logs.LogGroup;
    readonly alarmTopic: sns.Topic;
    readonly ecsCpuAlarm?: cloudwatch.Alarm;
    readonly ecsMemoryAlarm?: cloudwatch.Alarm;
    readonly albUnhealthyHostAlarm?: cloudwatch.Alarm;
    readonly alb5xxErrorAlarm?: cloudwatch.Alarm;
    constructor(scope: Construct, id: string, props: ObservabilityStackProps);
}
