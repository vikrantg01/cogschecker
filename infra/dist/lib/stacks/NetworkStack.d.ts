import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
export interface NetworkStackProps extends cdk.StackProps {
    /** Logical environment name, e.g. "staging" or "prod". Used for naming. */
    readonly envName: string;
}
/**
 * NetworkStack
 *
 * Provisions the foundational network layer for the Food Cost Calculator:
 *
 *  • VPC spanning 3 Availability Zones
 *  • 2 public subnets  (1 per AZ for first two AZs)  — ALB, NAT gateway EIPs
 *  • 4 private subnets (across 3 AZs)               — EKS nodes, Aurora, ElastiCache
 *  • 1 NAT gateway per AZ (high-availability outbound internet for private subnets)
 *  • Baseline security groups for: ALB, EKS nodes, Aurora PostgreSQL, ElastiCache Redis
 *
 * Satisfies Requirements: 10.1 (multi-venue/multi-AZ), 10.3 (data isolation via subnet scoping)
 */
export declare class NetworkStack extends cdk.Stack {
    /** The VPC shared by all downstream stacks. */
    readonly vpc: ec2.Vpc;
    /** Security group for the Application Load Balancer (internet-facing). */
    readonly albSecurityGroup: ec2.SecurityGroup;
    /** Security group for EKS worker nodes (API and worker pods). */
    readonly eksNodeSecurityGroup: ec2.SecurityGroup;
    /**
     * Security group for the Aurora PostgreSQL cluster.
     * Only accepts connections from EKS nodes on port 5432.
     */
    readonly auroraSecurityGroup: ec2.SecurityGroup;
    /**
     * Security group for the ElastiCache Redis cluster.
     * Only accepts connections from EKS nodes on port 6379.
     */
    readonly elastiCacheSecurityGroup: ec2.SecurityGroup;
    constructor(scope: Construct, id: string, props: NetworkStackProps);
}
