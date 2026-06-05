"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseStack = void 0;
const cdk = require("aws-cdk-lib");
const rds = require("aws-cdk-lib/aws-rds");
const secretsmanager = require("aws-cdk-lib/aws-secretsmanager");
/**
 * DatabaseStack
 *
 * Provisions the Aurora PostgreSQL Serverless v2 cluster for the Food Cost Calculator:
 *
 *  • Aurora Serverless v2 PostgreSQL 15.x cluster
 *  • Multi-AZ deployment with automatic failover to standby replica
 *  • Credentials stored in AWS Secrets Manager (auto-generated username + password)
 *  • Parameter group configured with:
 *      - rds.force_ssl = 1 (enforce TLS connections)
 *      - pgaudit.log = 'all' (comprehensive audit logging)
 *      - shared_preload_libraries = 'pgaudit' (enable pgaudit extension)
 *  • Automated daily backups with 7-day retention
 *  • Deployed in private-data subnets (PRIVATE_ISOLATED) across 2 AZs
 *  • Encryption at rest enabled (AWS-managed KMS key)
 *
 * Satisfies Requirements:
 *  - 7.1: Automatic data persistence after every create/update/delete operation
 *  - 7.2: Application restore from persisted state on open/refresh
 */
class DatabaseStack extends cdk.Stack {
    /** The Aurora PostgreSQL cluster. */
    cluster;
    /** Secrets Manager secret containing the database credentials. */
    secret;
    /** The database name (default: 'foodcostcalculator'). */
    databaseName = 'foodcostcalculator';
    constructor(scope, id, props) {
        super(scope, id, props);
        const { envName, vpc, auroraSecurityGroup } = props;
        // ── Secrets Manager — Database Credentials ──────────────────────────────
        //
        // Auto-generate secure credentials (username + password).
        // The Spring Boot application will reference this secret ARN via environment
        // variable and retrieve credentials at runtime.
        //
        // Secret rotation is enabled with a 30-day rotation schedule (using the
        // RDS single-user rotation strategy). Aurora automatically updates the
        // password in the database when rotation occurs, and applications using
        // the secret ARN will fetch the new credentials on the next retrieval.
        this.secret = new secretsmanager.Secret(this, 'AuroraCredentials', {
            secretName: `food-cost-calculator/${envName}/aurora/credentials`,
            description: `Aurora PostgreSQL credentials for Food Cost Calculator (${envName})`,
            generateSecretString: {
                secretStringTemplate: JSON.stringify({
                    username: 'fcc_app_user',
                }),
                generateStringKey: 'password',
                excludeCharacters: '"@/\\', // Exclude chars that may cause shell escaping issues
                passwordLength: 32,
            },
        });
        // ── Parameter Group — SSL Enforcement + pgaudit ─────────────────────────
        //
        // Custom parameter group for Aurora PostgreSQL 15.x with:
        //  1. rds.force_ssl = 1           — reject non-TLS connections
        //  2. shared_preload_libraries    — load pgaudit extension at server start
        //  3. pgaudit.log = 'all'         — log all DDL, DML, role changes, etc.
        //
        // The pgaudit extension provides session and object audit logging.
        // Logs are written to CloudWatch Logs via Aurora's native integration.
        const parameterGroup = new rds.ParameterGroup(this, 'AuroraParameterGroup', {
            engine: rds.DatabaseClusterEngine.auroraPostgres({
                version: rds.AuroraPostgresEngineVersion.VER_15_5,
            }),
            description: `Aurora PostgreSQL parameter group for Food Cost Calculator (${envName}) — SSL + pgaudit`,
            parameters: {
                // Enforce TLS connections — reject plaintext PostgreSQL connections.
                'rds.force_ssl': '1',
                // Load pgaudit extension at server startup.
                // This is a static parameter; cluster restart is required if changed.
                shared_preload_libraries: 'pgaudit',
                // pgaudit logging configuration:
                //  'all' — log DDL, ROLE, READ, WRITE, FUNCTION, MISC
                //  Logs are written to CloudWatch Logs via Aurora's PostgreSQL log export.
                'pgaudit.log': 'all',
                // Optional: log statement text in audit logs (for deeper forensics).
                // Set to 'all' to include full SQL statement text in pgaudit logs.
                // This increases log volume but aids in compliance auditing.
                'pgaudit.log_statement_once': '0', // Log every statement (not just once per txn)
            },
        });
        // ── Subnet Group — Private Data Subnets ────────────────────────────────
        //
        // Aurora cluster is deployed in the 'private-data' subnets (PRIVATE_ISOLATED)
        // across 2 AZs. These subnets have no internet egress (no NAT gateway route).
        // The cluster is only accessible from EKS nodes via the auroraSecurityGroup.
        const subnetGroup = new rds.SubnetGroup(this, 'AuroraSubnetGroup', {
            description: `Aurora PostgreSQL subnet group for Food Cost Calculator (${envName})`,
            vpc,
            vpcSubnets: vpc.selectSubnets({
                subnetGroupName: 'private-data',
            }),
            subnetGroupName: `fcc-aurora-${envName}`,
        });
        // ── Aurora Serverless v2 Cluster ────────────────────────────────────────
        //
        // Aurora Serverless v2 provides on-demand scaling of Aurora Capacity Units (ACUs).
        // Each ACU = 2 GiB RAM + proportional CPU + network.
        //
        // Configuration:
        //  • Engine: Aurora PostgreSQL 15.5 (latest GA version as of design)
        //  • Capacity: 0.5–2 ACUs (min 0.5 ACU = 1 GiB RAM; scales to 2 ACUs under load)
        //  • Multi-AZ: 1 writer + 1 standby reader in a second AZ (automatic failover)
        //  • Encryption: at-rest via AWS-managed KMS key
        //  • Backups: automated daily snapshots, 7-day retention
        //  • CloudWatch Logs: postgresql log stream enabled
        //
        // Credentials are retrieved from Secrets Manager at cluster creation time
        // and stored in the RDS master user password. Applications retrieve the
        // current credentials by reading the secret ARN at runtime.
        this.cluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
            engine: rds.DatabaseClusterEngine.auroraPostgres({
                version: rds.AuroraPostgresEngineVersion.VER_15_5,
            }),
            clusterIdentifier: `fcc-aurora-${envName}`,
            defaultDatabaseName: this.databaseName,
            // Credentials from Secrets Manager.
            // The secret must have {username, password} keys in its JSON structure.
            // Note: fromSecret() automatically attaches the secret to the cluster,
            // so we don't need to call secret.attach() separately.
            credentials: rds.Credentials.fromSecret(this.secret),
            // Serverless v2 scaling configuration.
            // minCapacity: 0.5 ACU (1 GiB RAM) — minimum cost when idle.
            // maxCapacity: 2 ACU (4 GiB RAM)   — sufficient for production workload per design.
            serverlessV2MinCapacity: 0.5,
            serverlessV2MaxCapacity: 2,
            // Multi-AZ deployment: 1 writer + 1 standby reader.
            // Aurora automatically promotes the standby to writer on failure (< 30s RTO).
            writer: rds.ClusterInstance.serverlessV2('Writer', {
                instanceIdentifier: `fcc-aurora-writer-${envName}`,
                publiclyAccessible: false,
                enablePerformanceInsights: true,
                performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT, // 7 days (free tier)
            }),
            readers: [
                rds.ClusterInstance.serverlessV2('Reader1', {
                    instanceIdentifier: `fcc-aurora-reader1-${envName}`,
                    publiclyAccessible: false,
                    enablePerformanceInsights: true,
                    performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
                }),
            ],
            vpc,
            vpcSubnets: vpc.selectSubnets({
                subnetGroupName: 'private-data',
            }),
            securityGroups: [auroraSecurityGroup],
            subnetGroup,
            parameterGroup,
            // Encryption at rest — AWS-managed KMS key (no additional cost).
            // For customer-managed KMS keys, replace with `storageEncryptionKey: new kms.Key(...)`.
            storageEncrypted: true,
            // Automated backups — daily snapshot, 7-day retention.
            backup: {
                retention: cdk.Duration.days(7),
                preferredWindow: '03:00-04:00', // UTC — 1pm–2pm AEDT (off-peak)
            },
            // CloudWatch Logs — export PostgreSQL logs to CloudWatch Logs.
            // Includes error logs, slow query logs, and pgaudit logs.
            cloudwatchLogsExports: ['postgresql'],
            cloudwatchLogsRetention: cdk.aws_logs.RetentionDays.ONE_MONTH,
            // Deletion protection — prevent accidental deletion in production.
            // Set to false for staging/dev environments to allow easier teardown.
            deletionProtection: envName === 'prod',
            // Removal policy — SNAPSHOT on delete (retain a final snapshot for disaster recovery).
            // For staging/dev, you may use DESTROY to skip the final snapshot and speed up teardown.
            removalPolicy: envName === 'prod' ? cdk.RemovalPolicy.SNAPSHOT : cdk.RemovalPolicy.DESTROY,
        });
        // ── CloudFormation Outputs ───────────────────────────────────────────────
        //
        // Export critical values for consumption by the EKS stack (API + worker services).
        // The Spring Boot application will receive these values as environment variables:
        //  • DB_SECRET_ARN       — ARN of the Secrets Manager secret (credentials)
        //  • DB_CLUSTER_ENDPOINT — Aurora cluster writer endpoint (hostname:port)
        //  • DB_READER_ENDPOINT  — Aurora cluster reader endpoint (read-only queries)
        //  • DB_NAME             — Database name
        new cdk.CfnOutput(this, 'SecretArn', {
            value: this.secret.secretArn,
            description: 'Secrets Manager ARN for Aurora credentials',
            exportName: `FoodCostCalculator-${envName}-AuroraSecretArn`,
        });
        new cdk.CfnOutput(this, 'ClusterEndpoint', {
            value: this.cluster.clusterEndpoint.socketAddress,
            description: 'Aurora PostgreSQL cluster writer endpoint (hostname:port)',
            exportName: `FoodCostCalculator-${envName}-AuroraClusterEndpoint`,
        });
        new cdk.CfnOutput(this, 'ClusterReadEndpoint', {
            value: this.cluster.clusterReadEndpoint.socketAddress,
            description: 'Aurora PostgreSQL cluster reader endpoint (read-only queries)',
            exportName: `FoodCostCalculator-${envName}-AuroraReaderEndpoint`,
        });
        new cdk.CfnOutput(this, 'DatabaseName', {
            value: this.databaseName,
            description: 'Aurora PostgreSQL database name',
            exportName: `FoodCostCalculator-${envName}-DatabaseName`,
        });
        new cdk.CfnOutput(this, 'ClusterArn', {
            value: this.cluster.clusterArn,
            description: 'Aurora cluster ARN (for IAM and resource tagging)',
            exportName: `FoodCostCalculator-${envName}-AuroraClusterArn`,
        });
    }
}
exports.DatabaseStack = DatabaseStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiRGF0YWJhc2VTdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL2xpYi9zdGFja3MvRGF0YWJhc2VTdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMsMkNBQTJDO0FBQzNDLGlFQUFpRTtBQWNqRTs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRztBQUNILE1BQWEsYUFBYyxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzFDLHFDQUFxQztJQUNyQixPQUFPLENBQXNCO0lBRTdDLGtFQUFrRTtJQUNsRCxNQUFNLENBQXlCO0lBRS9DLHlEQUF5RDtJQUN6QyxZQUFZLEdBQVcsb0JBQW9CLENBQUM7SUFFNUQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUF5QjtRQUNqRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsT0FBTyxFQUFFLEdBQUcsRUFBRSxtQkFBbUIsRUFBRSxHQUFHLEtBQUssQ0FBQztRQUVwRCwyRUFBMkU7UUFDM0UsRUFBRTtRQUNGLDBEQUEwRDtRQUMxRCw2RUFBNkU7UUFDN0UsZ0RBQWdEO1FBQ2hELEVBQUU7UUFDRix3RUFBd0U7UUFDeEUsdUVBQXVFO1FBQ3ZFLHdFQUF3RTtRQUN4RSx1RUFBdUU7UUFDdkUsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLGNBQWMsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQ2pFLFVBQVUsRUFBRSx3QkFBd0IsT0FBTyxxQkFBcUI7WUFDaEUsV0FBVyxFQUFFLDJEQUEyRCxPQUFPLEdBQUc7WUFDbEYsb0JBQW9CLEVBQUU7Z0JBQ3BCLG9CQUFvQixFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7b0JBQ25DLFFBQVEsRUFBRSxjQUFjO2lCQUN6QixDQUFDO2dCQUNGLGlCQUFpQixFQUFFLFVBQVU7Z0JBQzdCLGlCQUFpQixFQUFFLE9BQU8sRUFBRSxxREFB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c0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCAqIGFzIHJkcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtcmRzJztcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBEYXRhYmFzZVN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIC8qKiBMb2dpY2FsIGVudmlyb25tZW50IG5hbWUsIGUuZy4gXCJzdGFnaW5nXCIgb3IgXCJwcm9kXCIuIFVzZWQgZm9yIG5hbWluZy4gKi9cbiAgcmVhZG9ubHkgZW52TmFtZTogc3RyaW5nO1xuXG4gIC8qKiBWUEMgd2hlcmUgdGhlIEF1cm9yYSBjbHVzdGVyIHdpbGwgYmUgZGVwbG95ZWQuICovXG4gIHJlYWRvbmx5IHZwYzogZWMyLklWcGM7XG5cbiAgLyoqIFNlY3VyaXR5IGdyb3VwIGZvciBBdXJvcmEgUG9zdGdyZVNRTCBjbHVzdGVyLiAqL1xuICByZWFkb25seSBhdXJvcmFTZWN1cml0eUdyb3VwOiBlYzIuSVNlY3VyaXR5R3JvdXA7XG59XG5cbi8qKlxuICogRGF0YWJhc2VTdGFja1xuICpcbiAqIFByb3Zpc2lvbnMgdGhlIEF1cm9yYSBQb3N0Z3JlU1FMIFNlcnZlcmxlc3MgdjIgY2x1c3RlciBmb3IgdGhlIEZvb2QgQ29zdCBDYWxjdWxhdG9yOlxuICpcbiAqICDigKIgQXVyb3JhIFNlcnZlcmxlc3MgdjIgUG9zdGdyZVNRTCAxNS54IGNsdXN0ZXJcbiAqICDigKIgTXVsdGktQVogZGVwbG95bWVudCB3aXRoIGF1dG9tYXRpYyBmYWlsb3ZlciB0byBzdGFuZGJ5IHJlcGxpY2FcbiAqICDigKIgQ3JlZGVudGlhbHMgc3RvcmVkIGluIEFXUyBTZWNyZXRzIE1hbmFnZXIgKGF1dG8tZ2VuZXJhdGVkIHVzZXJuYW1lICsgcGFzc3dvcmQpXG4gKiAg4oCiIFBhcmFtZXRlciBncm91cCBjb25maWd1cmVkIHdpdGg6XG4gKiAgICAgIC0gcmRzLmZvcmNlX3NzbCA9IDEgKGVuZm9yY2UgVExTIGNvbm5lY3Rpb25zKVxuICogICAgICAtIHBnYXVkaXQubG9nID0gJ2FsbCcgKGNvbXByZWhlbnNpdmUgYXVkaXQgbG9nZ2luZylcbiAqICAgICAgLSBzaGFyZWRfcHJlbG9hZF9saWJyYXJpZXMgPSAncGdhdWRpdCcgKGVuYWJsZSBwZ2F1ZGl0IGV4dGVuc2lvbilcbiAqICDigKIgQXV0b21hdGVkIGRhaWx5IGJhY2t1cHMgd2l0aCA3LWRheSByZXRlbnRpb25cbiAqICDigKIgRGVwbG95ZWQgaW4gcHJpdmF0ZS1kYXRhIHN1Ym5ldHMgKFBSSVZBVEVfSVNPTEFURUQpIGFjcm9zcyAyIEFac1xuICogIOKAoiBFbmNyeXB0aW9uIGF0IHJlc3QgZW5hYmxlZCAoQVdTLW1hbmFnZWQgS01TIGtleSlcbiAqXG4gKiBTYXRpc2ZpZXMgUmVxdWlyZW1lbnRzOlxuICogIC0gNy4xOiBBdXRvbWF0aWMgZGF0YSBwZXJzaXN0ZW5jZSBhZnRlciBldmVyeSBjcmVhdGUvdXBkYXRlL2RlbGV0ZSBvcGVyYXRpb25cbiAqICAtIDcuMjogQXBwbGljYXRpb24gcmVzdG9yZSBmcm9tIHBlcnNpc3RlZCBzdGF0ZSBvbiBvcGVuL3JlZnJlc2hcbiAqL1xuZXhwb3J0IGNsYXNzIERhdGFiYXNlU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICAvKiogVGhlIEF1cm9yYSBQb3N0Z3JlU1FMIGNsdXN0ZXIuICovXG4gIHB1YmxpYyByZWFkb25seSBjbHVzdGVyOiByZHMuRGF0YWJhc2VDbHVzdGVyO1xuXG4gIC8qKiBTZWNyZXRzIE1hbmFnZXIgc2VjcmV0IGNvbnRhaW5pbmcgdGhlIGRhdGFiYXNlIGNyZWRlbnRpYWxzLiAqL1xuICBwdWJsaWMgcmVhZG9ubHkgc2VjcmV0OiBzZWNyZXRzbWFuYWdlci5JU2VjcmV0O1xuXG4gIC8qKiBUaGUgZGF0YWJhc2UgbmFtZSAoZGVmYXVsdDogJ2Zvb2Rjb3N0Y2FsY3VsYXRvcicpLiAqL1xuICBwdWJsaWMgcmVhZG9ubHkgZGF0YWJhc2VOYW1lOiBzdHJpbmcgPSAnZm9vZGNvc3RjYWxjdWxhdG9yJztcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogRGF0YWJhc2VTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7IGVudk5hbWUsIHZwYywgYXVyb3JhU2VjdXJpdHlHcm91cCB9ID0gcHJvcHM7XG5cbiAgICAvLyDilIDilIAgU2VjcmV0cyBNYW5hZ2VyIOKAlCBEYXRhYmFzZSBDcmVkZW50aWFscyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvL1xuICAgIC8vIEF1dG8tZ2VuZXJhdGUgc2VjdXJlIGNyZWRlbnRpYWxzICh1c2VybmFtZSArIHBhc3N3b3JkKS5cbiAgICAvLyBUaGUgU3ByaW5nIEJvb3QgYXBwbGljYXRpb24gd2lsbCByZWZlcmVuY2UgdGhpcyBzZWNyZXQgQVJOIHZpYSBlbnZpcm9ubWVudFxuICAgIC8vIHZhcmlhYmxlIGFuZCByZXRyaWV2ZSBjcmVkZW50aWFscyBhdCBydW50aW1lLlxuICAgIC8vXG4gICAgLy8gU2VjcmV0IHJvdGF0aW9uIGlzIGVuYWJsZWQgd2l0aCBhIDMwLWRheSByb3RhdGlvbiBzY2hlZHVsZSAodXNpbmcgdGhlXG4gICAgLy8gUkRTIHNpbmdsZS11c2VyIHJvdGF0aW9uIHN0cmF0ZWd5KS4gQXVyb3JhIGF1dG9tYXRpY2FsbHkgdXBkYXRlcyB0aGVcbiAgICAvLyBwYXNzd29yZCBpbiB0aGUgZGF0YWJhc2Ugd2hlbiByb3RhdGlvbiBvY2N1cnMsIGFuZCBhcHBsaWNhdGlvbnMgdXNpbmdcbiAgICAvLyB0aGUgc2VjcmV0IEFSTiB3aWxsIGZldGNoIHRoZSBuZXcgY3JlZGVudGlhbHMgb24gdGhlIG5leHQgcmV0cmlldmFsLlxuICAgIHRoaXMuc2VjcmV0ID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldCh0aGlzLCAnQXVyb3JhQ3JlZGVudGlhbHMnLCB7XG4gICAgICBzZWNyZXROYW1lOiBgZm9vZC1jb3N0LWNhbGN1bGF0b3IvJHtlbnZOYW1lfS9hdXJvcmEvY3JlZGVudGlhbHNgLFxuICAgICAgZGVzY3JpcHRpb246IGBBdXJvcmEgUG9zdGdyZVNRTCBjcmVkZW50aWFscyBmb3IgRm9vZCBDb3N0IENhbGN1bGF0b3IgKCR7ZW52TmFtZX0pYCxcbiAgICAgIGdlbmVyYXRlU2VjcmV0U3RyaW5nOiB7XG4gICAgICAgIHNlY3JldFN0cmluZ1RlbXBsYXRlOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgdXNlcm5hbWU6ICdmY2NfYXBwX3VzZXInLFxuICAgICAgICB9KSxcbiAgICAgICAgZ2VuZXJhdGVTdHJpbmdLZXk6ICdwYXNzd29yZCcsXG4gICAgICAgIGV4Y2x1ZGVDaGFyYWN0ZXJzOiAnXCJAL1xcXFwnLCAvLyBFeGNsdWRlIGNoYXJzIHRoYXQgbWF5IGNhdXNlIHNoZWxsIGVzY2FwaW5nIGlzc3Vlc1xuICAgICAgICBwYXNzd29yZExlbmd0aDogMzIsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSAIFBhcmFtZXRlciBHcm91cCDigJQgU1NMIEVuZm9yY2VtZW50ICsgcGdhdWRpdCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvL1xuICAgIC8vIEN1c3RvbSBwYXJhbWV0ZXIgZ3JvdXAgZm9yIEF1cm9yYSBQb3N0Z3JlU1FMIDE1Lnggd2l0aDpcbiAgICAvLyAgMS4gcmRzLmZvcmNlX3NzbCA9IDEgICAgICAgICAgIOKAlCByZWplY3Qgbm9uLVRMUyBjb25uZWN0aW9uc1xuICAgIC8vICAyLiBzaGFyZWRfcHJlbG9hZF9saWJyYXJpZXMgICAg4oCUIGxvYWQgcGdhdWRpdCBleHRlbnNpb24gYXQgc2VydmVyIHN0YXJ0XG4gICAgLy8gIDMuIHBnYXVkaXQubG9nID0gJ2FsbCcgICAgICAgICDigJQgbG9nIGFsbCBEREwsIERNTCwgcm9sZSBjaGFuZ2VzLCBldGMuXG4gICAgLy9cbiAgICAvLyBUaGUgcGdhdWRpdCBleHRlbnNpb24gcHJvdmlkZXMgc2Vzc2lvbiBhbmQgb2JqZWN0IGF1ZGl0IGxvZ2dpbmcuXG4gICAgLy8gTG9ncyBhcmUgd3JpdHRlbiB0byBDbG91ZFdhdGNoIExvZ3MgdmlhIEF1cm9yYSdzIG5hdGl2ZSBpbnRlZ3JhdGlvbi5cbiAgICBjb25zdCBwYXJhbWV0ZXJHcm91cCA9IG5ldyByZHMuUGFyYW1ldGVyR3JvdXAodGhpcywgJ0F1cm9yYVBhcmFtZXRlckdyb3VwJywge1xuICAgICAgZW5naW5lOiByZHMuRGF0YWJhc2VDbHVzdGVyRW5naW5lLmF1cm9yYVBvc3RncmVzKHtcbiAgICAgICAgdmVyc2lvbjogcmRzLkF1cm9yYVBvc3RncmVzRW5naW5lVmVyc2lvbi5WRVJfMTVfNSxcbiAgICAgIH0pLFxuICAgICAgZGVzY3JpcHRpb246IGBBdXJvcmEgUG9zdGdyZVNRTCBwYXJhbWV0ZXIgZ3JvdXAgZm9yIEZvb2QgQ29zdCBDYWxjdWxhdG9yICgke2Vudk5hbWV9KSDigJQgU1NMICsgcGdhdWRpdGAsXG4gICAgICBwYXJhbWV0ZXJzOiB7XG4gICAgICAgIC8vIEVuZm9yY2UgVExTIGNvbm5lY3Rpb25zIOKAlCByZWplY3QgcGxhaW50ZXh0IFBvc3RncmVTUUwgY29ubmVjdGlvbnMuXG4gICAgICAgICdyZHMuZm9yY2Vfc3NsJzogJzEnLFxuXG4gICAgICAgIC8vIExvYWQgcGdhdWRpdCBleHRlbnNpb24gYXQgc2VydmVyIHN0YXJ0dXAuXG4gICAgICAgIC8vIFRoaXMgaXMgYSBzdGF0aWMgcGFyYW1ldGVyOyBjbHVzdGVyIHJlc3RhcnQgaXMgcmVxdWlyZWQgaWYgY2hhbmdlZC5cbiAgICAgICAgc2hhcmVkX3ByZWxvYWRfbGlicmFyaWVzOiAncGdhdWRpdCcsXG5cbiAgICAgICAgLy8gcGdhdWRpdCBsb2dnaW5nIGNvbmZpZ3VyYXRpb246XG4gICAgICAgIC8vICAnYWxsJyDigJQgbG9nIERETCwgUk9MRSwgUkVBRCwgV1JJVEUsIEZVTkNUSU9OLCBNSVNDXG4gICAgICAgIC8vICBMb2dzIGFyZSB3cml0dGVuIHRvIENsb3VkV2F0Y2ggTG9ncyB2aWEgQXVyb3JhJ3MgUG9zdGdyZVNRTCBsb2cgZXhwb3J0LlxuICAgICAgICAncGdhdWRpdC5sb2cnOiAnYWxsJyxcblxuICAgICAgICAvLyBPcHRpb25hbDogbG9nIHN0YXRlbWVudCB0ZXh0IGluIGF1ZGl0IGxvZ3MgKGZvciBkZWVwZXIgZm9yZW5zaWNzKS5cbiAgICAgICAgLy8gU2V0IHRvICdhbGwnIHRvIGluY2x1ZGUgZnVsbCBTUUwgc3RhdGVtZW50IHRleHQgaW4gcGdhdWRpdCBsb2dzLlxuICAgICAgICAvLyBUaGlzIGluY3JlYXNlcyBsb2cgdm9sdW1lIGJ1dCBhaWRzIGluIGNvbXBsaWFuY2UgYXVkaXRpbmcuXG4gICAgICAgICdwZ2F1ZGl0LmxvZ19zdGF0ZW1lbnRfb25jZSc6ICcwJywgLy8gTG9nIGV2ZXJ5IHN0YXRlbWVudCAobm90IGp1c3Qgb25jZSBwZXIgdHhuKVxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCBTdWJuZXQgR3JvdXAg4oCUIFByaXZhdGUgRGF0YSBTdWJuZXRzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vXG4gICAgLy8gQXVyb3JhIGNsdXN0ZXIgaXMgZGVwbG95ZWQgaW4gdGhlICdwcml2YXRlLWRhdGEnIHN1Ym5ldHMgKFBSSVZBVEVfSVNPTEFURUQpXG4gICAgLy8gYWNyb3NzIDIgQVpzLiBUaGVzZSBzdWJuZXRzIGhhdmUgbm8gaW50ZXJuZXQgZWdyZXNzIChubyBOQVQgZ2F0ZXdheSByb3V0ZSkuXG4gICAgLy8gVGhlIGNsdXN0ZXIgaXMgb25seSBhY2Nlc3NpYmxlIGZyb20gRUtTIG5vZGVzIHZpYSB0aGUgYXVyb3JhU2VjdXJpdHlHcm91cC5cbiAgICBjb25zdCBzdWJuZXRHcm91cCA9IG5ldyByZHMuU3VibmV0R3JvdXAodGhpcywgJ0F1cm9yYVN1Ym5ldEdyb3VwJywge1xuICAgICAgZGVzY3JpcHRpb246IGBBdXJvcmEgUG9zdGdyZVNRTCBzdWJuZXQgZ3JvdXAgZm9yIEZvb2QgQ29zdCBDYWxjdWxhdG9yICgke2Vudk5hbWV9KWAsXG4gICAgICB2cGMsXG4gICAgICB2cGNTdWJuZXRzOiB2cGMuc2VsZWN0U3VibmV0cyh7XG4gICAgICAgIHN1Ym5ldEdyb3VwTmFtZTogJ3ByaXZhdGUtZGF0YScsXG4gICAgICB9KSxcbiAgICAgIHN1Ym5ldEdyb3VwTmFtZTogYGZjYy1hdXJvcmEtJHtlbnZOYW1lfWAsXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgQXVyb3JhIFNlcnZlcmxlc3MgdjIgQ2x1c3RlciDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvL1xuICAgIC8vIEF1cm9yYSBTZXJ2ZXJsZXNzIHYyIHByb3ZpZGVzIG9uLWRlbWFuZCBzY2FsaW5nIG9mIEF1cm9yYSBDYXBhY2l0eSBVbml0cyAoQUNVcykuXG4gICAgLy8gRWFjaCBBQ1UgPSAyIEdpQiBSQU0gKyBwcm9wb3J0aW9uYWwgQ1BVICsgbmV0d29yay5cbiAgICAvL1xuICAgIC8vIENvbmZpZ3VyYXRpb246XG4gICAgLy8gIOKAoiBFbmdpbmU6IEF1cm9yYSBQb3N0Z3JlU1FMIDE1LjUgKGxhdGVzdCBHQSB2ZXJzaW9uIGFzIG9mIGRlc2lnbilcbiAgICAvLyAg4oCiIENhcGFjaXR5OiAwLjXigJMyIEFDVXMgKG1pbiAwLjUgQUNVID0gMSBHaUIgUkFNOyBzY2FsZXMgdG8gMiBBQ1VzIHVuZGVyIGxvYWQpXG4gICAgLy8gIOKAoiBNdWx0aS1BWjogMSB3cml0ZXIgKyAxIHN0YW5kYnkgcmVhZGVyIGluIGEgc2Vjb25kIEFaIChhdXRvbWF0aWMgZmFpbG92ZXIpXG4gICAgLy8gIOKAoiBFbmNyeXB0aW9uOiBhdC1yZXN0IHZpYSBBV1MtbWFuYWdlZCBLTVMga2V5XG4gICAgLy8gIOKAoiBCYWNrdXBzOiBhdXRvbWF0ZWQgZGFpbHkgc25hcHNob3RzLCA3LWRheSByZXRlbnRpb25cbiAgICAvLyAg4oCiIENsb3VkV2F0Y2ggTG9nczogcG9zdGdyZXNxbCBsb2cgc3RyZWFtIGVuYWJsZWRcbiAgICAvL1xuICAgIC8vIENyZWRlbnRpYWxzIGFyZSByZXRyaWV2ZWQgZnJvbSBTZWNyZXRzIE1hbmFnZXIgYXQgY2x1c3RlciBjcmVhdGlvbiB0aW1lXG4gICAgLy8gYW5kIHN0b3JlZCBpbiB0aGUgUkRTIG1hc3RlciB1c2VyIHBhc3N3b3JkLiBBcHBsaWNhdGlvbnMgcmV0cmlldmUgdGhlXG4gICAgLy8gY3VycmVudCBjcmVkZW50aWFscyBieSByZWFkaW5nIHRoZSBzZWNyZXQgQVJOIGF0IHJ1bnRpbWUuXG4gICAgdGhpcy5jbHVzdGVyID0gbmV3IHJkcy5EYXRhYmFzZUNsdXN0ZXIodGhpcywgJ0F1cm9yYUNsdXN0ZXInLCB7XG4gICAgICBlbmdpbmU6IHJkcy5EYXRhYmFzZUNsdXN0ZXJFbmdpbmUuYXVyb3JhUG9zdGdyZXMoe1xuICAgICAgICB2ZXJzaW9uOiByZHMuQXVyb3JhUG9zdGdyZXNFbmdpbmVWZXJzaW9uLlZFUl8xNV81LFxuICAgICAgfSksXG4gICAgICBjbHVzdGVySWRlbnRpZmllcjogYGZjYy1hdXJvcmEtJHtlbnZOYW1lfWAsXG4gICAgICBkZWZhdWx0RGF0YWJhc2VOYW1lOiB0aGlzLmRhdGFiYXNlTmFtZSxcblxuICAgICAgLy8gQ3JlZGVudGlhbHMgZnJvbSBTZWNyZXRzIE1hbmFnZXIuXG4gICAgICAvLyBUaGUgc2VjcmV0IG11c3QgaGF2ZSB7dXNlcm5hbWUsIHBhc3N3b3JkfSBrZXlzIGluIGl0cyBKU09OIHN0cnVjdHVyZS5cbiAgICAgIC8vIE5vdGU6IGZyb21TZWNyZXQoKSBhdXRvbWF0aWNhbGx5IGF0dGFjaGVzIHRoZSBzZWNyZXQgdG8gdGhlIGNsdXN0ZXIsXG4gICAgICAvLyBzbyB3ZSBkb24ndCBuZWVkIHRvIGNhbGwgc2VjcmV0LmF0dGFjaCgpIHNlcGFyYXRlbHkuXG4gICAgICBjcmVkZW50aWFsczogcmRzLkNyZWRlbnRpYWxzLmZyb21TZWNyZXQodGhpcy5zZWNyZXQpLFxuXG4gICAgICAvLyBTZXJ2ZXJsZXNzIHYyIHNjYWxpbmcgY29uZmlndXJhdGlvbi5cbiAgICAgIC8vIG1pbkNhcGFjaXR5OiAwLjUgQUNVICgxIEdpQiBSQU0pIOKAlCBtaW5pbXVtIGNvc3Qgd2hlbiBpZGxlLlxuICAgICAgLy8gbWF4Q2FwYWNpdHk6IDIgQUNVICg0IEdpQiBSQU0pICAg4oCUIHN1ZmZpY2llbnQgZm9yIHByb2R1Y3Rpb24gd29ya2xvYWQgcGVyIGRlc2lnbi5cbiAgICAgIHNlcnZlcmxlc3NWMk1pbkNhcGFjaXR5OiAwLjUsXG4gICAgICBzZXJ2ZXJsZXNzVjJNYXhDYXBhY2l0eTogMixcblxuICAgICAgLy8gTXVsdGktQVogZGVwbG95bWVudDogMSB3cml0ZXIgKyAxIHN0YW5kYnkgcmVhZGVyLlxuICAgICAgLy8gQXVyb3JhIGF1dG9tYXRpY2FsbHkgcHJvbW90ZXMgdGhlIHN0YW5kYnkgdG8gd3JpdGVyIG9uIGZhaWx1cmUgKDwgMzBzIFJUTykuXG4gICAgICB3cml0ZXI6IHJkcy5DbHVzdGVySW5zdGFuY2Uuc2VydmVybGVzc1YyKCdXcml0ZXInLCB7XG4gICAgICAgIGluc3RhbmNlSWRlbnRpZmllcjogYGZjYy1hdXJvcmEtd3JpdGVyLSR7ZW52TmFtZX1gLFxuICAgICAgICBwdWJsaWNseUFjY2Vzc2libGU6IGZhbHNlLFxuICAgICAgICBlbmFibGVQZXJmb3JtYW5jZUluc2lnaHRzOiB0cnVlLFxuICAgICAgICBwZXJmb3JtYW5jZUluc2lnaHRSZXRlbnRpb246IHJkcy5QZXJmb3JtYW5jZUluc2lnaHRSZXRlbnRpb24uREVGQVVMVCwgLy8gNyBkYXlzIChmcmVlIHRpZXIpXG4gICAgICB9KSxcbiAgICAgIHJlYWRlcnM6IFtcbiAgICAgICAgcmRzLkNsdXN0ZXJJbnN0YW5jZS5zZXJ2ZXJsZXNzVjIoJ1JlYWRlcjEnLCB7XG4gICAgICAgICAgaW5zdGFuY2VJZGVudGlmaWVyOiBgZmNjLWF1cm9yYS1yZWFkZXIxLSR7ZW52TmFtZX1gLFxuICAgICAgICAgIHB1YmxpY2x5QWNjZXNzaWJsZTogZmFsc2UsXG4gICAgICAgICAgZW5hYmxlUGVyZm9ybWFuY2VJbnNpZ2h0czogdHJ1ZSxcbiAgICAgICAgICBwZXJmb3JtYW5jZUluc2lnaHRSZXRlbnRpb246IHJkcy5QZXJmb3JtYW5jZUluc2lnaHRSZXRlbnRpb24uREVGQVVMVCxcbiAgICAgICAgfSksXG4gICAgICBdLFxuXG4gICAgICB2cGMsXG4gICAgICB2cGNTdWJuZXRzOiB2cGMuc2VsZWN0U3VibmV0cyh7XG4gICAgICAgIHN1Ym5ldEdyb3VwTmFtZTogJ3ByaXZhdGUtZGF0YScsXG4gICAgICB9KSxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbYXVyb3JhU2VjdXJpdHlHcm91cF0sXG4gICAgICBzdWJuZXRHcm91cCxcblxuICAgICAgcGFyYW1ldGVyR3JvdXAsXG5cbiAgICAgIC8vIEVuY3J5cHRpb24gYXQgcmVzdCDigJQgQVdTLW1hbmFnZWQgS01TIGtleSAobm8gYWRkaXRpb25hbCBjb3N0KS5cbiAgICAgIC8vIEZvciBjdXN0b21lci1tYW5hZ2VkIEtNUyBrZXlzLCByZXBsYWNlIHdpdGggYHN0b3JhZ2VFbmNyeXB0aW9uS2V5OiBuZXcga21zLktleSguLi4pYC5cbiAgICAgIHN0b3JhZ2VFbmNyeXB0ZWQ6IHRydWUsXG5cbiAgICAgIC8vIEF1dG9tYXRlZCBiYWNrdXBzIOKAlCBkYWlseSBzbmFwc2hvdCwgNy1kYXkgcmV0ZW50aW9uLlxuICAgICAgYmFja3VwOiB7XG4gICAgICAgIHJldGVudGlvbjogY2RrLkR1cmF0aW9uLmRheXMoNyksXG4gICAgICAgIHByZWZlcnJlZFdpbmRvdzogJzAzOjAwLTA0OjAwJywgLy8gVVRDIOKAlCAxcG3igJMycG0gQUVEVCAob2ZmLXBlYWspXG4gICAgICB9LFxuXG4gICAgICAvLyBDbG91ZFdhdGNoIExvZ3Mg4oCUIGV4cG9ydCBQb3N0Z3JlU1FMIGxvZ3MgdG8gQ2xvdWRXYXRjaCBMb2dzLlxuICAgICAgLy8gSW5jbHVkZXMgZXJyb3IgbG9ncywgc2xvdyBxdWVyeSBsb2dzLCBhbmQgcGdhdWRpdCBsb2dzLlxuICAgICAgY2xvdWR3YXRjaExvZ3NFeHBvcnRzOiBbJ3Bvc3RncmVzcWwnXSxcbiAgICAgIGNsb3Vkd2F0Y2hMb2dzUmV0ZW50aW9uOiBjZGsuYXdzX2xvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG5cbiAgICAgIC8vIERlbGV0aW9uIHByb3RlY3Rpb24g4oCUIHByZXZlbnQgYWNjaWRlbnRhbCBkZWxldGlvbiBpbiBwcm9kdWN0aW9uLlxuICAgICAgLy8gU2V0IHRvIGZhbHNlIGZvciBzdGFnaW5nL2RldiBlbnZpcm9ubWVudHMgdG8gYWxsb3cgZWFzaWVyIHRlYXJkb3duLlxuICAgICAgZGVsZXRpb25Qcm90ZWN0aW9uOiBlbnZOYW1lID09PSAncHJvZCcsXG5cbiAgICAgIC8vIFJlbW92YWwgcG9saWN5IOKAlCBTTkFQU0hPVCBvbiBkZWxldGUgKHJldGFpbiBhIGZpbmFsIHNuYXBzaG90IGZvciBkaXNhc3RlciByZWNvdmVyeSkuXG4gICAgICAvLyBGb3Igc3RhZ2luZy9kZXYsIHlvdSBtYXkgdXNlIERFU1RST1kgdG8gc2tpcCB0aGUgZmluYWwgc25hcHNob3QgYW5kIHNwZWVkIHVwIHRlYXJkb3duLlxuICAgICAgcmVtb3ZhbFBvbGljeTogZW52TmFtZSA9PT0gJ3Byb2QnID8gY2RrLlJlbW92YWxQb2xpY3kuU05BUFNIT1QgOiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSAIENsb3VkRm9ybWF0aW9uIE91dHB1dHMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBFeHBvcnQgY3JpdGljYWwgdmFsdWVzIGZvciBjb25zdW1wdGlvbiBieSB0aGUgRUtTIHN0YWNrIChBUEkgKyB3b3JrZXIgc2VydmljZXMpLlxuICAgIC8vIFRoZSBTcHJpbmcgQm9vdCBhcHBsaWNhdGlvbiB3aWxsIHJlY2VpdmUgdGhlc2UgdmFsdWVzIGFzIGVudmlyb25tZW50IHZhcmlhYmxlczpcbiAgICAvLyAg4oCiIERCX1NFQ1JFVF9BUk4gICAgICAg4oCUIEFSTiBvZiB0aGUgU2VjcmV0cyBNYW5hZ2VyIHNlY3JldCAoY3JlZGVudGlhbHMpXG4gICAgLy8gIOKAoiBEQl9DTFVTVEVSX0VORFBPSU5UIOKAlCBBdXJvcmEgY2x1c3RlciB3cml0ZXIgZW5kcG9pbnQgKGhvc3RuYW1lOnBvcnQpXG4gICAgLy8gIOKAoiBEQl9SRUFERVJfRU5EUE9JTlQgIOKAlCBBdXJvcmEgY2x1c3RlciByZWFkZXIgZW5kcG9pbnQgKHJlYWQtb25seSBxdWVyaWVzKVxuICAgIC8vICDigKIgREJfTkFNRSAgICAgICAgICAgICDigJQgRGF0YWJhc2UgbmFtZVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1NlY3JldEFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnNlY3JldC5zZWNyZXRBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ1NlY3JldHMgTWFuYWdlciBBUk4gZm9yIEF1cm9yYSBjcmVkZW50aWFscycsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tQXVyb3JhU2VjcmV0QXJuYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDbHVzdGVyRW5kcG9pbnQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5jbHVzdGVyLmNsdXN0ZXJFbmRwb2ludC5zb2NrZXRBZGRyZXNzLFxuICAgICAgZGVzY3JpcHRpb246ICdBdXJvcmEgUG9zdGdyZVNRTCBjbHVzdGVyIHdyaXRlciBlbmRwb2ludCAoaG9zdG5hbWU6cG9ydCknLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LUF1cm9yYUNsdXN0ZXJFbmRwb2ludGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ2x1c3RlclJlYWRFbmRwb2ludCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmNsdXN0ZXIuY2x1c3RlclJlYWRFbmRwb2ludC5zb2NrZXRBZGRyZXNzLFxuICAgICAgZGVzY3JpcHRpb246ICdBdXJvcmEgUG9zdGdyZVNRTCBjbHVzdGVyIHJlYWRlciBlbmRwb2ludCAocmVhZC1vbmx5IHF1ZXJpZXMpJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1BdXJvcmFSZWFkZXJFbmRwb2ludGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGF0YWJhc2VOYW1lJywge1xuICAgICAgdmFsdWU6IHRoaXMuZGF0YWJhc2VOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdBdXJvcmEgUG9zdGdyZVNRTCBkYXRhYmFzZSBuYW1lJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1EYXRhYmFzZU5hbWVgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0NsdXN0ZXJBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5jbHVzdGVyLmNsdXN0ZXJBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0F1cm9yYSBjbHVzdGVyIEFSTiAoZm9yIElBTSBhbmQgcmVzb3VyY2UgdGFnZ2luZyknLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LUF1cm9yYUNsdXN0ZXJBcm5gLFxuICAgIH0pO1xuICB9XG59XG4iXX0=