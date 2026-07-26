"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheStack = void 0;
const cdk = require("aws-cdk-lib");
const ec2 = require("aws-cdk-lib/aws-ec2");
const elasticache = require("aws-cdk-lib/aws-elasticache");
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
class CacheStack extends cdk.Stack {
    /**
     * The ElastiCache Redis replication group (single node).
     * Export the primary endpoint for client connections.
     */
    replicationGroup;
    /**
     * The subnet group used by ElastiCache.
     * Placed in private isolated subnets (same subnets as RDS).
     */
    subnetGroup;
    constructor(scope, id, props) {
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
            engineVersion: '7.1', // Latest stable Redis 7.x
            cacheNodeType: 'cache.t4g.micro', // ARM-based, cost-optimized
            cacheParameterGroupName: parameterGroup.ref,
            // ── Single Node Configuration ──────────────────────────────────────────
            // No cluster mode, no replication - single node only
            // numNodeGroups and replicasPerNodeGroup are NOT specified for single-node
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
exports.CacheStack = CacheStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQ2FjaGVTdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL2xpYi9zdGFja3MvQ2FjaGVTdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFDbkMsMkNBQTJDO0FBQzNDLDJEQUEyRDtBQWMzRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBOEJHO0FBQ0gsTUFBYSxVQUFXLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDdkM7OztPQUdHO0lBQ2EsZ0JBQWdCLENBQWtDO0lBRWxFOzs7T0FHRztJQUNhLFdBQVcsQ0FBNkI7SUFFeEQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsT0FBTyxFQUFFLEdBQUcsRUFBRSxrQkFBa0IsRUFBRSxHQUFHLEtBQUssQ0FBQztRQUVuRCw0RUFBNEU7UUFDNUUsRUFBRTtRQUNGLGlEQUFpRDtRQUNqRCxpRUFBaUU7UUFDakUsOEJBQThCO1FBQzlCLGtGQUFrRjtRQUNsRixNQUFNLGtCQUFrQixHQUFHLEdBQUcsQ0FBQyxhQUFhLENBQUM7WUFDM0MsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsZ0JBQWdCO1NBQzVDLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxXQUFXLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUMxRSxTQUFTLEVBQUUsa0JBQWtCLENBQUMsU0FBUztZQUN2QyxXQUFXLEVBQUUsNERBQTRELE9BQU8sR0FBRztZQUNuRixvQkFBb0IsRUFBRSxhQUFhLE9BQU8sRUFBRTtTQUM3QyxDQUFDLENBQUM7UUFFSCw0RUFBNEU7UUFDNUUsRUFBRTtRQUNGLDBEQUEwRDtRQUMxRCxtRUFBbUU7UUFDbkUsTUFBTSxjQUFjLEdBQUcsSUFBSSxXQUFXLENBQUMs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Z0JBQWdCLENBQUMsMEJBQTBCO1lBQ3ZELFdBQVcsRUFBRSw4Q0FBOEM7WUFDM0QsVUFBVSxFQUFFLHNCQUFzQixPQUFPLGdCQUFnQjtTQUMxRCxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLDBCQUEwQixFQUFFO1lBQ2xELEtBQUssRUFBRSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsdUJBQXVCO1lBQ3BELFdBQVcsRUFBRSwyQ0FBMkM7WUFDeEQsVUFBVSxFQUFFLHNCQUFzQixPQUFPLFlBQVk7U0FDdEQsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSx5QkFBeUIsRUFBRTtZQUNqRCxLQUFLLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixDQUFDLGtCQUFrQixJQUFJLEVBQUU7WUFDckQsV0FBVyxFQUFFLHdDQUF3QztZQUNyRCxVQUFVLEVBQUUsc0JBQXNCLE9BQU8sMEJBQTBCO1NBQ3BFLENBQUMsQ0FBQztRQUVILDRFQUE0RTtRQUM1RSxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsV0FBVyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBQzVDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxZQUFZLEVBQUUsTUFBTSxDQUFDLENBQUM7SUFDOUMsQ0FBQztDQUNGO0FBbEtELGdDQWtLQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgKiBhcyBlbGFzdGljYWNoZSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWxhc3RpY2FjaGUnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2FjaGVTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICAvKiogTG9naWNhbCBlbnZpcm9ubWVudCBuYW1lLCBlLmcuIFwic3RhZ2luZ1wiIG9yIFwicHJvZFwiLiBVc2VkIGZvciBuYW1pbmcuICovXG4gIHJlYWRvbmx5IGVudk5hbWU6IHN0cmluZztcblxuICAvKiogVGhlIFZQQyBpbiB3aGljaCB0byBkZXBsb3kgdGhlIEVsYXN0aUNhY2hlIFJlZGlzIGluc3RhbmNlLiAqL1xuICByZWFkb25seSB2cGM6IGVjMi5JVnBjO1xuXG4gIC8qKiBTZWN1cml0eSBncm91cCB0aGF0IGFsbG93cyBFQ1MgdGFza3MgdG8gY29ubmVjdCB0byBSZWRpcyAocG9ydCA2Mzc5KS4gKi9cbiAgcmVhZG9ubHkgcmVkaXNTZWN1cml0eUdyb3VwOiBlYzIuSVNlY3VyaXR5R3JvdXA7XG59XG5cbi8qKlxuICogQ2FjaGVTdGFja1xuICpcbiAqIENvc3Qtb3B0aW1pemVkIEFtYXpvbiBFbGFzdGlDYWNoZSBmb3IgUmVkaXMgZm9yIHRoZSBGb29kIENvc3QgQ2FsY3VsYXRvcjpcbiAqXG4gKiAg4oCiIFJlZGlzIDcuMCsgc2luZ2xlLW5vZGUgKG5vIHJlcGxpY2F0aW9uKSBmb3IgY29zdCBvcHRpbWl6YXRpb25cbiAqICDigKIgY2FjaGUudDRnLm1pY3JvIChBUk0tYmFzZWQgR3Jhdml0b24yLCBidXJzdGFibGUgcGVyZm9ybWFuY2UpXG4gKiAg4oCiIEVuY3J5cHRpb24gYXQgcmVzdCAoQVdTLW1hbmFnZWQgS01TIGtleXMpXG4gKiAg4oCiIEVuY3J5cHRpb24gaW4gdHJhbnNpdCAoVExTIHJlcXVpcmVkKVxuICogIOKAoiBEZXBsb3llZCBpbiBwcml2YXRlIGlzb2xhdGVkIHN1Ym5ldHMgd2l0aCBubyBpbnRlcm5ldCBhY2Nlc3NcbiAqICDigKIgQWNjZXNzIHJlc3RyaWN0ZWQgdG8gRUNTIHRhc2tzIHZpYSBzZWN1cml0eSBncm91cCBpbmdyZXNzIHJ1bGUgKGRlZmluZWQgaW4gTmV0d29ya1N0YWNrT3B0aW1pemVkKVxuICogIOKAoiBTdWJuZXQgZ3JvdXAgc3BhbnMgYm90aCBwcml2YXRlIGlzb2xhdGVkIHN1Ym5ldHMgKHJlYWR5IGZvciBtdWx0aS1BWiBleHBhbnNpb24pXG4gKlxuICogVXNhZ2U6XG4gKiAgLSBTZXNzaW9uIHN0b3JhZ2UgZm9yIFNwcmluZyBCb290IEFQSSAoU3ByaW5nIFNlc3Npb24gUmVkaXMpXG4gKiAgLSBRdWVyeSByZXN1bHQgY2FjaGUgZm9yIGV4cGVuc2l2ZSByZWFkIG9wZXJhdGlvbnNcbiAqXG4gKiBDb3N0IHNhdmluZ3MgdnMgY2x1c3RlcmVkIFJlZGlzOlxuICogIC0gU2luZ2xlIG5vZGU6IH4kMTItMTUvbW9udGhcbiAqICAtIENsdXN0ZXIgd2l0aCByZXBsaWNhdGlvbjogfiQ3MC05MC9tb250aFxuICogIC0gKipTYXZpbmdzOiAkNTUtNzUvbW9udGgqKiAoODAlIHJlZHVjdGlvbilcbiAqXG4gKiBUcmFkZS1vZmZzOlxuICogIC0gTm8gYXV0b21hdGljIGZhaWxvdmVyIChzaW5nbGUgbm9kZSlcbiAqICAtIE5vIHJlYWQgcmVwbGljYXMgKGFsbCByZWFkcy93cml0ZXMgb24gcHJpbWFyeSlcbiAqICAtIE1hbnVhbCByZWNvdmVyeSByZXF1aXJlZCBvbiBub2RlIGZhaWx1cmVcbiAqXG4gKiBGb3IgMiBpbml0aWFsIHZlbnVlcywgc2luZ2xlLW5vZGUgY2FjaGUudDRnLm1pY3JvIGlzIHN1ZmZpY2llbnQuXG4gKlxuICogU2F0aXNmaWVzIFJlcXVpcmVtZW50czogNS4xLCA1LjIsIDUuMywgNS40LCA1LjUsIDUuNiwgNS43XG4gKi9cbmV4cG9ydCBjbGFzcyBDYWNoZVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgLyoqXG4gICAqIFRoZSBFbGFzdGlDYWNoZSBSZWRpcyByZXBsaWNhdGlvbiBncm91cCAoc2luZ2xlIG5vZGUpLlxuICAgKiBFeHBvcnQgdGhlIHByaW1hcnkgZW5kcG9pbnQgZm9yIGNsaWVudCBjb25uZWN0aW9ucy5cbiAgICovXG4gIHB1YmxpYyByZWFkb25seSByZXBsaWNhdGlvbkdyb3VwOiBlbGFzdGljYWNoZS5DZm5SZXBsaWNhdGlvbkdyb3VwO1xuXG4gIC8qKlxuICAgKiBUaGUgc3VibmV0IGdyb3VwIHVzZWQgYnkgRWxhc3RpQ2FjaGUuXG4gICAqIFBsYWNlZCBpbiBwcml2YXRlIGlzb2xhdGVkIHN1Ym5ldHMgKHNhbWUgc3VibmV0cyBhcyBSRFMpLlxuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IHN1Ym5ldEdyb3VwOiBlbGFzdGljYWNoZS5DZm5TdWJuZXRHcm91cDtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQ2FjaGVTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7IGVudk5hbWUsIHZwYywgcmVkaXNTZWN1cml0eUdyb3VwIH0gPSBwcm9wcztcblxuICAgIC8vIOKUgOKUgCBTdWJuZXQgR3JvdXAg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBFbGFzdGlDYWNoZSByZXF1aXJlcyBhbiBleHBsaWNpdCBzdWJuZXQgZ3JvdXAuXG4gICAgLy8gV2UgcGxhY2UgdGhlIFJlZGlzIG5vZGUgaW4gdGhlIGlzb2xhdGVkIHN1Ym5ldHMgKHNhbWUgYXMgUkRTKSxcbiAgICAvLyBpc29sYXRlZCBmcm9tIHRoZSBpbnRlcm5ldC5cbiAgICAvLyBTdWJuZXQgZ3JvdXAgc3BhbnMgYm90aCBwcml2YXRlIGlzb2xhdGVkIHN1Ym5ldHMgZm9yIGZ1dHVyZSBtdWx0aS1BWiBleHBhbnNpb24uXG4gICAgY29uc3QgcHJpdmF0ZURhdGFTdWJuZXRzID0gdnBjLnNlbGVjdFN1Ym5ldHMoe1xuICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9JU09MQVRFRCxcbiAgICB9KTtcblxuICAgIHRoaXMuc3VibmV0R3JvdXAgPSBuZXcgZWxhc3RpY2FjaGUuQ2ZuU3VibmV0R3JvdXAodGhpcywgJ1JlZGlzU3VibmV0R3JvdXAnLCB7XG4gICAgICBzdWJuZXRJZHM6IHByaXZhdGVEYXRhU3VibmV0cy5zdWJuZXRJZHMsXG4gICAgICBkZXNjcmlwdGlvbjogYEVsYXN0aUNhY2hlIFJlZGlzIHN1Ym5ldCBncm91cCBmb3IgRm9vZCBDb3N0IENhbGN1bGF0b3IgKCR7ZW52TmFtZX0pYCxcbiAgICAgIGNhY2hlU3VibmV0R3JvdXBOYW1lOiBgZmNjLXJlZGlzLSR7ZW52TmFtZX1gLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSAIFBhcmFtZXRlciBHcm91cCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvL1xuICAgIC8vIEN1c3RvbSBwYXJhbWV0ZXIgZ3JvdXAgZm9yIFJlZGlzIDcueCAobm8gY2x1c3RlciBtb2RlKS5cbiAgICAvLyBTZXQgcmVhc29uYWJsZSBkZWZhdWx0cyBmb3Igc2Vzc2lvbiBzdG9yYWdlIGFuZCBjYWNoZSB1c2UgY2FzZXMuXG4gICAgY29uc3QgcGFyYW1ldGVyR3JvdXAgPSBuZXcgZWxhc3RpY2FjaGUuQ2ZuUGFyYW1ldGVyR3JvdXAodGhpcywgJ1JlZGlzUGFyYW1ldGVyR3JvdXAnLCB7XG4gICAgICBjYWNoZVBhcmFtZXRlckdyb3VwRmFtaWx5OiAncmVkaXM3JywgLy8gUmVkaXMgNy54IHdpdGhvdXQgY2x1c3RlciBtb2RlXG4gICAgICBkZXNjcmlwdGlvbjogYEZvb2QgQ29zdCBDYWxjdWxhdG9yIFJlZGlzIDcgcGFyYW1ldGVycyAoJHtlbnZOYW1lfSlgLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAvLyBNYXggbWVtb3J5IHBvbGljeTogZXZpY3QgbGVhc3QtcmVjZW50bHktdXNlZCBrZXlzIHdoZW4gbWVtb3J5IGlzIGZ1bGwuXG4gICAgICAgIC8vIFRoaXMgaXMgc3VpdGFibGUgZm9yIHNlc3Npb24gc3RvcmFnZSBhbmQgcXVlcnkgY2FjaGUgd29ya2xvYWRzLlxuICAgICAgICAnbWF4bWVtb3J5LXBvbGljeSc6ICdhbGxrZXlzLWxydScsXG5cbiAgICAgICAgLy8gVGltZW91dCBmb3IgaWRsZSBjb25uZWN0aW9ucyAoZGVmYXVsdCAwID0gbm8gdGltZW91dCkuXG4gICAgICAgIC8vIFNldCB0byA1IG1pbnV0ZXMgdG8gY2xlYW4gdXAgc3RhbGUgY29ubmVjdGlvbnMuXG4gICAgICAgICd0aW1lb3V0JzogJzMwMCcsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSAIFJlcGxpY2F0aW9uIEdyb3VwIChTaW5nbGUgTm9kZSkg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBTaW5nbGUtbm9kZSBSZWRpcyBmb3IgY29zdCBvcHRpbWl6YXRpb24uXG4gICAgLy9cbiAgICAvLyBDb25maWd1cmF0aW9uOlxuICAgIC8vICAgLSAxIG5vZGUgKG5vIHJlcGxpY2F0aW9uLCBubyBjbHVzdGVyIG1vZGUpXG4gICAgLy8gICAtIGNhY2hlLnQ0Zy5taWNybyAoQVJNLWJhc2VkIEdyYXZpdG9uMiwgYnVyc3RhYmxlIHBlcmZvcm1hbmNlKVxuICAgIC8vICAgLSBBdXRvbWF0aWMgZmFpbG92ZXIgZGlzYWJsZWQgKHNpbmdsZSBub2RlLCBub3RoaW5nIHRvIGZhaWwgb3ZlciB0bylcbiAgICAvLyAgIC0gQXQtcmVzdCBlbmNyeXB0aW9uIGVuYWJsZWQgKEFXUy1tYW5hZ2VkIEtNUyBrZXlzKVxuICAgIC8vICAgLSBJbi10cmFuc2l0IGVuY3J5cHRpb24gKFRMUykgZW5hYmxlZFxuICAgIC8vICAgLSBBdXRvbWF0aWMgbWlub3IgdmVyc2lvbiB1cGdyYWRlcyBlbmFibGVkXG4gICAgLy8gICAtIE1haW50ZW5hbmNlIHdpbmRvdzogU3VuZGF5IDAzOjAw4oCTMDQ6MDAgVVRDXG4gICAgLy8gICAtIFNuYXBzaG90IHJldGVudGlvbjogNyBkYXlzIChmb3IgZGlzYXN0ZXIgcmVjb3ZlcnkpXG4gICAgLy8gICAtIERhaWx5IHNuYXBzaG90IHdpbmRvdzogMDI6MDDigJMwMzowMCBVVENcbiAgICAvL1xuICAgIC8vIFRvdGFsIGNsdXN0ZXIgc2l6ZTogMSBub2RlIChwcmltYXJ5IG9ubHksIG5vIHJlcGxpY2FzKVxuXG4gICAgdGhpcy5yZXBsaWNhdGlvbkdyb3VwID0gbmV3IGVsYXN0aWNhY2hlLkNmblJlcGxpY2F0aW9uR3JvdXAodGhpcywgJ1JlZGlzU2luZ2xlTm9kZScsIHtcbiAgICAgIHJlcGxpY2F0aW9uR3JvdXBJZDogYGZjYy1yZWRpcy0ke2Vudk5hbWV9YCxcbiAgICAgIHJlcGxpY2F0aW9uR3JvdXBEZXNjcmlwdGlvbjogYEZvb2QgQ29zdCBDYWxjdWxhdG9yIFJlZGlzIGNhY2hlICgke2Vudk5hbWV9KWAsXG5cbiAgICAgIC8vIOKUgOKUgCBFbmdpbmUgQ29uZmlndXJhdGlvbiDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIGVuZ2luZTogJ3JlZGlzJyxcbiAgICAgIGVuZ2luZVZlcnNpb246ICc3LjEnLCAvLyBMYXRlc3Qgc3RhYmxlIFJlZGlzIDcueFxuICAgICAgY2FjaGVOb2RlVHlwZTogJ2NhY2hlLnQ0Zy5taWNybycsIC8vIEFSTS1iYXNlZCwgY29zdC1vcHRpbWl6ZWRcbiAgICAgIGNhY2hlUGFyYW1ldGVyR3JvdXBOYW1lOiBwYXJhbWV0ZXJHcm91cC5yZWYsXG5cbiAgICAgIC8vIOKUgOKUgCBTaW5nbGUgTm9kZSBDb25maWd1cmF0aW9uIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgLy8gTm8gY2x1c3RlciBtb2RlLCBubyByZXBsaWNhdGlvbiAtIHNpbmdsZSBub2RlIG9ubHlcbiAgICAgIC8vIG51bU5vZGVHcm91cHMgYW5kIHJlcGxpY2FzUGVyTm9kZUdyb3VwIGFyZSBOT1Qgc3BlY2lmaWVkIGZvciBzaW5nbGUtbm9kZVxuXG4gICAgICAvLyDilIDilIAgSGlnaCBBdmFpbGFiaWxpdHkg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgICBhdXRvbWF0aWNGYWlsb3ZlckVuYWJsZWQ6IGZhbHNlLCAvLyBNdXN0IGJlIGZhbHNlIGZvciBzaW5nbGUgbm9kZVxuICAgICAgbXVsdGlBekVuYWJsZWQ6IGZhbHNlLCAvLyBTaW5nbGUgbm9kZSBjYW5ub3QgYmUgbXVsdGktQVpcblxuICAgICAgLy8g4pSA4pSAIE5ldHdvcmsgQ29uZmlndXJhdGlvbiDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIGNhY2hlU3VibmV0R3JvdXBOYW1lOiB0aGlzLnN1Ym5ldEdyb3VwLnJlZixcbiAgICAgIHNlY3VyaXR5R3JvdXBJZHM6IFtyZWRpc1NlY3VyaXR5R3JvdXAuc2VjdXJpdHlHcm91cElkXSxcblxuICAgICAgLy8gUG9ydCA2Mzc5IGlzIHRoZSBkZWZhdWx0IFJlZGlzIHBvcnQ7IGV4cGxpY2l0bHkgc2V0IGZvciBjbGFyaXR5LlxuICAgICAgcG9ydDogNjM3OSxcblxuICAgICAgLy8g4pSA4pSAIEVuY3J5cHRpb24g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgICBhdFJlc3RFbmNyeXB0aW9uRW5hYmxlZDogdHJ1ZSxcbiAgICAgIHRyYW5zaXRFbmNyeXB0aW9uRW5hYmxlZDogdHJ1ZSxcbiAgICAgIC8vIEZvciBUTFMtZW5hYmxlZCBjbHVzdGVycywgU3ByaW5nIEJvb3QncyBMZXR0dWNlIGNsaWVudCByZXF1aXJlcyBUTFMgY29uZmlndXJhdGlvbi5cbiAgICAgIC8vIFJlZGlzIEFVVEggaXMgbm90IGV4cGxpY2l0bHkgY29uZmlndXJlZCBoZXJlIChhdXRoVG9rZW4gaXMgb3B0aW9uYWwgZm9yIFZQQy1pc29sYXRlZFxuICAgICAgLy8gY2x1c3RlcnMpLiBJZiBuZWVkZWQgZm9yIGNvbXBsaWFuY2UsIHNldCBhdXRoVG9rZW4gdmlhIFNlY3JldHMgTWFuYWdlci5cblxuICAgICAgLy8g4pSA4pSAIE1haW50ZW5hbmNlIGFuZCBCYWNrdXAg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgICBhdXRvTWlub3JWZXJzaW9uVXBncmFkZTogdHJ1ZSxcbiAgICAgIHByZWZlcnJlZE1haW50ZW5hbmNlV2luZG93OiAnc3VuOjAzOjAwLXN1bjowNDowMCcsIC8vIFN1bmRheSAz4oCTNCBBTSBVVENcbiAgICAgIHNuYXBzaG90UmV0ZW50aW9uTGltaXQ6IDcsIC8vIHJldGFpbiBkYWlseSBzbmFwc2hvdHMgZm9yIDcgZGF5c1xuICAgICAgc25hcHNob3RXaW5kb3c6ICcwMjowMC0wMzowMCcsIC8vIGRhaWx5IHNuYXBzaG90IGF0IDLigJMzIEFNIFVUQ1xuXG4gICAgICAvLyDilIDilIAgTG9nZ2luZyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIC8vIEVuYWJsZSBDbG91ZFdhdGNoIExvZ3MgZm9yIHNsb3cgcXVlcmllcyBhbmQgZW5naW5lIGxvZ3MuXG4gICAgICBsb2dEZWxpdmVyeUNvbmZpZ3VyYXRpb25zOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBkZXN0aW5hdGlvblR5cGU6ICdjbG91ZHdhdGNoLWxvZ3MnLFxuICAgICAgICAgIGxvZ0Zvcm1hdDogJ2pzb24nLFxuICAgICAgICAgIGxvZ1R5cGU6ICdzbG93LWxvZycsXG4gICAgICAgICAgZGVzdGluYXRpb25EZXRhaWxzOiB7XG4gICAgICAgICAgICBjbG91ZFdhdGNoTG9nc0RldGFpbHM6IHtcbiAgICAgICAgICAgICAgbG9nR3JvdXA6IGAvYXdzL2VsYXN0aWNhY2hlLyR7ZW52TmFtZX0vcmVkaXMvc2xvdy1sb2dgLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgZGVzdGluYXRpb25UeXBlOiAnY2xvdWR3YXRjaC1sb2dzJyxcbiAgICAgICAgICBsb2dGb3JtYXQ6ICdqc29uJyxcbiAgICAgICAgICBsb2dUeXBlOiAnZW5naW5lLWxvZycsXG4gICAgICAgICAgZGVzdGluYXRpb25EZXRhaWxzOiB7XG4gICAgICAgICAgICBjbG91ZFdhdGNoTG9nc0RldGFpbHM6IHtcbiAgICAgICAgICAgICAgbG9nR3JvdXA6IGAvYXdzL2VsYXN0aWNhY2hlLyR7ZW52TmFtZX0vcmVkaXMvZW5naW5lLWxvZ2AsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gRXhwbGljaXQgZGVwZW5kZW5jeTogcmVwbGljYXRpb24gZ3JvdXAgcmVxdWlyZXMgdGhlIHN1Ym5ldCBncm91cCB0byBleGlzdCBmaXJzdC5cbiAgICB0aGlzLnJlcGxpY2F0aW9uR3JvdXAuYWRkRGVwZW5kZW5jeSh0aGlzLnN1Ym5ldEdyb3VwKTtcblxuICAgIC8vIOKUgOKUgCBDbG91ZEZvcm1hdGlvbiBPdXRwdXRzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vIEV4cG9ydCB0aGUgcHJpbWFyeSBlbmRwb2ludCBmb3Igc2luZ2xlLW5vZGUgUmVkaXMuXG4gICAgLy8gRm9yIHNpbmdsZS1ub2RlIGRlcGxveW1lbnRzLCBjbGllbnRzIGNvbm5lY3QgZGlyZWN0bHkgdG8gdGhlIHByaW1hcnkgZW5kcG9pbnQuXG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmVkaXNQcmltYXJ5RW5kcG9pbnQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5yZXBsaWNhdGlvbkdyb3VwLmF0dHJQcmltYXJ5RW5kUG9pbnRBZGRyZXNzLFxuICAgICAgZGVzY3JpcHRpb246ICdFbGFzdGlDYWNoZSBSZWRpcyBwcmltYXJ5IGVuZHBvaW50IChhZGRyZXNzKScsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tUmVkaXNFbmRwb2ludGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmVkaXNQcmltYXJ5RW5kcG9pbnRQb3J0Jywge1xuICAgICAgdmFsdWU6IHRoaXMucmVwbGljYXRpb25Hcm91cC5hdHRyUHJpbWFyeUVuZFBvaW50UG9ydCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRWxhc3RpQ2FjaGUgUmVkaXMgcHJpbWFyeSBlbmRwb2ludCAocG9ydCknLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LVJlZGlzUG9ydGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmVkaXNSZXBsaWNhdGlvbkdyb3VwSWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5yZXBsaWNhdGlvbkdyb3VwLnJlcGxpY2F0aW9uR3JvdXBJZCB8fCAnJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRWxhc3RpQ2FjaGUgUmVkaXMgcmVwbGljYXRpb24gZ3JvdXAgSUQnLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LVJlZGlzUmVwbGljYXRpb25Hcm91cElkYCxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCBUYWdzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnQ29tcG9uZW50JywgJ0NhY2hlJyk7XG4gICAgY2RrLlRhZ3Mub2YodGhpcykuYWRkKCdDb3N0Q2VudGVyJywgJ0RhdGEnKTtcbiAgfVxufVxuIl19