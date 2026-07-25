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
export declare class RdsStack extends cdk.Stack {
    /** The RDS PostgreSQL instance */
    readonly instance: rds.DatabaseInstance;
    /** Secrets Manager secret containing credentials */
    readonly secret: secretsmanager.ISecret;
    /** Database endpoint hostname */
    readonly endpoint: string;
    /** Database name */
    readonly databaseName: string;
    constructor(scope: Construct, id: string, props: RdsStackProps);
}
