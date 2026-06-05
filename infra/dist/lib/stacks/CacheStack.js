"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheStack = void 0;
const cdk = require("aws-cdk-lib");
const elasticache = require("aws-cdk-lib/aws-elasticache");
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
class CacheStack extends cdk.Stack {
    /**
     * The ElastiCache Redis replication group.
     * Export the configuration endpoint for cluster-mode clients.
     */
    replicationGroup;
    /**
     * The subnet group used by ElastiCache.
     * Placed in private data subnets (same subnets as Aurora for simplicity).
     */
    subnetGroup;
    constructor(scope, id, props) {
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
exports.CacheStack = CacheStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQ2FjaGVTdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL2xpYi9zdGFja3MvQ2FjaGVTdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkRBQTJEO0FBYzNEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBbUJHO0FBQ0gsTUFBYSxVQUFXLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDdkM7OztPQUdHO0lBQ2EsZ0JBQWdCLENBQWtDO0lBRWxFOzs7T0FHRztJQUNhLFdBQVcsQ0FBNkI7SUFFeEQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsT0FBTyxFQUFFLEdBQUcsRUFBRSx3QkFBd0IsRUFBRSxHQUFHLEtBQUssQ0FBQztRQUV6RCw0RUFBNEU7UUFDNUUsRUFBRTtRQUNGLGlEQUFpRDtRQUNqRCwyRUFBMkU7UUFDM0UsOEJBQThCO1FBQzlCLE1BQU0sa0JBQWtCLEdBQUcsR0FBRyxDQUFDLGFBQWEsQ0FBQztZQUMzQyxlQUFlLEVBQUUsY0FBYztTQUNoQyxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksV0FBVyxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDMUUsU0FBUyxFQUFFLGtCQUFrQixDQUFDLFNBQVM7WUFDdkMsV0FBVyxFQUFFLDREQUE0RCxPQUFPLEdBQUc7WUFDbkYsb0JBQW9CLEVBQUUsYUFBYSxPQUFPLEVBQUU7U0FDN0MsQ0FBQyxDQUFDO1FBRUgsNEVBQTRFO1FBQzVFLEVBQUU7UUFDRixxREFBcUQ7UUFDckQsbUZBQW1GO1FBQ25GLE1BQU0sY0FBYyxHQUFHLElBQUksV0FBVyxDQUFDLGlCQUFpQixDQUFDLElBQUksRUFBRSxxQkFBcUIsRUFBRTtZQUNwRix5QkFBeUIsRUFBRSxtQkFBbUIs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QUksQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUV0RCw0RUFBNEU7UUFDNUUsOERBQThEO1FBQzlELGtGQUFrRjtRQUNsRixpRkFBaUY7UUFDakYsbUNBQW1DO1FBRW5DLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsNEJBQTRCLEVBQUU7WUFDcEQsS0FBSyxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxnQ0FBZ0M7WUFDN0QsV0FBVyxFQUFFLDREQUE0RDtZQUN6RSxVQUFVLEVBQUUsc0JBQXNCLE9BQU8sb0NBQW9DO1NBQzlFLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsZ0NBQWdDLEVBQUU7WUFDeEQsS0FBSyxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyw2QkFBNkI7WUFDMUQsV0FBVyxFQUFFLHlEQUF5RDtZQUN0RSxVQUFVLEVBQUUsc0JBQXNCLE9BQU8saUNBQWlDO1NBQzNFLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUseUJBQXlCLEVBQUU7WUFDakQsS0FBSyxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxrQkFBa0IsSUFBSSxFQUFFO1lBQ3JELFdBQVcsRUFBRSx3Q0FBd0M7WUFDckQsVUFBVSxFQUFFLHNCQUFzQixPQUFPLDBCQUEwQjtTQUNwRSxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF4S0QsZ0NBd0tDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCAqIGFzIGVsYXN0aWNhY2hlIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lbGFzdGljYWNoZSc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBDYWNoZVN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIC8qKiBMb2dpY2FsIGVudmlyb25tZW50IG5hbWUsIGUuZy4gXCJzdGFnaW5nXCIgb3IgXCJwcm9kXCIuIFVzZWQgZm9yIG5hbWluZy4gKi9cbiAgcmVhZG9ubHkgZW52TmFtZTogc3RyaW5nO1xuXG4gIC8qKiBUaGUgVlBDIGluIHdoaWNoIHRvIGRlcGxveSB0aGUgRWxhc3RpQ2FjaGUgY2x1c3Rlci4gKi9cbiAgcmVhZG9ubHkgdnBjOiBlYzIuSVZwYztcblxuICAvKiogU2VjdXJpdHkgZ3JvdXAgdGhhdCBhbGxvd3MgRUtTIG5vZGVzIHRvIGNvbm5lY3QgdG8gUmVkaXMgKHBvcnQgNjM3OSkuICovXG4gIHJlYWRvbmx5IGVsYXN0aUNhY2hlU2VjdXJpdHlHcm91cDogZWMyLklTZWN1cml0eUdyb3VwO1xufVxuXG4vKipcbiAqIENhY2hlU3RhY2tcbiAqXG4gKiBQcm92aXNpb25zIGFuIEFtYXpvbiBFbGFzdGlDYWNoZSBmb3IgUmVkaXMgY2x1c3RlciBmb3IgdGhlIEZvb2QgQ29zdCBDYWxjdWxhdG9yOlxuICpcbiAqICDigKIgUmVkaXMgNy54IGNsdXN0ZXIgbW9kZSBlbmFibGVkXG4gKiAg4oCiIFR3byBzaGFyZHMgKG5vZGUgZ3JvdXBzKSBmb3IgaG9yaXpvbnRhbCBwYXJ0aXRpb25pbmdcbiAqICDigKIgVHdvIHJlcGxpY2FzIHBlciBzaGFyZCBmb3IgaGlnaCBhdmFpbGFiaWxpdHkgKDMgbm9kZXMgcGVyIHNoYXJkOiAxIHByaW1hcnkgKyAyIHJlcGxpY2FzKVxuICogIOKAoiBNdWx0aS1BWiByZXBsaWNhdGlvbiBncm91cHMg4oCUIHJlcGxpY2FzIHNwcmVhZCBhY3Jvc3MgYXZhaWxhYmlsaXR5IHpvbmVzXG4gKiAg4oCiIEF1dG9tYXRpYyBmYWlsb3ZlciBlbmFibGVkIOKAlCBFbGFzdGlDYWNoZSBwcm9tb3RlcyBhIHJlcGxpY2EgdG8gcHJpbWFyeSBvbiBwcmltYXJ5IGZhaWx1cmVcbiAqICDigKIgRGVwbG95ZWQgaW4gcHJpdmF0ZSBkYXRhIHN1Ym5ldHMgd2l0aCBubyBpbnRlcm5ldCBhY2Nlc3NcbiAqICDigKIgQWNjZXNzIHJlc3RyaWN0ZWQgdG8gRUtTIG5vZGVzIHZpYSBzZWN1cml0eSBncm91cCBpbmdyZXNzIHJ1bGUgKGRlZmluZWQgaW4gTmV0d29ya1N0YWNrKVxuICpcbiAqIFVzYWdlOlxuICogIC0gU2Vzc2lvbiB0b2tlbiBzdG9yZSBmb3IgU3ByaW5nIEJvb3QgQVBJIHBvZHMgKFNwcmluZyBTZXNzaW9uIFJlZGlzKVxuICogIC0gUmVkaXMgcHViL3N1YiBjaGFubmVsIGZvciByZWFsLXRpbWUgY29zdCBwcm9wYWdhdGlvbiBldmVudHMgKHZlbnVlOnt2ZW51ZUlkfTpjb3N0cylcbiAqICAtIFF1ZXJ5IHJlc3VsdCBjYWNoZSBmb3IgZXhwZW5zaXZlIHJlYWQgb3BlcmF0aW9ucyAocmVjaXBlIGNvc3RpbmcgcmVwb3J0cywgY3Jvc3MtdmVudWUgc3VtbWFyaWVzKVxuICpcbiAqIFNhdGlzZmllcyBSZXF1aXJlbWVudHM6IDMuMyAoY29zdCBwcm9wYWdhdGlvbiB3aXRoaW4gMiBzZWNvbmRzKVxuICovXG5leHBvcnQgY2xhc3MgQ2FjaGVTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIC8qKlxuICAgKiBUaGUgRWxhc3RpQ2FjaGUgUmVkaXMgcmVwbGljYXRpb24gZ3JvdXAuXG4gICAqIEV4cG9ydCB0aGUgY29uZmlndXJhdGlvbiBlbmRwb2ludCBmb3IgY2x1c3Rlci1tb2RlIGNsaWVudHMuXG4gICAqL1xuICBwdWJsaWMgcmVhZG9ubHkgcmVwbGljYXRpb25Hcm91cDogZWxhc3RpY2FjaGUuQ2ZuUmVwbGljYXRpb25Hcm91cDtcblxuICAvKipcbiAgICogVGhlIHN1Ym5ldCBncm91cCB1c2VkIGJ5IEVsYXN0aUNhY2hlLlxuICAgKiBQbGFjZWQgaW4gcHJpdmF0ZSBkYXRhIHN1Ym5ldHMgKHNhbWUgc3VibmV0cyBhcyBBdXJvcmEgZm9yIHNpbXBsaWNpdHkpLlxuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IHN1Ym5ldEdyb3VwOiBlbGFzdGljYWNoZS5DZm5TdWJuZXRHcm91cDtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQ2FjaGVTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7IGVudk5hbWUsIHZwYywgZWxhc3RpQ2FjaGVTZWN1cml0eUdyb3VwIH0gPSBwcm9wcztcblxuICAgIC8vIOKUgOKUgCBTdWJuZXQgR3JvdXAg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBFbGFzdGlDYWNoZSByZXF1aXJlcyBhbiBleHBsaWNpdCBzdWJuZXQgZ3JvdXAuXG4gICAgLy8gV2UgcGxhY2UgdGhlIFJlZGlzIGNsdXN0ZXIgaW4gdGhlIHByaXZhdGUgZGF0YSBzdWJuZXRzIChzYW1lIGFzIEF1cm9yYSksXG4gICAgLy8gaXNvbGF0ZWQgZnJvbSB0aGUgaW50ZXJuZXQuXG4gICAgY29uc3QgcHJpdmF0ZURhdGFTdWJuZXRzID0gdnBjLnNlbGVjdFN1Ym5ldHMoe1xuICAgICAgc3VibmV0R3JvdXBOYW1lOiAncHJpdmF0ZS1kYXRhJyxcbiAgICB9KTtcblxuICAgIHRoaXMuc3VibmV0R3JvdXAgPSBuZXcgZWxhc3RpY2FjaGUuQ2ZuU3VibmV0R3JvdXAodGhpcywgJ1JlZGlzU3VibmV0R3JvdXAnLCB7XG4gICAgICBzdWJuZXRJZHM6IHByaXZhdGVEYXRhU3VibmV0cy5zdWJuZXRJZHMsXG4gICAgICBkZXNjcmlwdGlvbjogYEVsYXN0aUNhY2hlIFJlZGlzIHN1Ym5ldCBncm91cCBmb3IgRm9vZCBDb3N0IENhbGN1bGF0b3IgKCR7ZW52TmFtZX0pYCxcbiAgICAgIGNhY2hlU3VibmV0R3JvdXBOYW1lOiBgZmNjLXJlZGlzLSR7ZW52TmFtZX1gLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSAIFBhcmFtZXRlciBHcm91cCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvL1xuICAgIC8vIEN1c3RvbSBwYXJhbWV0ZXIgZ3JvdXAgZm9yIFJlZGlzIDcueCBjbHVzdGVyIG1vZGUuXG4gICAgLy8gRW5hYmxlIGNsdXN0ZXIgbW9kZSBhbmQgc2V0IHJlYXNvbmFibGUgZGVmYXVsdHMgZm9yIHB1Yi9zdWIgYW5kIGNhY2hlIHVzZSBjYXNlcy5cbiAgICBjb25zdCBwYXJhbWV0ZXJHcm91cCA9IG5ldyBlbGFzdGljYWNoZS5DZm5QYXJhbWV0ZXJHcm91cCh0aGlzLCAnUmVkaXNQYXJhbWV0ZXJHcm91cCcsIHtcbiAgICAgIGNhY2hlUGFyYW1ldGVyR3JvdXBGYW1pbHk6ICdyZWRpczcuY2x1c3Rlci5vbicsIC8vIFJlZGlzIDcueCB3aXRoIGNsdXN0ZXIgbW9kZSBlbmFibGVkXG4gICAgICBkZXNjcmlwdGlvbjogYEZvb2QgQ29zdCBDYWxjdWxhdG9yIFJlZGlzIDcgY2x1c3RlciBwYXJhbWV0ZXJzICgke2Vudk5hbWV9KWAsXG4gICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgIC8vIEVuYWJsZSBSZWRpcyBwdWIvc3ViIGZvciBjb3N0IHByb3BhZ2F0aW9uIGV2ZW50cy5cbiAgICAgICAgLy8gRGVmYXVsdCBub3RpZnkta2V5c3BhY2UtZXZlbnRzIGlzIGVtcHR5OyB3ZSBlbmFibGUgYWxsIG5vdGlmaWNhdGlvbiB0eXBlcy5cbiAgICAgICAgJ25vdGlmeS1rZXlzcGFjZS1ldmVudHMnOiAnQUtFJyxcblxuICAgICAgICAvLyBNYXggbWVtb3J5IHBvbGljeTogZXZpY3QgbGVhc3QtcmVjZW50bHktdXNlZCBrZXlzIHdoZW4gbWVtb3J5IGlzIGZ1bGwuXG4gICAgICAgIC8vIFRoaXMgaXMgc3VpdGFibGUgZm9yIGEgY2FjaGUgKyBwdWIvc3ViIHdvcmtsb2FkIChwdWIvc3ViIG1lc3NhZ2VzIGFyZVxuICAgICAgICAvLyB0cmFuc2llbnQgYW5kIG5ldmVyIGV2aWN0ZWQ7IGNhY2hlZCBxdWVyeSByZXN1bHRzIGNhbiBiZSBldmljdGVkKS5cbiAgICAgICAgJ21heG1lbW9yeS1wb2xpY3knOiAnYWxsa2V5cy1scnUnLFxuXG4gICAgICAgIC8vIFRpbWVvdXQgZm9yIGlkbGUgY29ubmVjdGlvbnMgKGRlZmF1bHQgMCA9IG5vIHRpbWVvdXQpLlxuICAgICAgICAvLyBTZXQgdG8gNSBtaW51dGVzIHRvIGNsZWFuIHVwIHN0YWxlIGNvbm5lY3Rpb25zLlxuICAgICAgICAndGltZW91dCc6ICczMDAnLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCBSZXBsaWNhdGlvbiBHcm91cCAoUmVkaXMgQ2x1c3Rlcikg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBNdWx0aS1BWiByZXBsaWNhdGlvbiBncm91cCB3aXRoIGNsdXN0ZXIgbW9kZSBlbmFibGVkLlxuICAgIC8vXG4gICAgLy8gQ29uZmlndXJhdGlvbjpcbiAgICAvLyAgIC0gMiBzaGFyZHMgKG51bU5vZGVHcm91cHMpXG4gICAgLy8gICAtIDIgcmVwbGljYXMgcGVyIHNoYXJkIChyZXBsaWNhc1Blck5vZGVHcm91cCkg4oCUIHRvdGFsIDMgbm9kZXMgcGVyIHNoYXJkXG4gICAgLy8gICAtIGNhY2hlLnQ0Zy5taWNybyBmb3Igc3RhZ2luZzsgY2FjaGUucjdnLmxhcmdlIGZvciBwcm9kIChBUk0tYmFzZWQgR3Jhdml0b24yKVxuICAgIC8vICAgLSBBdXRvbWF0aWMgZmFpbG92ZXIgZW5hYmxlZCAoRWxhc3RpQ2FjaGUgYXV0by1wcm9tb3RlcyByZXBsaWNhIG9uIHByaW1hcnkgZmFpbHVyZSlcbiAgICAvLyAgIC0gTXVsdGktQVogZW5hYmxlZCAocmVwbGljYXMgZGlzdHJpYnV0ZWQgYWNyb3NzIGF2YWlsYWJpbGl0eSB6b25lcylcbiAgICAvLyAgIC0gQXQtcmVzdCBlbmNyeXB0aW9uIGVuYWJsZWQgKGRlZmF1bHQgQ01LKVxuICAgIC8vICAgLSBJbi10cmFuc2l0IGVuY3J5cHRpb24gKFRMUykgZW5hYmxlZFxuICAgIC8vICAgLSBBdXRvbWF0aWMgbWlub3IgdmVyc2lvbiB1cGdyYWRlcyBlbmFibGVkXG4gICAgLy8gICAtIE1haW50ZW5hbmNlIHdpbmRvdzogU3VuZGF5IDAzOjAw4oCTMDQ6MDAgVVRDXG4gICAgLy8gICAtIFNuYXBzaG90IHJldGVudGlvbjogNyBkYXlzIChmb3IgZGlzYXN0ZXIgcmVjb3ZlcnkpXG4gICAgLy8gICAtIERhaWx5IHNuYXBzaG90IHdpbmRvdzogMDI6MDDigJMwMzowMCBVVENcbiAgICAvL1xuICAgIC8vIFRvdGFsIGNsdXN0ZXIgc2l6ZTpcbiAgICAvLyAgIDIgc2hhcmRzIMOXIDMgbm9kZXMgcGVyIHNoYXJkID0gNiBub2RlcyAoMiBwcmltYXJpZXMsIDQgcmVwbGljYXMpXG5cbiAgICB0aGlzLnJlcGxpY2F0aW9uR3JvdXAgPSBuZXcgZWxhc3RpY2FjaGUuQ2ZuUmVwbGljYXRpb25Hcm91cCh0aGlzLCAnUmVkaXNDbHVzdGVyJywge1xuICAgICAgcmVwbGljYXRpb25Hcm91cElkOiBgZmNjLXJlZGlzLSR7ZW52TmFtZX1gLFxuICAgICAgcmVwbGljYXRpb25Hcm91cERlc2NyaXB0aW9uOiBgRm9vZCBDb3N0IENhbGN1bGF0b3IgUmVkaXMgY2x1c3RlciAoJHtlbnZOYW1lfSlgLFxuXG4gICAgICAvLyDilIDilIAgRW5naW5lIENvbmZpZ3VyYXRpb24g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgICBlbmdpbmU6ICdyZWRpcycsXG4gICAgICBlbmdpbmVWZXJzaW9uOiAnNy4xJywgLy8gTGF0ZXN0IHN0YWJsZSBSZWRpcyA3LnhcbiAgICAgIGNhY2hlTm9kZVR5cGU6IGVudk5hbWUgPT09ICdwcm9kJyA/ICdjYWNoZS5yN2cubGFyZ2UnIDogJ2NhY2hlLnQ0Zy5taWNybycsXG4gICAgICBjYWNoZVBhcmFtZXRlckdyb3VwTmFtZTogcGFyYW1ldGVyR3JvdXAucmVmLFxuXG4gICAgICAvLyDilIDilIAgQ2x1c3RlciBNb2RlIENvbmZpZ3VyYXRpb24g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgICAvLyBFbmFibGUgY2x1c3RlciBtb2RlIHdpdGggMiBzaGFyZHMgYW5kIDIgcmVwbGljYXMgcGVyIHNoYXJkLlxuICAgICAgbnVtTm9kZUdyb3VwczogMiwgLy8gbnVtYmVyIG9mIHNoYXJkc1xuICAgICAgcmVwbGljYXNQZXJOb2RlR3JvdXA6IDIsIC8vIG51bWJlciBvZiByZXBsaWNhcyBwZXIgc2hhcmQgKHRvdGFsIDMgbm9kZXMgcGVyIHNoYXJkKVxuXG4gICAgICAvLyDilIDilIAgSGlnaCBBdmFpbGFiaWxpdHkg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgICBhdXRvbWF0aWNGYWlsb3ZlckVuYWJsZWQ6IHRydWUsIC8vIGF1dG8tcHJvbW90ZSByZXBsaWNhIG9uIHByaW1hcnkgZmFpbHVyZVxuICAgICAgbXVsdGlBekVuYWJsZWQ6IHRydWUsIC8vIGRpc3RyaWJ1dGUgcmVwbGljYXMgYWNyb3NzIEFac1xuXG4gICAgICAvLyDilIDilIAgTmV0d29yayBDb25maWd1cmF0aW9uIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgY2FjaGVTdWJuZXRHcm91cE5hbWU6IHRoaXMuc3VibmV0R3JvdXAucmVmLFxuICAgICAgc2VjdXJpdHlHcm91cElkczogW2VsYXN0aUNhY2hlU2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWRdLFxuXG4gICAgICAvLyBQb3J0IDYzNzkgaXMgdGhlIGRlZmF1bHQgUmVkaXMgcG9ydDsgZXhwbGljaXRseSBzZXQgZm9yIGNsYXJpdHkuXG4gICAgICBwb3J0OiA2Mzc5LFxuXG4gICAgICAvLyDilIDilIAgRW5jcnlwdGlvbiDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIGF0UmVzdEVuY3J5cHRpb25FbmFibGVkOiB0cnVlLFxuICAgICAgdHJhbnNpdEVuY3J5cHRpb25FbmFibGVkOiB0cnVlLFxuICAgICAgLy8gRm9yIFRMUy1lbmFibGVkIGNsdXN0ZXJzLCBTcHJpbmcgQm9vdCdzIExldHR1Y2UgY2xpZW50IHJlcXVpcmVzIFRMUyBjb25maWd1cmF0aW9uLlxuICAgICAgLy8gUmVkaXMgQVVUSCBpcyBub3QgZXhwbGljaXRseSBjb25maWd1cmVkIGhlcmUgKGF1dGhUb2tlbiBpcyBvcHRpb25hbCBmb3IgVlBDLWlzb2xhdGVkXG4gICAgICAvLyBjbHVzdGVycykuIElmIG5lZWRlZCBmb3IgY29tcGxpYW5jZSwgc2V0IGF1dGhUb2tlbiB2aWEgU2VjcmV0cyBNYW5hZ2VyLlxuXG4gICAgICAvLyDilIDilIAgTWFpbnRlbmFuY2UgYW5kIEJhY2t1cCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIGF1dG9NaW5vclZlcnNpb25VcGdyYWRlOiB0cnVlLFxuICAgICAgcHJlZmVycmVkTWFpbnRlbmFuY2VXaW5kb3c6ICdzdW46MDM6MDAtc3VuOjA0OjAwJywgLy8gU3VuZGF5IDPigJM0IEFNIFVUQ1xuICAgICAgc25hcHNob3RSZXRlbnRpb25MaW1pdDogNywgLy8gcmV0YWluIGRhaWx5IHNuYXBzaG90cyBmb3IgNyBkYXlzXG4gICAgICBzbmFwc2hvdFdpbmRvdzogJzAyOjAwLTAzOjAwJywgLy8gZGFpbHkgc25hcHNob3QgYXQgMuKAkzMgQU0gVVRDXG5cbiAgICAgIC8vIOKUgOKUgCBMb2dnaW5nIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgLy8gRW5hYmxlIENsb3VkV2F0Y2ggTG9ncyBmb3Igc2xvdyBxdWVyaWVzIGFuZCBlbmdpbmUgbG9ncy5cbiAgICAgIGxvZ0RlbGl2ZXJ5Q29uZmlndXJhdGlvbnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGRlc3RpbmF0aW9uVHlwZTogJ2Nsb3Vkd2F0Y2gtbG9ncycsXG4gICAgICAgICAgbG9nRm9ybWF0OiAnanNvbicsXG4gICAgICAgICAgbG9nVHlwZTogJ3Nsb3ctbG9nJyxcbiAgICAgICAgICBkZXN0aW5hdGlvbkRldGFpbHM6IHtcbiAgICAgICAgICAgIGNsb3VkV2F0Y2hMb2dzRGV0YWlsczoge1xuICAgICAgICAgICAgICBsb2dHcm91cDogYC9hd3MvZWxhc3RpY2FjaGUvJHtlbnZOYW1lfS9yZWRpcy9zbG93LWxvZ2AsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBkZXN0aW5hdGlvblR5cGU6ICdjbG91ZHdhdGNoLWxvZ3MnLFxuICAgICAgICAgIGxvZ0Zvcm1hdDogJ2pzb24nLFxuICAgICAgICAgIGxvZ1R5cGU6ICdlbmdpbmUtbG9nJyxcbiAgICAgICAgICBkZXN0aW5hdGlvbkRldGFpbHM6IHtcbiAgICAgICAgICAgIGNsb3VkV2F0Y2hMb2dzRGV0YWlsczoge1xuICAgICAgICAgICAgICBsb2dHcm91cDogYC9hd3MvZWxhc3RpY2FjaGUvJHtlbnZOYW1lfS9yZWRpcy9lbmdpbmUtbG9nYCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBFeHBsaWNpdCBkZXBlbmRlbmN5OiByZXBsaWNhdGlvbiBncm91cCByZXF1aXJlcyB0aGUgc3VibmV0IGdyb3VwIHRvIGV4aXN0IGZpcnN0LlxuICAgIHRoaXMucmVwbGljYXRpb25Hcm91cC5hZGREZXBlbmRlbmN5KHRoaXMuc3VibmV0R3JvdXApO1xuXG4gICAgLy8g4pSA4pSAIENsb3VkRm9ybWF0aW9uIE91dHB1dHMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy8gRXhwb3J0IHRoZSBjb25maWd1cmF0aW9uIGVuZHBvaW50IGZvciBjbHVzdGVyLW1vZGUgY2xpZW50cy5cbiAgICAvLyBGb3IgY2x1c3RlciBtb2RlLCBjbGllbnRzIHNob3VsZCB1c2UgdGhlIGNvbmZpZ3VyYXRpb24gZW5kcG9pbnQgKG5vdCBpbmRpdmlkdWFsXG4gICAgLy8gbm9kZSBlbmRwb2ludHMpLiBTcHJpbmcgQm9vdCdzIExldHR1Y2UgY2xpZW50IGF1dG8tZGlzY292ZXJzIGFsbCBjbHVzdGVyIG5vZGVzXG4gICAgLy8gZnJvbSB0aGUgY29uZmlndXJhdGlvbiBlbmRwb2ludC5cblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSZWRpc0NvbmZpZ3VyYXRpb25FbmRwb2ludCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnJlcGxpY2F0aW9uR3JvdXAuYXR0ckNvbmZpZ3VyYXRpb25FbmRQb2ludEFkZHJlc3MsXG4gICAgICBkZXNjcmlwdGlvbjogJ0VsYXN0aUNhY2hlIFJlZGlzIGNsdXN0ZXIgY29uZmlndXJhdGlvbiBlbmRwb2ludCAoYWRkcmVzcyknLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LVJlZGlzQ29uZmlndXJhdGlvbkVuZHBvaW50QWRkcmVzc2AsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmVkaXNDb25maWd1cmF0aW9uRW5kcG9pbnRQb3J0Jywge1xuICAgICAgdmFsdWU6IHRoaXMucmVwbGljYXRpb25Hcm91cC5hdHRyQ29uZmlndXJhdGlvbkVuZFBvaW50UG9ydCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRWxhc3RpQ2FjaGUgUmVkaXMgY2x1c3RlciBjb25maWd1cmF0aW9uIGVuZHBvaW50IChwb3J0KScsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tUmVkaXNDb25maWd1cmF0aW9uRW5kcG9pbnRQb3J0YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSZWRpc1JlcGxpY2F0aW9uR3JvdXBJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnJlcGxpY2F0aW9uR3JvdXAucmVwbGljYXRpb25Hcm91cElkIHx8ICcnLFxuICAgICAgZGVzY3JpcHRpb246ICdFbGFzdGlDYWNoZSBSZWRpcyByZXBsaWNhdGlvbiBncm91cCBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tUmVkaXNSZXBsaWNhdGlvbkdyb3VwSWRgLFxuICAgIH0pO1xuICB9XG59XG4iXX0=