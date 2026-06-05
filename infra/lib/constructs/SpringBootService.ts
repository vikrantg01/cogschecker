import * as cdk from 'aws-cdk-lib';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as iam from 'aws-cdk-lib/aws-iam';
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
  readonly environmentVariables?: { [key: string]: string };

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
export class SpringBootService extends Construct {
  /**
   * The Kubernetes ServiceAccount created for this service.
   */
  public readonly serviceAccount: eks.ServiceAccount;

  /**
   * The Kubernetes Deployment manifest.
   */
  public readonly deployment: eks.KubernetesManifest;

  /**
   * The Kubernetes Service manifest.
   */
  public readonly service: eks.KubernetesManifest;

  /**
   * The HorizontalPodAutoscaler manifest.
   */
  public readonly hpa: eks.KubernetesManifest;

  /**
   * The PodDisruptionBudget manifest.
   */
  public readonly pdb: eks.KubernetesManifest;

  /**
   * The optional ALB Ingress manifest (created only if enableAlbIngress is true).
   */
  public readonly ingress?: eks.KubernetesManifest;

  constructor(scope: Construct, id: string, props: SpringBootServiceProps) {
    super(scope, id);

    const {
      cluster,
      namespace = 'default',
      serviceName,
      imageUri,
      containerPort = 8080,
      environmentVariables = {},
      irsaRoleArn,
      hpaMinReplicas = 2,
      hpaMaxReplicas = 20,
      hpaTargetCpuUtilization = 60,
      hpaTargetMemoryUtilization = 70,
      cpuRequest = '500m',
      cpuLimit = '1000m',
      memoryRequest = '512Mi',
      memoryLimit = '1Gi',
      livenessProbeInitialDelaySeconds = 30,
      readinessProbeInitialDelaySeconds = 10,
      healthCheckPath = '/actuator/health',
      enableAlbIngress = true,
      ingressHost,
      ingressPath = '/*',
      albSecurityGroupIds = [],
      albSubnetIds = [],
      certificateArn,
    } = props;

    // ── ServiceAccount with IRSA ────────────────────────────────────────────
    //
    // Create a Kubernetes ServiceAccount and annotate it with the IAM role ARN.
    // IRSA (IAM Roles for Service Accounts) allows pods to assume the IAM role
    // without embedding long-lived AWS credentials in the container.
    //
    // The EKS cluster must have an OIDC identity provider configured.
    // Pods using this ServiceAccount can call AWS APIs with the permissions
    // granted by the IAM role (e.g., RDS Data API, S3, SQS, Textract, Bedrock).
    this.serviceAccount = new eks.ServiceAccount(this, 'ServiceAccount', {
      cluster,
      name: serviceName,
      namespace,
      annotations: {
        'eks.amazonaws.com/role-arn': irsaRoleArn,
      },
    });

    // ── Deployment ──────────────────────────────────────────────────────────
    //
    // Kubernetes Deployment with:
    //  • Initial replica count = hpaMinReplicas (HPA will scale this)
    //  • Pod anti-affinity to spread replicas across nodes
    //  • Resource requests and limits for predictable QoS
    //  • Readiness and liveness probes pointing to Spring Boot Actuator
    //  • Environment variables (DB host, Redis host, etc.)
    //  • ServiceAccount for IRSA
    //
    // Rolling update strategy:
    //  • maxSurge: 1      — allow one extra pod during rollout
    //  • maxUnavailable: 0 — do not terminate old pods until new pods are ready
    //
    // This ensures zero-downtime deployments in combination with the PDB.
    const deploymentManifest = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: serviceName,
        namespace,
        labels: {
          app: serviceName,
          'app.kubernetes.io/name': serviceName,
          'app.kubernetes.io/component': 'backend',
          'app.kubernetes.io/part-of': 'food-cost-calculator',
        },
      },
      spec: {
        replicas: hpaMinReplicas,
        selector: {
          matchLabels: {
            app: serviceName,
          },
        },
        strategy: {
          type: 'RollingUpdate',
          rollingUpdate: {
            maxSurge: 1,
            maxUnavailable: 0,
          },
        },
        template: {
          metadata: {
            labels: {
              app: serviceName,
              'app.kubernetes.io/name': serviceName,
              'app.kubernetes.io/component': 'backend',
              'app.kubernetes.io/part-of': 'food-cost-calculator',
            },
            annotations: {
              // Prometheus scraping annotations (if using Prometheus for metrics)
              'prometheus.io/scrape': 'true',
              'prometheus.io/port': containerPort.toString(),
              'prometheus.io/path': '/actuator/prometheus',
            },
          },
          spec: {
            serviceAccountName: serviceName,

            // Pod anti-affinity — prefer spreading replicas across different nodes
            // for high availability. Uses preferredDuringSchedulingIgnoredDuringExecution
            // (soft affinity) rather than required (hard affinity) to avoid blocking
            // scheduling when insufficient nodes are available.
            affinity: {
              podAntiAffinity: {
                preferredDuringSchedulingIgnoredDuringExecution: [
                  {
                    weight: 100,
                    podAffinityTerm: {
                      labelSelector: {
                        matchExpressions: [
                          {
                            key: 'app',
                            operator: 'In',
                            values: [serviceName],
                          },
                        ],
                      },
                      topologyKey: 'kubernetes.io/hostname',
                    },
                  },
                ],
              },
            },

            containers: [
              {
                name: serviceName,
                image: imageUri,
                imagePullPolicy: 'IfNotPresent',

                ports: [
                  {
                    name: 'http',
                    containerPort,
                    protocol: 'TCP',
                  },
                ],

                // Environment variables — DB host, Redis host, SQS queue URLs, etc.
                env: Object.entries(environmentVariables).map(([name, value]) => ({
                  name,
                  value,
                })),

                // Resource requests and limits.
                // Requests: guaranteed CPU and memory (used for scheduling).
                // Limits: maximum CPU and memory the container can use.
                //
                // QoS class:
                //  • If requests == limits  → Guaranteed (highest priority)
                //  • If requests < limits   → Burstable (medium priority)
                //  • If no requests set     → BestEffort (lowest priority, evicted first)
                //
                // We use Burstable QoS to allow bursts during load spikes while
                // still guaranteeing baseline resources.
                resources: {
                  requests: {
                    cpu: cpuRequest,
                    memory: memoryRequest,
                  },
                  limits: {
                    cpu: cpuLimit,
                    memory: memoryLimit,
                  },
                },

                // Readiness probe — determines when the pod is ready to receive traffic.
                // Kubernetes will not route Service traffic to a pod until it passes
                // the readiness probe. Spring Boot Actuator /actuator/health returns
                // HTTP 200 when the app is ready (DataSource connected, etc.).
                //
                // periodSeconds: 10   — check every 10 seconds
                // timeoutSeconds: 5   — fail if no response in 5 seconds
                // failureThreshold: 3 — mark pod unready after 3 consecutive failures
                readinessProbe: {
                  httpGet: {
                    path: healthCheckPath,
                    port: containerPort,
                    scheme: 'HTTP',
                  },
                  initialDelaySeconds: readinessProbeInitialDelaySeconds,
                  periodSeconds: 10,
                  timeoutSeconds: 5,
                  successThreshold: 1,
                  failureThreshold: 3,
                },

                // Liveness probe — determines if the pod is still alive.
                // Kubernetes will restart the pod if it fails the liveness probe.
                // Use a longer initialDelaySeconds to allow Spring Boot to fully
                // start up before checking (Spring Boot apps can take 20–30s to start).
                //
                // periodSeconds: 30   — check every 30 seconds (less frequent than readiness)
                // timeoutSeconds: 10  — longer timeout for liveness (allow slow health checks)
                // failureThreshold: 3 — restart pod after 3 consecutive failures
                livenessProbe: {
                  httpGet: {
                    path: healthCheckPath,
                    port: containerPort,
                    scheme: 'HTTP',
                  },
                  initialDelaySeconds: livenessProbeInitialDelaySeconds,
                  periodSeconds: 30,
                  timeoutSeconds: 10,
                  successThreshold: 1,
                  failureThreshold: 3,
                },
              },
            ],
          },
        },
      },
    };

    this.deployment = new eks.KubernetesManifest(this, 'Deployment', {
      cluster,
      manifest: [deploymentManifest],
    });

    // Ensure ServiceAccount is created before Deployment references it.
    this.deployment.node.addDependency(this.serviceAccount);

    // ── Service ─────────────────────────────────────────────────────────────
    //
    // Kubernetes Service — ClusterIP type by default.
    // Exposes the Deployment pods on a stable internal IP within the cluster.
    //
    // If enableAlbIngress is true, the ALB Ingress will route external traffic
    // to this Service. If enableAlbIngress is false, this Service is only
    // accessible within the cluster (for internal microservices).
    //
    // Service type:
    //  • ClusterIP (default)   — internal-only access
    //  • LoadBalancer          — creates a classic ELB (not recommended; use Ingress instead)
    //  • NodePort              — exposes on a static port on each node (rarely used)
    //
    // We use ClusterIP and rely on the ALB Ingress for external access.
    const serviceManifest = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: serviceName,
        namespace,
        labels: {
          app: serviceName,
        },
      },
      spec: {
        type: 'ClusterIP',
        selector: {
          app: serviceName,
        },
        ports: [
          {
            name: 'http',
            port: 80,
            targetPort: containerPort,
            protocol: 'TCP',
          },
        ],
      },
    };

    this.service = new eks.KubernetesManifest(this, 'Service', {
      cluster,
      manifest: [serviceManifest],
    });

    // ── HorizontalPodAutoscaler ─────────────────────────────────────────────
    //
    // HPA automatically scales the Deployment replica count based on observed
    // CPU and memory utilization. Uses the Metrics Server (pre-installed on EKS)
    // to scrape pod resource usage.
    //
    // Scaling behavior:
    //  • Scale up: when average CPU > target for 15 seconds (default stabilization window)
    //  • Scale down: after 5 minutes of low usage (default scale-down stabilization)
    //  • minReplicas: 2  — always at least 2 pods (HA baseline)
    //  • maxReplicas: 20 — cap scaling to prevent cost runaway
    //
    // Target metrics:
    //  • CPU: 60% of requests (e.g., if request is 500m, target is 300m average)
    //  • Memory: 70% of requests (e.g., if request is 512Mi, target is 358Mi average)
    const hpaManifest = {
      apiVersion: 'autoscaling/v2',
      kind: 'HorizontalPodAutoscaler',
      metadata: {
        name: serviceName,
        namespace,
        labels: {
          app: serviceName,
        },
      },
      spec: {
        scaleTargetRef: {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          name: serviceName,
        },
        minReplicas: hpaMinReplicas,
        maxReplicas: hpaMaxReplicas,
        metrics: [
          {
            type: 'Resource',
            resource: {
              name: 'cpu',
              target: {
                type: 'Utilization',
                averageUtilization: hpaTargetCpuUtilization,
              },
            },
          },
          {
            type: 'Resource',
            resource: {
              name: 'memory',
              target: {
                type: 'Utilization',
                averageUtilization: hpaTargetMemoryUtilization,
              },
            },
          },
        ],
        behavior: {
          scaleDown: {
            stabilizationWindowSeconds: 300, // 5 minutes
            policies: [
              {
                type: 'Percent',
                value: 50, // Scale down by at most 50% of current replicas per period
                periodSeconds: 60,
              },
            ],
          },
          scaleUp: {
            stabilizationWindowSeconds: 15, // 15 seconds (fast scale-up)
            policies: [
              {
                type: 'Percent',
                value: 100, // Double the replicas per period if needed
                periodSeconds: 60,
              },
              {
                type: 'Pods',
                value: 4, // Add at most 4 pods per period
                periodSeconds: 60,
              },
            ],
            selectPolicy: 'Max', // Use the more aggressive of the two policies
          },
        },
      },
    };

    this.hpa = new eks.KubernetesManifest(this, 'HPA', {
      cluster,
      manifest: [hpaManifest],
    });

    // HPA must be created after Deployment.
    this.hpa.node.addDependency(this.deployment);

    // ── PodDisruptionBudget ─────────────────────────────────────────────────
    //
    // PDB ensures that at least 1 pod remains available during voluntary
    // disruptions (e.g., node drain, rolling update, cluster autoscaler scale-down).
    //
    // minAvailable: 1 — at least 1 pod must remain running and ready during disruptions.
    //
    // This is critical for zero-downtime deployments. Combined with the Deployment's
    // maxUnavailable: 0 rolling update strategy, this guarantees that:
    //  1. New pods are started and become ready before old pods are terminated.
    //  2. During node drains (e.g., cluster autoscaler scale-down), at least one
    //     pod remains available to serve traffic.
    //
    // Note: PDB does NOT protect against involuntary disruptions (e.g., node failure,
    // out-of-memory kill). For those, rely on HPA min replicas >= 2 across multiple AZs.
    const pdbManifest = {
      apiVersion: 'policy/v1',
      kind: 'PodDisruptionBudget',
      metadata: {
        name: serviceName,
        namespace,
        labels: {
          app: serviceName,
        },
      },
      spec: {
        minAvailable: 1,
        selector: {
          matchLabels: {
            app: serviceName,
          },
        },
      },
    };

    this.pdb = new eks.KubernetesManifest(this, 'PDB', {
      cluster,
      manifest: [pdbManifest],
    });

    // ── Optional: ALB Ingress ───────────────────────────────────────────────
    //
    // If enableAlbIngress is true, create a Kubernetes Ingress resource with
    // annotations for the AWS Load Balancer Controller.
    //
    // The AWS Load Balancer Controller (installed in the EKS cluster via Helm)
    // watches for Ingress resources with the `alb.ingress.kubernetes.io/*`
    // annotations and creates an Application Load Balancer in AWS.
    //
    // Key annotations:
    //  • alb.ingress.kubernetes.io/scheme: internet-facing
    //      → ALB is publicly accessible (uses public subnets)
    //  • alb.ingress.kubernetes.io/target-type: ip
    //      → ALB targets pod IPs directly (not node IPs); required for Fargate or CNI
    //  • alb.ingress.kubernetes.io/subnets: subnet-abc,subnet-xyz
    //      → ALB is created in these subnets (public subnets for internet-facing)
    //  • alb.ingress.kubernetes.io/security-groups: sg-123
    //      → Attach these security groups to the ALB
    //  • alb.ingress.kubernetes.io/listen-ports: '[{"HTTP":80},{"HTTPS":443}]'
    //      → ALB listens on HTTP (redirects to HTTPS) and HTTPS
    //  • alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:us-east-1:123456789012:certificate/abc-123
    //      → HTTPS listener uses this ACM certificate
    //  • alb.ingress.kubernetes.io/ssl-redirect: '443'
    //      → Redirect HTTP requests to HTTPS
    //  • alb.ingress.kubernetes.io/healthcheck-path: /actuator/health
    //      → ALB target group health check path
    //  • alb.ingress.kubernetes.io/healthcheck-interval-seconds: '15'
    //      → Health check interval (default is 30s; we use 15s for faster failover)
    //  • alb.ingress.kubernetes.io/healthy-threshold-count: '2'
    //      → Mark target healthy after 2 consecutive successful health checks
    //  • alb.ingress.kubernetes.io/unhealthy-threshold-count: '2'
    //      → Mark target unhealthy after 2 consecutive failed health checks
    //
    // Ingress rules:
    //  • If ingressHost is set: route based on Host header (e.g., api.foodcostcalculator.com)
    //  • If ingressHost is not set: route all traffic to the service
    //  • Path: specified by ingressPath (default: /* — all paths)
    //
    // The AWS Load Balancer Controller automatically:
    //  1. Creates an ALB in the specified subnets
    //  2. Creates a target group pointing to the Service pods
    //  3. Registers/deregisters pod IPs as they are created/deleted
    //  4. Updates target group health checks based on readiness probes
    //
    // For more details, see:
    //  https://kubernetes-sigs.github.io/aws-load-balancer-controller/v2.7/guide/ingress/annotations/
    if (enableAlbIngress) {
      const ingressAnnotations: { [key: string]: string } = {
        'kubernetes.io/ingress.class': 'alb',
        'alb.ingress.kubernetes.io/scheme': 'internet-facing',
        'alb.ingress.kubernetes.io/target-type': 'ip',
        'alb.ingress.kubernetes.io/healthcheck-path': healthCheckPath,
        'alb.ingress.kubernetes.io/healthcheck-interval-seconds': '15',
        'alb.ingress.kubernetes.io/healthy-threshold-count': '2',
        'alb.ingress.kubernetes.io/unhealthy-threshold-count': '2',
      };

      // Add subnets annotation if provided.
      if (albSubnetIds.length > 0) {
        ingressAnnotations['alb.ingress.kubernetes.io/subnets'] = albSubnetIds.join(',');
      }

      // Add security groups annotation if provided.
      if (albSecurityGroupIds.length > 0) {
        ingressAnnotations['alb.ingress.kubernetes.io/security-groups'] = albSecurityGroupIds.join(',');
      }

      // Add HTTPS configuration if certificate ARN is provided.
      if (certificateArn) {
        ingressAnnotations['alb.ingress.kubernetes.io/listen-ports'] =
          '[{"HTTP":80},{"HTTPS":443}]';
        ingressAnnotations['alb.ingress.kubernetes.io/certificate-arn'] = certificateArn;
        ingressAnnotations['alb.ingress.kubernetes.io/ssl-redirect'] = '443';
      } else {
        // HTTP-only listener if no certificate is provided.
        ingressAnnotations['alb.ingress.kubernetes.io/listen-ports'] = '[{"HTTP":80}]';
      }

      const ingressRules: any[] = [];

      // If ingressHost is provided, add a host-based rule.
      // Otherwise, add a catch-all rule (no host restriction).
      const rule: any = {
        http: {
          paths: [
            {
              path: ingressPath,
              pathType: 'ImplementationSpecific',
              backend: {
                service: {
                  name: serviceName,
                  port: {
                    number: 80,
                  },
                },
              },
            },
          ],
        },
      };

      if (ingressHost) {
        rule.host = ingressHost;
      }

      ingressRules.push(rule);

      const ingressManifest = {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'Ingress',
        metadata: {
          name: serviceName,
          namespace,
          labels: {
            app: serviceName,
          },
          annotations: ingressAnnotations,
        },
        spec: {
          rules: ingressRules,
        },
      };

      this.ingress = new eks.KubernetesManifest(this, 'Ingress', {
        cluster,
        manifest: [ingressManifest],
      });

      // Ingress must be created after Service.
      this.ingress.node.addDependency(this.service);
    }

    // ── CDK Output ──────────────────────────────────────────────────────────
    //
    // Export the service name and namespace as CloudFormation outputs for
    // reference by other stacks or external tools.
    new cdk.CfnOutput(this, 'ServiceName', {
      value: serviceName,
      description: `Service name for ${serviceName}`,
    });

    new cdk.CfnOutput(this, 'Namespace', {
      value: namespace,
      description: `Kubernetes namespace for ${serviceName}`,
    });
  }
}
