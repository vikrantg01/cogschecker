import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
export interface EksStackProps extends cdk.StackProps {
    /** Logical environment name, e.g. "staging" or "prod". Used for naming. */
    readonly envName: string;
    /** VPC where the EKS cluster will be deployed. */
    readonly vpc: ec2.IVpc;
    /** Security group for EKS worker nodes. */
    readonly eksNodeSecurityGroup: ec2.ISecurityGroup;
}
/**
 * EksStack
 *
 * Provisions the Amazon EKS cluster for the Food Cost Calculator:
 *
 *  • EKS 1.30 cluster with managed control plane
 *  • Three managed node groups (one per AZ) with m6i.xlarge instances
 *  • OIDC provider for IAM Roles for Service Accounts (IRSA)
 *  • IRSA IAM roles for `api` and `workers` Kubernetes service accounts
 *  • Least-privilege IAM policies:
 *      - api:     RDS Data API, S3 read, SQS send, Cognito
 *      - workers: SQS consume, Textract, Bedrock, SES, S3 read/write
 *  • Cluster Autoscaler and Horizontal Pod Autoscaler (HPA) support
 *  • CoreDNS, kube-proxy, and VPC CNI add-ons managed by AWS
 *
 * Satisfies Requirements:
 *  - 3.3: Real-time cost propagation via worker pods (async job processing)
 *  - 12.7: Pro — OCR invoice processing via Textract (workers role)
 */
export declare class EksStack extends cdk.Stack {
    /** The EKS cluster. */
    readonly cluster: eks.Cluster;
    /** IRSA IAM role for the `api` service account (Spring Boot API pods). */
    readonly apiServiceAccountRole: iam.IRole;
    /** IRSA IAM role for the `workers` service account (Spring Boot worker pods). */
    readonly workersServiceAccountRole: iam.IRole;
    constructor(scope: Construct, id: string, props: EksStackProps);
}
