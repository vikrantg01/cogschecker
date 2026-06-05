import * as eks from 'aws-cdk-lib/aws-eks';
import { Construct } from 'constructs';
export interface SpringBootServiceProps {
    /**
     * The EKS cluster to deploy the service into.
     */
    readonly cluster: eks.ICluster;
    /**
     * Kubernetes namespace where the service will be deployed.
     * @default 'default'
     */
    readonly namespace?: string;
    /**
     * Service name (used for Deployment, Service, ServiceAccount, and HPA names).
     * Must be a valid Kubernetes name (lowercase alphanumeric + hyphens).
     */
    readonly serviceName: string;
    /**
     * Container image URI (e.g., from Amazon ECR).
     * Example: "123456789012.dkr.ecr.us-east-1.amazonaws.com/food-cost-calculator-api:latest"
     */
    readonly imageUri: string;
    /**
     * Container port the Spring Boot application listens on.
     * @default 8080
     */
    readonly containerPort?: number;
    /**
     * Environment variables to inject into the container.
     * Example: { DB_HOST: 'aurora-cluster.us-east-1.rds.amazonaws.com' }
     */
    readonly environmentVariables?: {
        [key: string]: string;
    };
    /**
     * IAM Role ARN for IRSA (IAM Roles for Service Accounts).
     * This role is attached to the Kubernetes ServiceAccount and grants AWS API permissions.
     */
    readonly irsaRoleArn: string;
    /**
     * Horizontal Pod Autoscaler — minimum number of replicas.
     * @default 2
     */
    readonly hpaMinReplicas?: number;
    /**
     * Horizontal Pod Autoscaler — maximum number of replicas.
     * @default 20
     */
    readonly hpaMaxReplicas?: number;
    /**
     * Target CPU utilization percentage for HPA scaling decisions.
     * @default 60
     */
    readonly hpaTargetCpuUtilization?: number;
    /**
     * Target memory utilization percentage for HPA scaling decisions.
     * @default 70
     */
    readonly hpaTargetMemoryUtilization?: number;
    /**
     * CPU resource request for each pod.
     * @default '500m'
     */
    readonly cpuRequest?: string;
    /**
     * CPU resource limit for each pod.
     * @default '1000m' (1 vCPU)
     */
    readonly cpuLimit?: string;
    /**
     * Memory resource request for each pod.
     * @default '512Mi'
     */
    readonly memoryRequest?: string;
    /**
     * Memory resource limit for each pod.
     * @default '1Gi'
     */
    readonly memoryLimit?: string;
    /**
     * Liveness probe — initial delay in seconds before the first check.
     * @default 30
     */
    readonly livenessProbeInitialDelaySeconds?: number;
    /**
     * Readiness probe — initial delay in seconds before the first check.
     * @default 10
     */
    readonly readinessProbeInitialDelaySeconds?: number;
    /**
     * Health check path for liveness and readiness probes.
     * @default '/actuator/health'
     */
    readonly healthCheckPath?: string;
    /**
     * Whether to enable ALB Ingress for this service.
     * When true, adds annotations for AWS Load Balancer Controller to create an ALB.
     * @default true
     */
    readonly enableAlbIngress?: boolean;
    /**
     * ALB Ingress host (for host-based routing).
     * Example: "api.foodcostcalculator.com"
     * Only used when enableAlbIngress is true.
     */
    readonly ingressHost?: string;
    /**
     * ALB Ingress path (for path-based routing).
     * Example: "/api/*"
     * Only used when enableAlbIngress is true.
     * @default '/*'
     */
    readonly ingressPath?: string;
    /**
     * Security group IDs to attach to the ALB.
     * Only used when enableAlbIngress is true.
     */
    readonly albSecurityGroupIds?: string[];
    /**
     * Subnet IDs for ALB placement (typically public subnets).
     * Only used when enableAlbIngress is true.
     */
    readonly albSubnetIds?: string[];
    /**
     * ACM certificate ARN for HTTPS listener on the ALB.
     * Only used when enableAlbIngress is true.
     */
    readonly certificateArn?: string;
}
/**
 * SpringBootService
 *
 * A reusable CDK construct that deploys a Spring Boot microservice to Amazon EKS with:
 *
 *  • Kubernetes Deployment with configurable replica count and resource limits
 *  • Kubernetes Service (ClusterIP or LoadBalancer)
 *  • ServiceAccount with IRSA (IAM Roles for Service Accounts) for AWS API access
 *  • Horizontal Pod Autoscaler (HPA) for automatic scaling based on CPU and memory
 *  • PodDisruptionBudget (PDB) to ensure at least 1 pod remains available during voluntary disruptions
 *  • Readiness and liveness probes pointing to Spring Boot Actuator `/actuator/health`
 *  • Optional ALB Ingress for internet-facing traffic via AWS Load Balancer Controller
 *
 * This construct follows EKS and Spring Boot best practices:
 *  - IRSA for least-privilege AWS API access (no long-lived credentials in pods)
 *  - HPA for automatic scaling under load
 *  - PDB for zero-downtime rolling updates
 *  - Health probes for Kubernetes-managed pod lifecycle
 *  - Resource requests/limits for predictable scheduling and QoS
 *
 * Usage example:
 *
 * ```typescript
 * new SpringBootService(this, 'ApiService', {
 *   cluster: eksCluster,
 *   serviceName: 'food-cost-calculator-api',
 *   imageUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/food-cost-calculator-api:latest',
 *   irsaRoleArn: apiIrsaRole.roleArn,
 *   environmentVariables: {
 *     DB_HOST: auroraCluster.clusterEndpoint.hostname,
 *     REDIS_HOST: redisCluster.attrPrimaryEndPointAddress,
 *   },
 *   hpaMinReplicas: 2,
 *   hpaMaxReplicas: 20,
 *   enableAlbIngress: true,
 *   ingressHost: 'api.foodcostcalculator.com',
 *   albSecurityGroupIds: [albSg.securityGroupId],
 *   albSubnetIds: vpc.publicSubnets.map(s => s.subnetId),
 *   certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/abc-123',
 * });
 * ```
 *
 * Satisfies Requirements: 3.3 (real-time cost propagation via async workers), infrastructure availability.
 */
export declare class SpringBootService extends Construct {
    /**
     * The Kubernetes ServiceAccount created for this service.
     */
    readonly serviceAccount: eks.ServiceAccount;
    /**
     * The Kubernetes Deployment manifest.
     */
    readonly deployment: eks.KubernetesManifest;
    /**
     * The Kubernetes Service manifest.
     */
    readonly service: eks.KubernetesManifest;
    /**
     * The HorizontalPodAutoscaler manifest.
     */
    readonly hpa: eks.KubernetesManifest;
    /**
     * The PodDisruptionBudget manifest.
     */
    readonly pdb: eks.KubernetesManifest;
    /**
     * The optional ALB Ingress manifest (created only if enableAlbIngress is true).
     */
    readonly ingress?: eks.KubernetesManifest;
    constructor(scope: Construct, id: string, props: SpringBootServiceProps);
}
