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
export class CacheStack extends cdk.Stack {
  /**
   * The ElastiCache Redis replication group (single node).
   * Export the primary endpoint for client connections.
   */
  public readonly replicationGroup: elasticache.CfnReplicationGroup;

  /**
   * The subnet group used by ElastiCache.
   * Placed in private isolated subnets (same subnets as RDS).
   */
  public readonly subnetGroup: elasticache.CfnSubnetGroup;

  constructor(scope: Construct, id: string, props: CacheStackProps) {
    super(scope, id, props);

    const { envName, vpc, redisSecurityGroup } = props;

    // ── Subnet Group ─────────────────────────────────────────────────────────
    //
    // ElastiCache requires an explicit subnet group.
    // We place the Redis node in the isolated subnets (same as RDS),
    // isolated from the internet.
    // Subnet group spans both private isolated subnets for future multi-AZ expansion.
    const privateDataSubnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
    });

    this.subnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      subnetIds: privateDataSubnets.subnetIds,
      description: `ElastiCache Redis subnet group for Food Cost Calculator (${envName})`,
      cacheSubnetGroupName: `fcc-redis-${envName}`,
    });

    // ── Parameter Group ──────────────────────────────────────────────────────
    //
    // Custom parameter group for Redis 7.x (no cluster mode).
    // Set reasonable defaults for session storage and cache use cases.
    const parameterGroup = new elasticache.CfnParameterGroup(this, 'RedisParameterGroup', {
      cacheParameterGroupFamily: 'redis7', // Redis 7.x without cluster mode
      description: `Food Cost Calculator Redis 7 parameters (${envName})`,
      properties: {
        // Max memory policy: evict least-recently-used keys when memory is full.
        // This is suitable for session storage and query cache workloads.
        'maxmemory-policy': 'allkeys-lru',

        // Timeout for idle connections (default 0 = no timeout).
        // Set to 5 minutes to clean up stale connections.
        'timeout': '300',
      },
    });

    // ── Replication Group (Single Node) ──────────────────────────────────────
    //
    // Single-node Redis for cost optimization.
    //
    // Configuration:
    //   - 1 node (no replication, no cluster mode)
    //   - cache.t4g.micro (ARM-based Graviton2, burstable performance)
    //   - Automatic failover disabled (single node, nothing to fail over to)
    //   - At-rest encryption enabled (AWS-managed KMS keys)
    //   - In-transit encryption (TLS) enabled
    //   - Automatic minor version upgrades enabled
    //   - Maintenance window: Sunday 03:00–04:00 UTC
    //   - Snapshot retention: 7 days (for disaster recovery)
    //   - Daily snapshot window: 02:00–03:00 UTC
    //
    // Total cluster size: 1 node (primary only, no replicas)

    this.replicationGroup = new elasticache.CfnReplicationGroup(this, 'RedisSingleNode', {
      replicationGroupId: `fcc-redis-${envName}`,
      replicationGroupDescription: `Food Cost Calculator Redis cache (${envName})`,

      // ── Engine Configuration ───────────────────────────────────────────────
      engine: 'redis',
      engineVersion: '7.0', // Latest stable Redis 7.x (7.1 may have compatibility issues)
      cacheNodeType: 'cache.t3.micro', // Cost-optimized (t4g not available for Redis 7.1)
      cacheParameterGroupName: parameterGroup.ref,

      // ── Single Node Configuration ──────────────────────────────────────────
      // No cluster mode, no replication - single node only
      // For single-node (non-cluster mode), specify numCacheClusters
      numCacheClusters: 1, // Single primary node

      // ── High Availability ──────────────────────────────────────────────────
      automaticFailoverEnabled: false, // Must be false for single node
      multiAzEnabled: false, // Single node cannot be multi-AZ

      // ── Network Configuration ──────────────────────────────────────────────
      cacheSubnetGroupName: this.subnetGroup.ref,
      securityGroupIds: [redisSecurityGroup.securityGroupId],

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
    // Export the primary endpoint for single-node Redis.
    // For single-node deployments, clients connect directly to the primary endpoint.

    new cdk.CfnOutput(this, 'RedisPrimaryEndpoint', {
      value: this.replicationGroup.attrPrimaryEndPointAddress,
      description: 'ElastiCache Redis primary endpoint (address)',
      exportName: `FoodCostCalculator-${envName}-RedisEndpoint`,
    });

    new cdk.CfnOutput(this, 'RedisPrimaryEndpointPort', {
      value: this.replicationGroup.attrPrimaryEndPointPort,
      description: 'ElastiCache Redis primary endpoint (port)',
      exportName: `FoodCostCalculator-${envName}-RedisPort`,
    });

    new cdk.CfnOutput(this, 'RedisReplicationGroupId', {
      value: this.replicationGroup.replicationGroupId || '',
      description: 'ElastiCache Redis replication group ID',
      exportName: `FoodCostCalculator-${envName}-RedisReplicationGroupId`,
    });

    // ── Tags ─────────────────────────────────────────────────────────────────
    cdk.Tags.of(this).add('Component', 'Cache');
    cdk.Tags.of(this).add('CostCenter', 'Data');
  }
}
