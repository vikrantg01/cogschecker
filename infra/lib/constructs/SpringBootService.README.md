# SpringBootService CDK Construct

A reusable CDK construct for deploying Spring Boot microservices to Amazon EKS with production-ready configurations.

## Features

- **Kubernetes Deployment** with configurable replicas and rolling update strategy
- **ServiceAccount with IRSA** for secure AWS API access without long-lived credentials
- **Horizontal Pod Autoscaler (HPA)** for automatic scaling based on CPU and memory
- **PodDisruptionBudget (PDB)** to ensure at least 1 pod remains available during disruptions
- **Health Probes** (readiness and liveness) pointing to Spring Boot Actuator `/actuator/health`
- **Optional ALB Ingress** for internet-facing traffic via AWS Load Balancer Controller
- **Resource requests/limits** for predictable QoS and scheduling
- **Pod anti-affinity** to spread replicas across nodes for high availability

## Usage Example

```typescript
import { SpringBootService } from '../constructs/SpringBootService';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as iam from 'aws-cdk-lib/aws-iam';

// Assuming you have an EKS cluster and IRSA role already created
const cluster: eks.ICluster = // ... your EKS cluster
const irsaRole: iam.IRole = // ... your IRSA IAM role

// Deploy the API service
const apiService = new SpringBootService(this, 'ApiService', {
  cluster,
  serviceName: 'food-cost-calculator-api',
  imageUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/food-cost-calculator-api:latest',
  irsaRoleArn: irsaRole.roleArn,
  
  // Environment variables (DB connection, Redis, etc.)
  environmentVariables: {
    DB_HOST: 'aurora-cluster.us-east-1.rds.amazonaws.com',
    DB_PORT: '5432',
    DB_NAME: 'foodcostcalculator',
    REDIS_HOST: 'redis-cluster.cache.amazonaws.com',
    REDIS_PORT: '6379',
    SPRING_PROFILES_ACTIVE: 'prod',
  },
  
  // HPA configuration
  hpaMinReplicas: 2,
  hpaMaxReplicas: 20,
  hpaTargetCpuUtilization: 60,
  hpaTargetMemoryUtilization: 70,
  
  // Resource limits
  cpuRequest: '500m',
  cpuLimit: '1000m',
  memoryRequest: '512Mi',
  memoryLimit: '1Gi',
  
  // ALB Ingress configuration
  enableAlbIngress: true,
  ingressHost: 'api.foodcostcalculator.com',
  ingressPath: '/api/*',
  albSecurityGroupIds: [albSecurityGroup.securityGroupId],
  albSubnetIds: vpc.publicSubnets.map(s => s.subnetId),
  certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/abc-123',
});

// Deploy the workers service (separate from API, no ALB ingress)
const workersService = new SpringBootService(this, 'WorkersService', {
  cluster,
  serviceName: 'food-cost-calculator-workers',
  imageUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/food-cost-calculator-workers:latest',
  irsaRoleArn: workersIrsaRole.roleArn,
  
  environmentVariables: {
    DB_HOST: 'aurora-cluster.us-east-1.rds.amazonaws.com',
    DB_PORT: '5432',
    DB_NAME: 'foodcostcalculator',
    REDIS_HOST: 'redis-cluster.cache.amazonaws.com',
    REDIS_PORT: '6379',
    SQS_COST_PROPAGATION_QUEUE: 'https://sqs.us-east-1.amazonaws.com/123456789012/cost-propagation.fifo',
    SQS_OCR_PROCESSING_QUEUE: 'https://sqs.us-east-1.amazonaws.com/123456789012/ocr-processing.fifo',
    SPRING_PROFILES_ACTIVE: 'prod',
  },
  
  hpaMinReplicas: 1,
  hpaMaxReplicas: 10,
  
  // Workers don't need ALB ingress (internal-only, processes SQS messages)
  enableAlbIngress: false,
});
```

## Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `cluster` | `eks.ICluster` | The EKS cluster to deploy into |
| `serviceName` | `string` | Kubernetes resource name (Deployment, Service, etc.) |
| `imageUri` | `string` | Container image URI (e.g., from ECR) |
| `irsaRoleArn` | `string` | IAM Role ARN for IRSA (attached to ServiceAccount) |

### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `namespace` | `string` | `'default'` | Kubernetes namespace |
| `containerPort` | `number` | `8080` | Port the Spring Boot app listens on |
| `environmentVariables` | `{ [key: string]: string }` | `{}` | Environment variables for the container |
| `hpaMinReplicas` | `number` | `2` | HPA minimum replicas (HA baseline) |
| `hpaMaxReplicas` | `number` | `20` | HPA maximum replicas |
| `hpaTargetCpuUtilization` | `number` | `60` | HPA CPU target (%) |
| `hpaTargetMemoryUtilization` | `number` | `70` | HPA memory target (%) |
| `cpuRequest` | `string` | `'500m'` | CPU resource request |
| `cpuLimit` | `string` | `'1000m'` | CPU resource limit |
| `memoryRequest` | `string` | `'512Mi'` | Memory resource request |
| `memoryLimit` | `string` | `'1Gi'` | Memory resource limit |
| `livenessProbeInitialDelaySeconds` | `number` | `30` | Liveness probe initial delay |
| `readinessProbeInitialDelaySeconds` | `number` | `10` | Readiness probe initial delay |
| `healthCheckPath` | `string` | `'/actuator/health'` | Health check endpoint |
| `enableAlbIngress` | `boolean` | `true` | Whether to create ALB Ingress |
| `ingressHost` | `string` | `undefined` | Host for host-based routing |
| `ingressPath` | `string` | `'/*'` | Path for path-based routing |
| `albSecurityGroupIds` | `string[]` | `[]` | Security groups for ALB |
| `albSubnetIds` | `string[]` | `[]` | Subnets for ALB placement |
| `certificateArn` | `string` | `undefined` | ACM certificate ARN for HTTPS |

## Design Decisions

### Zero-Downtime Deployments

The construct is configured for zero-downtime rolling updates:

- **PodDisruptionBudget** with `minAvailable: 1` ensures at least one pod remains running during voluntary disruptions (node drain, rolling update)
- **Rolling update strategy** with `maxUnavailable: 0` and `maxSurge: 1` starts new pods before terminating old ones
- **Readiness probe** prevents traffic from routing to pods until they're fully ready
- **HPA min replicas >= 2** ensures multiple replicas are running for redundancy

### High Availability

- **HPA min replicas = 2** ensures at least two pods are always running
- **Pod anti-affinity** (soft) spreads replicas across different nodes when possible
- **Multi-AZ node groups** (configured in EKS stack) spread pods across availability zones

### Resource Management

- **Resource requests** guarantee baseline CPU and memory for each pod
- **Resource limits** prevent pods from consuming excessive resources
- **Burstable QoS class** (requests < limits) allows pods to burst during load spikes while guaranteeing baseline resources

### Security

- **IRSA** (IAM Roles for Service Accounts) provides temporary AWS credentials to pods without storing long-lived secrets
- **ServiceAccount** is annotated with the IAM role ARN and mounted into the pod
- **Least-privilege IAM policies** are defined in the EKS stack and attached to the IRSA role

## Prerequisites

### EKS Cluster Requirements

1. **OIDC Provider** must be configured on the EKS cluster for IRSA to work
2. **AWS Load Balancer Controller** must be installed if using ALB Ingress (install via Helm)
3. **Metrics Server** must be installed for HPA to work (pre-installed on EKS)

### AWS Load Balancer Controller Installation

```bash
# Add the EKS Helm chart repository
helm repo add eks https://aws.github.io/eks-charts
helm repo update

# Install the AWS Load Balancer Controller
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=<your-cluster-name> \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller
```

## Health Probes

The construct configures both readiness and liveness probes pointing to Spring Boot Actuator's `/actuator/health` endpoint.

### Readiness Probe

- **Purpose**: Determines when the pod is ready to receive traffic
- **Initial delay**: 10 seconds (default)
- **Period**: 10 seconds
- **Failure threshold**: 3 consecutive failures → pod marked unready

Kubernetes will not route Service traffic to a pod until it passes the readiness probe.

### Liveness Probe

- **Purpose**: Determines if the pod is still alive
- **Initial delay**: 30 seconds (default, allows Spring Boot startup time)
- **Period**: 30 seconds
- **Failure threshold**: 3 consecutive failures → pod restarted

Kubernetes will restart the pod if it fails the liveness probe.

### Spring Boot Actuator Configuration

Ensure your `application.properties` or `application.yml` includes:

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,prometheus
  endpoint:
    health:
      probes:
        enabled: true
```

This enables the `/actuator/health` endpoint and adds readiness/liveness subpaths that Kubernetes can use.

## Troubleshooting

### Pods not scaling

1. Check Metrics Server is running: `kubectl get deployment metrics-server -n kube-system`
2. Check HPA status: `kubectl describe hpa <service-name>`
3. Check pod resource usage: `kubectl top pods`

### ALB Ingress not created

1. Check AWS Load Balancer Controller is running: `kubectl get deployment -n kube-system aws-load-balancer-controller`
2. Check Ingress status: `kubectl describe ingress <service-name>`
3. Check controller logs: `kubectl logs -n kube-system deployment/aws-load-balancer-controller`

### Pods not getting AWS permissions (IRSA not working)

1. Verify OIDC provider exists: `aws eks describe-cluster --name <cluster-name> --query "cluster.identity.oidc"`
2. Check ServiceAccount annotation: `kubectl describe serviceaccount <service-name>`
3. Check IAM role trust policy allows the ServiceAccount to assume it
4. Check pod logs for AWS credential errors

## References

- [Spring Boot Actuator Health Endpoints](https://docs.spring.io/spring-boot/docs/current/reference/html/actuator.html#actuator.endpoints.health)
- [Kubernetes Horizontal Pod Autoscaler](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [Kubernetes Pod Disruption Budgets](https://kubernetes.io/docs/tasks/run-application/configure-pdb/)
- [EKS IRSA (IAM Roles for Service Accounts)](https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html)
- [AWS Load Balancer Controller](https://kubernetes-sigs.github.io/aws-load-balancer-controller/)
