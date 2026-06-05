import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import { Construct } from 'constructs';
export interface CacheStackProps extends cdk.StackProps {
    /** Logical environment name, e.g. "staging" or "prod". Used for naming. */
    readonly envName: string;
    /** The VPC in which to deploy the ElastiCache cluster. */
    readonly vpc: ec2.IVpc;
    /** Security group that allows EKS nodes to connect to Redis (port 6379). */
    readonly elastiCacheSecurityGroup: ec2.ISecurityGroup;
}
/**
 * CacheStack
 *
 * Provisions an Amazon ElastiCache for Redis cluster for the Food Cost Calculator:
 *
 *  • Redis 7.x cluster mode enabled
 *  • Two shards (node groups) for horizontal partitioning
 *  • Two replicas per shard for high availability (3 nodes per shard: 1 primary + 2 replicas)
 *  • Multi-AZ replication groups — replicas spread across availability zones
 *  • Automatic failover enabled — ElastiCache promotes a replica to primary on primary failure
 *  • Deployed in private data subnets with no internet access
 *  • Access restricted to EKS nodes via security group ingress rule (defined in NetworkStack)
 *
 * Usage:
 *  - Session token store for Spring Boot API pods (Spring Session Redis)
 *  - Redis pub/sub channel for real-time cost propagation events (venue:{venueId}:costs)
 *  - Query result cache for expensive read operations (recipe costing reports, cross-venue summaries)
 *
 * Satisfies Requirements: 3.3 (cost propagation within 2 seconds)
 */
export declare class CacheStack extends cdk.Stack {
    /**
     * The ElastiCache Redis replication group.
     * Export the configuration endpoint for cluster-mode clients.
     */
    readonly replicationGroup: elasticache.CfnReplicationGroup;
    /**
     * The subnet group used by ElastiCache.
     * Placed in private data subnets (same subnets as Aurora for simplicity).
     */
    readonly subnetGroup: elasticache.CfnSubnetGroup;
    constructor(scope: Construct, id: string, props: CacheStackProps);
}
