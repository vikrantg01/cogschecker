"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RdsStack = void 0;
const cdk = require("aws-cdk-lib");
const ec2 = require("aws-cdk-lib/aws-ec2");
const rds = require("aws-cdk-lib/aws-rds");
const secretsmanager = require("aws-cdk-lib/aws-secretsmanager");
/**
 * RdsStack
 *
 * Cost-optimized PostgreSQL database using RDS (not Aurora):
 *
 *  • RDS PostgreSQL 15 (not Aurora Serverless v2)
 *  • db.t4g.micro Multi-AZ for HA (ARM-based, cheaper)
 *  • Automated backups (7-day retention)
 *  • Encryption at rest (AWS-managed keys)
 *  • SSL/TLS enforcement
 *  • Deployed in private subnets
 *  • Credentials in Secrets Manager
 *
 * Cost savings vs Aurora Serverless v2:
 *  - RDS t4g.micro Multi-AZ: ~$50-60/month
 *  - Aurora Serverless v2: ~$250-400/month
 *  - **Savings: $200-350/month** (80% reduction)
 *
 * Trade-offs:
 *  - Fixed compute (not auto-scaling)
 *  - Slower failover (1-2 min vs 30 sec)
 *  - Manual scaling (restart required)
 *
 * For 50-100 cafes, t4g.micro is sufficient (2 vCPU, 1 GB RAM).
 */
class RdsStack extends cdk.Stack {
    /** The RDS PostgreSQL instance */
    instance;
    /** Secrets Manager secret containing credentials */
    secret;
    /** Database endpoint hostname */
    endpoint;
    /** Database name */
    databaseName = 'foodcost';
    constructor(scope, id, props) {
        super(scope, id, props);
        const { envName, vpc, rdsSecurityGroup } = props;
        // ── Secrets Manager — Database Credentials ──────────────────────────────
        this.secret = new secretsmanager.Secret(this, 'DatabaseCredentials', {
            secretName: `foodcost/${envName}/database/credentials`,
            description: `RDS PostgreSQL credentials for Food Cost Calculator (${envName})`,
            generateSecretString: {
                secretStringTemplate: JSON.stringify({
                    username: 'postgres',
                }),
                generateStringKey: 'password',
                excludeCharacters: '"@/\\\'', // Avoid shell escaping issues
                passwordLength: 32,
            },
        });
        // ── Parameter Group — SSL Enforcement ───────────────────────────────────
        const parameterGroup = new rds.ParameterGroup(this, 'ParameterGroup', {
            engine: rds.DatabaseInstanceEngine.postgres({
                version: rds.PostgresEngineVersion.VER_15_4,
            }),
            description: `RDS PostgreSQL parameter group for Food Cost Calculator (${envName})`,
            parameters: {
                'rds.force_ssl': '1', // Enforce SSL/TLS connections
            },
        });
        // ── Subnet Group — Private Subnets ──────────────────────────────────────
        const subnetGroup = new rds.SubnetGroup(this, 'SubnetGroup', {
            description: `RDS PostgreSQL subnet group for Food Cost Calculator (${envName})`,
            vpc,
            vpcSubnets: vpc.selectSubnets({
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            }),
            subnetGroupName: `foodcost-rds-${envName}`,
        });
        // ── RDS PostgreSQL Instance ─────────────────────────────────────────────
        //
        // db.t4g.micro (ARM-based Graviton2):
        //  - 2 vCPU, 1 GB RAM
        //  - Burstable performance (T4g baseline: 10% CPU, bursts to 100%)
        //  - 20% cheaper than t3.micro (Intel)
        //  - Sufficient for 50-100 cafe workload
        //
        // Multi-AZ:
        //  - Synchronous standby in second AZ
        //  - Automatic failover (1-2 minutes)
        //  - ~2x cost of single-AZ but worth it for production
        //
        this.instance = new rds.DatabaseInstance(this, 'Instance', {
            engine: rds.DatabaseInstanceEngine.postgres({
                version: rds.PostgresEngineVersion.VER_15_4,
            }),
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, // ARM-based (Graviton2)
            ec2.InstanceSize.MICRO),
            instanceIdentifier: `foodcost-db-${envName}`,
            databaseName: this.databaseName,
            // Credentials from Secrets Manager
            credentials: rds.Credentials.fromSecret(this.secret),
            vpc,
            vpcSubnets: vpc.selectSubnets({
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            }),
            securityGroups: [rdsSecurityGroup],
            subnetGroup,
            parameterGroup,
            // Multi-AZ for high availability
            multiAz: envName === 'prod',
            // Storage
            allocatedStorage: 20, // GB (minimum for gp3)
            storageType: rds.StorageType.GP3, // General Purpose SSD v3 (cheaper than gp2)
            maxAllocatedStorage: 100, // Auto-scaling up to 100 GB
            storageEncrypted: true, // Encryption at rest (AWS-managed key)
            // Backup
            backupRetention: cdk.Duration.days(7),
            preferredBackupWindow: '03:00-04:00', // UTC (off-peak)
            copyTagsToSnapshot: true,
            // Maintenance
            autoMinorVersionUpgrade: true,
            preferredMaintenanceWindow: 'sun:04:00-sun:05:00', // Sunday 4-5 AM UTC
            // Monitoring
            monitoringInterval: cdk.Duration.seconds(60), // Enhanced monitoring
            enablePerformanceInsights: false, // Disable to save cost (can enable later)
            cloudwatchLogsExports: ['postgresql'], // Export logs to CloudWatch
            // Deletion protection
            deletionProtection: envName === 'prod',
            removalPolicy: envName === 'prod' ? cdk.RemovalPolicy.SNAPSHOT : cdk.RemovalPolicy.DESTROY,
        });
        this.endpoint = this.instance.dbInstanceEndpointAddress;
        // ── CloudFormation Outputs ───────────────────────────────────────────────
        new cdk.CfnOutput(this, 'SecretArn', {
            value: this.secret.secretArn,
            description: 'Secrets Manager ARN for database credentials',
            exportName: `FoodCostCalculator-${envName}-DatabaseSecretArn`,
        });
        new cdk.CfnOutput(this, 'Endpoint', {
            value: this.instance.dbInstanceEndpointAddress,
            description: 'RDS PostgreSQL endpoint hostname',
            exportName: `FoodCostCalculator-${envName}-DatabaseEndpoint`,
        });
        new cdk.CfnOutput(this, 'Port', {
            value: this.instance.dbInstanceEndpointPort,
            description: 'RDS PostgreSQL port',
            exportName: `FoodCostCalculator-${envName}-DatabasePort`,
        });
        new cdk.CfnOutput(this, 'DatabaseName', {
            value: this.databaseName,
            description: 'Database name',
            exportName: `FoodCostCalculator-${envName}-DatabaseName`,
        });
        // ── Tags ─────────────────────────────────────────────────────────────────
        cdk.Tags.of(this).add('Component', 'Database');
        cdk.Tags.of(this).add('CostCenter', 'Data');
    }
}
exports.RdsStack = RdsStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUmRzU3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9saWIvc3RhY2tzL1Jkc1N0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQywyQ0FBMkM7QUFDM0MsMkNBQTJDO0FBQzNDLGlFQUFpRTtBQWNqRTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBd0JHO0FBQ0gsTUFBYSxRQUFTLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDckMsa0NBQWtDO0lBQ2xCLFFBQVEsQ0FBdUI7SUFFL0Msb0RBQW9EO0lBQ3BDLE1BQU0sQ0FBeUI7SUFFL0MsaUNBQWlDO0lBQ2pCLFFBQVEsQ0FBUztJQUVqQyxvQkFBb0I7SUFDSixZQUFZLEdBQVcsVUFBVSxDQUFDO0lBRWxELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBb0I7UUFDNUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLE9BQU8sRUFBRSxHQUFHLEVBQUUsZ0JBQWdCLEVBQUUsR0FBRyxLQUFLLENBQUM7UUFFakQsMkVBQTJFO1FBQzNFLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxjQUFjLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxxQkFBcUIsRUFBRTtZQUNuRSxVQUFVLEVBQUUsWUFBWSxPQUFPLHVCQUF1QjtZQUN0RCxXQUFXLEVBQUUsd0RBQXdELE9BQU8sR0FBRztZQUMvRSxvQkFBb0IsRUFBRTtnQkFDcEIsb0JBQW9CLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztvQkFDbkMsUUFBUSxFQUFFLFVBQVU7aUJBQ3JCLENBQUM7Z0JBQ0YsaUJBQWlCLEVBQUUsVUFBVTtnQkFDN0IsaUJBQWlCLEVBQUUsU0FBUyxFQUFFLDhCQUE4QjtnQkFDNUQsY0FBYyxFQUFFLEVBQUU7YUFDbkI7U0FDRixDQUFDLENBQUM7UUFFSCwyRUFBMkU7UUFDM0UsTUFBTSxjQUFjLEdBQUcsSUFBSSxHQUFHLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUNwRSxNQUFNLEVBQUUsR0FBRyxDQUFDLHNCQUFzQixDQUFDLFFBQVEsQ0FBQztnQkFDMUMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxxQkFBcUIsQ0FBQyxRQUFRO2FBQzVDLENBQUM7WUFDRixXQUFXLEVBQUUsNERBQTRELE9BQU8sR0FBRztZQUNuRixVQUFVLEVBQUU7Z0JBQ1YsZUFBZSxFQUFFLEdBQUcsRUFBRSw4QkFBOEI7YUFDckQ7U0FDRixDQUFDLENBQUM7UUFFSCwyRUFBMkU7UUFDM0UsTUFBTSxXQUFXLEdBQUcsSUFBSSxHQUFHLENBQUMsV0FBVyxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDM0QsV0FBVyxFQUFFLHlEQUF5RCxPQUFPLEdBQUc7WUFDaEYsR0FBRztZQUNILFVBQVUsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDO2dCQUM1QixVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxnQkFBZ0I7YUFDNUMsQ0FBQztZQUNGLGVBQWUsRUFBRSxnQkFBZ0IsT0FBTyxFQUFFO1NBQzNDLENBQUMsQ0FBQztRQUVILDJFQUEyRTtRQUMzRSxFQUFFO1FBQ0Ysc0NBQXNDO1FBQ3RDLHNCQUFzQjtRQUN0QixtRUFBbUU7UUFDbkUsdUNBQXVDO1FBQ3ZDLHlDQUF5QztRQUN6QyxFQUFFO1FBQ0YsWUFBWTtRQUNaLHNDQUFzQztRQUN0QyxzQ0FBc0M7UUFDdEMsdURBQXVEO1FBQ3ZELEVBQUU7UUFDRixJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksR0FBRyxDQUFDLGdCQUFnQixDQUFDLElBQUksRUFBRSxVQUFVLEVBQUU7WUFDekQsTUFBTSxFQUFFLEdBQUcsQ0FBQyxzQkFBc0IsQ0FBQyxRQUFRLENBQUM7Z0JBQzFDLE9BQU8sRUFBRSxHQUFHLENBQUMscUJBQXFCLENBQUMsUUFBUTthQUM1QyxDQUFDO1lBQ0YsWUFBWSxFQUFFLEdBQUcsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUMvQixHQUFHLENBQUMsYUFBYSxDQUFDLEdBQUcsRUFBRSx3QkFBd0I7WUFDL0MsR0FBRyxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQ3ZCO1lBQ0Qsa0JBQWtCLEVBQUUsZUFBZSxPQUFPLEVBQUU7WUFDNUMsWUFBWSxFQUFFLElBQUksQ0FBQyxZQUFZO1lBRS9CLG1DQUFtQztZQUNuQyxXQUFXLEVBQUUsR0FBRyxDQUFDLFdBQVcsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQztZQUVwRCxHQUFHO1lBQ0gsVUFBVSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUM7Z0JBQzVCLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLGdCQUFnQjthQUM1QyxDQUFDO1lBQ0YsY0FBYyxFQUFFLENBQUMsZ0JBQWdCLENBQUM7WUFDbEMsV0FBVztZQUVYLGNBQWM7WUFFZCxpQ0FBaUM7WUFDakMsT0FBTyxFQUFFLE9BQU8sS0FBSyxNQUFNO1lBRTNCLFVBQVU7WUFDVixnQkFBZ0IsRUFBRSxFQUFFLEVBQUUsdUJBQXVCO1lBQzdDLFdBQVcsRUFBRSxHQUFHLENBQUMsV0FBVyxDQUFDLEdBQUcsRUFBRSw0Q0FBNEM7WUFDOUUsbUJBQW1CLEVBQUUsR0FBRyxFQUFFLDRCQUE0QjtZQUN0RCxnQkFBZ0IsRUFBRSxJQUFJLEVBQUUsdUNBQXVDO1lBRS9ELFNBQVM7WUFDVCxlQUFlLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO1lBQ3JDLHFCQUFxQixFQUFFLGFBQWEsRUFBRSxpQkFBaUI7WUFDdkQsa0JBQWtCLEVBQUUsSUFBSTtZQUV4QixjQUFjO1lBQ2QsdUJBQXVCLEVBQUUsSUFBSTtZQUM3QiwwQkFBMEIsRUFBRSxxQkFBcUIsRUFBRSxvQkFBb0I7WUFFdkUsYUFBYTtZQUNiLGtCQUFrQixFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxFQUFFLHNCQUFzQjtZQUNwRSx5QkFBeUIsRUFBRSxLQUFLLEVBQUUsMENBQTBDO1lBQzVFLHFCQUFxQixFQUFFLENBQUMsWUFBWSxDQUFDLEVBQUUsNEJBQTRCO1lBRW5FLHNCQUFzQjtZQUN0QixrQkFBa0IsRUFBRSxPQUFPLEtBQUssTUFBTTtZQUN0QyxhQUFhLEVBQUUsT0FBTyxLQUFLLE1BQU0sQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsT0FBTztTQUMzRixDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMseUJBQXlCLENBQUM7UUFFeEQsNEVBQTRFO1FBQzVFLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsV0FBVyxFQUFFO1lBQ25DLEtBQUssRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVM7WUFDNUIsV0FBVyxFQUFFLDhDQUE4QztZQUMzRCxVQUFVLEVBQUUsc0JBQXNCLE9BQU8sb0JBQW9CO1NBQzlELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsVUFBVSxFQUFFO1lBQ2xDLEtBQUssRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLHlCQUF5QjtZQUM5QyxXQUFXLEVBQUUsa0NBQWtDO1lBQy9DLFVBQVUsRUFBRSxzQkFBc0IsT0FBTyxtQkFBbUI7U0FDN0QsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUU7WUFDOUIsS0FBSyxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsc0JBQXNCO1lBQzNDLFdBQVcsRUFBRSxxQkFBcUI7WUFDbEMsVUFBVSxFQUFFLHNCQUFzQixPQUFPLGVBQWU7U0FDekQsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDdEMsS0FBSyxFQUFFLElBQUksQ0FBQyxZQUFZO1lBQ3hCLFdBQVcsRUFBRSxlQUFlO1lBQzVCLFVBQVUsRUFBRSxzQkFBc0IsT0FBTyxlQUFlO1NBQ3pELENBQUMsQ0FBQztRQUVILDRFQUE0RTtRQUM1RSxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsV0FBVyxFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBQy9DLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxZQUFZLEVBQUUsTUFBTSxDQUFDLENBQUM7SUFDOUMsQ0FBQztDQUNGO0FBcEpELDRCQW9KQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgKiBhcyByZHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXJkcyc7XG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmRzU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgLyoqIExvZ2ljYWwgZW52aXJvbm1lbnQgbmFtZSwgZS5nLiBcInN0YWdpbmdcIiBvciBcInByb2RcIiAqL1xuICByZWFkb25seSBlbnZOYW1lOiBzdHJpbmc7XG5cbiAgLyoqIFZQQyB3aGVyZSB0aGUgUkRTIGluc3RhbmNlIHdpbGwgYmUgZGVwbG95ZWQgKi9cbiAgcmVhZG9ubHkgdnBjOiBlYzIuSVZwYztcblxuICAvKiogU2VjdXJpdHkgZ3JvdXAgZm9yIFJEUyBpbnN0YW5jZSAqL1xuICByZWFkb25seSByZHNTZWN1cml0eUdyb3VwOiBlYzIuSVNlY3VyaXR5R3JvdXA7XG59XG5cbi8qKlxuICogUmRzU3RhY2tcbiAqXG4gKiBDb3N0LW9wdGltaXplZCBQb3N0Z3JlU1FMIGRhdGFiYXNlIHVzaW5nIFJEUyAobm90IEF1cm9yYSk6XG4gKlxuICogIOKAoiBSRFMgUG9zdGdyZVNRTCAxNSAobm90IEF1cm9yYSBTZXJ2ZXJsZXNzIHYyKVxuICogIOKAoiBkYi50NGcubWljcm8gTXVsdGktQVogZm9yIEhBIChBUk0tYmFzZWQsIGNoZWFwZXIpXG4gKiAg4oCiIEF1dG9tYXRlZCBiYWNrdXBzICg3LWRheSByZXRlbnRpb24pXG4gKiAg4oCiIEVuY3J5cHRpb24gYXQgcmVzdCAoQVdTLW1hbmFnZWQga2V5cylcbiAqICDigKIgU1NML1RMUyBlbmZvcmNlbWVudFxuICogIOKAoiBEZXBsb3llZCBpbiBwcml2YXRlIHN1Ym5ldHNcbiAqICDigKIgQ3JlZGVudGlhbHMgaW4gU2VjcmV0cyBNYW5hZ2VyXG4gKlxuICogQ29zdCBzYXZpbmdzIHZzIEF1cm9yYSBTZXJ2ZXJsZXNzIHYyOlxuICogIC0gUkRTIHQ0Zy5taWNybyBNdWx0aS1BWjogfiQ1MC02MC9tb250aFxuICogIC0gQXVyb3JhIFNlcnZlcmxlc3MgdjI6IH4kMjUwLTQwMC9tb250aFxuICogIC0gKipTYXZpbmdzOiAkMjAwLTM1MC9tb250aCoqICg4MCUgcmVkdWN0aW9uKVxuICpcbiAqIFRyYWRlLW9mZnM6XG4gKiAgLSBGaXhlZCBjb21wdXRlIChub3QgYXV0by1zY2FsaW5nKVxuICogIC0gU2xvd2VyIGZhaWxvdmVyICgxLTIgbWluIHZzIDMwIHNlYylcbiAqICAtIE1hbnVhbCBzY2FsaW5nIChyZXN0YXJ0IHJlcXVpcmVkKVxuICpcbiAqIEZvciA1MC0xMDAgY2FmZXMsIHQ0Zy5taWNybyBpcyBzdWZmaWNpZW50ICgyIHZDUFUsIDEgR0IgUkFNKS5cbiAqL1xuZXhwb3J0IGNsYXNzIFJkc1N0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgLyoqIFRoZSBSRFMgUG9zdGdyZVNRTCBpbnN0YW5jZSAqL1xuICBwdWJsaWMgcmVhZG9ubHkgaW5zdGFuY2U6IHJkcy5EYXRhYmFzZUluc3RhbmNlO1xuXG4gIC8qKiBTZWNyZXRzIE1hbmFnZXIgc2VjcmV0IGNvbnRhaW5pbmcgY3JlZGVudGlhbHMgKi9cbiAgcHVibGljIHJlYWRvbmx5IHNlY3JldDogc2VjcmV0c21hbmFnZXIuSVNlY3JldDtcblxuICAvKiogRGF0YWJhc2UgZW5kcG9pbnQgaG9zdG5hbWUgKi9cbiAgcHVibGljIHJlYWRvbmx5IGVuZHBvaW50OiBzdHJpbmc7XG5cbiAgLyoqIERhdGFiYXNlIG5hbWUgKi9cbiAgcHVibGljIHJlYWRvbmx5IGRhdGFiYXNlTmFtZTogc3RyaW5nID0gJ2Zvb2Rjb3N0JztcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogUmRzU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgeyBlbnZOYW1lLCB2cGMsIHJkc1NlY3VyaXR5R3JvdXAgfSA9IHByb3BzO1xuXG4gICAgLy8g4pSA4pSAIFNlY3JldHMgTWFuYWdlciDigJQgRGF0YWJhc2UgQ3JlZGVudGlhbHMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgdGhpcy5zZWNyZXQgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdEYXRhYmFzZUNyZWRlbnRpYWxzJywge1xuICAgICAgc2VjcmV0TmFtZTogYGZvb2Rjb3N0LyR7ZW52TmFtZX0vZGF0YWJhc2UvY3JlZGVudGlhbHNgLFxuICAgICAgZGVzY3JpcHRpb246IGBSRFMgUG9zdGdyZVNRTCBjcmVkZW50aWFscyBmb3IgRm9vZCBDb3N0IENhbGN1bGF0b3IgKCR7ZW52TmFtZX0pYCxcbiAgICAgIGdlbmVyYXRlU2VjcmV0U3RyaW5nOiB7XG4gICAgICAgIHNlY3JldFN0cmluZ1RlbXBsYXRlOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgdXNlcm5hbWU6ICdwb3N0Z3JlcycsXG4gICAgICAgIH0pLFxuICAgICAgICBnZW5lcmF0ZVN0cmluZ0tleTogJ3Bhc3N3b3JkJyxcbiAgICAgICAgZXhjbHVkZUNoYXJhY3RlcnM6ICdcIkAvXFxcXFxcJycsIC8vIEF2b2lkIHNoZWxsIGVzY2FwaW5nIGlzc3Vlc1xuICAgICAgICBwYXNzd29yZExlbmd0aDogMzIsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSAIFBhcmFtZXRlciBHcm91cCDigJQgU1NMIEVuZm9yY2VtZW50IOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIGNvbnN0IHBhcmFtZXRlckdyb3VwID0gbmV3IHJkcy5QYXJhbWV0ZXJHcm91cCh0aGlzLCAnUGFyYW1ldGVyR3JvdXAnLCB7XG4gICAgICBlbmdpbmU6IHJkcy5EYXRhYmFzZUluc3RhbmNlRW5naW5lLnBvc3RncmVzKHtcbiAgICAgICAgdmVyc2lvbjogcmRzLlBvc3RncmVzRW5naW5lVmVyc2lvbi5WRVJfMTVfNCxcbiAgICAgIH0pLFxuICAgICAgZGVzY3JpcHRpb246IGBSRFMgUG9zdGdyZVNRTCBwYXJhbWV0ZXIgZ3JvdXAgZm9yIEZvb2QgQ29zdCBDYWxjdWxhdG9yICgke2Vudk5hbWV9KWAsXG4gICAgICBwYXJhbWV0ZXJzOiB7XG4gICAgICAgICdyZHMuZm9yY2Vfc3NsJzogJzEnLCAvLyBFbmZvcmNlIFNTTC9UTFMgY29ubmVjdGlvbnNcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgU3VibmV0IEdyb3VwIOKAlCBQcml2YXRlIFN1Ym5ldHMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgY29uc3Qgc3VibmV0R3JvdXAgPSBuZXcgcmRzLlN1Ym5ldEdyb3VwKHRoaXMsICdTdWJuZXRHcm91cCcsIHtcbiAgICAgIGRlc2NyaXB0aW9uOiBgUkRTIFBvc3RncmVTUUwgc3VibmV0IGdyb3VwIGZvciBGb29kIENvc3QgQ2FsY3VsYXRvciAoJHtlbnZOYW1lfSlgLFxuICAgICAgdnBjLFxuICAgICAgdnBjU3VibmV0czogdnBjLnNlbGVjdFN1Ym5ldHMoe1xuICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX0lTT0xBVEVELFxuICAgICAgfSksXG4gICAgICBzdWJuZXRHcm91cE5hbWU6IGBmb29kY29zdC1yZHMtJHtlbnZOYW1lfWAsXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgUkRTIFBvc3RncmVTUUwgSW5zdGFuY2Ug4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBkYi50NGcubWljcm8gKEFSTS1iYXNlZCBHcmF2aXRvbjIpOlxuICAgIC8vICAtIDIgdkNQVSwgMSBHQiBSQU1cbiAgICAvLyAgLSBCdXJzdGFibGUgcGVyZm9ybWFuY2UgKFQ0ZyBiYXNlbGluZTogMTAlIENQVSwgYnVyc3RzIHRvIDEwMCUpXG4gICAgLy8gIC0gMjAlIGNoZWFwZXIgdGhhbiB0My5taWNybyAoSW50ZWwpXG4gICAgLy8gIC0gU3VmZmljaWVudCBmb3IgNTAtMTAwIGNhZmUgd29ya2xvYWRcbiAgICAvL1xuICAgIC8vIE11bHRpLUFaOlxuICAgIC8vICAtIFN5bmNocm9ub3VzIHN0YW5kYnkgaW4gc2Vjb25kIEFaXG4gICAgLy8gIC0gQXV0b21hdGljIGZhaWxvdmVyICgxLTIgbWludXRlcylcbiAgICAvLyAgLSB+MnggY29zdCBvZiBzaW5nbGUtQVogYnV0IHdvcnRoIGl0IGZvciBwcm9kdWN0aW9uXG4gICAgLy9cbiAgICB0aGlzLmluc3RhbmNlID0gbmV3IHJkcy5EYXRhYmFzZUluc3RhbmNlKHRoaXMsICdJbnN0YW5jZScsIHtcbiAgICAgIGVuZ2luZTogcmRzLkRhdGFiYXNlSW5zdGFuY2VFbmdpbmUucG9zdGdyZXMoe1xuICAgICAgICB2ZXJzaW9uOiByZHMuUG9zdGdyZXNFbmdpbmVWZXJzaW9uLlZFUl8xNV80LFxuICAgICAgfSksXG4gICAgICBpbnN0YW5jZVR5cGU6IGVjMi5JbnN0YW5jZVR5cGUub2YoXG4gICAgICAgIGVjMi5JbnN0YW5jZUNsYXNzLlQ0RywgLy8gQVJNLWJhc2VkIChHcmF2aXRvbjIpXG4gICAgICAgIGVjMi5JbnN0YW5jZVNpemUuTUlDUk8sIC8vIDIgdkNQVSwgMSBHQiBSQU1cbiAgICAgICksXG4gICAgICBpbnN0YW5jZUlkZW50aWZpZXI6IGBmb29kY29zdC1kYi0ke2Vudk5hbWV9YCxcbiAgICAgIGRhdGFiYXNlTmFtZTogdGhpcy5kYXRhYmFzZU5hbWUsXG5cbiAgICAgIC8vIENyZWRlbnRpYWxzIGZyb20gU2VjcmV0cyBNYW5hZ2VyXG4gICAgICBjcmVkZW50aWFsczogcmRzLkNyZWRlbnRpYWxzLmZyb21TZWNyZXQodGhpcy5zZWNyZXQpLFxuXG4gICAgICB2cGMsXG4gICAgICB2cGNTdWJuZXRzOiB2cGMuc2VsZWN0U3VibmV0cyh7XG4gICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfSVNPTEFURUQsXG4gICAgICB9KSxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbcmRzU2VjdXJpdHlHcm91cF0sXG4gICAgICBzdWJuZXRHcm91cCxcblxuICAgICAgcGFyYW1ldGVyR3JvdXAsXG5cbiAgICAgIC8vIE11bHRpLUFaIGZvciBoaWdoIGF2YWlsYWJpbGl0eVxuICAgICAgbXVsdGlBejogZW52TmFtZSA9PT0gJ3Byb2QnLFxuXG4gICAgICAvLyBTdG9yYWdlXG4gICAgICBhbGxvY2F0ZWRTdG9yYWdlOiAyMCwgLy8gR0IgKG1pbmltdW0gZm9yIGdwMylcbiAgICAgIHN0b3JhZ2VUeXBlOiByZHMuU3RvcmFnZVR5cGUuR1AzLCAvLyBHZW5lcmFsIFB1cnBvc2UgU1NEIHYzIChjaGVhcGVyIHRoYW4gZ3AyKVxuICAgICAgbWF4QWxsb2NhdGVkU3RvcmFnZTogMTAwLCAvLyBBdXRvLXNjYWxpbmcgdXAgdG8gMTAwIEdCXG4gICAgICBzdG9yYWdlRW5jcnlwdGVkOiB0cnVlLCAvLyBFbmNyeXB0aW9uIGF0IHJlc3QgKEFXUy1tYW5hZ2VkIGtleSlcblxuICAgICAgLy8gQmFja3VwXG4gICAgICBiYWNrdXBSZXRlbnRpb246IGNkay5EdXJhdGlvbi5kYXlzKDcpLFxuICAgICAgcHJlZmVycmVkQmFja3VwV2luZG93OiAnMDM6MDAtMDQ6MDAnLCAvLyBVVEMgKG9mZi1wZWFrKVxuICAgICAgY29weVRhZ3NUb1NuYXBzaG90OiB0cnVlLFxuXG4gICAgICAvLyBNYWludGVuYW5jZVxuICAgICAgYXV0b01pbm9yVmVyc2lvblVwZ3JhZGU6IHRydWUsXG4gICAgICBwcmVmZXJyZWRNYWludGVuYW5jZVdpbmRvdzogJ3N1bjowNDowMC1zdW46MDU6MDAnLCAvLyBTdW5kYXkgNC01IEFNIFVUQ1xuXG4gICAgICAvLyBNb25pdG9yaW5nXG4gICAgICBtb25pdG9yaW5nSW50ZXJ2YWw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDYwKSwgLy8gRW5oYW5jZWQgbW9uaXRvcmluZ1xuICAgICAgZW5hYmxlUGVyZm9ybWFuY2VJbnNpZ2h0czogZmFsc2UsIC8vIERpc2FibGUgdG8gc2F2ZSBjb3N0IChjYW4gZW5hYmxlIGxhdGVyKVxuICAgICAgY2xvdWR3YXRjaExvZ3NFeHBvcnRzOiBbJ3Bvc3RncmVzcWwnXSwgLy8gRXhwb3J0IGxvZ3MgdG8gQ2xvdWRXYXRjaFxuXG4gICAgICAvLyBEZWxldGlvbiBwcm90ZWN0aW9uXG4gICAgICBkZWxldGlvblByb3RlY3Rpb246IGVudk5hbWUgPT09ICdwcm9kJyxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGVudk5hbWUgPT09ICdwcm9kJyA/IGNkay5SZW1vdmFsUG9saWN5LlNOQVBTSE9UIDogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIHRoaXMuZW5kcG9pbnQgPSB0aGlzLmluc3RhbmNlLmRiSW5zdGFuY2VFbmRwb2ludEFkZHJlc3M7XG5cbiAgICAvLyDilIDilIAgQ2xvdWRGb3JtYXRpb24gT3V0cHV0cyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU2VjcmV0QXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuc2VjcmV0LnNlY3JldEFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjcmV0cyBNYW5hZ2VyIEFSTiBmb3IgZGF0YWJhc2UgY3JlZGVudGlhbHMnLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LURhdGFiYXNlU2VjcmV0QXJuYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdFbmRwb2ludCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmluc3RhbmNlLmRiSW5zdGFuY2VFbmRwb2ludEFkZHJlc3MsXG4gICAgICBkZXNjcmlwdGlvbjogJ1JEUyBQb3N0Z3JlU1FMIGVuZHBvaW50IGhvc3RuYW1lJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1EYXRhYmFzZUVuZHBvaW50YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdQb3J0Jywge1xuICAgICAgdmFsdWU6IHRoaXMuaW5zdGFuY2UuZGJJbnN0YW5jZUVuZHBvaW50UG9ydCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUkRTIFBvc3RncmVTUUwgcG9ydCcsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tRGF0YWJhc2VQb3J0YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEYXRhYmFzZU5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5kYXRhYmFzZU5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0RhdGFiYXNlIG5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LURhdGFiYXNlTmFtZWAsXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgVGFncyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ0NvbXBvbmVudCcsICdEYXRhYmFzZScpO1xuICAgIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnQ29zdENlbnRlcicsICdEYXRhJyk7XG4gIH1cbn1cbiJdfQ==