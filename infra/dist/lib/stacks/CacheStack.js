"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheStack = void 0;
const cdk = require("aws-cdk-lib");
const ec2 = require("aws-cdk-lib/aws-ec2");
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
        // We place the Redis cluster in the isolated subnets (same as RDS),
        // isolated from the internet.
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQ2FjaGVTdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL2xpYi9zdGFja3MvQ2FjaGVTdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFDbkMsMkNBQTJDO0FBQzNDLDJEQUEyRDtBQWMzRDs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRztBQUNILE1BQWEsVUFBVyxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3ZDOzs7T0FHRztJQUNhLGdCQUFnQixDQUFrQztJQUVsRTs7O09BR0c7SUFDYSxXQUFXLENBQTZCO0lBRXhELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLE9BQU8sRUFBRSxHQUFHLEVBQUUsd0JBQXdCLEVBQUUsR0FBRyxLQUFLLENBQUM7UUFFekQsNEVBQTRFO1FBQzVFLEVBQUU7UUFDRixpREFBaUQ7UUFDakQsb0VBQW9FO1FBQ3BFLDhCQUE4QjtRQUM5QixNQUFNLGtCQUFrQixHQUFHLEdBQUcsQ0FBQyxhQUFhLENBQUM7WUFDM0MsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsZ0JBQWdCO1NBQzVDLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxXQUFXLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUMxRSxTQUFTLEVBQUUsa0JBQWtCLENBQUMsU0FBUztZQUN2QyxXQUFXLEVBQUUsNERBQTRELE9BQU8sR0FBRztZQUNuRixvQkFBb0IsRUFBRSxhQUFhLE9BQU8sRUFBRTtTQUM3QyxDQUFDLENBQUM7UUFFSCw0RUFBNEU7UUFDNUUsRUFBRTtRQUNGLHFEQUFxRDtRQUNyRCxtRkFBbUY7UUFDbkYsTUFBTSxjQUFjLEdBQUcsSUFBSSxXQUFXLENBQUMsaUJBQWlCLENBQUMsSUFBSSxFQUFFLHFC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LElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBRXRELDRFQUE0RTtRQUM1RSw4REFBOEQ7UUFDOUQsa0ZBQWtGO1FBQ2xGLGlGQUFpRjtRQUNqRixtQ0FBbUM7UUFFbkMsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSw0QkFBNEIsRUFBRTtZQUNwRCxLQUFLLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixDQUFDLGdDQUFnQztZQUM3RCxXQUFXLEVBQUUsNERBQTREO1lBQ3pFLFVBQVUsRUFBRSxzQkFBc0IsT0FBTyxvQ0FBb0M7U0FDOUUsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxnQ0FBZ0MsRUFBRTtZQUN4RCxLQUFLLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixDQUFDLDZCQUE2QjtZQUMxRCxXQUFXLEVBQUUseURBQXlEO1lBQ3RFLFVBQVUsRUFBRSxzQkFBc0IsT0FBTyxpQ0FBaUM7U0FDM0UsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSx5QkFBeUIsRUFBRTtZQUNqRCxLQUFLLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixDQUFDLGtCQUFrQixJQUFJLEVBQUU7WUFDckQsV0FBVyxFQUFFLHdDQUF3QztZQUNyRCxVQUFVLEVBQUUsc0JBQXNCLE9BQU8sMEJBQTBCO1NBQ3BFLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQXhLRCxnQ0F3S0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0ICogYXMgZWxhc3RpY2FjaGUgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVsYXN0aWNhY2hlJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIENhY2hlU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgLyoqIExvZ2ljYWwgZW52aXJvbm1lbnQgbmFtZSwgZS5nLiBcInN0YWdpbmdcIiBvciBcInByb2RcIi4gVXNlZCBmb3IgbmFtaW5nLiAqL1xuICByZWFkb25seSBlbnZOYW1lOiBzdHJpbmc7XG5cbiAgLyoqIFRoZSBWUEMgaW4gd2hpY2ggdG8gZGVwbG95IHRoZSBFbGFzdGlDYWNoZSBjbHVzdGVyLiAqL1xuICByZWFkb25seSB2cGM6IGVjMi5JVnBjO1xuXG4gIC8qKiBTZWN1cml0eSBncm91cCB0aGF0IGFsbG93cyBFS1Mgbm9kZXMgdG8gY29ubmVjdCB0byBSZWRpcyAocG9ydCA2Mzc5KS4gKi9cbiAgcmVhZG9ubHkgZWxhc3RpQ2FjaGVTZWN1cml0eUdyb3VwOiBlYzIuSVNlY3VyaXR5R3JvdXA7XG59XG5cbi8qKlxuICogQ2FjaGVTdGFja1xuICpcbiAqIFByb3Zpc2lvbnMgYW4gQW1hem9uIEVsYXN0aUNhY2hlIGZvciBSZWRpcyBjbHVzdGVyIGZvciB0aGUgRm9vZCBDb3N0IENhbGN1bGF0b3I6XG4gKlxuICogIOKAoiBSZWRpcyA3LnggY2x1c3RlciBtb2RlIGVuYWJsZWRcbiAqICDigKIgVHdvIHNoYXJkcyAobm9kZSBncm91cHMpIGZvciBob3Jpem9udGFsIHBhcnRpdGlvbmluZ1xuICogIOKAoiBUd28gcmVwbGljYXMgcGVyIHNoYXJkIGZvciBoaWdoIGF2YWlsYWJpbGl0eSAoMyBub2RlcyBwZXIgc2hhcmQ6IDEgcHJpbWFyeSArIDIgcmVwbGljYXMpXG4gKiAg4oCiIE11bHRpLUFaIHJlcGxpY2F0aW9uIGdyb3VwcyDigJQgcmVwbGljYXMgc3ByZWFkIGFjcm9zcyBhdmFpbGFiaWxpdHkgem9uZXNcbiAqICDigKIgQXV0b21hdGljIGZhaWxvdmVyIGVuYWJsZWQg4oCUIEVsYXN0aUNhY2hlIHByb21vdGVzIGEgcmVwbGljYSB0byBwcmltYXJ5IG9uIHByaW1hcnkgZmFpbHVyZVxuICogIOKAoiBEZXBsb3llZCBpbiBwcml2YXRlIGRhdGEgc3VibmV0cyB3aXRoIG5vIGludGVybmV0IGFjY2Vzc1xuICogIOKAoiBBY2Nlc3MgcmVzdHJpY3RlZCB0byBFS1Mgbm9kZXMgdmlhIHNlY3VyaXR5IGdyb3VwIGluZ3Jlc3MgcnVsZSAoZGVmaW5lZCBpbiBOZXR3b3JrU3RhY2spXG4gKlxuICogVXNhZ2U6XG4gKiAgLSBTZXNzaW9uIHRva2VuIHN0b3JlIGZvciBTcHJpbmcgQm9vdCBBUEkgcG9kcyAoU3ByaW5nIFNlc3Npb24gUmVkaXMpXG4gKiAgLSBSZWRpcyBwdWIvc3ViIGNoYW5uZWwgZm9yIHJlYWwtdGltZSBjb3N0IHByb3BhZ2F0aW9uIGV2ZW50cyAodmVudWU6e3ZlbnVlSWR9OmNvc3RzKVxuICogIC0gUXVlcnkgcmVzdWx0IGNhY2hlIGZvciBleHBlbnNpdmUgcmVhZCBvcGVyYXRpb25zIChyZWNpcGUgY29zdGluZyByZXBvcnRzLCBjcm9zcy12ZW51ZSBzdW1tYXJpZXMpXG4gKlxuICogU2F0aXNmaWVzIFJlcXVpcmVtZW50czogMy4zIChjb3N0IHByb3BhZ2F0aW9uIHdpdGhpbiAyIHNlY29uZHMpXG4gKi9cbmV4cG9ydCBjbGFzcyBDYWNoZVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgLyoqXG4gICAqIFRoZSBFbGFzdGlDYWNoZSBSZWRpcyByZXBsaWNhdGlvbiBncm91cC5cbiAgICogRXhwb3J0IHRoZSBjb25maWd1cmF0aW9uIGVuZHBvaW50IGZvciBjbHVzdGVyLW1vZGUgY2xpZW50cy5cbiAgICovXG4gIHB1YmxpYyByZWFkb25seSByZXBsaWNhdGlvbkdyb3VwOiBlbGFzdGljYWNoZS5DZm5SZXBsaWNhdGlvbkdyb3VwO1xuXG4gIC8qKlxuICAgKiBUaGUgc3VibmV0IGdyb3VwIHVzZWQgYnkgRWxhc3RpQ2FjaGUuXG4gICAqIFBsYWNlZCBpbiBwcml2YXRlIGRhdGEgc3VibmV0cyAoc2FtZSBzdWJuZXRzIGFzIEF1cm9yYSBmb3Igc2ltcGxpY2l0eSkuXG4gICAqL1xuICBwdWJsaWMgcmVhZG9ubHkgc3VibmV0R3JvdXA6IGVsYXN0aWNhY2hlLkNmblN1Ym5ldEdyb3VwO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBDYWNoZVN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgZW52TmFtZSwgdnBjLCBlbGFzdGlDYWNoZVNlY3VyaXR5R3JvdXAgfSA9IHByb3BzO1xuXG4gICAgLy8g4pSA4pSAIFN1Ym5ldCBHcm91cCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvL1xuICAgIC8vIEVsYXN0aUNhY2hlIHJlcXVpcmVzIGFuIGV4cGxpY2l0IHN1Ym5ldCBncm91cC5cbiAgICAvLyBXZSBwbGFjZSB0aGUgUmVkaXMgY2x1c3RlciBpbiB0aGUgaXNvbGF0ZWQgc3VibmV0cyAoc2FtZSBhcyBSRFMpLFxuICAgIC8vIGlzb2xhdGVkIGZyb20gdGhlIGludGVybmV0LlxuICAgIGNvbnN0IHByaXZhdGVEYXRhU3VibmV0cyA9IHZwYy5zZWxlY3RTdWJuZXRzKHtcbiAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfSVNPTEFURUQsXG4gICAgfSk7XG5cbiAgICB0aGlzLnN1Ym5ldEdyb3VwID0gbmV3IGVsYXN0aWNhY2hlLkNmblN1Ym5ldEdyb3VwKHRoaXMsICdSZWRpc1N1Ym5ldEdyb3VwJywge1xuICAgICAgc3VibmV0SWRzOiBwcml2YXRlRGF0YVN1Ym5ldHMuc3VibmV0SWRzLFxuICAgICAgZGVzY3JpcHRpb246IGBFbGFzdGlDYWNoZSBSZWRpcyBzdWJuZXQgZ3JvdXAgZm9yIEZvb2QgQ29zdCBDYWxjdWxhdG9yICgke2Vudk5hbWV9KWAsXG4gICAgICBjYWNoZVN1Ym5ldEdyb3VwTmFtZTogYGZjYy1yZWRpcy0ke2Vudk5hbWV9YCxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCBQYXJhbWV0ZXIgR3JvdXAg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBDdXN0b20gcGFyYW1ldGVyIGdyb3VwIGZvciBSZWRpcyA3LnggY2x1c3RlciBtb2RlLlxuICAgIC8vIEVuYWJsZSBjbHVzdGVyIG1vZGUgYW5kIHNldCByZWFzb25hYmxlIGRlZmF1bHRzIGZvciBwdWIvc3ViIGFuZCBjYWNoZSB1c2UgY2FzZXMuXG4gICAgY29uc3QgcGFyYW1ldGVyR3JvdXAgPSBuZXcgZWxhc3RpY2FjaGUuQ2ZuUGFyYW1ldGVyR3JvdXAodGhpcywgJ1JlZGlzUGFyYW1ldGVyR3JvdXAnLCB7XG4gICAgICBjYWNoZVBhcmFtZXRlckdyb3VwRmFtaWx5OiAncmVkaXM3LmNsdXN0ZXIub24nLCAvLyBSZWRpcyA3Lnggd2l0aCBjbHVzdGVyIG1vZGUgZW5hYmxlZFxuICAgICAgZGVzY3JpcHRpb246IGBGb29kIENvc3QgQ2FsY3VsYXRvciBSZWRpcyA3IGNsdXN0ZXIgcGFyYW1ldGVycyAoJHtlbnZOYW1lfSlgLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAvLyBFbmFibGUgUmVkaXMgcHViL3N1YiBmb3IgY29zdCBwcm9wYWdhdGlvbiBldmVudHMuXG4gICAgICAgIC8vIERlZmF1bHQgbm90aWZ5LWtleXNwYWNlLWV2ZW50cyBpcyBlbXB0eTsgd2UgZW5hYmxlIGFsbCBub3RpZmljYXRpb24gdHlwZXMuXG4gICAgICAgICdub3RpZnkta2V5c3BhY2UtZXZlbnRzJzogJ0FLRScsXG5cbiAgICAgICAgLy8gTWF4IG1lbW9yeSBwb2xpY3k6IGV2aWN0IGxlYXN0LXJlY2VudGx5LXVzZWQga2V5cyB3aGVuIG1lbW9yeSBpcyBmdWxsLlxuICAgICAgICAvLyBUaGlzIGlzIHN1aXRhYmxlIGZvciBhIGNhY2hlICsgcHViL3N1YiB3b3JrbG9hZCAocHViL3N1YiBtZXNzYWdlcyBhcmVcbiAgICAgICAgLy8gdHJhbnNpZW50IGFuZCBuZXZlciBldmljdGVkOyBjYWNoZWQgcXVlcnkgcmVzdWx0cyBjYW4gYmUgZXZpY3RlZCkuXG4gICAgICAgICdtYXhtZW1vcnktcG9saWN5JzogJ2FsbGtleXMtbHJ1JyxcblxuICAgICAgICAvLyBUaW1lb3V0IGZvciBpZGxlIGNvbm5lY3Rpb25zIChkZWZhdWx0IDAgPSBubyB0aW1lb3V0KS5cbiAgICAgICAgLy8gU2V0IHRvIDUgbWludXRlcyB0byBjbGVhbiB1cCBzdGFsZSBjb25uZWN0aW9ucy5cbiAgICAgICAgJ3RpbWVvdXQnOiAnMzAwJyxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgUmVwbGljYXRpb24gR3JvdXAgKFJlZGlzIENsdXN0ZXIpIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vXG4gICAgLy8gTXVsdGktQVogcmVwbGljYXRpb24gZ3JvdXAgd2l0aCBjbHVzdGVyIG1vZGUgZW5hYmxlZC5cbiAgICAvL1xuICAgIC8vIENvbmZpZ3VyYXRpb246XG4gICAgLy8gICAtIDIgc2hhcmRzIChudW1Ob2RlR3JvdXBzKVxuICAgIC8vICAgLSAyIHJlcGxpY2FzIHBlciBzaGFyZCAocmVwbGljYXNQZXJOb2RlR3JvdXApIOKAlCB0b3RhbCAzIG5vZGVzIHBlciBzaGFyZFxuICAgIC8vICAgLSBjYWNoZS50NGcubWljcm8gZm9yIHN0YWdpbmc7IGNhY2hlLnI3Zy5sYXJnZSBmb3IgcHJvZCAoQVJNLWJhc2VkIEdyYXZpdG9uMilcbiAgICAvLyAgIC0gQXV0b21hdGljIGZhaWxvdmVyIGVuYWJsZWQgKEVsYXN0aUNhY2hlIGF1dG8tcHJvbW90ZXMgcmVwbGljYSBvbiBwcmltYXJ5IGZhaWx1cmUpXG4gICAgLy8gICAtIE11bHRpLUFaIGVuYWJsZWQgKHJlcGxpY2FzIGRpc3RyaWJ1dGVkIGFjcm9zcyBhdmFpbGFiaWxpdHkgem9uZXMpXG4gICAgLy8gICAtIEF0LXJlc3QgZW5jcnlwdGlvbiBlbmFibGVkIChkZWZhdWx0IENNSylcbiAgICAvLyAgIC0gSW4tdHJhbnNpdCBlbmNyeXB0aW9uIChUTFMpIGVuYWJsZWRcbiAgICAvLyAgIC0gQXV0b21hdGljIG1pbm9yIHZlcnNpb24gdXBncmFkZXMgZW5hYmxlZFxuICAgIC8vICAgLSBNYWludGVuYW5jZSB3aW5kb3c6IFN1bmRheSAwMzowMOKAkzA0OjAwIFVUQ1xuICAgIC8vICAgLSBTbmFwc2hvdCByZXRlbnRpb246IDcgZGF5cyAoZm9yIGRpc2FzdGVyIHJlY292ZXJ5KVxuICAgIC8vICAgLSBEYWlseSBzbmFwc2hvdCB3aW5kb3c6IDAyOjAw4oCTMDM6MDAgVVRDXG4gICAgLy9cbiAgICAvLyBUb3RhbCBjbHVzdGVyIHNpemU6XG4gICAgLy8gICAyIHNoYXJkcyDDlyAzIG5vZGVzIHBlciBzaGFyZCA9IDYgbm9kZXMgKDIgcHJpbWFyaWVzLCA0IHJlcGxpY2FzKVxuXG4gICAgdGhpcy5yZXBsaWNhdGlvbkdyb3VwID0gbmV3IGVsYXN0aWNhY2hlLkNmblJlcGxpY2F0aW9uR3JvdXAodGhpcywgJ1JlZGlzQ2x1c3RlcicsIHtcbiAgICAgIHJlcGxpY2F0aW9uR3JvdXBJZDogYGZjYy1yZWRpcy0ke2Vudk5hbWV9YCxcbiAgICAgIHJlcGxpY2F0aW9uR3JvdXBEZXNjcmlwdGlvbjogYEZvb2QgQ29zdCBDYWxjdWxhdG9yIFJlZGlzIGNsdXN0ZXIgKCR7ZW52TmFtZX0pYCxcblxuICAgICAgLy8g4pSA4pSAIEVuZ2luZSBDb25maWd1cmF0aW9uIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgZW5naW5lOiAncmVkaXMnLFxuICAgICAgZW5naW5lVmVyc2lvbjogJzcuMScsIC8vIExhdGVzdCBzdGFibGUgUmVkaXMgNy54XG4gICAgICBjYWNoZU5vZGVUeXBlOiBlbnZOYW1lID09PSAncHJvZCcgPyAnY2FjaGUucjdnLmxhcmdlJyA6ICdjYWNoZS50NGcubWljcm8nLFxuICAgICAgY2FjaGVQYXJhbWV0ZXJHcm91cE5hbWU6IHBhcmFtZXRlckdyb3VwLnJlZixcblxuICAgICAgLy8g4pSA4pSAIENsdXN0ZXIgTW9kZSBDb25maWd1cmF0aW9uIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgLy8gRW5hYmxlIGNsdXN0ZXIgbW9kZSB3aXRoIDIgc2hhcmRzIGFuZCAyIHJlcGxpY2FzIHBlciBzaGFyZC5cbiAgICAgIG51bU5vZGVHcm91cHM6IDIsIC8vIG51bWJlciBvZiBzaGFyZHNcbiAgICAgIHJlcGxpY2FzUGVyTm9kZUdyb3VwOiAyLCAvLyBudW1iZXIgb2YgcmVwbGljYXMgcGVyIHNoYXJkICh0b3RhbCAzIG5vZGVzIHBlciBzaGFyZClcblxuICAgICAgLy8g4pSA4pSAIEhpZ2ggQXZhaWxhYmlsaXR5IOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgYXV0b21hdGljRmFpbG92ZXJFbmFibGVkOiB0cnVlLCAvLyBhdXRvLXByb21vdGUgcmVwbGljYSBvbiBwcmltYXJ5IGZhaWx1cmVcbiAgICAgIG11bHRpQXpFbmFibGVkOiB0cnVlLCAvLyBkaXN0cmlidXRlIHJlcGxpY2FzIGFjcm9zcyBBWnNcblxuICAgICAgLy8g4pSA4pSAIE5ldHdvcmsgQ29uZmlndXJhdGlvbiDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIGNhY2hlU3VibmV0R3JvdXBOYW1lOiB0aGlzLnN1Ym5ldEdyb3VwLnJlZixcbiAgICAgIHNlY3VyaXR5R3JvdXBJZHM6IFtlbGFzdGlDYWNoZVNlY3VyaXR5R3JvdXAuc2VjdXJpdHlHcm91cElkXSxcblxuICAgICAgLy8gUG9ydCA2Mzc5IGlzIHRoZSBkZWZhdWx0IFJlZGlzIHBvcnQ7IGV4cGxpY2l0bHkgc2V0IGZvciBjbGFyaXR5LlxuICAgICAgcG9ydDogNjM3OSxcblxuICAgICAgLy8g4pSA4pSAIEVuY3J5cHRpb24g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgICBhdFJlc3RFbmNyeXB0aW9uRW5hYmxlZDogdHJ1ZSxcbiAgICAgIHRyYW5zaXRFbmNyeXB0aW9uRW5hYmxlZDogdHJ1ZSxcbiAgICAgIC8vIEZvciBUTFMtZW5hYmxlZCBjbHVzdGVycywgU3ByaW5nIEJvb3QncyBMZXR0dWNlIGNsaWVudCByZXF1aXJlcyBUTFMgY29uZmlndXJhdGlvbi5cbiAgICAgIC8vIFJlZGlzIEFVVEggaXMgbm90IGV4cGxpY2l0bHkgY29uZmlndXJlZCBoZXJlIChhdXRoVG9rZW4gaXMgb3B0aW9uYWwgZm9yIFZQQy1pc29sYXRlZFxuICAgICAgLy8gY2x1c3RlcnMpLiBJZiBuZWVkZWQgZm9yIGNvbXBsaWFuY2UsIHNldCBhdXRoVG9rZW4gdmlhIFNlY3JldHMgTWFuYWdlci5cblxuICAgICAgLy8g4pSA4pSAIE1haW50ZW5hbmNlIGFuZCBCYWNrdXAg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgICBhdXRvTWlub3JWZXJzaW9uVXBncmFkZTogdHJ1ZSxcbiAgICAgIHByZWZlcnJlZE1haW50ZW5hbmNlV2luZG93OiAnc3VuOjAzOjAwLXN1bjowNDowMCcsIC8vIFN1bmRheSAz4oCTNCBBTSBVVENcbiAgICAgIHNuYXBzaG90UmV0ZW50aW9uTGltaXQ6IDcsIC8vIHJldGFpbiBkYWlseSBzbmFwc2hvdHMgZm9yIDcgZGF5c1xuICAgICAgc25hcHNob3RXaW5kb3c6ICcwMjowMC0wMzowMCcsIC8vIGRhaWx5IHNuYXBzaG90IGF0IDLigJMzIEFNIFVUQ1xuXG4gICAgICAvLyDilIDilIAgTG9nZ2luZyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIC8vIEVuYWJsZSBDbG91ZFdhdGNoIExvZ3MgZm9yIHNsb3cgcXVlcmllcyBhbmQgZW5naW5lIGxvZ3MuXG4gICAgICBsb2dEZWxpdmVyeUNvbmZpZ3VyYXRpb25zOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBkZXN0aW5hdGlvblR5cGU6ICdjbG91ZHdhdGNoLWxvZ3MnLFxuICAgICAgICAgIGxvZ0Zvcm1hdDogJ2pzb24nLFxuICAgICAgICAgIGxvZ1R5cGU6ICdzbG93LWxvZycsXG4gICAgICAgICAgZGVzdGluYXRpb25EZXRhaWxzOiB7XG4gICAgICAgICAgICBjbG91ZFdhdGNoTG9nc0RldGFpbHM6IHtcbiAgICAgICAgICAgICAgbG9nR3JvdXA6IGAvYXdzL2VsYXN0aWNhY2hlLyR7ZW52TmFtZX0vcmVkaXMvc2xvdy1sb2dgLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgZGVzdGluYXRpb25UeXBlOiAnY2xvdWR3YXRjaC1sb2dzJyxcbiAgICAgICAgICBsb2dGb3JtYXQ6ICdqc29uJyxcbiAgICAgICAgICBsb2dUeXBlOiAnZW5naW5lLWxvZycsXG4gICAgICAgICAgZGVzdGluYXRpb25EZXRhaWxzOiB7XG4gICAgICAgICAgICBjbG91ZFdhdGNoTG9nc0RldGFpbHM6IHtcbiAgICAgICAgICAgICAgbG9nR3JvdXA6IGAvYXdzL2VsYXN0aWNhY2hlLyR7ZW52TmFtZX0vcmVkaXMvZW5naW5lLWxvZ2AsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gRXhwbGljaXQgZGVwZW5kZW5jeTogcmVwbGljYXRpb24gZ3JvdXAgcmVxdWlyZXMgdGhlIHN1Ym5ldCBncm91cCB0byBleGlzdCBmaXJzdC5cbiAgICB0aGlzLnJlcGxpY2F0aW9uR3JvdXAuYWRkRGVwZW5kZW5jeSh0aGlzLnN1Ym5ldEdyb3VwKTtcblxuICAgIC8vIOKUgOKUgCBDbG91ZEZvcm1hdGlvbiBPdXRwdXRzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vIEV4cG9ydCB0aGUgY29uZmlndXJhdGlvbiBlbmRwb2ludCBmb3IgY2x1c3Rlci1tb2RlIGNsaWVudHMuXG4gICAgLy8gRm9yIGNsdXN0ZXIgbW9kZSwgY2xpZW50cyBzaG91bGQgdXNlIHRoZSBjb25maWd1cmF0aW9uIGVuZHBvaW50IChub3QgaW5kaXZpZHVhbFxuICAgIC8vIG5vZGUgZW5kcG9pbnRzKS4gU3ByaW5nIEJvb3QncyBMZXR0dWNlIGNsaWVudCBhdXRvLWRpc2NvdmVycyBhbGwgY2x1c3RlciBub2Rlc1xuICAgIC8vIGZyb20gdGhlIGNvbmZpZ3VyYXRpb24gZW5kcG9pbnQuXG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmVkaXNDb25maWd1cmF0aW9uRW5kcG9pbnQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5yZXBsaWNhdGlvbkdyb3VwLmF0dHJDb25maWd1cmF0aW9uRW5kUG9pbnRBZGRyZXNzLFxuICAgICAgZGVzY3JpcHRpb246ICdFbGFzdGlDYWNoZSBSZWRpcyBjbHVzdGVyIGNvbmZpZ3VyYXRpb24gZW5kcG9pbnQgKGFkZHJlc3MpJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1SZWRpc0NvbmZpZ3VyYXRpb25FbmRwb2ludEFkZHJlc3NgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1JlZGlzQ29uZmlndXJhdGlvbkVuZHBvaW50UG9ydCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnJlcGxpY2F0aW9uR3JvdXAuYXR0ckNvbmZpZ3VyYXRpb25FbmRQb2ludFBvcnQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0VsYXN0aUNhY2hlIFJlZGlzIGNsdXN0ZXIgY29uZmlndXJhdGlvbiBlbmRwb2ludCAocG9ydCknLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LVJlZGlzQ29uZmlndXJhdGlvbkVuZHBvaW50UG9ydGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmVkaXNSZXBsaWNhdGlvbkdyb3VwSWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5yZXBsaWNhdGlvbkdyb3VwLnJlcGxpY2F0aW9uR3JvdXBJZCB8fCAnJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRWxhc3RpQ2FjaGUgUmVkaXMgcmVwbGljYXRpb24gZ3JvdXAgSUQnLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LVJlZGlzUmVwbGljYXRpb25Hcm91cElkYCxcbiAgICB9KTtcbiAgfVxufVxuIl19