import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface EcsStackProps extends cdk.StackProps {
  /** Logical environment name, e.g. "staging" or "prod" */
  readonly envName: string;

  /** VPC where ECS will be deployed */
  readonly vpc: ec2.IVpc;

  /** Security group for ECS tasks */
  readonly ecsSecurityGroup: ec2.ISecurityGroup;

  /** Security group for ALB */
  readonly albSecurityGroup: ec2.ISecurityGroup;

  /** Database endpoint (RDS or Aurora) */
  readonly databaseEndpoint: string;

  /** Database secret ARN */
  readonly databaseSecretArn: string;

  /** Redis endpoint (ElastiCache) - optional, can be undefined if Redis is not available */
  readonly redisEndpoint?: string;

  /** Cognito User Pool ID */
  readonly cognitoUserPoolId: string;

  /** Cognito Client ID */
  readonly cognitoClientId: string;
}

/**
 * EcsStack
 *
 * Cost-optimized compute stack using ECS Fargate instead of EKS:
 *
 *  • ECS Cluster with Fargate capacity provider
 *  • ECR repository for Docker images
 *  • Application Load Balancer (public subnets)
 *  • ECS Service with Fargate tasks (private subnets)
 *  • Auto-scaling based on CPU/memory
 *  • IAM task roles with least privilege
 *  • CloudWatch Logs integration
 *
 * Cost savings vs EKS:
 *  - No $72/month control plane fee
 *  - Pay only for task CPU/memory (not idle nodes)
 *  - Automatic capacity management
 *
 * Expected cost: $45-90/month for 2 tasks
 */
export class EcsStack extends cdk.Stack {
  /** The ECS cluster */
  public readonly cluster: ecs.Cluster;

  /** The ECR repository */
  public readonly repository: ecr.IRepository;

  /** The Application Load Balancer */
  public readonly alb: elbv2.ApplicationLoadBalancer;

  /** The ECS service */
  public readonly service: ecs.FargateService;

  /** The ALB DNS name */
  public readonly albDnsName: string;

  /** S3 bucket for ALB access logs */
  public readonly albLogsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    const { envName, vpc, ecsSecurityGroup, albSecurityGroup, databaseEndpoint, databaseSecretArn, redisEndpoint, cognitoUserPoolId, cognitoClientId } = props;

    // ── ECR Repository ───────────────────────────────────────────────────────
    //
    // Import existing repository (created by deployment script) or create new one
    const repositoryName = `food-cost-calculator-${envName}`;
    this.repository = ecr.Repository.fromRepositoryName(
      this, 
      'Repository', 
      repositoryName
    );

    // ── ECS Cluster ──────────────────────────────────────────────────────────
    //
    // Fargate-based cluster (no EC2 instances to manage).
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `foodcost-${envName}`,
      vpc,
      containerInsights: true, // CloudWatch Container Insights
    });

    // ── Application Load Balancer ────────────────────────────────────────────
    //
    // Internet-facing ALB in public subnets.
    
    // Create S3 bucket for ALB access logs
    // Requirement 11.8: ALB access logs for HTTP request logging
    this.albLogsBucket = new s3.Bucket(this, 'AlbLogsBucket', {
      bucketName: `fcc-alb-logs-${envName}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          id: 'DeleteOldLogs',
          enabled: true,
          expiration: cdk.Duration.days(90), // Delete logs after 90 days for cost optimization
        },
      ],
      removalPolicy: envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: envName !== 'prod', // Auto-delete for non-prod environments
    });

    this.alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PUBLIC,
      }),
      loadBalancerName: `foodcost-alb-${envName}`,
    });

    this.albDnsName = this.alb.loadBalancerDnsName;

    // Enable ALB access logs to S3
    this.alb.logAccessLogs(this.albLogsBucket);

    // ── IAM Task Execution Role ──────────────────────────────────────────────
    //
    // Role used by ECS agent to pull images, write logs, read secrets.
    // Permissions:
    //   - ECR: Pull Docker images from repository
    //   - CloudWatch Logs: Write application logs
    //   - Secrets Manager: Read database credentials
    //
    // Note: AmazonECSTaskExecutionRolePolicy includes ECR pull and CloudWatch Logs write
    const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Grant access to Secrets Manager for database credentials (least-privilege: specific secret only)
    taskExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [databaseSecretArn, `${databaseSecretArn}-??????`], // Include auto-generated suffix
      }),
    );

    // ── IAM Task Role ────────────────────────────────────────────────────────
    //
    // Role used by application code to access AWS services.
    // Follows least-privilege principle with specific resource ARNs.
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Grant S3 access for invoice uploads (least-privilege: specific bucket only)
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
        resources: [
          `arn:aws:s3:::fcc-invoices-${envName}`,
          `arn:aws:s3:::fcc-invoices-${envName}/*`,
        ],
      }),
    );

    // Grant Cognito access for user attribute read (least-privilege: specific User Pool only)
    const userPoolArn = `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${cognitoUserPoolId}`;
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminUpdateUserAttributes',
          'cognito-idp:ListUsers',
        ],
        resources: [userPoolArn],
      }),
    );

    // ── CloudWatch Logs ──────────────────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/ecs/foodcost-api-${envName}`,
      retention: logs.RetentionDays.ONE_WEEK, // Cost optimization
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── Task Definition ──────────────────────────────────────────────────────
    //
    // Fargate task: 1 vCPU, 3 GB RAM (increased for Spring Boot + Flyway migrations)
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      family: `foodcost-api-${envName}`,
      cpu: 1024, // 1 vCPU
      memoryLimitMiB: 3072, // 3 GB (increased from 2GB to handle Flyway + Spring Boot startup)
      executionRole: taskExecutionRole,
      taskRole,
    });

    // Add container
    const container = taskDefinition.addContainer('api', {
      containerName: 'api',
      image: ecs.ContainerImage.fromEcrRepository(this.repository, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'ecs',
        logGroup,
      }),
      environment: {
        SPRING_PROFILES_ACTIVE: 'production',
        DATABASE_URL: `jdbc:postgresql://${databaseEndpoint}/foodcost`,
        DATABASE_USERNAME: 'postgres',
        ...(redisEndpoint ? {
          REDIS_HOST: redisEndpoint,
          REDIS_PORT: '6379',
          REDIS_SSL_ENABLED: 'true',
        } : {
          // Disable Redis when not available
          'spring.data.redis.enabled': 'false',
          'spring.cache.type': 'none',
          'management.health.redis.enabled': 'false', // Disable Redis health check
        }),
        AWS_REGION: this.region,
        COGNITO_USER_POOL_ID: cognitoUserPoolId,
        COGNITO_CLIENT_ID: cognitoClientId,
        COGNITO_JWKS_URI: `https://cognito-idp.${this.region}.amazonaws.com/${cognitoUserPoolId}/.well-known/jwks.json`,
        COGNITO_DOMAIN: `https://food-cost-calculator-${envName}.auth.${this.region}.amazoncognito.com`,
        S3_INVOICES_BUCKET: `fcc-invoices-${envName}`,
        // Disable X-Ray for now (not configured)
        AWS_XRAY_ENABLED: 'false',
        // Set placeholders for optional SQS queues (not critical for startup)
        SQS_COST_PROPAGATION_QUEUE: 'disabled',
        SQS_OCR_PROCESSING_QUEUE: 'disabled',
        // CORS configuration
        CORS_ALLOWED_ORIGINS: 'http://localhost:5173,http://localhost:3000,http://fcc-frontend.s3-website-us-east-1.amazonaws.com',
      },
      secrets: {
        DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(
          cdk.aws_secretsmanager.Secret.fromSecretCompleteArn(this, 'DatabaseSecret', databaseSecretArn),
          'password',
        ),
      },
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:8080/actuator/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(180), // Increased to allow Flyway migrations and Spring Boot startup
      },
    });

    container.addPortMappings({
      containerPort: 8080,
      protocol: ecs.Protocol.TCP,
    });

    // ── ECS Service ──────────────────────────────────────────────────────────
    //
    // Fargate service with auto-scaling (1-4 tasks)
    // Circuit breaker enables automatic rollback if health checks fail after deployment
    this.service = new ecs.FargateService(this, 'Service', {
      cluster: this.cluster,
      taskDefinition,
      serviceName: `foodcost-api-${envName}`,
      desiredCount: 1, // Start with 1 task for cost optimization
      minHealthyPercent: 50,
      maxHealthyPercent: 200,
      vpcSubnets: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      }),
      securityGroups: [ecsSecurityGroup],
      assignPublicIp: false,
      healthCheckGracePeriod: cdk.Duration.seconds(300), // Increased to 5 minutes for Flyway migrations and Spring Boot startup
      // Automatic rollback configuration - Requirement 9.7
      circuitBreaker: {
        rollback: true, // Enable automatic rollback on deployment failure
      },
    });

    // ── Auto Scaling ─────────────────────────────────────────────────────────
    const scaling = this.service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 4,
    });

    // Scale on CPU utilization
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // Scale on memory utilization
    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 80,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // ── ALB Target Group ─────────────────────────────────────────────────────
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc,
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/actuator/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10), // Increased timeout to handle slow responses during startup
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5, // Increased to allow more retries during startup
        healthyHttpCodes: '200',
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // Register ECS service with target group
    this.service.attachToApplicationTargetGroup(targetGroup);

    // ── ALB Listener ─────────────────────────────────────────────────────────
    //
    // HTTP listener (port 80) - redirect to HTTPS in production
    const listener = this.alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.forward([targetGroup]),
    });

    // TODO: Add HTTPS listener when SSL certificate is available
    // const httpsListener = this.alb.addListener('HttpsListener', {
    //   port: 443,
    //   protocol: elbv2.ApplicationProtocol.HTTPS,
    //   certificates: [certificate],
    //   defaultAction: elbv2.ListenerAction.forward([targetGroup]),
    // });

    // ── CloudFormation Outputs ───────────────────────────────────────────────
    new cdk.CfnOutput(this, 'RepositoryUri', {
      value: this.repository.repositoryUri,
      description: 'ECR repository URI for Docker images',
      exportName: `FoodCostCalculator-${envName}-RepositoryUri`,
    });

    new cdk.CfnOutput(this, 'ClusterName', {
      value: this.cluster.clusterName,
      description: 'ECS cluster name',
      exportName: `FoodCostCalculator-${envName}-EcsClusterName`,
    });

    new cdk.CfnOutput(this, 'ServiceName', {
      value: this.service.serviceName,
      description: 'ECS service name',
      exportName: `FoodCostCalculator-${envName}-EcsServiceName`,
    });

    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: this.alb.loadBalancerDnsName,
      description: 'Application Load Balancer DNS name',
      exportName: `FoodCostCalculator-${envName}-AlbDns`,
    });

    new cdk.CfnOutput(this, 'LoadBalancerUrl', {
      value: `http://${this.alb.loadBalancerDnsName}`,
      description: 'Application Load Balancer URL',
    });

    new cdk.CfnOutput(this, 'AlbLogsBucketName', {
      value: this.albLogsBucket.bucketName,
      description: 'S3 bucket for ALB access logs',
      exportName: `FoodCostCalculator-${envName}-AlbLogsBucketName`,
    });

    // ── Tags ─────────────────────────────────────────────────────────────────
    cdk.Tags.of(this).add('Component', 'ECS');
    cdk.Tags.of(this).add('CostCenter', 'Compute');
  }
}
