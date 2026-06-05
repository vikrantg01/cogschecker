"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpringBootService = void 0;
const cdk = require("aws-cdk-lib");
const eks = require("aws-cdk-lib/aws-eks");
const constructs_1 = require("constructs");
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
class SpringBootService extends constructs_1.Construct {
    /**
     * The Kubernetes ServiceAccount created for this service.
     */
    serviceAccount;
    /**
     * The Kubernetes Deployment manifest.
     */
    deployment;
    /**
     * The Kubernetes Service manifest.
     */
    service;
    /**
     * The HorizontalPodAutoscaler manifest.
     */
    hpa;
    /**
     * The PodDisruptionBudget manifest.
     */
    pdb;
    /**
     * The optional ALB Ingress manifest (created only if enableAlbIngress is true).
     */
    ingress;
    constructor(scope, id, props) {
        super(scope, id);
        const { cluster, namespace = 'default', serviceName, imageUri, containerPort = 8080, environmentVariables = {}, irsaRoleArn, hpaMinReplicas = 2, hpaMaxReplicas = 20, hpaTargetCpuUtilization = 60, hpaTargetMemoryUtilization = 70, cpuRequest = '500m', cpuLimit = '1000m', memoryRequest = '512Mi', memoryLimit = '1Gi', livenessProbeInitialDelaySeconds = 30, readinessProbeInitialDelaySeconds = 10, healthCheckPath = '/actuator/health', enableAlbIngress = true, ingressHost, ingressPath = '/*', albSecurityGroupIds = [], albSubnetIds = [], certificateArn, } = props;
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
            const ingressAnnotations = {
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
            }
            else {
                // HTTP-only listener if no certificate is provided.
                ingressAnnotations['alb.ingress.kubernetes.io/listen-ports'] = '[{"HTTP":80}]';
            }
            const ingressRules = [];
            // If ingressHost is provided, add a host-based rule.
            // Otherwise, add a catch-all rule (no host restriction).
            const rule = {
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
exports.SpringBootService = SpringBootService;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiU3ByaW5nQm9vdFNlcnZpY2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9saWIvY29uc3RydWN0cy9TcHJpbmdCb290U2VydmljZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFDbkMsMkNBQTJDO0FBRTNDLDJDQUF1QztBQXVKdkM7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0EyQ0c7QUFDSCxNQUFhLGlCQUFrQixTQUFRLHNCQUFTO0lBQzlDOztPQUVHO0lBQ2EsY0FBYyxDQUFxQjtJQUVuRDs7T0FFRztJQUNhLFVBQVUsQ0FBeUI7SUFFbkQ7O09BRUc7SUFDYSxPQUFPLENBQXlCO0lBRWhEOztPQUVHO0lBQ2EsR0FBRyxDQUF5QjtJQUU1Qzs7T0FFRztJQUNhLEdBQUcsQ0FBeUI7SUFFNUM7O09BRUc7SUFDYSxPQUFPLENBQTBCO0lBRWpELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBNkI7UUFDckUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixNQUFNLEVBQ0osT0FBTyxFQUNQLFNBQVMsR0FBRyxTQUFTLEVBQ3JCLFdBQVcsRUFDWCxRQUFRLEVBQ1IsYUFBYSxHQUFHLElBQUksRUFDcEIsb0JBQW9CLEdBQUcsRUFBRSxFQUN6QixXQUFXLEVBQ1gsY0FBYyxHQUFHLENBQUMsRUFDbEIsY0FBYyxHQUFHLEVBQUUsRUFDbkIsdUJBQXVCLEdBQUcsRUFBRSxFQUM1QiwwQkFBMEIsR0FBRyxFQUFFLEVBQy9CLFVBQVUsR0FBRyxNQUFNLEVBQ25CLFFBQVEsR0FBRyxPQUFPLEVBQ2xCLGFBQWEsR0FBRyxPQUFPLEVBQ3ZCLFdBQVcsR0FBRyxLQUFLLEVBQ25CLGdDQUFnQyxHQUFHLEVBQUUsRUFDckMsaUNBQWlDLEdBQUcsRUFBRSxFQUN0QyxlQUFlLEdBQUcsa0JBQWtCLEVBQ3BDLGdCQUFnQixHQUFHLElBQUksRUFDdkIsV0FB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LGtCQUFrQixDQUFDLElBQUksRUFBRSxTQUFTLEVBQUU7Z0JBQ3pELE9BQU87Z0JBQ1AsUUFBUSxFQUFFLENBQUMsZUFBZSxDQUFDO2FBQzVCLENBQUMsQ0FBQztZQUVILHlDQUF5QztZQUN6QyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ2hELENBQUM7UUFFRCwyRUFBMkU7UUFDM0UsRUFBRTtRQUNGLHNFQUFzRTtRQUN0RSwrQ0FBK0M7UUFDL0MsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDckMsS0FBSyxFQUFFLFdBQVc7WUFDbEIsV0FBVyxFQUFFLG9CQUFvQixXQUFXLEVBQUU7U0FDL0MsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxXQUFXLEVBQUU7WUFDbkMsS0FBSyxFQUFFLFNBQVM7WUFDaEIsV0FBVyxFQUFFLDRCQUE0QixXQUFXLEVBQUU7U0FDdkQsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBN2tCRCw4Q0E2a0JDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGVrcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWtzJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFNwcmluZ0Jvb3RTZXJ2aWNlUHJvcHMge1xuICAvKipcbiAgICogVGhlIEVLUyBjbHVzdGVyIHRvIGRlcGxveSB0aGUgc2VydmljZSBpbnRvLlxuICAgKi9cbiAgcmVhZG9ubHkgY2x1c3RlcjogZWtzLklDbHVzdGVyO1xuXG4gIC8qKlxuICAgKiBLdWJlcm5ldGVzIG5hbWVzcGFjZSB3aGVyZSB0aGUgc2VydmljZSB3aWxsIGJlIGRlcGxveWVkLlxuICAgKiBAZGVmYXVsdCAnZGVmYXVsdCdcbiAgICovXG4gIHJlYWRvbmx5IG5hbWVzcGFjZT86IHN0cmluZztcblxuICAvKipcbiAgICogU2VydmljZSBuYW1lICh1c2VkIGZvciBEZXBsb3ltZW50LCBTZXJ2aWNlLCBTZXJ2aWNlQWNjb3VudCwgYW5kIEhQQSBuYW1lcykuXG4gICAqIE11c3QgYmUgYSB2YWxpZCBLdWJlcm5ldGVzIG5hbWUgKGxvd2VyY2FzZSBhbHBoYW51bWVyaWMgKyBoeXBoZW5zKS5cbiAgICovXG4gIHJlYWRvbmx5IHNlcnZpY2VOYW1lOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIENvbnRhaW5lciBpbWFnZSBVUkkgKGUuZy4sIGZyb20gQW1hem9uIEVDUikuXG4gICAqIEV4YW1wbGU6IFwiMTIzNDU2Nzg5MDEyLmRrci5lY3IudXMtZWFzdC0xLmFtYXpvbmF3cy5jb20vZm9vZC1jb3N0LWNhbGN1bGF0b3ItYXBpOmxhdGVzdFwiXG4gICAqL1xuICByZWFkb25seSBpbWFnZVVyaTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBDb250YWluZXIgcG9ydCB0aGUgU3ByaW5nIEJvb3QgYXBwbGljYXRpb24gbGlzdGVucyBvbi5cbiAgICogQGRlZmF1bHQgODA4MFxuICAgKi9cbiAgcmVhZG9ubHkgY29udGFpbmVyUG9ydD86IG51bWJlcjtcblxuICAvKipcbiAgICogRW52aXJvbm1lbnQgdmFyaWFibGVzIHRvIGluamVjdCBpbnRvIHRoZSBjb250YWluZXIuXG4gICAqIEV4YW1wbGU6IHsgREJfSE9TVDogJ2F1cm9yYS1jbHVzdGVyLnVzLWVhc3QtMS5yZHMuYW1hem9uYXdzLmNvbScgfVxuICAgKi9cbiAgcmVhZG9ubHkgZW52aXJvbm1lbnRWYXJpYWJsZXM/OiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9O1xuXG4gIC8qKlxuICAgKiBJQU0gUm9sZSBBUk4gZm9yIElSU0EgKElBTSBSb2xlcyBmb3IgU2VydmljZSBBY2NvdW50cykuXG4gICAqIFRoaXMgcm9sZSBpcyBhdHRhY2hlZCB0byB0aGUgS3ViZXJuZXRlcyBTZXJ2aWNlQWNjb3VudCBhbmQgZ3JhbnRzIEFXUyBBUEkgcGVybWlzc2lvbnMuXG4gICAqL1xuICByZWFkb25seSBpcnNhUm9sZUFybjogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBIb3Jpem9udGFsIFBvZCBBdXRvc2NhbGVyIOKAlCBtaW5pbXVtIG51bWJlciBvZiByZXBsaWNhcy5cbiAgICogQGRlZmF1bHQgMlxuICAgKi9cbiAgcmVhZG9ubHkgaHBhTWluUmVwbGljYXM/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIEhvcml6b250YWwgUG9kIEF1dG9zY2FsZXIg4oCUIG1heGltdW0gbnVtYmVyIG9mIHJlcGxpY2FzLlxuICAgKiBAZGVmYXVsdCAyMFxuICAgKi9cbiAgcmVhZG9ubHkgaHBhTWF4UmVwbGljYXM/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIFRhcmdldCBDUFUgdXRpbGl6YXRpb24gcGVyY2VudGFnZSBmb3IgSFBBIHNjYWxpbmcgZGVjaXNpb25zLlxuICAgKiBAZGVmYXVsdCA2MFxuICAgKi9cbiAgcmVhZG9ubHkgaHBhVGFyZ2V0Q3B1VXRpbGl6YXRpb24/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIFRhcmdldCBtZW1vcnkgdXRpbGl6YXRpb24gcGVyY2VudGFnZSBmb3IgSFBBIHNjYWxpbmcgZGVjaXNpb25zLlxuICAgKiBAZGVmYXVsdCA3MFxuICAgKi9cbiAgcmVhZG9ubHkgaHBhVGFyZ2V0TWVtb3J5VXRpbGl6YXRpb24/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIENQVSByZXNvdXJjZSByZXF1ZXN0IGZvciBlYWNoIHBvZC5cbiAgICogQGRlZmF1bHQgJzUwMG0nXG4gICAqL1xuICByZWFkb25seSBjcHVSZXF1ZXN0Pzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBDUFUgcmVzb3VyY2UgbGltaXQgZm9yIGVhY2ggcG9kLlxuICAgKiBAZGVmYXVsdCAnMTAwMG0nICgxIHZDUFUpXG4gICAqL1xuICByZWFkb25seSBjcHVMaW1pdD86IHN0cmluZztcblxuICAvKipcbiAgICogTWVtb3J5IHJlc291cmNlIHJlcXVlc3QgZm9yIGVhY2ggcG9kLlxuICAgKiBAZGVmYXVsdCAnNTEyTWknXG4gICAqL1xuICByZWFkb25seSBtZW1vcnlSZXF1ZXN0Pzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBNZW1vcnkgcmVzb3VyY2UgbGltaXQgZm9yIGVhY2ggcG9kLlxuICAgKiBAZGVmYXVsdCAnMUdpJ1xuICAgKi9cbiAgcmVhZG9ubHkgbWVtb3J5TGltaXQ/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIExpdmVuZXNzIHByb2JlIOKAlCBpbml0aWFsIGRlbGF5IGluIHNlY29uZHMgYmVmb3JlIHRoZSBmaXJzdCBjaGVjay5cbiAgICogQGRlZmF1bHQgMzBcbiAgICovXG4gIHJlYWRvbmx5IGxpdmVuZXNzUHJvYmVJbml0aWFsRGVsYXlTZWNvbmRzPzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBSZWFkaW5lc3MgcHJvYmUg4oCUIGluaXRpYWwgZGVsYXkgaW4gc2Vjb25kcyBiZWZvcmUgdGhlIGZpcnN0IGNoZWNrLlxuICAgKiBAZGVmYXVsdCAxMFxuICAgKi9cbiAgcmVhZG9ubHkgcmVhZGluZXNzUHJvYmVJbml0aWFsRGVsYXlTZWNvbmRzPzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBIZWFsdGggY2hlY2sgcGF0aCBmb3IgbGl2ZW5lc3MgYW5kIHJlYWRpbmVzcyBwcm9iZXMuXG4gICAqIEBkZWZhdWx0ICcvYWN0dWF0b3IvaGVhbHRoJ1xuICAgKi9cbiAgcmVhZG9ubHkgaGVhbHRoQ2hlY2tQYXRoPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRvIGVuYWJsZSBBTEIgSW5ncmVzcyBmb3IgdGhpcyBzZXJ2aWNlLlxuICAgKiBXaGVuIHRydWUsIGFkZHMgYW5ub3RhdGlvbnMgZm9yIEFXUyBMb2FkIEJhbGFuY2VyIENvbnRyb2xsZXIgdG8gY3JlYXRlIGFuIEFMQi5cbiAgICogQGRlZmF1bHQgdHJ1ZVxuICAgKi9cbiAgcmVhZG9ubHkgZW5hYmxlQWxiSW5ncmVzcz86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIEFMQiBJbmdyZXNzIGhvc3QgKGZvciBob3N0LWJhc2VkIHJvdXRpbmcpLlxuICAgKiBFeGFtcGxlOiBcImFwaS5mb29kY29zdGNhbGN1bGF0b3IuY29tXCJcbiAgICogT25seSB1c2VkIHdoZW4gZW5hYmxlQWxiSW5ncmVzcyBpcyB0cnVlLlxuICAgKi9cbiAgcmVhZG9ubHkgaW5ncmVzc0hvc3Q/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIEFMQiBJbmdyZXNzIHBhdGggKGZvciBwYXRoLWJhc2VkIHJvdXRpbmcpLlxuICAgKiBFeGFtcGxlOiBcIi9hcGkvKlwiXG4gICAqIE9ubHkgdXNlZCB3aGVuIGVuYWJsZUFsYkluZ3Jlc3MgaXMgdHJ1ZS5cbiAgICogQGRlZmF1bHQgJy8qJ1xuICAgKi9cbiAgcmVhZG9ubHkgaW5ncmVzc1BhdGg/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFNlY3VyaXR5IGdyb3VwIElEcyB0byBhdHRhY2ggdG8gdGhlIEFMQi5cbiAgICogT25seSB1c2VkIHdoZW4gZW5hYmxlQWxiSW5ncmVzcyBpcyB0cnVlLlxuICAgKi9cbiAgcmVhZG9ubHkgYWxiU2VjdXJpdHlHcm91cElkcz86IHN0cmluZ1tdO1xuXG4gIC8qKlxuICAgKiBTdWJuZXQgSURzIGZvciBBTEIgcGxhY2VtZW50ICh0eXBpY2FsbHkgcHVibGljIHN1Ym5ldHMpLlxuICAgKiBPbmx5IHVzZWQgd2hlbiBlbmFibGVBbGJJbmdyZXNzIGlzIHRydWUuXG4gICAqL1xuICByZWFkb25seSBhbGJTdWJuZXRJZHM/OiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogQUNNIGNlcnRpZmljYXRlIEFSTiBmb3IgSFRUUFMgbGlzdGVuZXIgb24gdGhlIEFMQi5cbiAgICogT25seSB1c2VkIHdoZW4gZW5hYmxlQWxiSW5ncmVzcyBpcyB0cnVlLlxuICAgKi9cbiAgcmVhZG9ubHkgY2VydGlmaWNhdGVBcm4/OiBzdHJpbmc7XG59XG5cbi8qKlxuICogU3ByaW5nQm9vdFNlcnZpY2VcbiAqXG4gKiBBIHJldXNhYmxlIENESyBjb25zdHJ1Y3QgdGhhdCBkZXBsb3lzIGEgU3ByaW5nIEJvb3QgbWljcm9zZXJ2aWNlIHRvIEFtYXpvbiBFS1Mgd2l0aDpcbiAqXG4gKiAg4oCiIEt1YmVybmV0ZXMgRGVwbG95bWVudCB3aXRoIGNvbmZpZ3VyYWJsZSByZXBsaWNhIGNvdW50IGFuZCByZXNvdXJjZSBsaW1pdHNcbiAqICDigKIgS3ViZXJuZXRlcyBTZXJ2aWNlIChDbHVzdGVySVAgb3IgTG9hZEJhbGFuY2VyKVxuICogIOKAoiBTZXJ2aWNlQWNjb3VudCB3aXRoIElSU0EgKElBTSBSb2xlcyBmb3IgU2VydmljZSBBY2NvdW50cykgZm9yIEFXUyBBUEkgYWNjZXNzXG4gKiAg4oCiIEhvcml6b250YWwgUG9kIEF1dG9zY2FsZXIgKEhQQSkgZm9yIGF1dG9tYXRpYyBzY2FsaW5nIGJhc2VkIG9uIENQVSBhbmQgbWVtb3J5XG4gKiAg4oCiIFBvZERpc3J1cHRpb25CdWRnZXQgKFBEQikgdG8gZW5zdXJlIGF0IGxlYXN0IDEgcG9kIHJlbWFpbnMgYXZhaWxhYmxlIGR1cmluZyB2b2x1bnRhcnkgZGlzcnVwdGlvbnNcbiAqICDigKIgUmVhZGluZXNzIGFuZCBsaXZlbmVzcyBwcm9iZXMgcG9pbnRpbmcgdG8gU3ByaW5nIEJvb3QgQWN0dWF0b3IgYC9hY3R1YXRvci9oZWFsdGhgXG4gKiAg4oCiIE9wdGlvbmFsIEFMQiBJbmdyZXNzIGZvciBpbnRlcm5ldC1mYWNpbmcgdHJhZmZpYyB2aWEgQVdTIExvYWQgQmFsYW5jZXIgQ29udHJvbGxlclxuICpcbiAqIFRoaXMgY29uc3RydWN0IGZvbGxvd3MgRUtTIGFuZCBTcHJpbmcgQm9vdCBiZXN0IHByYWN0aWNlczpcbiAqICAtIElSU0EgZm9yIGxlYXN0LXByaXZpbGVnZSBBV1MgQVBJIGFjY2VzcyAobm8gbG9uZy1saXZlZCBjcmVkZW50aWFscyBpbiBwb2RzKVxuICogIC0gSFBBIGZvciBhdXRvbWF0aWMgc2NhbGluZyB1bmRlciBsb2FkXG4gKiAgLSBQREIgZm9yIHplcm8tZG93bnRpbWUgcm9sbGluZyB1cGRhdGVzXG4gKiAgLSBIZWFsdGggcHJvYmVzIGZvciBLdWJlcm5ldGVzLW1hbmFnZWQgcG9kIGxpZmVjeWNsZVxuICogIC0gUmVzb3VyY2UgcmVxdWVzdHMvbGltaXRzIGZvciBwcmVkaWN0YWJsZSBzY2hlZHVsaW5nIGFuZCBRb1NcbiAqXG4gKiBVc2FnZSBleGFtcGxlOlxuICpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIG5ldyBTcHJpbmdCb290U2VydmljZSh0aGlzLCAnQXBpU2VydmljZScsIHtcbiAqICAgY2x1c3RlcjogZWtzQ2x1c3RlcixcbiAqICAgc2VydmljZU5hbWU6ICdmb29kLWNvc3QtY2FsY3VsYXRvci1hcGknLFxuICogICBpbWFnZVVyaTogJzEyMzQ1Njc4OTAxMi5ka3IuZWNyLnVzLWVhc3QtMS5hbWF6b25hd3MuY29tL2Zvb2QtY29zdC1jYWxjdWxhdG9yLWFwaTpsYXRlc3QnLFxuICogICBpcnNhUm9sZUFybjogYXBpSXJzYVJvbGUucm9sZUFybixcbiAqICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHtcbiAqICAgICBEQl9IT1NUOiBhdXJvcmFDbHVzdGVyLmNsdXN0ZXJFbmRwb2ludC5ob3N0bmFtZSxcbiAqICAgICBSRURJU19IT1NUOiByZWRpc0NsdXN0ZXIuYXR0clByaW1hcnlFbmRQb2ludEFkZHJlc3MsXG4gKiAgIH0sXG4gKiAgIGhwYU1pblJlcGxpY2FzOiAyLFxuICogICBocGFNYXhSZXBsaWNhczogMjAsXG4gKiAgIGVuYWJsZUFsYkluZ3Jlc3M6IHRydWUsXG4gKiAgIGluZ3Jlc3NIb3N0OiAnYXBpLmZvb2Rjb3N0Y2FsY3VsYXRvci5jb20nLFxuICogICBhbGJTZWN1cml0eUdyb3VwSWRzOiBbYWxiU2cuc2VjdXJpdHlHcm91cElkXSxcbiAqICAgYWxiU3VibmV0SWRzOiB2cGMucHVibGljU3VibmV0cy5tYXAocyA9PiBzLnN1Ym5ldElkKSxcbiAqICAgY2VydGlmaWNhdGVBcm46ICdhcm46YXdzOmFjbTp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOmNlcnRpZmljYXRlL2FiYy0xMjMnLFxuICogfSk7XG4gKiBgYGBcbiAqXG4gKiBTYXRpc2ZpZXMgUmVxdWlyZW1lbnRzOiAzLjMgKHJlYWwtdGltZSBjb3N0IHByb3BhZ2F0aW9uIHZpYSBhc3luYyB3b3JrZXJzKSwgaW5mcmFzdHJ1Y3R1cmUgYXZhaWxhYmlsaXR5LlxuICovXG5leHBvcnQgY2xhc3MgU3ByaW5nQm9vdFNlcnZpY2UgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuICAvKipcbiAgICogVGhlIEt1YmVybmV0ZXMgU2VydmljZUFjY291bnQgY3JlYXRlZCBmb3IgdGhpcyBzZXJ2aWNlLlxuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IHNlcnZpY2VBY2NvdW50OiBla3MuU2VydmljZUFjY291bnQ7XG5cbiAgLyoqXG4gICAqIFRoZSBLdWJlcm5ldGVzIERlcGxveW1lbnQgbWFuaWZlc3QuXG4gICAqL1xuICBwdWJsaWMgcmVhZG9ubHkgZGVwbG95bWVudDogZWtzLkt1YmVybmV0ZXNNYW5pZmVzdDtcblxuICAvKipcbiAgICogVGhlIEt1YmVybmV0ZXMgU2VydmljZSBtYW5pZmVzdC5cbiAgICovXG4gIHB1YmxpYyByZWFkb25seSBzZXJ2aWNlOiBla3MuS3ViZXJuZXRlc01hbmlmZXN0O1xuXG4gIC8qKlxuICAgKiBUaGUgSG9yaXpvbnRhbFBvZEF1dG9zY2FsZXIgbWFuaWZlc3QuXG4gICAqL1xuICBwdWJsaWMgcmVhZG9ubHkgaHBhOiBla3MuS3ViZXJuZXRlc01hbmlmZXN0O1xuXG4gIC8qKlxuICAgKiBUaGUgUG9kRGlzcnVwdGlvbkJ1ZGdldCBtYW5pZmVzdC5cbiAgICovXG4gIHB1YmxpYyByZWFkb25seSBwZGI6IGVrcy5LdWJlcm5ldGVzTWFuaWZlc3Q7XG5cbiAgLyoqXG4gICAqIFRoZSBvcHRpb25hbCBBTEIgSW5ncmVzcyBtYW5pZmVzdCAoY3JlYXRlZCBvbmx5IGlmIGVuYWJsZUFsYkluZ3Jlc3MgaXMgdHJ1ZSkuXG4gICAqL1xuICBwdWJsaWMgcmVhZG9ubHkgaW5ncmVzcz86IGVrcy5LdWJlcm5ldGVzTWFuaWZlc3Q7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IFNwcmluZ0Jvb3RTZXJ2aWNlUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgY29uc3Qge1xuICAgICAgY2x1c3RlcixcbiAgICAgIG5hbWVzcGFjZSA9ICdkZWZhdWx0JyxcbiAgICAgIHNlcnZpY2VOYW1lLFxuICAgICAgaW1hZ2VVcmksXG4gICAgICBjb250YWluZXJQb3J0ID0gODA4MCxcbiAgICAgIGVudmlyb25tZW50VmFyaWFibGVzID0ge30sXG4gICAgICBpcnNhUm9sZUFybixcbiAgICAgIGhwYU1pblJlcGxpY2FzID0gMixcbiAgICAgIGhwYU1heFJlcGxpY2FzID0gMjAsXG4gICAgICBocGFUYXJnZXRDcHVVdGlsaXphdGlvbiA9IDYwLFxuICAgICAgaHBhVGFyZ2V0TWVtb3J5VXRpbGl6YXRpb24gPSA3MCxcbiAgICAgIGNwdVJlcXVlc3QgPSAnNTAwbScsXG4gICAgICBjcHVMaW1pdCA9ICcxMDAwbScsXG4gICAgICBtZW1vcnlSZXF1ZXN0ID0gJzUxMk1pJyxcbiAgICAgIG1lbW9yeUxpbWl0ID0gJzFHaScsXG4gICAgICBsaXZlbmVzc1Byb2JlSW5pdGlhbERlbGF5U2Vjb25kcyA9IDMwLFxuICAgICAgcmVhZGluZXNzUHJvYmVJbml0aWFsRGVsYXlTZWNvbmRzID0gMTAsXG4gICAgICBoZWFsdGhDaGVja1BhdGggPSAnL2FjdHVhdG9yL2hlYWx0aCcsXG4gICAgICBlbmFibGVBbGJJbmdyZXNzID0gdHJ1ZSxcbiAgICAgIGluZ3Jlc3NIb3N0LFxuICAgICAgaW5ncmVzc1BhdGggPSAnLyonLFxuICAgICAgYWxiU2VjdXJpdHlHcm91cElkcyA9IFtdLFxuICAgICAgYWxiU3VibmV0SWRzID0gW10sXG4gICAgICBjZXJ0aWZpY2F0ZUFybixcbiAgICB9ID0gcHJvcHM7XG5cbiAgICAvLyDilIDilIAgU2VydmljZUFjY291bnQgd2l0aCBJUlNBIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vXG4gICAgLy8gQ3JlYXRlIGEgS3ViZXJuZXRlcyBTZXJ2aWNlQWNjb3VudCBhbmQgYW5ub3RhdGUgaXQgd2l0aCB0aGUgSUFNIHJvbGUgQVJOLlxuICAgIC8vIElSU0EgKElBTSBSb2xlcyBmb3IgU2VydmljZSBBY2NvdW50cykgYWxsb3dzIHBvZHMgdG8gYXNzdW1lIHRoZSBJQU0gcm9sZVxuICAgIC8vIHdpdGhvdXQgZW1iZWRkaW5nIGxvbmctbGl2ZWQgQVdTIGNyZWRlbnRpYWxzIGluIHRoZSBjb250YWluZXIuXG4gICAgLy9cbiAgICAvLyBUaGUgRUtTIGNsdXN0ZXIgbXVzdCBoYXZlIGFuIE9JREMgaWRlbnRpdHkgcHJvdmlkZXIgY29uZmlndXJlZC5cbiAgICAvLyBQb2RzIHVzaW5nIHRoaXMgU2VydmljZUFjY291bnQgY2FuIGNhbGwgQVdTIEFQSXMgd2l0aCB0aGUgcGVybWlzc2lvbnNcbiAgICAvLyBncmFudGVkIGJ5IHRoZSBJQU0gcm9sZSAoZS5nLiwgUkRTIERhdGEgQVBJLCBTMywgU1FTLCBUZXh0cmFjdCwgQmVkcm9jaykuXG4gICAgdGhpcy5zZXJ2aWNlQWNjb3VudCA9IG5ldyBla3MuU2VydmljZUFjY291bnQodGhpcywgJ1NlcnZpY2VBY2NvdW50Jywge1xuICAgICAgY2x1c3RlcixcbiAgICAgIG5hbWU6IHNlcnZpY2VOYW1lLFxuICAgICAgbmFtZXNwYWNlLFxuICAgICAgYW5ub3RhdGlvbnM6IHtcbiAgICAgICAgJ2Vrcy5hbWF6b25hd3MuY29tL3JvbGUtYXJuJzogaXJzYVJvbGVBcm4sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSAIERlcGxveW1lbnQg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBLdWJlcm5ldGVzIERlcGxveW1lbnQgd2l0aDpcbiAgICAvLyAg4oCiIEluaXRpYWwgcmVwbGljYSBjb3VudCA9IGhwYU1pblJlcGxpY2FzIChIUEEgd2lsbCBzY2FsZSB0aGlzKVxuICAgIC8vICDigKIgUG9kIGFudGktYWZmaW5pdHkgdG8gc3ByZWFkIHJlcGxpY2FzIGFjcm9zcyBub2Rlc1xuICAgIC8vICDigKIgUmVzb3VyY2UgcmVxdWVzdHMgYW5kIGxpbWl0cyBmb3IgcHJlZGljdGFibGUgUW9TXG4gICAgLy8gIOKAoiBSZWFkaW5lc3MgYW5kIGxpdmVuZXNzIHByb2JlcyBwb2ludGluZyB0byBTcHJpbmcgQm9vdCBBY3R1YXRvclxuICAgIC8vICDigKIgRW52aXJvbm1lbnQgdmFyaWFibGVzIChEQiBob3N0LCBSZWRpcyBob3N0LCBldGMuKVxuICAgIC8vICDigKIgU2VydmljZUFjY291bnQgZm9yIElSU0FcbiAgICAvL1xuICAgIC8vIFJvbGxpbmcgdXBkYXRlIHN0cmF0ZWd5OlxuICAgIC8vICDigKIgbWF4U3VyZ2U6IDEgICAgICDigJQgYWxsb3cgb25lIGV4dHJhIHBvZCBkdXJpbmcgcm9sbG91dFxuICAgIC8vICDigKIgbWF4VW5hdmFpbGFibGU6IDAg4oCUIGRvIG5vdCB0ZXJtaW5hdGUgb2xkIHBvZHMgdW50aWwgbmV3IHBvZHMgYXJlIHJlYWR5XG4gICAgLy9cbiAgICAvLyBUaGlzIGVuc3VyZXMgemVyby1kb3dudGltZSBkZXBsb3ltZW50cyBpbiBjb21iaW5hdGlvbiB3aXRoIHRoZSBQREIuXG4gICAgY29uc3QgZGVwbG95bWVudE1hbmlmZXN0ID0ge1xuICAgICAgYXBpVmVyc2lvbjogJ2FwcHMvdjEnLFxuICAgICAga2luZDogJ0RlcGxveW1lbnQnLFxuICAgICAgbWV0YWRhdGE6IHtcbiAgICAgICAgbmFtZTogc2VydmljZU5hbWUsXG4gICAgICAgIG5hbWVzcGFjZSxcbiAgICAgICAgbGFiZWxzOiB7XG4gICAgICAgICAgYXBwOiBzZXJ2aWNlTmFtZSxcbiAgICAgICAgICAnYXBwLmt1YmVybmV0ZXMuaW8vbmFtZSc6IHNlcnZpY2VOYW1lLFxuICAgICAgICAgICdhcHAua3ViZXJuZXRlcy5pby9jb21wb25lbnQnOiAnYmFja2VuZCcsXG4gICAgICAgICAgJ2FwcC5rdWJlcm5ldGVzLmlvL3BhcnQtb2YnOiAnZm9vZC1jb3N0LWNhbGN1bGF0b3InLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHNwZWM6IHtcbiAgICAgICAgcmVwbGljYXM6IGhwYU1pblJlcGxpY2FzLFxuICAgICAgICBzZWxlY3Rvcjoge1xuICAgICAgICAgIG1hdGNoTGFiZWxzOiB7XG4gICAgICAgICAgICBhcHA6IHNlcnZpY2VOYW1lLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHN0cmF0ZWd5OiB7XG4gICAgICAgICAgdHlwZTogJ1JvbGxpbmdVcGRhdGUnLFxuICAgICAgICAgIHJvbGxpbmdVcGRhdGU6IHtcbiAgICAgICAgICAgIG1heFN1cmdlOiAxLFxuICAgICAgICAgICAgbWF4VW5hdmFpbGFibGU6IDAsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgdGVtcGxhdGU6IHtcbiAgICAgICAgICBtZXRhZGF0YToge1xuICAgICAgICAgICAgbGFiZWxzOiB7XG4gICAgICAgICAgICAgIGFwcDogc2VydmljZU5hbWUsXG4gICAgICAgICAgICAgICdhcHAua3ViZXJuZXRlcy5pby9uYW1lJzogc2VydmljZU5hbWUsXG4gICAgICAgICAgICAgICdhcHAua3ViZXJuZXRlcy5pby9jb21wb25lbnQnOiAnYmFja2VuZCcsXG4gICAgICAgICAgICAgICdhcHAua3ViZXJuZXRlcy5pby9wYXJ0LW9mJzogJ2Zvb2QtY29zdC1jYWxjdWxhdG9yJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBhbm5vdGF0aW9uczoge1xuICAgICAgICAgICAgICAvLyBQcm9tZXRoZXVzIHNjcmFwaW5nIGFubm90YXRpb25zIChpZiB1c2luZyBQcm9tZXRoZXVzIGZvciBtZXRyaWNzKVxuICAgICAgICAgICAgICAncHJvbWV0aGV1cy5pby9zY3JhcGUnOiAndHJ1ZScsXG4gICAgICAgICAgICAgICdwcm9tZXRoZXVzLmlvL3BvcnQnOiBjb250YWluZXJQb3J0LnRvU3RyaW5nKCksXG4gICAgICAgICAgICAgICdwcm9tZXRoZXVzLmlvL3BhdGgnOiAnL2FjdHVhdG9yL3Byb21ldGhldXMnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHNwZWM6IHtcbiAgICAgICAgICAgIHNlcnZpY2VBY2NvdW50TmFtZTogc2VydmljZU5hbWUsXG5cbiAgICAgICAgICAgIC8vIFBvZCBhbnRpLWFmZmluaXR5IOKAlCBwcmVmZXIgc3ByZWFkaW5nIHJlcGxpY2FzIGFjcm9zcyBkaWZmZXJlbnQgbm9kZXNcbiAgICAgICAgICAgIC8vIGZvciBoaWdoIGF2YWlsYWJpbGl0eS4gVXNlcyBwcmVmZXJyZWREdXJpbmdTY2hlZHVsaW5nSWdub3JlZER1cmluZ0V4ZWN1dGlvblxuICAgICAgICAgICAgLy8gKHNvZnQgYWZmaW5pdHkpIHJhdGhlciB0aGFuIHJlcXVpcmVkIChoYXJkIGFmZmluaXR5KSB0byBhdm9pZCBibG9ja2luZ1xuICAgICAgICAgICAgLy8gc2NoZWR1bGluZyB3aGVuIGluc3VmZmljaWVudCBub2RlcyBhcmUgYXZhaWxhYmxlLlxuICAgICAgICAgICAgYWZmaW5pdHk6IHtcbiAgICAgICAgICAgICAgcG9kQW50aUFmZmluaXR5OiB7XG4gICAgICAgICAgICAgICAgcHJlZmVycmVkRHVyaW5nU2NoZWR1bGluZ0lnbm9yZWREdXJpbmdFeGVjdXRpb246IFtcbiAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgd2VpZ2h0OiAxMDAsXG4gICAgICAgICAgICAgICAgICAgIHBvZEFmZmluaXR5VGVybToge1xuICAgICAgICAgICAgICAgICAgICAgIGxhYmVsU2VsZWN0b3I6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hdGNoRXhwcmVzc2lvbnM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGtleTogJ2FwcCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb3BlcmF0b3I6ICdJbicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWVzOiBbc2VydmljZU5hbWVdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgIHRvcG9sb2d5S2V5OiAna3ViZXJuZXRlcy5pby9ob3N0bmFtZScsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICBjb250YWluZXJzOiBbXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiBzZXJ2aWNlTmFtZSxcbiAgICAgICAgICAgICAgICBpbWFnZTogaW1hZ2VVcmksXG4gICAgICAgICAgICAgICAgaW1hZ2VQdWxsUG9saWN5OiAnSWZOb3RQcmVzZW50JyxcblxuICAgICAgICAgICAgICAgIHBvcnRzOiBbXG4gICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6ICdodHRwJyxcbiAgICAgICAgICAgICAgICAgICAgY29udGFpbmVyUG9ydCxcbiAgICAgICAgICAgICAgICAgICAgcHJvdG9jb2w6ICdUQ1AnLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBdLFxuXG4gICAgICAgICAgICAgICAgLy8gRW52aXJvbm1lbnQgdmFyaWFibGVzIOKAlCBEQiBob3N0LCBSZWRpcyBob3N0LCBTUVMgcXVldWUgVVJMcywgZXRjLlxuICAgICAgICAgICAgICAgIGVudjogT2JqZWN0LmVudHJpZXMoZW52aXJvbm1lbnRWYXJpYWJsZXMpLm1hcCgoW25hbWUsIHZhbHVlXSkgPT4gKHtcbiAgICAgICAgICAgICAgICAgIG5hbWUsXG4gICAgICAgICAgICAgICAgICB2YWx1ZSxcbiAgICAgICAgICAgICAgICB9KSksXG5cbiAgICAgICAgICAgICAgICAvLyBSZXNvdXJjZSByZXF1ZXN0cyBhbmQgbGltaXRzLlxuICAgICAgICAgICAgICAgIC8vIFJlcXVlc3RzOiBndWFyYW50ZWVkIENQVSBhbmQgbWVtb3J5ICh1c2VkIGZvciBzY2hlZHVsaW5nKS5cbiAgICAgICAgICAgICAgICAvLyBMaW1pdHM6IG1heGltdW0gQ1BVIGFuZCBtZW1vcnkgdGhlIGNvbnRhaW5lciBjYW4gdXNlLlxuICAgICAgICAgICAgICAgIC8vXG4gICAgICAgICAgICAgICAgLy8gUW9TIGNsYXNzOlxuICAgICAgICAgICAgICAgIC8vICDigKIgSWYgcmVxdWVzdHMgPT0gbGltaXRzICDihpIgR3VhcmFudGVlZCAoaGlnaGVzdCBwcmlvcml0eSlcbiAgICAgICAgICAgICAgICAvLyAg4oCiIElmIHJlcXVlc3RzIDwgbGltaXRzICAg4oaSIEJ1cnN0YWJsZSAobWVkaXVtIHByaW9yaXR5KVxuICAgICAgICAgICAgICAgIC8vICDigKIgSWYgbm8gcmVxdWVzdHMgc2V0ICAgICDihpIgQmVzdEVmZm9ydCAobG93ZXN0IHByaW9yaXR5LCBldmljdGVkIGZpcnN0KVxuICAgICAgICAgICAgICAgIC8vXG4gICAgICAgICAgICAgICAgLy8gV2UgdXNlIEJ1cnN0YWJsZSBRb1MgdG8gYWxsb3cgYnVyc3RzIGR1cmluZyBsb2FkIHNwaWtlcyB3aGlsZVxuICAgICAgICAgICAgICAgIC8vIHN0aWxsIGd1YXJhbnRlZWluZyBiYXNlbGluZSByZXNvdXJjZXMuXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiB7XG4gICAgICAgICAgICAgICAgICByZXF1ZXN0czoge1xuICAgICAgICAgICAgICAgICAgICBjcHU6IGNwdVJlcXVlc3QsXG4gICAgICAgICAgICAgICAgICAgIG1lbW9yeTogbWVtb3J5UmVxdWVzdCxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICBsaW1pdHM6IHtcbiAgICAgICAgICAgICAgICAgICAgY3B1OiBjcHVMaW1pdCxcbiAgICAgICAgICAgICAgICAgICAgbWVtb3J5OiBtZW1vcnlMaW1pdCxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcblxuICAgICAgICAgICAgICAgIC8vIFJlYWRpbmVzcyBwcm9iZSDigJQgZGV0ZXJtaW5lcyB3aGVuIHRoZSBwb2QgaXMgcmVhZHkgdG8gcmVjZWl2ZSB0cmFmZmljLlxuICAgICAgICAgICAgICAgIC8vIEt1YmVybmV0ZXMgd2lsbCBub3Qgcm91dGUgU2VydmljZSB0cmFmZmljIHRvIGEgcG9kIHVudGlsIGl0IHBhc3Nlc1xuICAgICAgICAgICAgICAgIC8vIHRoZSByZWFkaW5lc3MgcHJvYmUuIFNwcmluZyBCb290IEFjdHVhdG9yIC9hY3R1YXRvci9oZWFsdGggcmV0dXJuc1xuICAgICAgICAgICAgICAgIC8vIEhUVFAgMjAwIHdoZW4gdGhlIGFwcCBpcyByZWFkeSAoRGF0YVNvdXJjZSBjb25uZWN0ZWQsIGV0Yy4pLlxuICAgICAgICAgICAgICAgIC8vXG4gICAgICAgICAgICAgICAgLy8gcGVyaW9kU2Vjb25kczogMTAgICDigJQgY2hlY2sgZXZlcnkgMTAgc2Vjb25kc1xuICAgICAgICAgICAgICAgIC8vIHRpbWVvdXRTZWNvbmRzOiA1ICAg4oCUIGZhaWwgaWYgbm8gcmVzcG9uc2UgaW4gNSBzZWNvbmRzXG4gICAgICAgICAgICAgICAgLy8gZmFpbHVyZVRocmVzaG9sZDogMyDigJQgbWFyayBwb2QgdW5yZWFkeSBhZnRlciAzIGNvbnNlY3V0aXZlIGZhaWx1cmVzXG4gICAgICAgICAgICAgICAgcmVhZGluZXNzUHJvYmU6IHtcbiAgICAgICAgICAgICAgICAgIGh0dHBHZXQ6IHtcbiAgICAgICAgICAgICAgICAgICAgcGF0aDogaGVhbHRoQ2hlY2tQYXRoLFxuICAgICAgICAgICAgICAgICAgICBwb3J0OiBjb250YWluZXJQb3J0LFxuICAgICAgICAgICAgICAgICAgICBzY2hlbWU6ICdIVFRQJyxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICBpbml0aWFsRGVsYXlTZWNvbmRzOiByZWFkaW5lc3NQcm9iZUluaXRpYWxEZWxheVNlY29uZHMsXG4gICAgICAgICAgICAgICAgICBwZXJpb2RTZWNvbmRzOiAxMCxcbiAgICAgICAgICAgICAgICAgIHRpbWVvdXRTZWNvbmRzOiA1LFxuICAgICAgICAgICAgICAgICAgc3VjY2Vzc1RocmVzaG9sZDogMSxcbiAgICAgICAgICAgICAgICAgIGZhaWx1cmVUaHJlc2hvbGQ6IDMsXG4gICAgICAgICAgICAgICAgfSxcblxuICAgICAgICAgICAgICAgIC8vIExpdmVuZXNzIHByb2JlIOKAlCBkZXRlcm1pbmVzIGlmIHRoZSBwb2QgaXMgc3RpbGwgYWxpdmUuXG4gICAgICAgICAgICAgICAgLy8gS3ViZXJuZXRlcyB3aWxsIHJlc3RhcnQgdGhlIHBvZCBpZiBpdCBmYWlscyB0aGUgbGl2ZW5lc3MgcHJvYmUuXG4gICAgICAgICAgICAgICAgLy8gVXNlIGEgbG9uZ2VyIGluaXRpYWxEZWxheVNlY29uZHMgdG8gYWxsb3cgU3ByaW5nIEJvb3QgdG8gZnVsbHlcbiAgICAgICAgICAgICAgICAvLyBzdGFydCB1cCBiZWZvcmUgY2hlY2tpbmcgKFNwcmluZyBCb290IGFwcHMgY2FuIHRha2UgMjDigJMzMHMgdG8gc3RhcnQpLlxuICAgICAgICAgICAgICAgIC8vXG4gICAgICAgICAgICAgICAgLy8gcGVyaW9kU2Vjb25kczogMzAgICDigJQgY2hlY2sgZXZlcnkgMzAgc2Vjb25kcyAobGVzcyBmcmVxdWVudCB0aGFuIHJlYWRpbmVzcylcbiAgICAgICAgICAgICAgICAvLyB0aW1lb3V0U2Vjb25kczogMTAgIOKAlCBsb25nZXIgdGltZW91dCBmb3IgbGl2ZW5lc3MgKGFsbG93IHNsb3cgaGVhbHRoIGNoZWNrcylcbiAgICAgICAgICAgICAgICAvLyBmYWlsdXJlVGhyZXNob2xkOiAzIOKAlCByZXN0YXJ0IHBvZCBhZnRlciAzIGNvbnNlY3V0aXZlIGZhaWx1cmVzXG4gICAgICAgICAgICAgICAgbGl2ZW5lc3NQcm9iZToge1xuICAgICAgICAgICAgICAgICAgaHR0cEdldDoge1xuICAgICAgICAgICAgICAgICAgICBwYXRoOiBoZWFsdGhDaGVja1BhdGgsXG4gICAgICAgICAgICAgICAgICAgIHBvcnQ6IGNvbnRhaW5lclBvcnQsXG4gICAgICAgICAgICAgICAgICAgIHNjaGVtZTogJ0hUVFAnLFxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgIGluaXRpYWxEZWxheVNlY29uZHM6IGxpdmVuZXNzUHJvYmVJbml0aWFsRGVsYXlTZWNvbmRzLFxuICAgICAgICAgICAgICAgICAgcGVyaW9kU2Vjb25kczogMzAsXG4gICAgICAgICAgICAgICAgICB0aW1lb3V0U2Vjb25kczogMTAsXG4gICAgICAgICAgICAgICAgICBzdWNjZXNzVGhyZXNob2xkOiAxLFxuICAgICAgICAgICAgICAgICAgZmFpbHVyZVRocmVzaG9sZDogMyxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9O1xuXG4gICAgdGhpcy5kZXBsb3ltZW50ID0gbmV3IGVrcy5LdWJlcm5ldGVzTWFuaWZlc3QodGhpcywgJ0RlcGxveW1lbnQnLCB7XG4gICAgICBjbHVzdGVyLFxuICAgICAgbWFuaWZlc3Q6IFtkZXBsb3ltZW50TWFuaWZlc3RdLFxuICAgIH0pO1xuXG4gICAgLy8gRW5zdXJlIFNlcnZpY2VBY2NvdW50IGlzIGNyZWF0ZWQgYmVmb3JlIERlcGxveW1lbnQgcmVmZXJlbmNlcyBpdC5cbiAgICB0aGlzLmRlcGxveW1lbnQubm9kZS5hZGREZXBlbmRlbmN5KHRoaXMuc2VydmljZUFjY291bnQpO1xuXG4gICAgLy8g4pSA4pSAIFNlcnZpY2Ug4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBLdWJlcm5ldGVzIFNlcnZpY2Ug4oCUIENsdXN0ZXJJUCB0eXBlIGJ5IGRlZmF1bHQuXG4gICAgLy8gRXhwb3NlcyB0aGUgRGVwbG95bWVudCBwb2RzIG9uIGEgc3RhYmxlIGludGVybmFsIElQIHdpdGhpbiB0aGUgY2x1c3Rlci5cbiAgICAvL1xuICAgIC8vIElmIGVuYWJsZUFsYkluZ3Jlc3MgaXMgdHJ1ZSwgdGhlIEFMQiBJbmdyZXNzIHdpbGwgcm91dGUgZXh0ZXJuYWwgdHJhZmZpY1xuICAgIC8vIHRvIHRoaXMgU2VydmljZS4gSWYgZW5hYmxlQWxiSW5ncmVzcyBpcyBmYWxzZSwgdGhpcyBTZXJ2aWNlIGlzIG9ubHlcbiAgICAvLyBhY2Nlc3NpYmxlIHdpdGhpbiB0aGUgY2x1c3RlciAoZm9yIGludGVybmFsIG1pY3Jvc2VydmljZXMpLlxuICAgIC8vXG4gICAgLy8gU2VydmljZSB0eXBlOlxuICAgIC8vICDigKIgQ2x1c3RlcklQIChkZWZhdWx0KSAgIOKAlCBpbnRlcm5hbC1vbmx5IGFjY2Vzc1xuICAgIC8vICDigKIgTG9hZEJhbGFuY2VyICAgICAgICAgIOKAlCBjcmVhdGVzIGEgY2xhc3NpYyBFTEIgKG5vdCByZWNvbW1lbmRlZDsgdXNlIEluZ3Jlc3MgaW5zdGVhZClcbiAgICAvLyAg4oCiIE5vZGVQb3J0ICAgICAgICAgICAgICDigJQgZXhwb3NlcyBvbiBhIHN0YXRpYyBwb3J0IG9uIGVhY2ggbm9kZSAocmFyZWx5IHVzZWQpXG4gICAgLy9cbiAgICAvLyBXZSB1c2UgQ2x1c3RlcklQIGFuZCByZWx5IG9uIHRoZSBBTEIgSW5ncmVzcyBmb3IgZXh0ZXJuYWwgYWNjZXNzLlxuICAgIGNvbnN0IHNlcnZpY2VNYW5pZmVzdCA9IHtcbiAgICAgIGFwaVZlcnNpb246ICd2MScsXG4gICAgICBraW5kOiAnU2VydmljZScsXG4gICAgICBtZXRhZGF0YToge1xuICAgICAgICBuYW1lOiBzZXJ2aWNlTmFtZSxcbiAgICAgICAgbmFtZXNwYWNlLFxuICAgICAgICBsYWJlbHM6IHtcbiAgICAgICAgICBhcHA6IHNlcnZpY2VOYW1lLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHNwZWM6IHtcbiAgICAgICAgdHlwZTogJ0NsdXN0ZXJJUCcsXG4gICAgICAgIHNlbGVjdG9yOiB7XG4gICAgICAgICAgYXBwOiBzZXJ2aWNlTmFtZSxcbiAgICAgICAgfSxcbiAgICAgICAgcG9ydHM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiAnaHR0cCcsXG4gICAgICAgICAgICBwb3J0OiA4MCxcbiAgICAgICAgICAgIHRhcmdldFBvcnQ6IGNvbnRhaW5lclBvcnQsXG4gICAgICAgICAgICBwcm90b2NvbDogJ1RDUCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfTtcblxuICAgIHRoaXMuc2VydmljZSA9IG5ldyBla3MuS3ViZXJuZXRlc01hbmlmZXN0KHRoaXMsICdTZXJ2aWNlJywge1xuICAgICAgY2x1c3RlcixcbiAgICAgIG1hbmlmZXN0OiBbc2VydmljZU1hbmlmZXN0XSxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCBIb3Jpem9udGFsUG9kQXV0b3NjYWxlciDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvL1xuICAgIC8vIEhQQSBhdXRvbWF0aWNhbGx5IHNjYWxlcyB0aGUgRGVwbG95bWVudCByZXBsaWNhIGNvdW50IGJhc2VkIG9uIG9ic2VydmVkXG4gICAgLy8gQ1BVIGFuZCBtZW1vcnkgdXRpbGl6YXRpb24uIFVzZXMgdGhlIE1ldHJpY3MgU2VydmVyIChwcmUtaW5zdGFsbGVkIG9uIEVLUylcbiAgICAvLyB0byBzY3JhcGUgcG9kIHJlc291cmNlIHVzYWdlLlxuICAgIC8vXG4gICAgLy8gU2NhbGluZyBiZWhhdmlvcjpcbiAgICAvLyAg4oCiIFNjYWxlIHVwOiB3aGVuIGF2ZXJhZ2UgQ1BVID4gdGFyZ2V0IGZvciAxNSBzZWNvbmRzIChkZWZhdWx0IHN0YWJpbGl6YXRpb24gd2luZG93KVxuICAgIC8vICDigKIgU2NhbGUgZG93bjogYWZ0ZXIgNSBtaW51dGVzIG9mIGxvdyB1c2FnZSAoZGVmYXVsdCBzY2FsZS1kb3duIHN0YWJpbGl6YXRpb24pXG4gICAgLy8gIOKAoiBtaW5SZXBsaWNhczogMiAg4oCUIGFsd2F5cyBhdCBsZWFzdCAyIHBvZHMgKEhBIGJhc2VsaW5lKVxuICAgIC8vICDigKIgbWF4UmVwbGljYXM6IDIwIOKAlCBjYXAgc2NhbGluZyB0byBwcmV2ZW50IGNvc3QgcnVuYXdheVxuICAgIC8vXG4gICAgLy8gVGFyZ2V0IG1ldHJpY3M6XG4gICAgLy8gIOKAoiBDUFU6IDYwJSBvZiByZXF1ZXN0cyAoZS5nLiwgaWYgcmVxdWVzdCBpcyA1MDBtLCB0YXJnZXQgaXMgMzAwbSBhdmVyYWdlKVxuICAgIC8vICDigKIgTWVtb3J5OiA3MCUgb2YgcmVxdWVzdHMgKGUuZy4sIGlmIHJlcXVlc3QgaXMgNTEyTWksIHRhcmdldCBpcyAzNThNaSBhdmVyYWdlKVxuICAgIGNvbnN0IGhwYU1hbmlmZXN0ID0ge1xuICAgICAgYXBpVmVyc2lvbjogJ2F1dG9zY2FsaW5nL3YyJyxcbiAgICAgIGtpbmQ6ICdIb3Jpem9udGFsUG9kQXV0b3NjYWxlcicsXG4gICAgICBtZXRhZGF0YToge1xuICAgICAgICBuYW1lOiBzZXJ2aWNlTmFtZSxcbiAgICAgICAgbmFtZXNwYWNlLFxuICAgICAgICBsYWJlbHM6IHtcbiAgICAgICAgICBhcHA6IHNlcnZpY2VOYW1lLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHNwZWM6IHtcbiAgICAgICAgc2NhbGVUYXJnZXRSZWY6IHtcbiAgICAgICAgICBhcGlWZXJzaW9uOiAnYXBwcy92MScsXG4gICAgICAgICAga2luZDogJ0RlcGxveW1lbnQnLFxuICAgICAgICAgIG5hbWU6IHNlcnZpY2VOYW1lLFxuICAgICAgICB9LFxuICAgICAgICBtaW5SZXBsaWNhczogaHBhTWluUmVwbGljYXMsXG4gICAgICAgIG1heFJlcGxpY2FzOiBocGFNYXhSZXBsaWNhcyxcbiAgICAgICAgbWV0cmljczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIHR5cGU6ICdSZXNvdXJjZScsXG4gICAgICAgICAgICByZXNvdXJjZToge1xuICAgICAgICAgICAgICBuYW1lOiAnY3B1JyxcbiAgICAgICAgICAgICAgdGFyZ2V0OiB7XG4gICAgICAgICAgICAgICAgdHlwZTogJ1V0aWxpemF0aW9uJyxcbiAgICAgICAgICAgICAgICBhdmVyYWdlVXRpbGl6YXRpb246IGhwYVRhcmdldENwdVV0aWxpemF0aW9uLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHR5cGU6ICdSZXNvdXJjZScsXG4gICAgICAgICAgICByZXNvdXJjZToge1xuICAgICAgICAgICAgICBuYW1lOiAnbWVtb3J5JyxcbiAgICAgICAgICAgICAgdGFyZ2V0OiB7XG4gICAgICAgICAgICAgICAgdHlwZTogJ1V0aWxpemF0aW9uJyxcbiAgICAgICAgICAgICAgICBhdmVyYWdlVXRpbGl6YXRpb246IGhwYVRhcmdldE1lbW9yeVV0aWxpemF0aW9uLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgICBiZWhhdmlvcjoge1xuICAgICAgICAgIHNjYWxlRG93bjoge1xuICAgICAgICAgICAgc3RhYmlsaXphdGlvbldpbmRvd1NlY29uZHM6IDMwMCwgLy8gNSBtaW51dGVzXG4gICAgICAgICAgICBwb2xpY2llczogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgdHlwZTogJ1BlcmNlbnQnLFxuICAgICAgICAgICAgICAgIHZhbHVlOiA1MCwgLy8gU2NhbGUgZG93biBieSBhdCBtb3N0IDUwJSBvZiBjdXJyZW50IHJlcGxpY2FzIHBlciBwZXJpb2RcbiAgICAgICAgICAgICAgICBwZXJpb2RTZWNvbmRzOiA2MCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzY2FsZVVwOiB7XG4gICAgICAgICAgICBzdGFiaWxpemF0aW9uV2luZG93U2Vjb25kczogMTUsIC8vIDE1IHNlY29uZHMgKGZhc3Qgc2NhbGUtdXApXG4gICAgICAgICAgICBwb2xpY2llczogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgdHlwZTogJ1BlcmNlbnQnLFxuICAgICAgICAgICAgICAgIHZhbHVlOiAxMDAsIC8vIERvdWJsZSB0aGUgcmVwbGljYXMgcGVyIHBlcmlvZCBpZiBuZWVkZWRcbiAgICAgICAgICAgICAgICBwZXJpb2RTZWNvbmRzOiA2MCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIHR5cGU6ICdQb2RzJyxcbiAgICAgICAgICAgICAgICB2YWx1ZTogNCwgLy8gQWRkIGF0IG1vc3QgNCBwb2RzIHBlciBwZXJpb2RcbiAgICAgICAgICAgICAgICBwZXJpb2RTZWNvbmRzOiA2MCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBzZWxlY3RQb2xpY3k6ICdNYXgnLCAvLyBVc2UgdGhlIG1vcmUgYWdncmVzc2l2ZSBvZiB0aGUgdHdvIHBvbGljaWVzXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfTtcblxuICAgIHRoaXMuaHBhID0gbmV3IGVrcy5LdWJlcm5ldGVzTWFuaWZlc3QodGhpcywgJ0hQQScsIHtcbiAgICAgIGNsdXN0ZXIsXG4gICAgICBtYW5pZmVzdDogW2hwYU1hbmlmZXN0XSxcbiAgICB9KTtcblxuICAgIC8vIEhQQSBtdXN0IGJlIGNyZWF0ZWQgYWZ0ZXIgRGVwbG95bWVudC5cbiAgICB0aGlzLmhwYS5ub2RlLmFkZERlcGVuZGVuY3kodGhpcy5kZXBsb3ltZW50KTtcblxuICAgIC8vIOKUgOKUgCBQb2REaXNydXB0aW9uQnVkZ2V0IOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vXG4gICAgLy8gUERCIGVuc3VyZXMgdGhhdCBhdCBsZWFzdCAxIHBvZCByZW1haW5zIGF2YWlsYWJsZSBkdXJpbmcgdm9sdW50YXJ5XG4gICAgLy8gZGlzcnVwdGlvbnMgKGUuZy4sIG5vZGUgZHJhaW4sIHJvbGxpbmcgdXBkYXRlLCBjbHVzdGVyIGF1dG9zY2FsZXIgc2NhbGUtZG93bikuXG4gICAgLy9cbiAgICAvLyBtaW5BdmFpbGFibGU6IDEg4oCUIGF0IGxlYXN0IDEgcG9kIG11c3QgcmVtYWluIHJ1bm5pbmcgYW5kIHJlYWR5IGR1cmluZyBkaXNydXB0aW9ucy5cbiAgICAvL1xuICAgIC8vIFRoaXMgaXMgY3JpdGljYWwgZm9yIHplcm8tZG93bnRpbWUgZGVwbG95bWVudHMuIENvbWJpbmVkIHdpdGggdGhlIERlcGxveW1lbnQnc1xuICAgIC8vIG1heFVuYXZhaWxhYmxlOiAwIHJvbGxpbmcgdXBkYXRlIHN0cmF0ZWd5LCB0aGlzIGd1YXJhbnRlZXMgdGhhdDpcbiAgICAvLyAgMS4gTmV3IHBvZHMgYXJlIHN0YXJ0ZWQgYW5kIGJlY29tZSByZWFkeSBiZWZvcmUgb2xkIHBvZHMgYXJlIHRlcm1pbmF0ZWQuXG4gICAgLy8gIDIuIER1cmluZyBub2RlIGRyYWlucyAoZS5nLiwgY2x1c3RlciBhdXRvc2NhbGVyIHNjYWxlLWRvd24pLCBhdCBsZWFzdCBvbmVcbiAgICAvLyAgICAgcG9kIHJlbWFpbnMgYXZhaWxhYmxlIHRvIHNlcnZlIHRyYWZmaWMuXG4gICAgLy9cbiAgICAvLyBOb3RlOiBQREIgZG9lcyBOT1QgcHJvdGVjdCBhZ2FpbnN0IGludm9sdW50YXJ5IGRpc3J1cHRpb25zIChlLmcuLCBub2RlIGZhaWx1cmUsXG4gICAgLy8gb3V0LW9mLW1lbW9yeSBraWxsKS4gRm9yIHRob3NlLCByZWx5IG9uIEhQQSBtaW4gcmVwbGljYXMgPj0gMiBhY3Jvc3MgbXVsdGlwbGUgQVpzLlxuICAgIGNvbnN0IHBkYk1hbmlmZXN0ID0ge1xuICAgICAgYXBpVmVyc2lvbjogJ3BvbGljeS92MScsXG4gICAgICBraW5kOiAnUG9kRGlzcnVwdGlvbkJ1ZGdldCcsXG4gICAgICBtZXRhZGF0YToge1xuICAgICAgICBuYW1lOiBzZXJ2aWNlTmFtZSxcbiAgICAgICAgbmFtZXNwYWNlLFxuICAgICAgICBsYWJlbHM6IHtcbiAgICAgICAgICBhcHA6IHNlcnZpY2VOYW1lLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHNwZWM6IHtcbiAgICAgICAgbWluQXZhaWxhYmxlOiAxLFxuICAgICAgICBzZWxlY3Rvcjoge1xuICAgICAgICAgIG1hdGNoTGFiZWxzOiB7XG4gICAgICAgICAgICBhcHA6IHNlcnZpY2VOYW1lLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH07XG5cbiAgICB0aGlzLnBkYiA9IG5ldyBla3MuS3ViZXJuZXRlc01hbmlmZXN0KHRoaXMsICdQREInLCB7XG4gICAgICBjbHVzdGVyLFxuICAgICAgbWFuaWZlc3Q6IFtwZGJNYW5pZmVzdF0sXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgT3B0aW9uYWw6IEFMQiBJbmdyZXNzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vXG4gICAgLy8gSWYgZW5hYmxlQWxiSW5ncmVzcyBpcyB0cnVlLCBjcmVhdGUgYSBLdWJlcm5ldGVzIEluZ3Jlc3MgcmVzb3VyY2Ugd2l0aFxuICAgIC8vIGFubm90YXRpb25zIGZvciB0aGUgQVdTIExvYWQgQmFsYW5jZXIgQ29udHJvbGxlci5cbiAgICAvL1xuICAgIC8vIFRoZSBBV1MgTG9hZCBCYWxhbmNlciBDb250cm9sbGVyIChpbnN0YWxsZWQgaW4gdGhlIEVLUyBjbHVzdGVyIHZpYSBIZWxtKVxuICAgIC8vIHdhdGNoZXMgZm9yIEluZ3Jlc3MgcmVzb3VyY2VzIHdpdGggdGhlIGBhbGIuaW5ncmVzcy5rdWJlcm5ldGVzLmlvLypgXG4gICAgLy8gYW5ub3RhdGlvbnMgYW5kIGNyZWF0ZXMgYW4gQXBwbGljYXRpb24gTG9hZCBCYWxhbmNlciBpbiBBV1MuXG4gICAgLy9cbiAgICAvLyBLZXkgYW5ub3RhdGlvbnM6XG4gICAgLy8gIOKAoiBhbGIuaW5ncmVzcy5rdWJlcm5ldGVzLmlvL3NjaGVtZTogaW50ZXJuZXQtZmFjaW5nXG4gICAgLy8gICAgICDihpIgQUxCIGlzIHB1YmxpY2x5IGFjY2Vzc2libGUgKHVzZXMgcHVibGljIHN1Ym5ldHMpXG4gICAgLy8gIOKAoiBhbGIuaW5ncmVzcy5rdWJlcm5ldGVzLmlvL3RhcmdldC10eXBlOiBpcFxuICAgIC8vICAgICAg4oaSIEFMQiB0YXJnZXRzIHBvZCBJUHMgZGlyZWN0bHkgKG5vdCBub2RlIElQcyk7IHJlcXVpcmVkIGZvciBGYXJnYXRlIG9yIENOSVxuICAgIC8vICDigKIgYWxiLmluZ3Jlc3Mua3ViZXJuZXRlcy5pby9zdWJuZXRzOiBzdWJuZXQtYWJjLHN1Ym5ldC14eXpcbiAgICAvLyAgICAgIOKGkiBBTEIgaXMgY3JlYXRlZCBpbiB0aGVzZSBzdWJuZXRzIChwdWJsaWMgc3VibmV0cyBmb3IgaW50ZXJuZXQtZmFjaW5nKVxuICAgIC8vICDigKIgYWxiLmluZ3Jlc3Mua3ViZXJuZXRlcy5pby9zZWN1cml0eS1ncm91cHM6IHNnLTEyM1xuICAgIC8vICAgICAg4oaSIEF0dGFjaCB0aGVzZSBzZWN1cml0eSBncm91cHMgdG8gdGhlIEFMQlxuICAgIC8vICDigKIgYWxiLmluZ3Jlc3Mua3ViZXJuZXRlcy5pby9saXN0ZW4tcG9ydHM6ICdbe1wiSFRUUFwiOjgwfSx7XCJIVFRQU1wiOjQ0M31dJ1xuICAgIC8vICAgICAg4oaSIEFMQiBsaXN0ZW5zIG9uIEhUVFAgKHJlZGlyZWN0cyB0byBIVFRQUykgYW5kIEhUVFBTXG4gICAgLy8gIOKAoiBhbGIuaW5ncmVzcy5rdWJlcm5ldGVzLmlvL2NlcnRpZmljYXRlLWFybjogYXJuOmF3czphY206dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjpjZXJ0aWZpY2F0ZS9hYmMtMTIzXG4gICAgLy8gICAgICDihpIgSFRUUFMgbGlzdGVuZXIgdXNlcyB0aGlzIEFDTSBjZXJ0aWZpY2F0ZVxuICAgIC8vICDigKIgYWxiLmluZ3Jlc3Mua3ViZXJuZXRlcy5pby9zc2wtcmVkaXJlY3Q6ICc0NDMnXG4gICAgLy8gICAgICDihpIgUmVkaXJlY3QgSFRUUCByZXF1ZXN0cyB0byBIVFRQU1xuICAgIC8vICDigKIgYWxiLmluZ3Jlc3Mua3ViZXJuZXRlcy5pby9oZWFsdGhjaGVjay1wYXRoOiAvYWN0dWF0b3IvaGVhbHRoXG4gICAgLy8gICAgICDihpIgQUxCIHRhcmdldCBncm91cCBoZWFsdGggY2hlY2sgcGF0aFxuICAgIC8vICDigKIgYWxiLmluZ3Jlc3Mua3ViZXJuZXRlcy5pby9oZWFsdGhjaGVjay1pbnRlcnZhbC1zZWNvbmRzOiAnMTUnXG4gICAgLy8gICAgICDihpIgSGVhbHRoIGNoZWNrIGludGVydmFsIChkZWZhdWx0IGlzIDMwczsgd2UgdXNlIDE1cyBmb3IgZmFzdGVyIGZhaWxvdmVyKVxuICAgIC8vICDigKIgYWxiLmluZ3Jlc3Mua3ViZXJuZXRlcy5pby9oZWFsdGh5LXRocmVzaG9sZC1jb3VudDogJzInXG4gICAgLy8gICAgICDihpIgTWFyayB0YXJnZXQgaGVhbHRoeSBhZnRlciAyIGNvbnNlY3V0aXZlIHN1Y2Nlc3NmdWwgaGVhbHRoIGNoZWNrc1xuICAgIC8vICDigKIgYWxiLmluZ3Jlc3Mua3ViZXJuZXRlcy5pby91bmhlYWx0aHktdGhyZXNob2xkLWNvdW50OiAnMidcbiAgICAvLyAgICAgIOKGkiBNYXJrIHRhcmdldCB1bmhlYWx0aHkgYWZ0ZXIgMiBjb25zZWN1dGl2ZSBmYWlsZWQgaGVhbHRoIGNoZWNrc1xuICAgIC8vXG4gICAgLy8gSW5ncmVzcyBydWxlczpcbiAgICAvLyAg4oCiIElmIGluZ3Jlc3NIb3N0IGlzIHNldDogcm91dGUgYmFzZWQgb24gSG9zdCBoZWFkZXIgKGUuZy4sIGFwaS5mb29kY29zdGNhbGN1bGF0b3IuY29tKVxuICAgIC8vICDigKIgSWYgaW5ncmVzc0hvc3QgaXMgbm90IHNldDogcm91dGUgYWxsIHRyYWZmaWMgdG8gdGhlIHNlcnZpY2VcbiAgICAvLyAg4oCiIFBhdGg6IHNwZWNpZmllZCBieSBpbmdyZXNzUGF0aCAoZGVmYXVsdDogLyog4oCUIGFsbCBwYXRocylcbiAgICAvL1xuICAgIC8vIFRoZSBBV1MgTG9hZCBCYWxhbmNlciBDb250cm9sbGVyIGF1dG9tYXRpY2FsbHk6XG4gICAgLy8gIDEuIENyZWF0ZXMgYW4gQUxCIGluIHRoZSBzcGVjaWZpZWQgc3VibmV0c1xuICAgIC8vICAyLiBDcmVhdGVzIGEgdGFyZ2V0IGdyb3VwIHBvaW50aW5nIHRvIHRoZSBTZXJ2aWNlIHBvZHNcbiAgICAvLyAgMy4gUmVnaXN0ZXJzL2RlcmVnaXN0ZXJzIHBvZCBJUHMgYXMgdGhleSBhcmUgY3JlYXRlZC9kZWxldGVkXG4gICAgLy8gIDQuIFVwZGF0ZXMgdGFyZ2V0IGdyb3VwIGhlYWx0aCBjaGVja3MgYmFzZWQgb24gcmVhZGluZXNzIHByb2Jlc1xuICAgIC8vXG4gICAgLy8gRm9yIG1vcmUgZGV0YWlscywgc2VlOlxuICAgIC8vICBodHRwczovL2t1YmVybmV0ZXMtc2lncy5naXRodWIuaW8vYXdzLWxvYWQtYmFsYW5jZXItY29udHJvbGxlci92Mi43L2d1aWRlL2luZ3Jlc3MvYW5ub3RhdGlvbnMvXG4gICAgaWYgKGVuYWJsZUFsYkluZ3Jlc3MpIHtcbiAgICAgIGNvbnN0IGluZ3Jlc3NBbm5vdGF0aW9uczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfSA9IHtcbiAgICAgICAgJ2t1YmVybmV0ZXMuaW8vaW5ncmVzcy5jbGFzcyc6ICdhbGInLFxuICAgICAgICAnYWxiLmluZ3Jlc3Mua3ViZXJuZXRlcy5pby9zY2hlbWUnOiAnaW50ZXJuZXQtZmFjaW5nJyxcbiAgICAgICAgJ2FsYi5pbmdyZXNzLmt1YmVybmV0ZXMuaW8vdGFyZ2V0LXR5cGUnOiAnaXAnLFxuICAgICAgICAnYWxiLmluZ3Jlc3Mua3ViZXJuZXRlcy5pby9oZWFsdGhjaGVjay1wYXRoJzogaGVhbHRoQ2hlY2tQYXRoLFxuICAgICAgICAnYWxiLmluZ3Jlc3Mua3ViZXJuZXRlcy5pby9oZWFsdGhjaGVjay1pbnRlcnZhbC1zZWNvbmRzJzogJzE1JyxcbiAgICAgICAgJ2FsYi5pbmdyZXNzLmt1YmVybmV0ZXMuaW8vaGVhbHRoeS10aHJlc2hvbGQtY291bnQnOiAnMicsXG4gICAgICAgICdhbGIuaW5ncmVzcy5rdWJlcm5ldGVzLmlvL3VuaGVhbHRoeS10aHJlc2hvbGQtY291bnQnOiAnMicsXG4gICAgICB9O1xuXG4gICAgICAvLyBBZGQgc3VibmV0cyBhbm5vdGF0aW9uIGlmIHByb3ZpZGVkLlxuICAgICAgaWYgKGFsYlN1Ym5ldElkcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGluZ3Jlc3NBbm5vdGF0aW9uc1snYWxiLmluZ3Jlc3Mua3ViZXJuZXRlcy5pby9zdWJuZXRzJ10gPSBhbGJTdWJuZXRJZHMuam9pbignLCcpO1xuICAgICAgfVxuXG4gICAgICAvLyBBZGQgc2VjdXJpdHkgZ3JvdXBzIGFubm90YXRpb24gaWYgcHJvdmlkZWQuXG4gICAgICBpZiAoYWxiU2VjdXJpdHlHcm91cElkcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGluZ3Jlc3NBbm5vdGF0aW9uc1snYWxiLmluZ3Jlc3Mua3ViZXJuZXRlcy5pby9zZWN1cml0eS1ncm91cHMnXSA9IGFsYlNlY3VyaXR5R3JvdXBJZHMuam9pbignLCcpO1xuICAgICAgfVxuXG4gICAgICAvLyBBZGQgSFRUUFMgY29uZmlndXJhdGlvbiBpZiBjZXJ0aWZpY2F0ZSBBUk4gaXMgcHJvdmlkZWQuXG4gICAgICBpZiAoY2VydGlmaWNhdGVBcm4pIHtcbiAgICAgICAgaW5ncmVzc0Fubm90YXRpb25zWydhbGIuaW5ncmVzcy5rdWJlcm5ldGVzLmlvL2xpc3Rlbi1wb3J0cyddID1cbiAgICAgICAgICAnW3tcIkhUVFBcIjo4MH0se1wiSFRUUFNcIjo0NDN9XSc7XG4gICAgICAgIGluZ3Jlc3NBbm5vdGF0aW9uc1snYWxiLmluZ3Jlc3Mua3ViZXJuZXRlcy5pby9jZXJ0aWZpY2F0ZS1hcm4nXSA9IGNlcnRpZmljYXRlQXJuO1xuICAgICAgICBpbmdyZXNzQW5ub3RhdGlvbnNbJ2FsYi5pbmdyZXNzLmt1YmVybmV0ZXMuaW8vc3NsLXJlZGlyZWN0J10gPSAnNDQzJztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEhUVFAtb25seSBsaXN0ZW5lciBpZiBubyBjZXJ0aWZpY2F0ZSBpcyBwcm92aWRlZC5cbiAgICAgICAgaW5ncmVzc0Fubm90YXRpb25zWydhbGIuaW5ncmVzcy5rdWJlcm5ldGVzLmlvL2xpc3Rlbi1wb3J0cyddID0gJ1t7XCJIVFRQXCI6ODB9XSc7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGluZ3Jlc3NSdWxlczogYW55W10gPSBbXTtcblxuICAgICAgLy8gSWYgaW5ncmVzc0hvc3QgaXMgcHJvdmlkZWQsIGFkZCBhIGhvc3QtYmFzZWQgcnVsZS5cbiAgICAgIC8vIE90aGVyd2lzZSwgYWRkIGEgY2F0Y2gtYWxsIHJ1bGUgKG5vIGhvc3QgcmVzdHJpY3Rpb24pLlxuICAgICAgY29uc3QgcnVsZTogYW55ID0ge1xuICAgICAgICBodHRwOiB7XG4gICAgICAgICAgcGF0aHM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgcGF0aDogaW5ncmVzc1BhdGgsXG4gICAgICAgICAgICAgIHBhdGhUeXBlOiAnSW1wbGVtZW50YXRpb25TcGVjaWZpYycsXG4gICAgICAgICAgICAgIGJhY2tlbmQ6IHtcbiAgICAgICAgICAgICAgICBzZXJ2aWNlOiB7XG4gICAgICAgICAgICAgICAgICBuYW1lOiBzZXJ2aWNlTmFtZSxcbiAgICAgICAgICAgICAgICAgIHBvcnQ6IHtcbiAgICAgICAgICAgICAgICAgICAgbnVtYmVyOiA4MCxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgIH07XG5cbiAgICAgIGlmIChpbmdyZXNzSG9zdCkge1xuICAgICAgICBydWxlLmhvc3QgPSBpbmdyZXNzSG9zdDtcbiAgICAgIH1cblxuICAgICAgaW5ncmVzc1J1bGVzLnB1c2gocnVsZSk7XG5cbiAgICAgIGNvbnN0IGluZ3Jlc3NNYW5pZmVzdCA9IHtcbiAgICAgICAgYXBpVmVyc2lvbjogJ25ldHdvcmtpbmcuazhzLmlvL3YxJyxcbiAgICAgICAga2luZDogJ0luZ3Jlc3MnLFxuICAgICAgICBtZXRhZGF0YToge1xuICAgICAgICAgIG5hbWU6IHNlcnZpY2VOYW1lLFxuICAgICAgICAgIG5hbWVzcGFjZSxcbiAgICAgICAgICBsYWJlbHM6IHtcbiAgICAgICAgICAgIGFwcDogc2VydmljZU5hbWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBhbm5vdGF0aW9uczogaW5ncmVzc0Fubm90YXRpb25zLFxuICAgICAgICB9LFxuICAgICAgICBzcGVjOiB7XG4gICAgICAgICAgcnVsZXM6IGluZ3Jlc3NSdWxlcyxcbiAgICAgICAgfSxcbiAgICAgIH07XG5cbiAgICAgIHRoaXMuaW5ncmVzcyA9IG5ldyBla3MuS3ViZXJuZXRlc01hbmlmZXN0KHRoaXMsICdJbmdyZXNzJywge1xuICAgICAgICBjbHVzdGVyLFxuICAgICAgICBtYW5pZmVzdDogW2luZ3Jlc3NNYW5pZmVzdF0sXG4gICAgICB9KTtcblxuICAgICAgLy8gSW5ncmVzcyBtdXN0IGJlIGNyZWF0ZWQgYWZ0ZXIgU2VydmljZS5cbiAgICAgIHRoaXMuaW5ncmVzcy5ub2RlLmFkZERlcGVuZGVuY3kodGhpcy5zZXJ2aWNlKTtcbiAgICB9XG5cbiAgICAvLyDilIDilIAgQ0RLIE91dHB1dCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvL1xuICAgIC8vIEV4cG9ydCB0aGUgc2VydmljZSBuYW1lIGFuZCBuYW1lc3BhY2UgYXMgQ2xvdWRGb3JtYXRpb24gb3V0cHV0cyBmb3JcbiAgICAvLyByZWZlcmVuY2UgYnkgb3RoZXIgc3RhY2tzIG9yIGV4dGVybmFsIHRvb2xzLlxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTZXJ2aWNlTmFtZScsIHtcbiAgICAgIHZhbHVlOiBzZXJ2aWNlTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiBgU2VydmljZSBuYW1lIGZvciAke3NlcnZpY2VOYW1lfWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTmFtZXNwYWNlJywge1xuICAgICAgdmFsdWU6IG5hbWVzcGFjZSxcbiAgICAgIGRlc2NyaXB0aW9uOiBgS3ViZXJuZXRlcyBuYW1lc3BhY2UgZm9yICR7c2VydmljZU5hbWV9YCxcbiAgICB9KTtcbiAgfVxufVxuIl19