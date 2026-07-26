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
 *  • RDS PostgreSQL 15.4+ (not Aurora Serverless v2)
 *  • db.t4g.micro Single-AZ for cost optimization (ARM-based, cheaper)
 *  • Automated backups (7-day retention)
 *  • Encryption at rest (AWS-managed keys)
 *  • SSL/TLS enforcement
 *  • Deployed in private isolated subnets
 *  • Credentials in Secrets Manager
 *
 * Cost savings vs Aurora Serverless v2:
 *  - RDS t4g.micro Single-AZ: ~$25-30/month
 *  - Aurora Serverless v2: ~$250-400/month
 *  - **Savings: $220-375/month** (90% reduction)
 *
 * Cost savings vs Multi-AZ:
 *  - Single-AZ saves ~$25-30/month vs Multi-AZ
 *
 * Trade-offs:
 *  - No automatic failover (single-AZ)
 *  - Fixed compute (not auto-scaling)
 *  - Manual scaling (restart required)
 *
 * For 2 initial venues, t4g.micro is sufficient (2 vCPU, 1 GB RAM).
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
        //  - Sufficient for 2 initial venues
        //
        // Single-AZ (cost optimization):
        //  - No automatic failover
        //  - Saves ~$25-30/month vs Multi-AZ
        //  - Automated backups allow recovery in case of failure
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
            // Single-AZ for cost optimization (requirement 4.3)
            multiAz: false,
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
            // Deletion protection and RETAIN removal policy (requirement 1.6)
            deletionProtection: true,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUmRzU3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9saWIvc3RhY2tzL1Jkc1N0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQywyQ0FBMkM7QUFDM0MsMkNBQTJDO0FBQzNDLGlFQUFpRTtBQWNqRTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBMkJHO0FBQ0gsTUFBYSxRQUFTLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDckMsa0NBQWtDO0lBQ2xCLFFBQVEsQ0FBdUI7SUFFL0Msb0RBQW9EO0lBQ3BDLE1BQU0sQ0FBeUI7SUFFL0MsaUNBQWlDO0lBQ2pCLFFBQVEsQ0FBUztJQUVqQyxvQkFBb0I7SUFDSixZQUFZLEdBQVcsVUFBVSxDQUFDO0lBRWxELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBb0I7UUFDNUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLE9BQU8sRUFBRSxHQUFHLEVBQUUsZ0JBQWdCLEVBQUUsR0FBRyxLQUFLLENBQUM7UUFFakQsMkVBQTJFO1FBQzNFLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxjQUFjLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxxQkFBcUIsRUFBRTtZQUNuRSxVQUFVLEVBQUUsWUFBWSxPQUFPLHVCQUF1QjtZQUN0RCxXQUFXLEVBQUUsd0RBQXdELE9BQU8sR0FBRztZQUMvRSxvQkFBb0IsRUFBRTtnQkFDcEIsb0JBQW9CLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztvQkFDbkMsUUFBUSxFQUFFLFVBQVU7aUJBQ3JCLENBQUM7Z0JBQ0YsaUJBQWlCLEVBQUUsVUFBVTtnQkFDN0IsaUJBQWlCLEVBQUUsU0FBUyxFQUFFLDhCQUE4QjtnQkFDNUQsY0FBYyxFQUFFLEVBQUU7YUFDbkI7U0FDRixDQUFDLENBQUM7UUFFSCwyRUFBMkU7UUFDM0UsTUFBTSxjQUFjLEdB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Q0FBQyxXQUFXLEVBQUUsVUFBVSxDQUFDLENBQUM7UUFDL0MsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLFlBQVksRUFBRSxNQUFNLENBQUMsQ0FBQztJQUM5QyxDQUFDO0NBQ0Y7QUFwSkQsNEJBb0pDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCAqIGFzIHJkcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtcmRzJztcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBSZHNTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICAvKiogTG9naWNhbCBlbnZpcm9ubWVudCBuYW1lLCBlLmcuIFwic3RhZ2luZ1wiIG9yIFwicHJvZFwiICovXG4gIHJlYWRvbmx5IGVudk5hbWU6IHN0cmluZztcblxuICAvKiogVlBDIHdoZXJlIHRoZSBSRFMgaW5zdGFuY2Ugd2lsbCBiZSBkZXBsb3llZCAqL1xuICByZWFkb25seSB2cGM6IGVjMi5JVnBjO1xuXG4gIC8qKiBTZWN1cml0eSBncm91cCBmb3IgUkRTIGluc3RhbmNlICovXG4gIHJlYWRvbmx5IHJkc1NlY3VyaXR5R3JvdXA6IGVjMi5JU2VjdXJpdHlHcm91cDtcbn1cblxuLyoqXG4gKiBSZHNTdGFja1xuICpcbiAqIENvc3Qtb3B0aW1pemVkIFBvc3RncmVTUUwgZGF0YWJhc2UgdXNpbmcgUkRTIChub3QgQXVyb3JhKTpcbiAqXG4gKiAg4oCiIFJEUyBQb3N0Z3JlU1FMIDE1LjQrIChub3QgQXVyb3JhIFNlcnZlcmxlc3MgdjIpXG4gKiAg4oCiIGRiLnQ0Zy5taWNybyBTaW5nbGUtQVogZm9yIGNvc3Qgb3B0aW1pemF0aW9uIChBUk0tYmFzZWQsIGNoZWFwZXIpXG4gKiAg4oCiIEF1dG9tYXRlZCBiYWNrdXBzICg3LWRheSByZXRlbnRpb24pXG4gKiAg4oCiIEVuY3J5cHRpb24gYXQgcmVzdCAoQVdTLW1hbmFnZWQga2V5cylcbiAqICDigKIgU1NML1RMUyBlbmZvcmNlbWVudFxuICogIOKAoiBEZXBsb3llZCBpbiBwcml2YXRlIGlzb2xhdGVkIHN1Ym5ldHNcbiAqICDigKIgQ3JlZGVudGlhbHMgaW4gU2VjcmV0cyBNYW5hZ2VyXG4gKlxuICogQ29zdCBzYXZpbmdzIHZzIEF1cm9yYSBTZXJ2ZXJsZXNzIHYyOlxuICogIC0gUkRTIHQ0Zy5taWNybyBTaW5nbGUtQVo6IH4kMjUtMzAvbW9udGhcbiAqICAtIEF1cm9yYSBTZXJ2ZXJsZXNzIHYyOiB+JDI1MC00MDAvbW9udGhcbiAqICAtICoqU2F2aW5nczogJDIyMC0zNzUvbW9udGgqKiAoOTAlIHJlZHVjdGlvbilcbiAqXG4gKiBDb3N0IHNhdmluZ3MgdnMgTXVsdGktQVo6XG4gKiAgLSBTaW5nbGUtQVogc2F2ZXMgfiQyNS0zMC9tb250aCB2cyBNdWx0aS1BWlxuICpcbiAqIFRyYWRlLW9mZnM6XG4gKiAgLSBObyBhdXRvbWF0aWMgZmFpbG92ZXIgKHNpbmdsZS1BWilcbiAqICAtIEZpeGVkIGNvbXB1dGUgKG5vdCBhdXRvLXNjYWxpbmcpXG4gKiAgLSBNYW51YWwgc2NhbGluZyAocmVzdGFydCByZXF1aXJlZClcbiAqXG4gKiBGb3IgMiBpbml0aWFsIHZlbnVlcywgdDRnLm1pY3JvIGlzIHN1ZmZpY2llbnQgKDIgdkNQVSwgMSBHQiBSQU0pLlxuICovXG5leHBvcnQgY2xhc3MgUmRzU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICAvKiogVGhlIFJEUyBQb3N0Z3JlU1FMIGluc3RhbmNlICovXG4gIHB1YmxpYyByZWFkb25seSBpbnN0YW5jZTogcmRzLkRhdGFiYXNlSW5zdGFuY2U7XG5cbiAgLyoqIFNlY3JldHMgTWFuYWdlciBzZWNyZXQgY29udGFpbmluZyBjcmVkZW50aWFscyAqL1xuICBwdWJsaWMgcmVhZG9ubHkgc2VjcmV0OiBzZWNyZXRzbWFuYWdlci5JU2VjcmV0O1xuXG4gIC8qKiBEYXRhYmFzZSBlbmRwb2ludCBob3N0bmFtZSAqL1xuICBwdWJsaWMgcmVhZG9ubHkgZW5kcG9pbnQ6IHN0cmluZztcblxuICAvKiogRGF0YWJhc2UgbmFtZSAqL1xuICBwdWJsaWMgcmVhZG9ubHkgZGF0YWJhc2VOYW1lOiBzdHJpbmcgPSAnZm9vZGNvc3QnO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBSZHNTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7IGVudk5hbWUsIHZwYywgcmRzU2VjdXJpdHlHcm91cCB9ID0gcHJvcHM7XG5cbiAgICAvLyDilIDilIAgU2VjcmV0cyBNYW5hZ2VyIOKAlCBEYXRhYmFzZSBDcmVkZW50aWFscyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICB0aGlzLnNlY3JldCA9IG5ldyBzZWNyZXRzbWFuYWdlci5TZWNyZXQodGhpcywgJ0RhdGFiYXNlQ3JlZGVudGlhbHMnLCB7XG4gICAgICBzZWNyZXROYW1lOiBgZm9vZGNvc3QvJHtlbnZOYW1lfS9kYXRhYmFzZS9jcmVkZW50aWFsc2AsXG4gICAgICBkZXNjcmlwdGlvbjogYFJEUyBQb3N0Z3JlU1FMIGNyZWRlbnRpYWxzIGZvciBGb29kIENvc3QgQ2FsY3VsYXRvciAoJHtlbnZOYW1lfSlgLFxuICAgICAgZ2VuZXJhdGVTZWNyZXRTdHJpbmc6IHtcbiAgICAgICAgc2VjcmV0U3RyaW5nVGVtcGxhdGU6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICB1c2VybmFtZTogJ3Bvc3RncmVzJyxcbiAgICAgICAgfSksXG4gICAgICAgIGdlbmVyYXRlU3RyaW5nS2V5OiAncGFzc3dvcmQnLFxuICAgICAgICBleGNsdWRlQ2hhcmFjdGVyczogJ1wiQC9cXFxcXFwnJywgLy8gQXZvaWQgc2hlbGwgZXNjYXBpbmcgaXNzdWVzXG4gICAgICAgIHBhc3N3b3JkTGVuZ3RoOiAzMixcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgUGFyYW1ldGVyIEdyb3VwIOKAlCBTU0wgRW5mb3JjZW1lbnQg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgY29uc3QgcGFyYW1ldGVyR3JvdXAgPSBuZXcgcmRzLlBhcmFtZXRlckdyb3VwKHRoaXMsICdQYXJhbWV0ZXJHcm91cCcsIHtcbiAgICAgIGVuZ2luZTogcmRzLkRhdGFiYXNlSW5zdGFuY2VFbmdpbmUucG9zdGdyZXMoe1xuICAgICAgICB2ZXJzaW9uOiByZHMuUG9zdGdyZXNFbmdpbmVWZXJzaW9uLlZFUl8xNV80LFxuICAgICAgfSksXG4gICAgICBkZXNjcmlwdGlvbjogYFJEUyBQb3N0Z3JlU1FMIHBhcmFtZXRlciBncm91cCBmb3IgRm9vZCBDb3N0IENhbGN1bGF0b3IgKCR7ZW52TmFtZX0pYCxcbiAgICAgIHBhcmFtZXRlcnM6IHtcbiAgICAgICAgJ3Jkcy5mb3JjZV9zc2wnOiAnMScsIC8vIEVuZm9yY2UgU1NML1RMUyBjb25uZWN0aW9uc1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCBTdWJuZXQgR3JvdXAg4oCUIFByaXZhdGUgU3VibmV0cyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBjb25zdCBzdWJuZXRHcm91cCA9IG5ldyByZHMuU3VibmV0R3JvdXAodGhpcywgJ1N1Ym5ldEdyb3VwJywge1xuICAgICAgZGVzY3JpcHRpb246IGBSRFMgUG9zdGdyZVNRTCBzdWJuZXQgZ3JvdXAgZm9yIEZvb2QgQ29zdCBDYWxjdWxhdG9yICgke2Vudk5hbWV9KWAsXG4gICAgICB2cGMsXG4gICAgICB2cGNTdWJuZXRzOiB2cGMuc2VsZWN0U3VibmV0cyh7XG4gICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfSVNPTEFURUQsXG4gICAgICB9KSxcbiAgICAgIHN1Ym5ldEdyb3VwTmFtZTogYGZvb2Rjb3N0LXJkcy0ke2Vudk5hbWV9YCxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCBSRFMgUG9zdGdyZVNRTCBJbnN0YW5jZSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvL1xuICAgIC8vIGRiLnQ0Zy5taWNybyAoQVJNLWJhc2VkIEdyYXZpdG9uMik6XG4gICAgLy8gIC0gMiB2Q1BVLCAxIEdCIFJBTVxuICAgIC8vICAtIEJ1cnN0YWJsZSBwZXJmb3JtYW5jZSAoVDRnIGJhc2VsaW5lOiAxMCUgQ1BVLCBidXJzdHMgdG8gMTAwJSlcbiAgICAvLyAgLSAyMCUgY2hlYXBlciB0aGFuIHQzLm1pY3JvIChJbnRlbClcbiAgICAvLyAgLSBTdWZmaWNpZW50IGZvciAyIGluaXRpYWwgdmVudWVzXG4gICAgLy9cbiAgICAvLyBTaW5nbGUtQVogKGNvc3Qgb3B0aW1pemF0aW9uKTpcbiAgICAvLyAgLSBObyBhdXRvbWF0aWMgZmFpbG92ZXJcbiAgICAvLyAgLSBTYXZlcyB+JDI1LTMwL21vbnRoIHZzIE11bHRpLUFaXG4gICAgLy8gIC0gQXV0b21hdGVkIGJhY2t1cHMgYWxsb3cgcmVjb3ZlcnkgaW4gY2FzZSBvZiBmYWlsdXJlXG4gICAgLy9cbiAgICB0aGlzLmluc3RhbmNlID0gbmV3IHJkcy5EYXRhYmFzZUluc3RhbmNlKHRoaXMsICdJbnN0YW5jZScsIHtcbiAgICAgIGVuZ2luZTogcmRzLkRhdGFiYXNlSW5zdGFuY2VFbmdpbmUucG9zdGdyZXMoe1xuICAgICAgICB2ZXJzaW9uOiByZHMuUG9zdGdyZXNFbmdpbmVWZXJzaW9uLlZFUl8xNV80LFxuICAgICAgfSksXG4gICAgICBpbnN0YW5jZVR5cGU6IGVjMi5JbnN0YW5jZVR5cGUub2YoXG4gICAgICAgIGVjMi5JbnN0YW5jZUNsYXNzLlQ0RywgLy8gQVJNLWJhc2VkIChHcmF2aXRvbjIpXG4gICAgICAgIGVjMi5JbnN0YW5jZVNpemUuTUlDUk8sIC8vIDIgdkNQVSwgMSBHQiBSQU1cbiAgICAgICksXG4gICAgICBpbnN0YW5jZUlkZW50aWZpZXI6IGBmb29kY29zdC1kYi0ke2Vudk5hbWV9YCxcbiAgICAgIGRhdGFiYXNlTmFtZTogdGhpcy5kYXRhYmFzZU5hbWUsXG5cbiAgICAgIC8vIENyZWRlbnRpYWxzIGZyb20gU2VjcmV0cyBNYW5hZ2VyXG4gICAgICBjcmVkZW50aWFsczogcmRzLkNyZWRlbnRpYWxzLmZyb21TZWNyZXQodGhpcy5zZWNyZXQpLFxuXG4gICAgICB2cGMsXG4gICAgICB2cGNTdWJuZXRzOiB2cGMuc2VsZWN0U3VibmV0cyh7XG4gICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfSVNPTEFURUQsXG4gICAgICB9KSxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbcmRzU2VjdXJpdHlHcm91cF0sXG4gICAgICBzdWJuZXRHcm91cCxcblxuICAgICAgcGFyYW1ldGVyR3JvdXAsXG5cbiAgICAgIC8vIFNpbmdsZS1BWiBmb3IgY29zdCBvcHRpbWl6YXRpb24gKHJlcXVpcmVtZW50IDQuMylcbiAgICAgIG11bHRpQXo6IGZhbHNlLFxuXG4gICAgICAvLyBTdG9yYWdlXG4gICAgICBhbGxvY2F0ZWRTdG9yYWdlOiAyMCwgLy8gR0IgKG1pbmltdW0gZm9yIGdwMylcbiAgICAgIHN0b3JhZ2VUeXBlOiByZHMuU3RvcmFnZVR5cGUuR1AzLCAvLyBHZW5lcmFsIFB1cnBvc2UgU1NEIHYzIChjaGVhcGVyIHRoYW4gZ3AyKVxuICAgICAgbWF4QWxsb2NhdGVkU3RvcmFnZTogMTAwLCAvLyBBdXRvLXNjYWxpbmcgdXAgdG8gMTAwIEdCXG4gICAgICBzdG9yYWdlRW5jcnlwdGVkOiB0cnVlLCAvLyBFbmNyeXB0aW9uIGF0IHJlc3QgKEFXUy1tYW5hZ2VkIGtleSlcblxuICAgICAgLy8gQmFja3VwXG4gICAgICBiYWNrdXBSZXRlbnRpb246IGNkay5EdXJhdGlvbi5kYXlzKDcpLFxuICAgICAgcHJlZmVycmVkQmFja3VwV2luZG93OiAnMDM6MDAtMDQ6MDAnLCAvLyBVVEMgKG9mZi1wZWFrKVxuICAgICAgY29weVRhZ3NUb1NuYXBzaG90OiB0cnVlLFxuXG4gICAgICAvLyBNYWludGVuYW5jZVxuICAgICAgYXV0b01pbm9yVmVyc2lvblVwZ3JhZGU6IHRydWUsXG4gICAgICBwcmVmZXJyZWRNYWludGVuYW5jZVdpbmRvdzogJ3N1bjowNDowMC1zdW46MDU6MDAnLCAvLyBTdW5kYXkgNC01IEFNIFVUQ1xuXG4gICAgICAvLyBNb25pdG9yaW5nXG4gICAgICBtb25pdG9yaW5nSW50ZXJ2YWw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDYwKSwgLy8gRW5oYW5jZWQgbW9uaXRvcmluZ1xuICAgICAgZW5hYmxlUGVyZm9ybWFuY2VJbnNpZ2h0czogZmFsc2UsIC8vIERpc2FibGUgdG8gc2F2ZSBjb3N0IChjYW4gZW5hYmxlIGxhdGVyKVxuICAgICAgY2xvdWR3YXRjaExvZ3NFeHBvcnRzOiBbJ3Bvc3RncmVzcWwnXSwgLy8gRXhwb3J0IGxvZ3MgdG8gQ2xvdWRXYXRjaFxuXG4gICAgICAvLyBEZWxldGlvbiBwcm90ZWN0aW9uIGFuZCBSRVRBSU4gcmVtb3ZhbCBwb2xpY3kgKHJlcXVpcmVtZW50IDEuNilcbiAgICAgIGRlbGV0aW9uUHJvdGVjdGlvbjogdHJ1ZSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICB9KTtcblxuICAgIHRoaXMuZW5kcG9pbnQgPSB0aGlzLmluc3RhbmNlLmRiSW5zdGFuY2VFbmRwb2ludEFkZHJlc3M7XG5cbiAgICAvLyDilIDilIAgQ2xvdWRGb3JtYXRpb24gT3V0cHV0cyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU2VjcmV0QXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuc2VjcmV0LnNlY3JldEFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjcmV0cyBNYW5hZ2VyIEFSTiBmb3IgZGF0YWJhc2UgY3JlZGVudGlhbHMnLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LURhdGFiYXNlU2VjcmV0QXJuYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdFbmRwb2ludCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmluc3RhbmNlLmRiSW5zdGFuY2VFbmRwb2ludEFkZHJlc3MsXG4gICAgICBkZXNjcmlwdGlvbjogJ1JEUyBQb3N0Z3JlU1FMIGVuZHBvaW50IGhvc3RuYW1lJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1EYXRhYmFzZUVuZHBvaW50YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdQb3J0Jywge1xuICAgICAgdmFsdWU6IHRoaXMuaW5zdGFuY2UuZGJJbnN0YW5jZUVuZHBvaW50UG9ydCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUkRTIFBvc3RncmVTUUwgcG9ydCcsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tRGF0YWJhc2VQb3J0YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEYXRhYmFzZU5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5kYXRhYmFzZU5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0RhdGFiYXNlIG5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LURhdGFiYXNlTmFtZWAsXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgVGFncyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ0NvbXBvbmVudCcsICdEYXRhYmFzZScpO1xuICAgIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnQ29zdENlbnRlcicsICdEYXRhJyk7XG4gIH1cbn1cbiJdfQ==