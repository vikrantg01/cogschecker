import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import { Construct } from 'constructs';
export interface CacheStackProps extends cdk.StackProps {
    /** Logical environment name, e.g. "staging" or "prod". Used for naming. */
    readonly envName: string;
    /** The VPC in which to deploy the ElastiCache Redis instance. */
    readonly vpc: ec2.IVpc;
    /** Security group that allows ECS tasks to connect to Redis (port 6379). */
    readonly redisSecurityGroup: ec2.ISecurityGroup;
}
/**
 * CacheStack
 *
 * Cost-optimized Amazon ElastiCache for Redis for the Food Cost Calculator:
 *
 *  • Redis 7.0+ single-node (no replication) for cost optimization
 *  • cache.t4g.micro (ARM-based Graviton2, burstable performance)
 *  • Encryption at rest (AWS-managed KMS keys)
 *  • Encryption in transit (TLS required)
 *  • Deployed in private isolated subnets with no internet access
 *  • Access restricted to ECS tasks via security group ingress rule (defined in NetworkStackOptimized)
 *  • Subnet group spans both private isolated subnets (ready for multi-AZ expansion)
 *
 * Usage:
 *  - Session storage for Spring Boot API (Spring Session Redis)
 *  - Query result cache for expensive read operations
 *
 * Cost savings vs clustered Redis:
 *  - Single node: ~$12-15/month
 *  - Cluster with replication: ~$70-90/month
 *  - **Savings: $55-75/month** (80% reduction)
 *
 * Trade-offs:
 *  - No automatic failover (single node)
 *  - No read replicas (all reads/writes on primary)
 *  - Manual recovery required on node failure
 *
 * For 2 initial venues, single-node cache.t4g.micro is sufficient.
 *
 * Satisfies Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */
export declare class CacheStack extends cdk.Stack {
    /**
     * The ElastiCache Redis replication group (single node).
     * Export the primary endpoint for client connections.
     */
    readonly replicationGroup: elasticache.CfnReplicationGroup;
    /**
     * The subnet group used by ElastiCache.
     * Placed in private isolated subnets (same subnets as RDS).
     */
    readonly subnetGroup: elasticache.CfnSubnetGroup;
    constructor(scope: Construct, id: string, props: CacheStackProps);
}
