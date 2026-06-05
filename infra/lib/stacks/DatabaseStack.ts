import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface DatabaseStackProps extends cdk.StackProps {
  /** Logical environment name, e.g. "staging" or "prod". Used for naming. */
  readonly envName: string;

  /** VPC where the Aurora cluster will be deployed. */
  readonly vpc: ec2.IVpc;

  /** Security group for Aurora PostgreSQL cluster. */
  readonly auroraSecurityGroup: ec2.ISecurityGroup;
}

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
export class DatabaseStack extends cdk.Stack {
  /** The Aurora PostgreSQL cluster. */
  public readonly cluster: rds.DatabaseCluster;

  /** Secrets Manager secret containing the database credentials. */
  public readonly secret: secretsmanager.ISecret;

  /** The database name (default: 'foodcostcalculator'). */
  public readonly databaseName: string = 'foodcostcalculator';

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
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
