import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
export interface EcsStackProps extends cdk.StackProps {
    /** Logical environment name, e.g. "staging" or "prod" */
    readonly envName: string;
    /** VPC where ECS will be deployed */
    readonly vpc: ec2.IVpc;
    /** Security group for ECS tasks */
    readonly ecsSecurityGroup: ec2.ISecurityGroup;
    /** Security group for ALB */
    readonly albSecurityGroup: ec2.ISecurityGroup;
    /** Database endpoint (RDS or Aurora) */
    readonly databaseEndpoint: string;
    /** Database secret ARN */
    readonly databaseSecretArn: string;
    /** Redis endpoint (ElastiCache) */
    readonly redisEndpoint: string;
    /** Cognito User Pool ID */
    readonly cognitoUserPoolId: string;
    /** Cognito Client ID */
    readonly cognitoClientId: string;
}
/**
 * EcsStack
 *
 * Cost-optimized compute stack using ECS Fargate instead of EKS:
 *
 *  • ECS Cluster with Fargate capacity provider
 *  • ECR repository for Docker images
 *  • Application Load Balancer (public subnets)
 *  • ECS Service with Fargate tasks (private subnets)
 *  • Auto-scaling based on CPU/memory
 *  • IAM task roles with least privilege
 *  • CloudWatch Logs integration
 *
 * Cost savings vs EKS:
 *  - No $72/month control plane fee
 *  - Pay only for task CPU/memory (not idle nodes)
 *  - Automatic capacity management
 *
 * Expected cost: $45-90/month for 2 tasks
 */
export declare class EcsStack extends cdk.Stack {
    /** The ECS cluster */
    readonly cluster: ecs.Cluster;
    /** The ECR repository */
    readonly repository: ecr.Repository;
    /** The Application Load Balancer */
    readonly alb: elbv2.ApplicationLoadBalancer;
    /** The ECS service */
    readonly service: ecs.FargateService;
    /** The ALB DNS name */
    readonly albDnsName: string;
    constructor(scope: Construct, id: string, props: EcsStackProps);
}
