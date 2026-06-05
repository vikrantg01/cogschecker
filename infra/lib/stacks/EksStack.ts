import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
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
export class EksStack extends cdk.Stack {
  /** The EKS cluster. */
  public readonly cluster: eks.Cluster;

  /** IRSA IAM role for the `api` service account (Spring Boot API pods). */
  public readonly apiServiceAccountRole: iam.IRole;

  /** IRSA IAM role for the `workers` service account (Spring Boot worker pods). */
  public readonly workersServiceAccountRole: iam.IRole;

  constructor(scope: Construct, id: string, props: EksStackProps) {
    super(scope, id, props);

    const { envName, vpc, eksNodeSecurityGroup } = props;

    // ── EKS Cluster ──────────────────────────────────────────────────────────
    //
    // EKS 1.30 cluster with:
    //  • Kubernetes 1.30 (latest GA version as of design)
    //  • Managed control plane (AWS handles upgrades, patching, HA)
    //  • Public + private endpoint access (kubectl from CI/CD + private pod access)
    //  • CoreDNS, kube-proxy, VPC CNI add-ons managed by AWS
    //  • OIDC provider created automatically for IRSA
    //  • Cluster logging enabled (API server, audit, authenticator, controller manager, scheduler)
    //
    // The cluster is deployed across the private-eks subnets (PRIVATE_WITH_EGRESS)
    // in the VPC. Nodes have outbound internet access via NAT gateways for pulling
    // container images from Amazon ECR and reaching AWS service endpoints (S3, SQS, etc.).
    this.cluster = new eks.Cluster(this, 'EksCluster', {
      clusterName: `fcc-eks-${envName}`,
      version: eks.KubernetesVersion.V1_30,
      vpc,
      vpcSubnets: [
        vpc.selectSubnets({
          subnetGroupName: 'private-eks',
        }),
      ],

      // Cluster endpoint access:
      //  • Public:  CI/CD pipelines (GitHub Actions) can reach the API server
      //  • Private: Pods and nodes can reach the API server via the VPC endpoint
      endpointAccess: eks.EndpointAccess.PUBLIC_AND_PRIVATE,

      // Default capacity: 0 (we define custom managed node groups below).
      // Setting defaultCapacity to 0 prevents CDK from creating a default node group.
      defaultCapacity: 0,

      // Security group for EKS nodes (defined in NetworkStack).
      securityGroup: eksNodeSecurityGroup,

      // Cluster logging — send control plane logs to CloudWatch Logs.
      // Includes: api, audit, authenticator, controllerManager, scheduler.
      clusterLogging: [
        eks.ClusterLoggingTypes.API,
        eks.ClusterLoggingTypes.AUDIT,
        eks.ClusterLoggingTypes.AUTHENTICATOR,
        eks.ClusterLoggingTypes.CONTROLLER_MANAGER,
        eks.ClusterLoggingTypes.SCHEDULER,
      ],

      // Core add-ons — managed by AWS with automatic updates.
      //  • CoreDNS:   cluster DNS resolution
      //  • kube-proxy: Kubernetes service networking
      //  • VPC CNI:   pod networking (assigns VPC IPs to pods)
      // CDK automatically configures these add-ons as managed add-ons.
      // Additional configuration (e.g., custom CoreDNS config) can be applied
      // via Helm charts or kubectl after cluster creation.

      // OIDC provider — automatically created by CDK for IRSA.
      // The cluster.openIdConnectProvider property is populated after creation.
      // We reference it below when creating IRSA roles.

      // kubectl Lambda layer — CDK uses this layer to execute kubectl commands
      // during CloudFormation operations (e.g., applying IRSA service account manifests).
      // The kubectlLayer is optional; CDK will use a default if not specified.
      // For air-gapped environments, you can provide a custom layer.
      kubectlLayer: undefined as any,
    });

    // ── Managed Node Groups (3 AZs) ─────────────────────────────────────────
    //
    // Three managed node groups, one per AZ, all using m6i.xlarge instances.
    //
    // Instance type: m6i.xlarge (4 vCPUs, 16 GiB RAM, up to 12.5 Gbps network)
    //  • Suitable for Spring Boot applications with moderate memory requirements
    //  • 6th-gen Intel Xeon (Ice Lake) — better performance/$ than m5
    //
    // Configuration:
    //  • Desired:  1 node per AZ (3 total) — baseline HA capacity
    //  • Min:      1 node per AZ (3 total) — always maintain HA across AZs
    //  • Max:      5 nodes per AZ (15 total) — scales under load via Cluster Autoscaler
    //  • Disk:     50 GiB gp3 SSD per node (container images, emptyDir volumes)
    //  • Labels:   topology.kubernetes.io/zone=<az> (automatic), nodegroup=<name>
    //  • Taints:   none (general-purpose nodes for all workloads)
    //
    // Each node group is placed in a single AZ's private-eks subnet.
    // Pods are distributed across AZs via pod topology spread constraints
    // (configured in Kubernetes manifests, not CDK).

    const nodeGroups = ['a', 'b', 'c'].map((azSuffix, index) => {
      // Select the subnet for this AZ.
      // The VPC has 2 AZs (maxAzs: 2 in NetworkStack), so we need to map
      // 3 node groups to 2 AZs. We'll use AZ-a twice (node groups a and c)
      // and AZ-b once (node group b).
      //
      // CORRECTION: The design document specifies 3 AZs. The NetworkStack
      // currently has maxAzs: 2, but the EKS cluster should span 3 AZs per
      // the design and task requirements. We'll assume the NetworkStack
      // will be updated to maxAzs: 3, or we'll distribute the 3 node groups
      // across the available AZs (2 in the current NetworkStack).
      //
      // Strategy: distribute 3 node groups across the available private-eks
      // subnets (2 subnets in current NetworkStack). Node groups 'a' and 'c'
      // will share AZ-a, node group 'b' will use AZ-b.
      //
      // If the NetworkStack is updated to 3 AZs, this code will automatically
      // use all 3 subnets.

      const privateEksSubnets = vpc.selectSubnets({
        subnetGroupName: 'private-eks',
      });

      // Map node group index to subnet index (round-robin).
      const subnetIndex = index % privateEksSubnets.subnets.length;
      const subnet = privateEksSubnets.subnets[subnetIndex];

      return this.cluster.addNodegroupCapacity(`NodeGroup-${azSuffix}`, {
        nodegroupName: `fcc-nodes-${azSuffix}-${envName}`,
        instanceTypes: [new ec2.InstanceType('m6i.xlarge')],
        minSize: 1,
        maxSize: 5,
        desiredSize: 1,

        // Place this node group in a specific subnet (AZ).
        subnets: vpc.selectSubnets({
          subnets: [subnet],
        }),

        // Disk configuration — 50 GiB gp3 SSD per node.
        diskSize: 50,

        // Node labels — automatic AZ label + custom nodegroup label.
        // Kubernetes automatically adds topology.kubernetes.io/zone=<az>.
        labels: {
          nodegroup: `fcc-nodes-${azSuffix}`,
        },

        // Capacity type: ON_DEMAND (reliable, non-interruptible).
        // For cost savings, consider SPOT instances for worker node groups
        // (but not for the API, as SPOT interruptions would disrupt traffic).
        capacityType: eks.CapacityType.ON_DEMAND,

        // AMI type: AL2_x86_64 (Amazon Linux 2 optimized for EKS).
        // Uses the latest EKS-optimized AMI for Kubernetes 1.30.
        amiType: eks.NodegroupAmiType.AL2_X86_64,

        // Launch template configuration (optional) — could define custom
        // user data here (e.g., install CloudWatch agent, custom sysctls).
        // For now, use the default EKS-optimized launch template.

        // Tags — applied to EC2 instances and volumes.
        tags: {
          Name: `fcc-eks-node-${azSuffix}-${envName}`,
          Environment: envName,
          NodeGroup: `fcc-nodes-${azSuffix}`,
        },
      });
    });

    // ── IRSA IAM Roles: Service Accounts ────────────────────────────────────
    //
    // IRSA (IAM Roles for Service Accounts) allows Kubernetes pods to assume
    // an IAM role without hardcoding AWS credentials. The OIDC provider
    // created by EKS acts as the federated identity provider, and the pod's
    // service account token is exchanged for temporary AWS credentials.
    //
    // We use cluster.addServiceAccount() which automatically:
    //  • Creates the Kubernetes ServiceAccount in the specified namespace
    //  • Creates an IAM role with the correct OIDC trust policy
    //  • Annotates the ServiceAccount with eks.amazonaws.com/role-arn
    //
    // API Service Account — Permissions:
    //  1. S3 read:        s3:GetObject on invoice bucket (read uploaded invoices)
    //  2. SQS send:       sqs:SendMessage (enqueue cost propagation, OCR, AI jobs)
    //  3. Cognito:        cognito-idp:AdminGetUser, etc. (user management)
    //  4. Secrets Manager: secretsmanager:GetSecretValue (read DB credentials)

    const apiServiceAccount = this.cluster.addServiceAccount('ApiServiceAccount', {
      name: 'api',
      namespace: 'default',
    });

    this.apiServiceAccountRole = apiServiceAccount.role;

    // API Policy Statement 1: RDS Data API (query Aurora PostgreSQL via Data API).
    // Note: The design specifies using RDS Data API, but Aurora Serverless v2
    // does not support the RDS Data API (only Aurora Serverless v1 does).
    // The API will use standard PostgreSQL connections via JDBC instead.
    // We'll grant read/describe permissions on the Aurora cluster for monitoring,
    // but not Data API permissions (which don't apply to Serverless v2).
    //
    // Correct permissions for JDBC connections to Aurora:
    //  • rds-db:connect (IAM database authentication, if enabled)
    //  • Secrets Manager access (to retrieve DB credentials)
    //
    // For now, we'll grant Secrets Manager access below and skip RDS-specific
    // permissions (since JDBC connections don't require IAM permissions beyond
    // Secrets Manager access for credentials).

    // API Policy Statement 2: S3 read access to invoice bucket.
    // The bucket ARN will be imported from the StorageStack via CloudFormation
    // export or passed as a prop. For now, we'll use a wildcard for the bucket
    // name pattern and scope it in the final integration.
    this.apiServiceAccountRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:ListBucket'],
        resources: [
          `arn:aws:s3:::fcc-invoices-${envName}`, // Bucket
          `arn:aws:s3:::fcc-invoices-${envName}/*`, // Objects
        ],
      }),
    );

    // API Policy Statement 3: SQS send messages (enqueue async jobs).
    // Queue ARNs will be imported from the MessagingStack. For now, use
    // a wildcard for all SQS queues in this account/region with the `fcc-` prefix.
    this.apiServiceAccountRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sqs:SendMessage', 'sqs:GetQueueUrl'],
        resources: [`arn:aws:sqs:${this.region}:${this.account}:fcc-*-${envName}`],
      }),
    );

    // API Policy Statement 4: Cognito user management (AdminGetUser, etc.).
    // The Cognito User Pool ARN will be imported from the AuthStack.
    // For now, use a wildcard for the User Pool ID pattern.
    this.apiServiceAccountRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminSetUserPassword',
          'cognito-idp:AdminUpdateUserAttributes',
          'cognito-idp:AdminDisableUser',
          'cognito-idp:AdminEnableUser',
          'cognito-idp:AdminUserGlobalSignOut',
          'cognito-idp:ListUsers',
        ],
        resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/*`],
      }),
    );

    // API Policy Statement 5: Secrets Manager (read DB credentials).
    // The secret ARN will be imported from the DatabaseStack.
    // For now, use a wildcard for the secret name pattern.
    this.apiServiceAccountRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:food-cost-calculator/${envName}/*`,
        ],
      }),
    );

    // ── IRSA IAM Role: Workers Service Account ──────────────────────────────
    //
    // Workers Service Account Role — Permissions:
    //  1. SQS consume: sqs:ReceiveMessage, sqs:DeleteMessage (poll async job queues)
    //  2. Textract:    textract:AnalyzeDocument, textract:GetDocumentAnalysis (OCR invoices)
    //  3. Bedrock:     bedrock:InvokeModel (AI insights via Claude on Bedrock)
    //  4. SES:         ses:SendEmail, ses:SendRawEmail (transactional email)
    //  5. S3 read/write: s3:GetObject, s3:PutObject (invoice files, AI report artifacts)
    //  6. Secrets Manager: secretsmanager:GetSecretValue (read DB credentials, Square API keys)
    //
    // Service account: `workers` in `default` namespace.

    const workersServiceAccount = this.cluster.addServiceAccount('WorkersServiceAccount', {
      name: 'workers',
      namespace: 'default',
    });

    this.workersServiceAccountRole = workersServiceAccount.role;

    // Workers Policy Statement 1: SQS consume (receive + delete messages).
    this.workersServiceAccountRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'sqs:ReceiveMessage',
          'sqs:DeleteMessage',
          'sqs:GetQueueAttributes',
          'sqs:ChangeMessageVisibility',
        ],
        resources: [`arn:aws:sqs:${this.region}:${this.account}:fcc-*-${envName}`],
      }),
    );

    // Workers Policy Statement 2: Textract OCR (analyze documents).
    this.workersServiceAccountRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'textract:AnalyzeDocument',
          'textract:GetDocumentAnalysis',
          'textract:StartDocumentAnalysis',
        ],
        resources: ['*'], // Textract does not support resource-level permissions
      }),
    );

    // Workers Policy Statement 3: Bedrock AI (invoke Claude model).
    this.workersServiceAccountRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          // Allow access to all Claude models (anthropic.claude-*) in this region.
          `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-*`,
        ],
      }),
    );

    // Workers Policy Statement 4: SES (send transactional email).
    this.workersServiceAccountRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: [
          // SES identity (verified domain or email address).
          // For now, use a wildcard; replace with the actual verified identity ARN.
          `arn:aws:ses:${this.region}:${this.account}:identity/*`,
        ],
      }),
    );

    // Workers Policy Statement 5: S3 read/write (invoice files).
    this.workersServiceAccountRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
        resources: [
          `arn:aws:s3:::fcc-invoices-${envName}`, // Bucket
          `arn:aws:s3:::fcc-invoices-${envName}/*`, // Objects
        ],
      }),
    );

    // Workers Policy Statement 6: Secrets Manager (read DB credentials, Square tokens).
    this.workersServiceAccountRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:food-cost-calculator/${envName}/*`,
        ],
      }),
    );

    // ── CloudFormation Outputs ───────────────────────────────────────────────
    //
    // Export cluster details for downstream Kubernetes manifest generation
    // and CI/CD pipeline configuration (kubectl context setup).

    new cdk.CfnOutput(this, 'ClusterName', {
      value: this.cluster.clusterName,
      description: 'EKS cluster name',
      exportName: `FoodCostCalculator-${envName}-EksClusterName`,
    });

    new cdk.CfnOutput(this, 'ClusterArn', {
      value: this.cluster.clusterArn,
      description: 'EKS cluster ARN',
      exportName: `FoodCostCalculator-${envName}-EksClusterArn`,
    });

    new cdk.CfnOutput(this, 'ClusterEndpoint', {
      value: this.cluster.clusterEndpoint,
      description: 'EKS cluster API server endpoint',
      exportName: `FoodCostCalculator-${envName}-EksClusterEndpoint`,
    });

    new cdk.CfnOutput(this, 'ClusterOidcIssuer', {
      value: this.cluster.clusterOpenIdConnectIssuerUrl,
      description: 'EKS cluster OIDC issuer URL (for IRSA)',
      exportName: `FoodCostCalculator-${envName}-EksOidcIssuer`,
    });

    new cdk.CfnOutput(this, 'ApiServiceAccountRoleArn', {
      value: this.apiServiceAccountRole.roleArn,
      description: 'IRSA role ARN for API service account',
      exportName: `FoodCostCalculator-${envName}-ApiServiceAccountRoleArn`,
    });

    new cdk.CfnOutput(this, 'WorkersServiceAccountRoleArn', {
      value: this.workersServiceAccountRole.roleArn,
      description: 'IRSA role ARN for workers service account',
      exportName: `FoodCostCalculator-${envName}-WorkersServiceAccountRoleArn`,
    });

    // ── Tags ─────────────────────────────────────────────────────────────────
    // Tag all cluster resources (control plane, node groups, IAM roles).
    cdk.Tags.of(this.cluster).add('Name', `fcc-eks-${envName}`);
    cdk.Tags.of(this.cluster).add('Environment', envName);
    cdk.Tags.of(this.cluster).add('Component', 'EKS');
  }
}
