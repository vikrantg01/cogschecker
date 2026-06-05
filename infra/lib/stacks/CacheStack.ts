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
export class CacheStack extends cdk.Stack {
  /**
   * The ElastiCache Redis replication group.
   * Export the configuration endpoint for cluster-mode clients.
   */
  public readonly replicationGroup: elasticache.CfnReplicationGroup;

  /**
   * The subnet group used by ElastiCache.
   * Placed in private data subnets (same subnets as Aurora for simplicity).
   */
  public readonly subnetGroup: elasticache.CfnSubnetGroup;

  constructor(scope: Construct, id: string, props: CacheStackProps) {
    super(scope, id, props);

    const { envName, vpc, elastiCacheSecurityGroup } = props;

    // ── Subnet Group ─────────────────────────────────────────────────────────
    //
    // ElastiCache requires an explicit subnet group.
    // We place the Redis cluster in the private data subnets (same as Aurora),
    // isolated from the internet.
    const privateDataSubnets = vpc.selectSubnets({
      subnetGroupName: 'private-data',
    });

    this.subnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      subnetIds: privateDataSubnets.subnetIds,
      description: `ElastiCache Redis subnet group for Food Cost Calculator (${envName})`,
      cacheSubnetGroupName: `fcc-redis-${envName}`,
    });

    // ── Parameter Group ──────────────────────────────────────────────────────
    //
    // Custom parameter group for Redis 7.x cluster mode.
    // Enable cluster mode and set reasonable defaults for pub/sub and cache use cases.
    const parameterGroup = new elasticache.CfnParameterGroup(this, 'RedisParameterGroup', {
      cacheParameterGroupFamily: 'redis7.cluster.on', // Redis 7.x with cluster mode enabled
      description: `Food Cost Calculator Redis 7 cluster parameters (${envName})`,
      properties: {
        // Enable Redis pub/sub for cost propagation events.
        // Default notify-keyspace-events is empty; we enable all notification types.
        'notify-keyspace-events': 'AKE',

        // Max memory policy: evict least-recently-used keys when memory is full.
        // This is suitable for a cache + pub/sub workload (pub/sub messages are
        // transient and never evicted; cached query results can be evicted).
        'maxmemory-policy': 'allkeys-lru',

        // Timeout for idle connections (default 0 = no timeout).
        // Set to 5 minutes to clean up stale connections.
        'timeout': '300',
      },
    });

    // ── Replication Group (Redis Cluster) ────────────────────────────────────
    //
    // Multi-AZ replication group with cluster mode enabled.
    //
    // Configuration:
    //   - 2 shards (numNodeGroups)
    //   - 2 replicas per shard (replicasPerNodeGroup) — total 3 nodes per shard
    //   - cache.t4g.micro for staging; cache.r7g.large for prod (ARM-based Graviton2)
    //   - Automatic failover enabled (ElastiCache auto-promotes replica on primary failure)
    //   - Multi-AZ enabled (replicas distributed across availability zones)
    //   - At-rest encryption enabled (default CMK)
    //   - In-transit encryption (TLS) enabled
    //   - Automatic minor version upgrades enabled
    //   - Maintenance window: Sunday 03:00–04:00 UTC
    //   - Snapshot retention: 7 days (for disaster recovery)
    //   - Daily snapshot window: 02:00–03:00 UTC
    //
    // Total cluster size:
    //   2 shards × 3 nodes per shard = 6 nodes (2 primaries, 4 replicas)

    this.replicationGroup = new elasticache.CfnReplicationGroup(this, 'RedisCluster', {
      replicationGroupId: `fcc-redis-${envName}`,
      replicationGroupDescription: `Food Cost Calculator Redis cluster (${envName})`,

      // ── Engine Configuration ───────────────────────────────────────────────
      engine: 'redis',
      engineVersion: '7.1', // Latest stable Redis 7.x
      cacheNodeType: envName === 'prod' ? 'cache.r7g.large' : 'cache.t4g.micro',
      cacheParameterGroupName: parameterGroup.ref,

      // ── Cluster Mode Configuration ─────────────────────────────────────────
      // Enable cluster mode with 2 shards and 2 replicas per shard.
      numNodeGroups: 2, // number of shards
      replicasPerNodeGroup: 2, // number of replicas per shard (total 3 nodes per shard)

      // ── High Availability ──────────────────────────────────────────────────
      automaticFailoverEnabled: true, // auto-promote replica on primary failure
      multiAzEnabled: true, // distribute replicas across AZs

      // ── Network Configuration ──────────────────────────────────────────────
      cacheSubnetGroupName: this.subnetGroup.ref,
      securityGroupIds: [elastiCacheSecurityGroup.securityGroupId],

      // Port 6379 is the default Redis port; explicitly set for clarity.
      port: 6379,

      // ── Encryption ─────────────────────────────────────────────────────────
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
      // For TLS-enabled clusters, Spring Boot's Lettuce client requires TLS configuration.
      // Redis AUTH is not explicitly configured here (authToken is optional for VPC-isolated
      // clusters). If needed for compliance, set authToken via Secrets Manager.

      // ── Maintenance and Backup ─────────────────────────────────────────────
      autoMinorVersionUpgrade: true,
      preferredMaintenanceWindow: 'sun:03:00-sun:04:00', // Sunday 3–4 AM UTC
      snapshotRetentionLimit: 7, // retain daily snapshots for 7 days
      snapshotWindow: '02:00-03:00', // daily snapshot at 2–3 AM UTC

      // ── Logging ────────────────────────────────────────────────────────────
      // Enable CloudWatch Logs for slow queries and engine logs.
      logDeliveryConfigurations: [
        {
          destinationType: 'cloudwatch-logs',
          logFormat: 'json',
          logType: 'slow-log',
          destinationDetails: {
            cloudWatchLogsDetails: {
              logGroup: `/aws/elasticache/${envName}/redis/slow-log`,
            },
          },
        },
        {
          destinationType: 'cloudwatch-logs',
          logFormat: 'json',
          logType: 'engine-log',
          destinationDetails: {
            cloudWatchLogsDetails: {
              logGroup: `/aws/elasticache/${envName}/redis/engine-log`,
            },
          },
        },
      ],
    });

    // Explicit dependency: replication group requires the subnet group to exist first.
    this.replicationGroup.addDependency(this.subnetGroup);

    // ── CloudFormation Outputs ───────────────────────────────────────────────
    // Export the configuration endpoint for cluster-mode clients.
    // For cluster mode, clients should use the configuration endpoint (not individual
    // node endpoints). Spring Boot's Lettuce client auto-discovers all cluster nodes
    // from the configuration endpoint.

    new cdk.CfnOutput(this, 'RedisConfigurationEndpoint', {
      value: this.replicationGroup.attrConfigurationEndPointAddress,
      description: 'ElastiCache Redis cluster configuration endpoint (address)',
      exportName: `FoodCostCalculator-${envName}-RedisConfigurationEndpointAddress`,
    });

    new cdk.CfnOutput(this, 'RedisConfigurationEndpointPort', {
      value: this.replicationGroup.attrConfigurationEndPointPort,
      description: 'ElastiCache Redis cluster configuration endpoint (port)',
      exportName: `FoodCostCalculator-${envName}-RedisConfigurationEndpointPort`,
    });

    new cdk.CfnOutput(this, 'RedisReplicationGroupId', {
      value: this.replicationGroup.replicationGroupId || '',
      description: 'ElastiCache Redis replication group ID',
      exportName: `FoodCostCalculator-${envName}-RedisReplicationGroupId`,
    });
  }
}
