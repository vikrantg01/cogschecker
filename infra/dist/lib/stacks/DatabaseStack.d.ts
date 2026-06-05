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
export declare class DatabaseStack extends cdk.Stack {
    /** The Aurora PostgreSQL cluster. */
    readonly cluster: rds.DatabaseCluster;
    /** Secrets Manager secret containing the database credentials. */
    readonly secret: secretsmanager.ISecret;
    /** The database name (default: 'foodcostcalculator'). */
    readonly databaseName: string;
    constructor(scope: Construct, id: string, props: DatabaseStackProps);
}
