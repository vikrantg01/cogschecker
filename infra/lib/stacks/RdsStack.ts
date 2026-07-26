import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface RdsStackProps extends cdk.StackProps {
  /** Logical environment name, e.g. "staging" or "prod" */
  readonly envName: string;

  /** VPC where the RDS instance will be deployed */
  readonly vpc: ec2.IVpc;

  /** Security group for RDS instance */
  readonly rdsSecurityGroup: ec2.ISecurityGroup;
}

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
export class RdsStack extends cdk.Stack {
  /** The RDS PostgreSQL instance */
  public readonly instance: rds.DatabaseInstance;

  /** Secrets Manager secret containing credentials */
  public readonly secret: secretsmanager.ISecret;

  /** Database endpoint hostname */
  public readonly endpoint: string;

  /** Database name */
  public readonly databaseName: string = 'foodcost';

  constructor(scope: Construct, id: string, props: RdsStackProps) {
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
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G, // ARM-based (Graviton2)
        ec2.InstanceSize.MICRO, // 2 vCPU, 1 GB RAM
      ),
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
