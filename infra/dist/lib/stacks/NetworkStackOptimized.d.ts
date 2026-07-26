import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
export interface NetworkStackOptimizedProps extends cdk.StackProps {
    /** Logical environment name, e.g. "staging" or "prod" */
    readonly envName: string;
}
/**
 * NetworkStackOptimized
 *
 * Cost-optimized network stack for ECS-based deployment:
 *
 *  • VPC spanning 2 Availability Zones (sufficient for HA)
 *  • 2 public subnets (ALB)
 *  • 2 private subnets with NAT egress (ECS tasks)
 *  • 2 private isolated subnets (RDS, Redis)
 *  • **1 NAT Gateway** (not 2) for cost savings
 *  • Security groups for ALB, ECS, RDS, Redis
 *
 * Cost savings vs NetworkStack:
 *  - 1 NAT gateway vs 2: Save $35/month
 *  - 2 AZs vs 3: Simpler, sufficient for HA
 *
 * Trade-off:
 *  - Single NAT gateway = single point of failure for internet egress
 *  - If NAT fails, ECS tasks can't reach internet (AWS services, Docker Hub)
 *  - For production, consider 2 NAT gateways or VPC endpoints
 */
export declare class NetworkStackOptimized extends cdk.Stack {
    /** The VPC */
    readonly vpc: ec2.Vpc;
    /** Security group for ALB */
    readonly albSecurityGroup: ec2.SecurityGroup;
    /** Security group for ECS tasks */
    readonly ecsSecurityGroup: ec2.SecurityGroup;
    /** Security group for RDS */
    readonly rdsSecurityGroup: ec2.SecurityGroup;
    /** Security group for ElastiCache Redis */
    readonly redisSecurityGroup: ec2.SecurityGroup;
    /** CloudWatch log group for VPC Flow Logs */
    readonly flowLogsLogGroup: logs.LogGroup;
    constructor(scope: Construct, id: string, props: NetworkStackOptimizedProps);
}
