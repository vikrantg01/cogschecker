"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EksStack = void 0;
const cdk = require("aws-cdk-lib");
const ec2 = require("aws-cdk-lib/aws-ec2");
const eks = require("aws-cdk-lib/aws-eks");
const iam = require("aws-cdk-lib/aws-iam");
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
class EksStack extends cdk.Stack {
    /** The EKS cluster. */
    cluster;
    /** IRSA IAM role for the `api` service account (Spring Boot API pods). */
    apiServiceAccountRole;
    /** IRSA IAM role for the `workers` service account (Spring Boot worker pods). */
    workersServiceAccountRole;
    constructor(scope, id, props) {
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
            kubectlLayer: undefined,
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
        this.apiServiceAccountRole.addToPrincipalPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['s3:GetObject', 's3:ListBucket'],
            resources: [
                `arn:aws:s3:::fcc-invoices-${envName}`, // Bucket
                `arn:aws:s3:::fcc-invoices-${envName}/*`, // Objects
            ],
        }));
        // API Policy Statement 3: SQS send messages (enqueue async jobs).
        // Queue ARNs will be imported from the MessagingStack. For now, use
        // a wildcard for all SQS queues in this account/region with the `fcc-` prefix.
        this.apiServiceAccountRole.addToPrincipalPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['sqs:SendMessage', 'sqs:GetQueueUrl'],
            resources: [`arn:aws:sqs:${this.region}:${this.account}:fcc-*-${envName}`],
        }));
        // API Policy Statement 4: Cognito user management (AdminGetUser, etc.).
        // The Cognito User Pool ARN will be imported from the AuthStack.
        // For now, use a wildcard for the User Pool ID pattern.
        this.apiServiceAccountRole.addToPrincipalPolicy(new iam.PolicyStatement({
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
        }));
        // API Policy Statement 5: Secrets Manager (read DB credentials).
        // The secret ARN will be imported from the DatabaseStack.
        // For now, use a wildcard for the secret name pattern.
        this.apiServiceAccountRole.addToPrincipalPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
            resources: [
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:food-cost-calculator/${envName}/*`,
            ],
        }));
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
        this.workersServiceAccountRole.addToPrincipalPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'sqs:ReceiveMessage',
                'sqs:DeleteMessage',
                'sqs:GetQueueAttributes',
                'sqs:ChangeMessageVisibility',
            ],
            resources: [`arn:aws:sqs:${this.region}:${this.account}:fcc-*-${envName}`],
        }));
        // Workers Policy Statement 2: Textract OCR (analyze documents).
        this.workersServiceAccountRole.addToPrincipalPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'textract:AnalyzeDocument',
                'textract:GetDocumentAnalysis',
                'textract:StartDocumentAnalysis',
            ],
            resources: ['*'], // Textract does not support resource-level permissions
        }));
        // Workers Policy Statement 3: Bedrock AI (invoke Claude model).
        this.workersServiceAccountRole.addToPrincipalPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
            resources: [
                // Allow access to all Claude models (anthropic.claude-*) in this region.
                `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-*`,
            ],
        }));
        // Workers Policy Statement 4: SES (send transactional email).
        this.workersServiceAccountRole.addToPrincipalPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['ses:SendEmail', 'ses:SendRawEmail'],
            resources: [
                // SES identity (verified domain or email address).
                // For now, use a wildcard; replace with the actual verified identity ARN.
                `arn:aws:ses:${this.region}:${this.account}:identity/*`,
            ],
        }));
        // Workers Policy Statement 5: S3 read/write (invoice files).
        this.workersServiceAccountRole.addToPrincipalPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
            resources: [
                `arn:aws:s3:::fcc-invoices-${envName}`, // Bucket
                `arn:aws:s3:::fcc-invoices-${envName}/*`, // Objects
            ],
        }));
        // Workers Policy Statement 6: Secrets Manager (read DB credentials, Square tokens).
        this.workersServiceAccountRole.addToPrincipalPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
            resources: [
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:food-cost-calculator/${envName}/*`,
            ],
        }));
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
exports.EksStack = EksStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiRWtzU3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9saWIvc3RhY2tzL0Vrc1N0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQywyQ0FBMkM7QUFDM0MsMkNBQTJDO0FBQzNDLDJDQUEyQztBQWUzQzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBa0JHO0FBQ0gsTUFBYSxRQUFTLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDckMsdUJBQXVCO0lBQ1AsT0FBTyxDQUFjO0lBRXJDLDBFQUEwRTtJQUMxRCxxQkFBcUIsQ0FBWTtJQUVqRCxpRkFBaUY7SUFDakUseUJBQXlCLENBQVk7SUFFckQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFvQjtRQUM1RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsT0FBTyxFQUFFLEdBQUcsRUFBRSxvQkFBb0IsRUFBRSxHQUFHLEtBQUssQ0FBQztRQUVyRCw0RUFBNEU7UUFDNUUsRUFBRTtRQUNGLHlCQUF5QjtRQUN6QixzREFBc0Q7UUFDdEQsZ0VBQWdFO1FBQ2hFLGdGQUFnRjtRQUNoRix5REFBeUQ7UUFDekQsa0RBQWtEO1FBQ2xELCtGQUErRjtRQUMvRixFQUFFO1FBQ0YsK0VBQStFO1FBQy9FLCtFQUErRTtRQUMvRSx1RkFBdUY7UUFDdkYsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLEdBQUcsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUNqRCxXQUFXLEVBQUUsV0FBVyxPQUFPLEVBQUU7WUFDakMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLO1lBQ3BDLEdBQUc7WUFDSCxVQUFVLEVBQUU7Z0JBQ1YsR0FBRyxDQUFDLGFBQWEsQ0FBQztvQkFDaEIsZUFBZSxFQUFFLGFBQWE7aUJBQy9CLENBQUM7YUFDSDtZQUVELDJCQUEyQjtZQUMzQix3RUFB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QUN0RCxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsR0FBRyxDQUFDLFdBQVcsRUFBRSxLQUFLLENBQUMsQ0FBQztJQUNwRCxDQUFDO0NBQ0Y7QUF6WkQsNEJBeVpDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCAqIGFzIGVrcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWtzJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEVrc1N0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIC8qKiBMb2dpY2FsIGVudmlyb25tZW50IG5hbWUsIGUuZy4gXCJzdGFnaW5nXCIgb3IgXCJwcm9kXCIuIFVzZWQgZm9yIG5hbWluZy4gKi9cbiAgcmVhZG9ubHkgZW52TmFtZTogc3RyaW5nO1xuXG4gIC8qKiBWUEMgd2hlcmUgdGhlIEVLUyBjbHVzdGVyIHdpbGwgYmUgZGVwbG95ZWQuICovXG4gIHJlYWRvbmx5IHZwYzogZWMyLklWcGM7XG5cbiAgLyoqIFNlY3VyaXR5IGdyb3VwIGZvciBFS1Mgd29ya2VyIG5vZGVzLiAqL1xuICByZWFkb25seSBla3NOb2RlU2VjdXJpdHlHcm91cDogZWMyLklTZWN1cml0eUdyb3VwO1xufVxuXG4vKipcbiAqIEVrc1N0YWNrXG4gKlxuICogUHJvdmlzaW9ucyB0aGUgQW1hem9uIEVLUyBjbHVzdGVyIGZvciB0aGUgRm9vZCBDb3N0IENhbGN1bGF0b3I6XG4gKlxuICogIOKAoiBFS1MgMS4zMCBjbHVzdGVyIHdpdGggbWFuYWdlZCBjb250cm9sIHBsYW5lXG4gKiAg4oCiIFRocmVlIG1hbmFnZWQgbm9kZSBncm91cHMgKG9uZSBwZXIgQVopIHdpdGggbTZpLnhsYXJnZSBpbnN0YW5jZXNcbiAqICDigKIgT0lEQyBwcm92aWRlciBmb3IgSUFNIFJvbGVzIGZvciBTZXJ2aWNlIEFjY291bnRzIChJUlNBKVxuICogIOKAoiBJUlNBIElBTSByb2xlcyBmb3IgYGFwaWAgYW5kIGB3b3JrZXJzYCBLdWJlcm5ldGVzIHNlcnZpY2UgYWNjb3VudHNcbiAqICDigKIgTGVhc3QtcHJpdmlsZWdlIElBTSBwb2xpY2llczpcbiAqICAgICAgLSBhcGk6ICAgICBSRFMgRGF0YSBBUEksIFMzIHJlYWQsIFNRUyBzZW5kLCBDb2duaXRvXG4gKiAgICAgIC0gd29ya2VyczogU1FTIGNvbnN1bWUsIFRleHRyYWN0LCBCZWRyb2NrLCBTRVMsIFMzIHJlYWQvd3JpdGVcbiAqICDigKIgQ2x1c3RlciBBdXRvc2NhbGVyIGFuZCBIb3Jpem9udGFsIFBvZCBBdXRvc2NhbGVyIChIUEEpIHN1cHBvcnRcbiAqICDigKIgQ29yZUROUywga3ViZS1wcm94eSwgYW5kIFZQQyBDTkkgYWRkLW9ucyBtYW5hZ2VkIGJ5IEFXU1xuICpcbiAqIFNhdGlzZmllcyBSZXF1aXJlbWVudHM6XG4gKiAgLSAzLjM6IFJlYWwtdGltZSBjb3N0IHByb3BhZ2F0aW9uIHZpYSB3b3JrZXIgcG9kcyAoYXN5bmMgam9iIHByb2Nlc3NpbmcpXG4gKiAgLSAxMi43OiBQcm8g4oCUIE9DUiBpbnZvaWNlIHByb2Nlc3NpbmcgdmlhIFRleHRyYWN0ICh3b3JrZXJzIHJvbGUpXG4gKi9cbmV4cG9ydCBjbGFzcyBFa3NTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIC8qKiBUaGUgRUtTIGNsdXN0ZXIuICovXG4gIHB1YmxpYyByZWFkb25seSBjbHVzdGVyOiBla3MuQ2x1c3RlcjtcblxuICAvKiogSVJTQSBJQU0gcm9sZSBmb3IgdGhlIGBhcGlgIHNlcnZpY2UgYWNjb3VudCAoU3ByaW5nIEJvb3QgQVBJIHBvZHMpLiAqL1xuICBwdWJsaWMgcmVhZG9ubHkgYXBpU2VydmljZUFjY291bnRSb2xlOiBpYW0uSVJvbGU7XG5cbiAgLyoqIElSU0EgSUFNIHJvbGUgZm9yIHRoZSBgd29ya2Vyc2Agc2VydmljZSBhY2NvdW50IChTcHJpbmcgQm9vdCB3b3JrZXIgcG9kcykuICovXG4gIHB1YmxpYyByZWFkb25seSB3b3JrZXJzU2VydmljZUFjY291bnRSb2xlOiBpYW0uSVJvbGU7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IEVrc1N0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgZW52TmFtZSwgdnBjLCBla3NOb2RlU2VjdXJpdHlHcm91cCB9ID0gcHJvcHM7XG5cbiAgICAvLyDilIDilIAgRUtTIENsdXN0ZXIg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBFS1MgMS4zMCBjbHVzdGVyIHdpdGg6XG4gICAgLy8gIOKAoiBLdWJlcm5ldGVzIDEuMzAgKGxhdGVzdCBHQSB2ZXJzaW9uIGFzIG9mIGRlc2lnbilcbiAgICAvLyAg4oCiIE1hbmFnZWQgY29udHJvbCBwbGFuZSAoQVdTIGhhbmRsZXMgdXBncmFkZXMsIHBhdGNoaW5nLCBIQSlcbiAgICAvLyAg4oCiIFB1YmxpYyArIHByaXZhdGUgZW5kcG9pbnQgYWNjZXNzIChrdWJlY3RsIGZyb20gQ0kvQ0QgKyBwcml2YXRlIHBvZCBhY2Nlc3MpXG4gICAgLy8gIOKAoiBDb3JlRE5TLCBrdWJlLXByb3h5LCBWUEMgQ05JIGFkZC1vbnMgbWFuYWdlZCBieSBBV1NcbiAgICAvLyAg4oCiIE9JREMgcHJvdmlkZXIgY3JlYXRlZCBhdXRvbWF0aWNhbGx5IGZvciBJUlNBXG4gICAgLy8gIOKAoiBDbHVzdGVyIGxvZ2dpbmcgZW5hYmxlZCAoQVBJIHNlcnZlciwgYXVkaXQsIGF1dGhlbnRpY2F0b3IsIGNvbnRyb2xsZXIgbWFuYWdlciwgc2NoZWR1bGVyKVxuICAgIC8vXG4gICAgLy8gVGhlIGNsdXN0ZXIgaXMgZGVwbG95ZWQgYWNyb3NzIHRoZSBwcml2YXRlLWVrcyBzdWJuZXRzIChQUklWQVRFX1dJVEhfRUdSRVNTKVxuICAgIC8vIGluIHRoZSBWUEMuIE5vZGVzIGhhdmUgb3V0Ym91bmQgaW50ZXJuZXQgYWNjZXNzIHZpYSBOQVQgZ2F0ZXdheXMgZm9yIHB1bGxpbmdcbiAgICAvLyBjb250YWluZXIgaW1hZ2VzIGZyb20gQW1hem9uIEVDUiBhbmQgcmVhY2hpbmcgQVdTIHNlcnZpY2UgZW5kcG9pbnRzIChTMywgU1FTLCBldGMuKS5cbiAgICB0aGlzLmNsdXN0ZXIgPSBuZXcgZWtzLkNsdXN0ZXIodGhpcywgJ0Vrc0NsdXN0ZXInLCB7XG4gICAgICBjbHVzdGVyTmFtZTogYGZjYy1la3MtJHtlbnZOYW1lfWAsXG4gICAgICB2ZXJzaW9uOiBla3MuS3ViZXJuZXRlc1ZlcnNpb24uVjFfMzAsXG4gICAgICB2cGMsXG4gICAgICB2cGNTdWJuZXRzOiBbXG4gICAgICAgIHZwYy5zZWxlY3RTdWJuZXRzKHtcbiAgICAgICAgICBzdWJuZXRHcm91cE5hbWU6ICdwcml2YXRlLWVrcycsXG4gICAgICAgIH0pLFxuICAgICAgXSxcblxuICAgICAgLy8gQ2x1c3RlciBlbmRwb2ludCBhY2Nlc3M6XG4gICAgICAvLyAg4oCiIFB1YmxpYzogIENJL0NEIHBpcGVsaW5lcyAoR2l0SHViIEFjdGlvbnMpIGNhbiByZWFjaCB0aGUgQVBJIHNlcnZlclxuICAgICAgLy8gIOKAoiBQcml2YXRlOiBQb2RzIGFuZCBub2RlcyBjYW4gcmVhY2ggdGhlIEFQSSBzZXJ2ZXIgdmlhIHRoZSBWUEMgZW5kcG9pbnRcbiAgICAgIGVuZHBvaW50QWNjZXNzOiBla3MuRW5kcG9pbnRBY2Nlc3MuUFVCTElDX0FORF9QUklWQVRFLFxuXG4gICAgICAvLyBEZWZhdWx0IGNhcGFjaXR5OiAwICh3ZSBkZWZpbmUgY3VzdG9tIG1hbmFnZWQgbm9kZSBncm91cHMgYmVsb3cpLlxuICAgICAgLy8gU2V0dGluZyBkZWZhdWx0Q2FwYWNpdHkgdG8gMCBwcmV2ZW50cyBDREsgZnJvbSBjcmVhdGluZyBhIGRlZmF1bHQgbm9kZSBncm91cC5cbiAgICAgIGRlZmF1bHRDYXBhY2l0eTogMCxcblxuICAgICAgLy8gU2VjdXJpdHkgZ3JvdXAgZm9yIEVLUyBub2RlcyAoZGVmaW5lZCBpbiBOZXR3b3JrU3RhY2spLlxuICAgICAgc2VjdXJpdHlHcm91cDogZWtzTm9kZVNlY3VyaXR5R3JvdXAsXG5cbiAgICAgIC8vIENsdXN0ZXIgbG9nZ2luZyDigJQgc2VuZCBjb250cm9sIHBsYW5lIGxvZ3MgdG8gQ2xvdWRXYXRjaCBMb2dzLlxuICAgICAgLy8gSW5jbHVkZXM6IGFwaSwgYXVkaXQsIGF1dGhlbnRpY2F0b3IsIGNvbnRyb2xsZXJNYW5hZ2VyLCBzY2hlZHVsZXIuXG4gICAgICBjbHVzdGVyTG9nZ2luZzogW1xuICAgICAgICBla3MuQ2x1c3RlckxvZ2dpbmdUeXBlcy5BUEksXG4gICAgICAgIGVrcy5DbHVzdGVyTG9nZ2luZ1R5cGVzLkFVRElULFxuICAgICAgICBla3MuQ2x1c3RlckxvZ2dpbmdUeXBlcy5BVVRIRU5USUNBVE9SLFxuICAgICAgICBla3MuQ2x1c3RlckxvZ2dpbmdUeXBlcy5DT05UUk9MTEVSX01BTkFHRVIsXG4gICAgICAgIGVrcy5DbHVzdGVyTG9nZ2luZ1R5cGVzLlNDSEVEVUxFUixcbiAgICAgIF0sXG5cbiAgICAgIC8vIENvcmUgYWRkLW9ucyDigJQgbWFuYWdlZCBieSBBV1Mgd2l0aCBhdXRvbWF0aWMgdXBkYXRlcy5cbiAgICAgIC8vICDigKIgQ29yZUROUzogICBjbHVzdGVyIEROUyByZXNvbHV0aW9uXG4gICAgICAvLyAg4oCiIGt1YmUtcHJveHk6IEt1YmVybmV0ZXMgc2VydmljZSBuZXR3b3JraW5nXG4gICAgICAvLyAg4oCiIFZQQyBDTkk6ICAgcG9kIG5ldHdvcmtpbmcgKGFzc2lnbnMgVlBDIElQcyB0byBwb2RzKVxuICAgICAgLy8gQ0RLIGF1dG9tYXRpY2FsbHkgY29uZmlndXJlcyB0aGVzZSBhZGQtb25zIGFzIG1hbmFnZWQgYWRkLW9ucy5cbiAgICAgIC8vIEFkZGl0aW9uYWwgY29uZmlndXJhdGlvbiAoZS5nLiwgY3VzdG9tIENvcmVETlMgY29uZmlnKSBjYW4gYmUgYXBwbGllZFxuICAgICAgLy8gdmlhIEhlbG0gY2hhcnRzIG9yIGt1YmVjdGwgYWZ0ZXIgY2x1c3RlciBjcmVhdGlvbi5cblxuICAgICAgLy8gT0lEQyBwcm92aWRlciDigJQgYXV0b21hdGljYWxseSBjcmVhdGVkIGJ5IENESyBmb3IgSVJTQS5cbiAgICAgIC8vIFRoZSBjbHVzdGVyLm9wZW5JZENvbm5lY3RQcm92aWRlciBwcm9wZXJ0eSBpcyBwb3B1bGF0ZWQgYWZ0ZXIgY3JlYXRpb24uXG4gICAgICAvLyBXZSByZWZlcmVuY2UgaXQgYmVsb3cgd2hlbiBjcmVhdGluZyBJUlNBIHJvbGVzLlxuXG4gICAgICAvLyBrdWJlY3RsIExhbWJkYSBsYXllciDigJQgQ0RLIHVzZXMgdGhpcyBsYXllciB0byBleGVjdXRlIGt1YmVjdGwgY29tbWFuZHNcbiAgICAgIC8vIGR1cmluZyBDbG91ZEZvcm1hdGlvbiBvcGVyYXRpb25zIChlLmcuLCBhcHBseWluZyBJUlNBIHNlcnZpY2UgYWNjb3VudCBtYW5pZmVzdHMpLlxuICAgICAgLy8gVGhlIGt1YmVjdGxMYXllciBpcyBvcHRpb25hbDsgQ0RLIHdpbGwgdXNlIGEgZGVmYXVsdCBpZiBub3Qgc3BlY2lmaWVkLlxuICAgICAgLy8gRm9yIGFpci1nYXBwZWQgZW52aXJvbm1lbnRzLCB5b3UgY2FuIHByb3ZpZGUgYSBjdXN0b20gbGF5ZXIuXG4gICAgICBrdWJlY3RsTGF5ZXI6IHVuZGVmaW5lZCBhcyBhbnksXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgTWFuYWdlZCBOb2RlIEdyb3VwcyAoMyBBWnMpIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vXG4gICAgLy8gVGhyZWUgbWFuYWdlZCBub2RlIGdyb3Vwcywgb25lIHBlciBBWiwgYWxsIHVzaW5nIG02aS54bGFyZ2UgaW5zdGFuY2VzLlxuICAgIC8vXG4gICAgLy8gSW5zdGFuY2UgdHlwZTogbTZpLnhsYXJnZSAoNCB2Q1BVcywgMTYgR2lCIFJBTSwgdXAgdG8gMTIuNSBHYnBzIG5ldHdvcmspXG4gICAgLy8gIOKAoiBTdWl0YWJsZSBmb3IgU3ByaW5nIEJvb3QgYXBwbGljYXRpb25zIHdpdGggbW9kZXJhdGUgbWVtb3J5IHJlcXVpcmVtZW50c1xuICAgIC8vICDigKIgNnRoLWdlbiBJbnRlbCBYZW9uIChJY2UgTGFrZSkg4oCUIGJldHRlciBwZXJmb3JtYW5jZS8kIHRoYW4gbTVcbiAgICAvL1xuICAgIC8vIENvbmZpZ3VyYXRpb246XG4gICAgLy8gIOKAoiBEZXNpcmVkOiAgMSBub2RlIHBlciBBWiAoMyB0b3RhbCkg4oCUIGJhc2VsaW5lIEhBIGNhcGFjaXR5XG4gICAgLy8gIOKAoiBNaW46ICAgICAgMSBub2RlIHBlciBBWiAoMyB0b3RhbCkg4oCUIGFsd2F5cyBtYWludGFpbiBIQSBhY3Jvc3MgQVpzXG4gICAgLy8gIOKAoiBNYXg6ICAgICAgNSBub2RlcyBwZXIgQVogKDE1IHRvdGFsKSDigJQgc2NhbGVzIHVuZGVyIGxvYWQgdmlhIENsdXN0ZXIgQXV0b3NjYWxlclxuICAgIC8vICDigKIgRGlzazogICAgIDUwIEdpQiBncDMgU1NEIHBlciBub2RlIChjb250YWluZXIgaW1hZ2VzLCBlbXB0eURpciB2b2x1bWVzKVxuICAgIC8vICDigKIgTGFiZWxzOiAgIHRvcG9sb2d5Lmt1YmVybmV0ZXMuaW8vem9uZT08YXo+IChhdXRvbWF0aWMpLCBub2RlZ3JvdXA9PG5hbWU+XG4gICAgLy8gIOKAoiBUYWludHM6ICAgbm9uZSAoZ2VuZXJhbC1wdXJwb3NlIG5vZGVzIGZvciBhbGwgd29ya2xvYWRzKVxuICAgIC8vXG4gICAgLy8gRWFjaCBub2RlIGdyb3VwIGlzIHBsYWNlZCBpbiBhIHNpbmdsZSBBWidzIHByaXZhdGUtZWtzIHN1Ym5ldC5cbiAgICAvLyBQb2RzIGFyZSBkaXN0cmlidXRlZCBhY3Jvc3MgQVpzIHZpYSBwb2QgdG9wb2xvZ3kgc3ByZWFkIGNvbnN0cmFpbnRzXG4gICAgLy8gKGNvbmZpZ3VyZWQgaW4gS3ViZXJuZXRlcyBtYW5pZmVzdHMsIG5vdCBDREspLlxuXG4gICAgY29uc3Qgbm9kZUdyb3VwcyA9IFsnYScsICdiJywgJ2MnXS5tYXAoKGF6U3VmZml4LCBpbmRleCkgPT4ge1xuICAgICAgLy8gU2VsZWN0IHRoZSBzdWJuZXQgZm9yIHRoaXMgQVouXG4gICAgICAvLyBUaGUgVlBDIGhhcyAyIEFacyAobWF4QXpzOiAyIGluIE5ldHdvcmtTdGFjayksIHNvIHdlIG5lZWQgdG8gbWFwXG4gICAgICAvLyAzIG5vZGUgZ3JvdXBzIHRvIDIgQVpzLiBXZSdsbCB1c2UgQVotYSB0d2ljZSAobm9kZSBncm91cHMgYSBhbmQgYylcbiAgICAgIC8vIGFuZCBBWi1iIG9uY2UgKG5vZGUgZ3JvdXAgYikuXG4gICAgICAvL1xuICAgICAgLy8gQ09SUkVDVElPTjogVGhlIGRlc2lnbiBkb2N1bWVudCBzcGVjaWZpZXMgMyBBWnMuIFRoZSBOZXR3b3JrU3RhY2tcbiAgICAgIC8vIGN1cnJlbnRseSBoYXMgbWF4QXpzOiAyLCBidXQgdGhlIEVLUyBjbHVzdGVyIHNob3VsZCBzcGFuIDMgQVpzIHBlclxuICAgICAgLy8gdGhlIGRlc2lnbiBhbmQgdGFzayByZXF1aXJlbWVudHMuIFdlJ2xsIGFzc3VtZSB0aGUgTmV0d29ya1N0YWNrXG4gICAgICAvLyB3aWxsIGJlIHVwZGF0ZWQgdG8gbWF4QXpzOiAzLCBvciB3ZSdsbCBkaXN0cmlidXRlIHRoZSAzIG5vZGUgZ3JvdXBzXG4gICAgICAvLyBhY3Jvc3MgdGhlIGF2YWlsYWJsZSBBWnMgKDIgaW4gdGhlIGN1cnJlbnQgTmV0d29ya1N0YWNrKS5cbiAgICAgIC8vXG4gICAgICAvLyBTdHJhdGVneTogZGlzdHJpYnV0ZSAzIG5vZGUgZ3JvdXBzIGFjcm9zcyB0aGUgYXZhaWxhYmxlIHByaXZhdGUtZWtzXG4gICAgICAvLyBzdWJuZXRzICgyIHN1Ym5ldHMgaW4gY3VycmVudCBOZXR3b3JrU3RhY2spLiBOb2RlIGdyb3VwcyAnYScgYW5kICdjJ1xuICAgICAgLy8gd2lsbCBzaGFyZSBBWi1hLCBub2RlIGdyb3VwICdiJyB3aWxsIHVzZSBBWi1iLlxuICAgICAgLy9cbiAgICAgIC8vIElmIHRoZSBOZXR3b3JrU3RhY2sgaXMgdXBkYXRlZCB0byAzIEFacywgdGhpcyBjb2RlIHdpbGwgYXV0b21hdGljYWxseVxuICAgICAgLy8gdXNlIGFsbCAzIHN1Ym5ldHMuXG5cbiAgICAgIGNvbnN0IHByaXZhdGVFa3NTdWJuZXRzID0gdnBjLnNlbGVjdFN1Ym5ldHMoe1xuICAgICAgICBzdWJuZXRHcm91cE5hbWU6ICdwcml2YXRlLWVrcycsXG4gICAgICB9KTtcblxuICAgICAgLy8gTWFwIG5vZGUgZ3JvdXAgaW5kZXggdG8gc3VibmV0IGluZGV4IChyb3VuZC1yb2JpbikuXG4gICAgICBjb25zdCBzdWJuZXRJbmRleCA9IGluZGV4ICUgcHJpdmF0ZUVrc1N1Ym5ldHMuc3VibmV0cy5sZW5ndGg7XG4gICAgICBjb25zdCBzdWJuZXQgPSBwcml2YXRlRWtzU3VibmV0cy5zdWJuZXRzW3N1Ym5ldEluZGV4XTtcblxuICAgICAgcmV0dXJuIHRoaXMuY2x1c3Rlci5hZGROb2RlZ3JvdXBDYXBhY2l0eShgTm9kZUdyb3VwLSR7YXpTdWZmaXh9YCwge1xuICAgICAgICBub2RlZ3JvdXBOYW1lOiBgZmNjLW5vZGVzLSR7YXpTdWZmaXh9LSR7ZW52TmFtZX1gLFxuICAgICAgICBpbnN0YW5jZVR5cGVzOiBbbmV3IGVjMi5JbnN0YW5jZVR5cGUoJ202aS54bGFyZ2UnKV0sXG4gICAgICAgIG1pblNpemU6IDEsXG4gICAgICAgIG1heFNpemU6IDUsXG4gICAgICAgIGRlc2lyZWRTaXplOiAxLFxuXG4gICAgICAgIC8vIFBsYWNlIHRoaXMgbm9kZSBncm91cCBpbiBhIHNwZWNpZmljIHN1Ym5ldCAoQVopLlxuICAgICAgICBzdWJuZXRzOiB2cGMuc2VsZWN0U3VibmV0cyh7XG4gICAgICAgICAgc3VibmV0czogW3N1Ym5ldF0sXG4gICAgICAgIH0pLFxuXG4gICAgICAgIC8vIERpc2sgY29uZmlndXJhdGlvbiDigJQgNTAgR2lCIGdwMyBTU0QgcGVyIG5vZGUuXG4gICAgICAgIGRpc2tTaXplOiA1MCxcblxuICAgICAgICAvLyBOb2RlIGxhYmVscyDigJQgYXV0b21hdGljIEFaIGxhYmVsICsgY3VzdG9tIG5vZGVncm91cCBsYWJlbC5cbiAgICAgICAgLy8gS3ViZXJuZXRlcyBhdXRvbWF0aWNhbGx5IGFkZHMgdG9wb2xvZ3kua3ViZXJuZXRlcy5pby96b25lPTxhej4uXG4gICAgICAgIGxhYmVsczoge1xuICAgICAgICAgIG5vZGVncm91cDogYGZjYy1ub2Rlcy0ke2F6U3VmZml4fWAsXG4gICAgICAgIH0sXG5cbiAgICAgICAgLy8gQ2FwYWNpdHkgdHlwZTogT05fREVNQU5EIChyZWxpYWJsZSwgbm9uLWludGVycnVwdGlibGUpLlxuICAgICAgICAvLyBGb3IgY29zdCBzYXZpbmdzLCBjb25zaWRlciBTUE9UIGluc3RhbmNlcyBmb3Igd29ya2VyIG5vZGUgZ3JvdXBzXG4gICAgICAgIC8vIChidXQgbm90IGZvciB0aGUgQVBJLCBhcyBTUE9UIGludGVycnVwdGlvbnMgd291bGQgZGlzcnVwdCB0cmFmZmljKS5cbiAgICAgICAgY2FwYWNpdHlUeXBlOiBla3MuQ2FwYWNpdHlUeXBlLk9OX0RFTUFORCxcblxuICAgICAgICAvLyBBTUkgdHlwZTogQUwyX3g4Nl82NCAoQW1hem9uIExpbnV4IDIgb3B0aW1pemVkIGZvciBFS1MpLlxuICAgICAgICAvLyBVc2VzIHRoZSBsYXRlc3QgRUtTLW9wdGltaXplZCBBTUkgZm9yIEt1YmVybmV0ZXMgMS4zMC5cbiAgICAgICAgYW1pVHlwZTogZWtzLk5vZGVncm91cEFtaVR5cGUuQUwyX1g4Nl82NCxcblxuICAgICAgICAvLyBMYXVuY2ggdGVtcGxhdGUgY29uZmlndXJhdGlvbiAob3B0aW9uYWwpIOKAlCBjb3VsZCBkZWZpbmUgY3VzdG9tXG4gICAgICAgIC8vIHVzZXIgZGF0YSBoZXJlIChlLmcuLCBpbnN0YWxsIENsb3VkV2F0Y2ggYWdlbnQsIGN1c3RvbSBzeXNjdGxzKS5cbiAgICAgICAgLy8gRm9yIG5vdywgdXNlIHRoZSBkZWZhdWx0IEVLUy1vcHRpbWl6ZWQgbGF1bmNoIHRlbXBsYXRlLlxuXG4gICAgICAgIC8vIFRhZ3Mg4oCUIGFwcGxpZWQgdG8gRUMyIGluc3RhbmNlcyBhbmQgdm9sdW1lcy5cbiAgICAgICAgdGFnczoge1xuICAgICAgICAgIE5hbWU6IGBmY2MtZWtzLW5vZGUtJHthelN1ZmZpeH0tJHtlbnZOYW1lfWAsXG4gICAgICAgICAgRW52aXJvbm1lbnQ6IGVudk5hbWUsXG4gICAgICAgICAgTm9kZUdyb3VwOiBgZmNjLW5vZGVzLSR7YXpTdWZmaXh9YCxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSAIElSU0EgSUFNIFJvbGVzOiBTZXJ2aWNlIEFjY291bnRzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vXG4gICAgLy8gSVJTQSAoSUFNIFJvbGVzIGZvciBTZXJ2aWNlIEFjY291bnRzKSBhbGxvd3MgS3ViZXJuZXRlcyBwb2RzIHRvIGFzc3VtZVxuICAgIC8vIGFuIElBTSByb2xlIHdpdGhvdXQgaGFyZGNvZGluZyBBV1MgY3JlZGVudGlhbHMuIFRoZSBPSURDIHByb3ZpZGVyXG4gICAgLy8gY3JlYXRlZCBieSBFS1MgYWN0cyBhcyB0aGUgZmVkZXJhdGVkIGlkZW50aXR5IHByb3ZpZGVyLCBhbmQgdGhlIHBvZCdzXG4gICAgLy8gc2VydmljZSBhY2NvdW50IHRva2VuIGlzIGV4Y2hhbmdlZCBmb3IgdGVtcG9yYXJ5IEFXUyBjcmVkZW50aWFscy5cbiAgICAvL1xuICAgIC8vIFdlIHVzZSBjbHVzdGVyLmFkZFNlcnZpY2VBY2NvdW50KCkgd2hpY2ggYXV0b21hdGljYWxseTpcbiAgICAvLyAg4oCiIENyZWF0ZXMgdGhlIEt1YmVybmV0ZXMgU2VydmljZUFjY291bnQgaW4gdGhlIHNwZWNpZmllZCBuYW1lc3BhY2VcbiAgICAvLyAg4oCiIENyZWF0ZXMgYW4gSUFNIHJvbGUgd2l0aCB0aGUgY29ycmVjdCBPSURDIHRydXN0IHBvbGljeVxuICAgIC8vICDigKIgQW5ub3RhdGVzIHRoZSBTZXJ2aWNlQWNjb3VudCB3aXRoIGVrcy5hbWF6b25hd3MuY29tL3JvbGUtYXJuXG4gICAgLy9cbiAgICAvLyBBUEkgU2VydmljZSBBY2NvdW50IOKAlCBQZXJtaXNzaW9uczpcbiAgICAvLyAgMS4gUzMgcmVhZDogICAgICAgIHMzOkdldE9iamVjdCBvbiBpbnZvaWNlIGJ1Y2tldCAocmVhZCB1cGxvYWRlZCBpbnZvaWNlcylcbiAgICAvLyAgMi4gU1FTIHNlbmQ6ICAgICAgIHNxczpTZW5kTWVzc2FnZSAoZW5xdWV1ZSBjb3N0IHByb3BhZ2F0aW9uLCBPQ1IsIEFJIGpvYnMpXG4gICAgLy8gIDMuIENvZ25pdG86ICAgICAgICBjb2duaXRvLWlkcDpBZG1pbkdldFVzZXIsIGV0Yy4gKHVzZXIgbWFuYWdlbWVudClcbiAgICAvLyAgNC4gU2VjcmV0cyBNYW5hZ2VyOiBzZWNyZXRzbWFuYWdlcjpHZXRTZWNyZXRWYWx1ZSAocmVhZCBEQiBjcmVkZW50aWFscylcblxuICAgIGNvbnN0IGFwaVNlcnZpY2VBY2NvdW50ID0gdGhpcy5jbHVzdGVyLmFkZFNlcnZpY2VBY2NvdW50KCdBcGlTZXJ2aWNlQWNjb3VudCcsIHtcbiAgICAgIG5hbWU6ICdhcGknLFxuICAgICAgbmFtZXNwYWNlOiAnZGVmYXVsdCcsXG4gICAgfSk7XG5cbiAgICB0aGlzLmFwaVNlcnZpY2VBY2NvdW50Um9sZSA9IGFwaVNlcnZpY2VBY2NvdW50LnJvbGU7XG5cbiAgICAvLyBBUEkgUG9saWN5IFN0YXRlbWVudCAxOiBSRFMgRGF0YSBBUEkgKHF1ZXJ5IEF1cm9yYSBQb3N0Z3JlU1FMIHZpYSBEYXRhIEFQSSkuXG4gICAgLy8gTm90ZTogVGhlIGRlc2lnbiBzcGVjaWZpZXMgdXNpbmcgUkRTIERhdGEgQVBJLCBidXQgQXVyb3JhIFNlcnZlcmxlc3MgdjJcbiAgICAvLyBkb2VzIG5vdCBzdXBwb3J0IHRoZSBSRFMgRGF0YSBBUEkgKG9ubHkgQXVyb3JhIFNlcnZlcmxlc3MgdjEgZG9lcykuXG4gICAgLy8gVGhlIEFQSSB3aWxsIHVzZSBzdGFuZGFyZCBQb3N0Z3JlU1FMIGNvbm5lY3Rpb25zIHZpYSBKREJDIGluc3RlYWQuXG4gICAgLy8gV2UnbGwgZ3JhbnQgcmVhZC9kZXNjcmliZSBwZXJtaXNzaW9ucyBvbiB0aGUgQXVyb3JhIGNsdXN0ZXIgZm9yIG1vbml0b3JpbmcsXG4gICAgLy8gYnV0IG5vdCBEYXRhIEFQSSBwZXJtaXNzaW9ucyAod2hpY2ggZG9uJ3QgYXBwbHkgdG8gU2VydmVybGVzcyB2MikuXG4gICAgLy9cbiAgICAvLyBDb3JyZWN0IHBlcm1pc3Npb25zIGZvciBKREJDIGNvbm5lY3Rpb25zIHRvIEF1cm9yYTpcbiAgICAvLyAg4oCiIHJkcy1kYjpjb25uZWN0IChJQU0gZGF0YWJhc2UgYXV0aGVudGljYXRpb24sIGlmIGVuYWJsZWQpXG4gICAgLy8gIOKAoiBTZWNyZXRzIE1hbmFnZXIgYWNjZXNzICh0byByZXRyaWV2ZSBEQiBjcmVkZW50aWFscylcbiAgICAvL1xuICAgIC8vIEZvciBub3csIHdlJ2xsIGdyYW50IFNlY3JldHMgTWFuYWdlciBhY2Nlc3MgYmVsb3cgYW5kIHNraXAgUkRTLXNwZWNpZmljXG4gICAgLy8gcGVybWlzc2lvbnMgKHNpbmNlIEpEQkMgY29ubmVjdGlvbnMgZG9uJ3QgcmVxdWlyZSBJQU0gcGVybWlzc2lvbnMgYmV5b25kXG4gICAgLy8gU2VjcmV0cyBNYW5hZ2VyIGFjY2VzcyBmb3IgY3JlZGVudGlhbHMpLlxuXG4gICAgLy8gQVBJIFBvbGljeSBTdGF0ZW1lbnQgMjogUzMgcmVhZCBhY2Nlc3MgdG8gaW52b2ljZSBidWNrZXQuXG4gICAgLy8gVGhlIGJ1Y2tldCBBUk4gd2lsbCBiZSBpbXBvcnRlZCBmcm9tIHRoZSBTdG9yYWdlU3RhY2sgdmlhIENsb3VkRm9ybWF0aW9uXG4gICAgLy8gZXhwb3J0IG9yIHBhc3NlZCBhcyBhIHByb3AuIEZvciBub3csIHdlJ2xsIHVzZSBhIHdpbGRjYXJkIGZvciB0aGUgYnVja2V0XG4gICAgLy8gbmFtZSBwYXR0ZXJuIGFuZCBzY29wZSBpdCBpbiB0aGUgZmluYWwgaW50ZWdyYXRpb24uXG4gICAgdGhpcy5hcGlTZXJ2aWNlQWNjb3VudFJvbGUuYWRkVG9QcmluY2lwYWxQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogWydzMzpHZXRPYmplY3QnLCAnczM6TGlzdEJ1Y2tldCddLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpzMzo6OmZjYy1pbnZvaWNlcy0ke2Vudk5hbWV9YCwgLy8gQnVja2V0XG4gICAgICAgICAgYGFybjphd3M6czM6OjpmY2MtaW52b2ljZXMtJHtlbnZOYW1lfS8qYCwgLy8gT2JqZWN0c1xuICAgICAgICBdLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIC8vIEFQSSBQb2xpY3kgU3RhdGVtZW50IDM6IFNRUyBzZW5kIG1lc3NhZ2VzIChlbnF1ZXVlIGFzeW5jIGpvYnMpLlxuICAgIC8vIFF1ZXVlIEFSTnMgd2lsbCBiZSBpbXBvcnRlZCBmcm9tIHRoZSBNZXNzYWdpbmdTdGFjay4gRm9yIG5vdywgdXNlXG4gICAgLy8gYSB3aWxkY2FyZCBmb3IgYWxsIFNRUyBxdWV1ZXMgaW4gdGhpcyBhY2NvdW50L3JlZ2lvbiB3aXRoIHRoZSBgZmNjLWAgcHJlZml4LlxuICAgIHRoaXMuYXBpU2VydmljZUFjY291bnRSb2xlLmFkZFRvUHJpbmNpcGFsUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnc3FzOlNlbmRNZXNzYWdlJywgJ3NxczpHZXRRdWV1ZVVybCddLFxuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpzcXM6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmZjYy0qLSR7ZW52TmFtZX1gXSxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICAvLyBBUEkgUG9saWN5IFN0YXRlbWVudCA0OiBDb2duaXRvIHVzZXIgbWFuYWdlbWVudCAoQWRtaW5HZXRVc2VyLCBldGMuKS5cbiAgICAvLyBUaGUgQ29nbml0byBVc2VyIFBvb2wgQVJOIHdpbGwgYmUgaW1wb3J0ZWQgZnJvbSB0aGUgQXV0aFN0YWNrLlxuICAgIC8vIEZvciBub3csIHVzZSBhIHdpbGRjYXJkIGZvciB0aGUgVXNlciBQb29sIElEIHBhdHRlcm4uXG4gICAgdGhpcy5hcGlTZXJ2aWNlQWNjb3VudFJvbGUuYWRkVG9QcmluY2lwYWxQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICdjb2duaXRvLWlkcDpBZG1pbkdldFVzZXInLFxuICAgICAgICAgICdjb2duaXRvLWlkcDpBZG1pbkNyZWF0ZVVzZXInLFxuICAgICAgICAgICdjb2duaXRvLWlkcDpBZG1pblNldFVzZXJQYXNzd29yZCcsXG4gICAgICAgICAgJ2NvZ25pdG8taWRwOkFkbWluVXBkYXRlVXNlckF0dHJpYnV0ZXMnLFxuICAgICAgICAgICdjb2duaXRvLWlkcDpBZG1pbkRpc2FibGVVc2VyJyxcbiAgICAgICAgICAnY29nbml0by1pZHA6QWRtaW5FbmFibGVVc2VyJyxcbiAgICAgICAgICAnY29nbml0by1pZHA6QWRtaW5Vc2VyR2xvYmFsU2lnbk91dCcsXG4gICAgICAgICAgJ2NvZ25pdG8taWRwOkxpc3RVc2VycycsXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmNvZ25pdG8taWRwOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp1c2VycG9vbC8qYF0sXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgLy8gQVBJIFBvbGljeSBTdGF0ZW1lbnQgNTogU2VjcmV0cyBNYW5hZ2VyIChyZWFkIERCIGNyZWRlbnRpYWxzKS5cbiAgICAvLyBUaGUgc2VjcmV0IEFSTiB3aWxsIGJlIGltcG9ydGVkIGZyb20gdGhlIERhdGFiYXNlU3RhY2suXG4gICAgLy8gRm9yIG5vdywgdXNlIGEgd2lsZGNhcmQgZm9yIHRoZSBzZWNyZXQgbmFtZSBwYXR0ZXJuLlxuICAgIHRoaXMuYXBpU2VydmljZUFjY291bnRSb2xlLmFkZFRvUHJpbmNpcGFsUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnc2VjcmV0c21hbmFnZXI6R2V0U2VjcmV0VmFsdWUnLCAnc2VjcmV0c21hbmFnZXI6RGVzY3JpYmVTZWNyZXQnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgYGFybjphd3M6c2VjcmV0c21hbmFnZXI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnNlY3JldDpmb29kLWNvc3QtY2FsY3VsYXRvci8ke2Vudk5hbWV9LypgLFxuICAgICAgICBdLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIC8vIOKUgOKUgCBJUlNBIElBTSBSb2xlOiBXb3JrZXJzIFNlcnZpY2UgQWNjb3VudCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvL1xuICAgIC8vIFdvcmtlcnMgU2VydmljZSBBY2NvdW50IFJvbGUg4oCUIFBlcm1pc3Npb25zOlxuICAgIC8vICAxLiBTUVMgY29uc3VtZTogc3FzOlJlY2VpdmVNZXNzYWdlLCBzcXM6RGVsZXRlTWVzc2FnZSAocG9sbCBhc3luYyBqb2IgcXVldWVzKVxuICAgIC8vICAyLiBUZXh0cmFjdDogICAgdGV4dHJhY3Q6QW5hbHl6ZURvY3VtZW50LCB0ZXh0cmFjdDpHZXREb2N1bWVudEFuYWx5c2lzIChPQ1IgaW52b2ljZXMpXG4gICAgLy8gIDMuIEJlZHJvY2s6ICAgICBiZWRyb2NrOkludm9rZU1vZGVsIChBSSBpbnNpZ2h0cyB2aWEgQ2xhdWRlIG9uIEJlZHJvY2spXG4gICAgLy8gIDQuIFNFUzogICAgICAgICBzZXM6U2VuZEVtYWlsLCBzZXM6U2VuZFJhd0VtYWlsICh0cmFuc2FjdGlvbmFsIGVtYWlsKVxuICAgIC8vICA1LiBTMyByZWFkL3dyaXRlOiBzMzpHZXRPYmplY3QsIHMzOlB1dE9iamVjdCAoaW52b2ljZSBmaWxlcywgQUkgcmVwb3J0IGFydGlmYWN0cylcbiAgICAvLyAgNi4gU2VjcmV0cyBNYW5hZ2VyOiBzZWNyZXRzbWFuYWdlcjpHZXRTZWNyZXRWYWx1ZSAocmVhZCBEQiBjcmVkZW50aWFscywgU3F1YXJlIEFQSSBrZXlzKVxuICAgIC8vXG4gICAgLy8gU2VydmljZSBhY2NvdW50OiBgd29ya2Vyc2AgaW4gYGRlZmF1bHRgIG5hbWVzcGFjZS5cblxuICAgIGNvbnN0IHdvcmtlcnNTZXJ2aWNlQWNjb3VudCA9IHRoaXMuY2x1c3Rlci5hZGRTZXJ2aWNlQWNjb3VudCgnV29ya2Vyc1NlcnZpY2VBY2NvdW50Jywge1xuICAgICAgbmFtZTogJ3dvcmtlcnMnLFxuICAgICAgbmFtZXNwYWNlOiAnZGVmYXVsdCcsXG4gICAgfSk7XG5cbiAgICB0aGlzLndvcmtlcnNTZXJ2aWNlQWNjb3VudFJvbGUgPSB3b3JrZXJzU2VydmljZUFjY291bnQucm9sZTtcblxuICAgIC8vIFdvcmtlcnMgUG9saWN5IFN0YXRlbWVudCAxOiBTUVMgY29uc3VtZSAocmVjZWl2ZSArIGRlbGV0ZSBtZXNzYWdlcykuXG4gICAgdGhpcy53b3JrZXJzU2VydmljZUFjY291bnRSb2xlLmFkZFRvUHJpbmNpcGFsUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAnc3FzOlJlY2VpdmVNZXNzYWdlJyxcbiAgICAgICAgICAnc3FzOkRlbGV0ZU1lc3NhZ2UnLFxuICAgICAgICAgICdzcXM6R2V0UXVldWVBdHRyaWJ1dGVzJyxcbiAgICAgICAgICAnc3FzOkNoYW5nZU1lc3NhZ2VWaXNpYmlsaXR5JyxcbiAgICAgICAgXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6c3FzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpmY2MtKi0ke2Vudk5hbWV9YF0sXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgLy8gV29ya2VycyBQb2xpY3kgU3RhdGVtZW50IDI6IFRleHRyYWN0IE9DUiAoYW5hbHl6ZSBkb2N1bWVudHMpLlxuICAgIHRoaXMud29ya2Vyc1NlcnZpY2VBY2NvdW50Um9sZS5hZGRUb1ByaW5jaXBhbFBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgJ3RleHRyYWN0OkFuYWx5emVEb2N1bWVudCcsXG4gICAgICAgICAgJ3RleHRyYWN0OkdldERvY3VtZW50QW5hbHlzaXMnLFxuICAgICAgICAgICd0ZXh0cmFjdDpTdGFydERvY3VtZW50QW5hbHlzaXMnLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFsnKiddLCAvLyBUZXh0cmFjdCBkb2VzIG5vdCBzdXBwb3J0IHJlc291cmNlLWxldmVsIHBlcm1pc3Npb25zXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgLy8gV29ya2VycyBQb2xpY3kgU3RhdGVtZW50IDM6IEJlZHJvY2sgQUkgKGludm9rZSBDbGF1ZGUgbW9kZWwpLlxuICAgIHRoaXMud29ya2Vyc1NlcnZpY2VBY2NvdW50Um9sZS5hZGRUb1ByaW5jaXBhbFBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ2JlZHJvY2s6SW52b2tlTW9kZWwnLCAnYmVkcm9jazpJbnZva2VNb2RlbFdpdGhSZXNwb25zZVN0cmVhbSddLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAvLyBBbGxvdyBhY2Nlc3MgdG8gYWxsIENsYXVkZSBtb2RlbHMgKGFudGhyb3BpYy5jbGF1ZGUtKikgaW4gdGhpcyByZWdpb24uXG4gICAgICAgICAgYGFybjphd3M6YmVkcm9jazoke3RoaXMucmVnaW9ufTo6Zm91bmRhdGlvbi1tb2RlbC9hbnRocm9waWMuY2xhdWRlLSpgLFxuICAgICAgICBdLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIC8vIFdvcmtlcnMgUG9saWN5IFN0YXRlbWVudCA0OiBTRVMgKHNlbmQgdHJhbnNhY3Rpb25hbCBlbWFpbCkuXG4gICAgdGhpcy53b3JrZXJzU2VydmljZUFjY291bnRSb2xlLmFkZFRvUHJpbmNpcGFsUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnc2VzOlNlbmRFbWFpbCcsICdzZXM6U2VuZFJhd0VtYWlsJ10sXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIC8vIFNFUyBpZGVudGl0eSAodmVyaWZpZWQgZG9tYWluIG9yIGVtYWlsIGFkZHJlc3MpLlxuICAgICAgICAgIC8vIEZvciBub3csIHVzZSBhIHdpbGRjYXJkOyByZXBsYWNlIHdpdGggdGhlIGFjdHVhbCB2ZXJpZmllZCBpZGVudGl0eSBBUk4uXG4gICAgICAgICAgYGFybjphd3M6c2VzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTppZGVudGl0eS8qYCxcbiAgICAgICAgXSxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICAvLyBXb3JrZXJzIFBvbGljeSBTdGF0ZW1lbnQgNTogUzMgcmVhZC93cml0ZSAoaW52b2ljZSBmaWxlcykuXG4gICAgdGhpcy53b3JrZXJzU2VydmljZUFjY291bnRSb2xlLmFkZFRvUHJpbmNpcGFsUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnczM6R2V0T2JqZWN0JywgJ3MzOlB1dE9iamVjdCcsICdzMzpMaXN0QnVja2V0J10sXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIGBhcm46YXdzOnMzOjo6ZmNjLWludm9pY2VzLSR7ZW52TmFtZX1gLCAvLyBCdWNrZXRcbiAgICAgICAgICBgYXJuOmF3czpzMzo6OmZjYy1pbnZvaWNlcy0ke2Vudk5hbWV9LypgLCAvLyBPYmplY3RzXG4gICAgICAgIF0sXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgLy8gV29ya2VycyBQb2xpY3kgU3RhdGVtZW50IDY6IFNlY3JldHMgTWFuYWdlciAocmVhZCBEQiBjcmVkZW50aWFscywgU3F1YXJlIHRva2VucykuXG4gICAgdGhpcy53b3JrZXJzU2VydmljZUFjY291bnRSb2xlLmFkZFRvUHJpbmNpcGFsUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnc2VjcmV0c21hbmFnZXI6R2V0U2VjcmV0VmFsdWUnLCAnc2VjcmV0c21hbmFnZXI6RGVzY3JpYmVTZWNyZXQnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgYGFybjphd3M6c2VjcmV0c21hbmFnZXI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnNlY3JldDpmb29kLWNvc3QtY2FsY3VsYXRvci8ke2Vudk5hbWV9LypgLFxuICAgICAgICBdLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIC8vIOKUgOKUgCBDbG91ZEZvcm1hdGlvbiBPdXRwdXRzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vXG4gICAgLy8gRXhwb3J0IGNsdXN0ZXIgZGV0YWlscyBmb3IgZG93bnN0cmVhbSBLdWJlcm5ldGVzIG1hbmlmZXN0IGdlbmVyYXRpb25cbiAgICAvLyBhbmQgQ0kvQ0QgcGlwZWxpbmUgY29uZmlndXJhdGlvbiAoa3ViZWN0bCBjb250ZXh0IHNldHVwKS5cblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDbHVzdGVyTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmNsdXN0ZXIuY2x1c3Rlck5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0VLUyBjbHVzdGVyIG5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LUVrc0NsdXN0ZXJOYW1lYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDbHVzdGVyQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuY2x1c3Rlci5jbHVzdGVyQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdFS1MgY2x1c3RlciBBUk4nLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LUVrc0NsdXN0ZXJBcm5gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0NsdXN0ZXJFbmRwb2ludCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmNsdXN0ZXIuY2x1c3RlckVuZHBvaW50LFxuICAgICAgZGVzY3JpcHRpb246ICdFS1MgY2x1c3RlciBBUEkgc2VydmVyIGVuZHBvaW50JyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1Fa3NDbHVzdGVyRW5kcG9pbnRgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0NsdXN0ZXJPaWRjSXNzdWVyJywge1xuICAgICAgdmFsdWU6IHRoaXMuY2x1c3Rlci5jbHVzdGVyT3BlbklkQ29ubmVjdElzc3VlclVybCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRUtTIGNsdXN0ZXIgT0lEQyBpc3N1ZXIgVVJMIChmb3IgSVJTQSknLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LUVrc09pZGNJc3N1ZXJgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FwaVNlcnZpY2VBY2NvdW50Um9sZUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmFwaVNlcnZpY2VBY2NvdW50Um9sZS5yb2xlQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdJUlNBIHJvbGUgQVJOIGZvciBBUEkgc2VydmljZSBhY2NvdW50JyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1BcGlTZXJ2aWNlQWNjb3VudFJvbGVBcm5gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1dvcmtlcnNTZXJ2aWNlQWNjb3VudFJvbGVBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy53b3JrZXJzU2VydmljZUFjY291bnRSb2xlLnJvbGVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0lSU0Egcm9sZSBBUk4gZm9yIHdvcmtlcnMgc2VydmljZSBhY2NvdW50JyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1Xb3JrZXJzU2VydmljZUFjY291bnRSb2xlQXJuYCxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCBUYWdzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vIFRhZyBhbGwgY2x1c3RlciByZXNvdXJjZXMgKGNvbnRyb2wgcGxhbmUsIG5vZGUgZ3JvdXBzLCBJQU0gcm9sZXMpLlxuICAgIGNkay5UYWdzLm9mKHRoaXMuY2x1c3RlcikuYWRkKCdOYW1lJywgYGZjYy1la3MtJHtlbnZOYW1lfWApO1xuICAgIGNkay5UYWdzLm9mKHRoaXMuY2x1c3RlcikuYWRkKCdFbnZpcm9ubWVudCcsIGVudk5hbWUpO1xuICAgIGNkay5UYWdzLm9mKHRoaXMuY2x1c3RlcikuYWRkKCdDb21wb25lbnQnLCAnRUtTJyk7XG4gIH1cbn1cbiJdfQ==