import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
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

  /** Redis endpoint (ElastiCache) */
  readonly redisEndpoint: string;

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
  public readonly repository: ecr.Repository;

  /** The Application Load Balancer */
  public readonly alb: elbv2.ApplicationLoadBalancer;

  /** The ECS service */
  public readonly service: ecs.FargateService;

  /** The ALB DNS name */
  public readonly albDnsName: string;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    const { envName, vpc, ecsSecurityGroup, albSecurityGroup, databaseEndpoint, databaseSecretArn, redisEndpoint, cognitoUserPoolId, cognitoClientId } = props;

    // ── ECR Repository ───────────────────────────────────────────────────────
    //
    // Store Docker images with automatic scanning and encryption.
    this.repository = new ecr.Repository(this, 'Repository', {
      repositoryName: `food-cost-calculator-${envName}`,
      imageScanOnPush: true,
      encryption: ecr.RepositoryEncryption.AES_256,
      removalPolicy: envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          description: 'Keep last 10 images',
          maxImageCount: 10,
        },
      ],
    });

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

    // ── IAM Task Execution Role ──────────────────────────────────────────────
    //
    // Role used by ECS agent to pull images, write logs, read secrets.
    const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Grant access to Secrets Manager for database credentials
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
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Grant S3 access for invoice uploads
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

    // Grant SQS access for async jobs
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'sqs:SendMessage',
          'sqs:ReceiveMessage',
          'sqs:DeleteMessage',
          'sqs:GetQueueUrl',
          'sqs:GetQueueAttributes',
        ],
        resources: [`arn:aws:sqs:${this.region}:${this.account}:fcc-*-${envName}`],
      }),
    );

    // Grant Cognito access for user management
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminUpdateUserAttributes',
          'cognito-idp:ListUsers',
        ],
        resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/*`],
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
    // Fargate task: 1 vCPU, 2 GB RAM (sufficient for Spring Boot)
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      family: `foodcost-api-${envName}`,
      cpu: 1024, // 1 vCPU
      memoryLimitMiB: 2048, // 2 GB
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
        REDIS_HOST: redisEndpoint,
        REDIS_PORT: '6379',
        AWS_REGION: this.region,
        COGNITO_USER_POOL_ID: cognitoUserPoolId,
        COGNITO_CLIENT_ID: cognitoClientId,
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
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    container.addPortMappings({
      containerPort: 8080,
      protocol: ecs.Protocol.TCP,
    });

    // ── ECS Service ──────────────────────────────────────────────────────────
    //
    // Fargate service with auto-scaling (1-4 tasks)
    this.service = new ecs.FargateService(this, 'Service', {
      cluster: this.cluster,
      taskDefinition,
      serviceName: `foodcost-api-${envName}`,
      desiredCount: 2, // Start with 2 for HA
      minHealthyPercent: 50,
      maxHealthyPercent: 200,
      vpcSubnets: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      }),
      securityGroups: [ecsSecurityGroup],
      assignPublicIp: false,
      healthCheckGracePeriod: cdk.Duration.seconds(60),
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
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
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

    // ── Tags ─────────────────────────────────────────────────────────────────
    cdk.Tags.of(this).add('Component', 'ECS');
    cdk.Tags.of(this).add('CostCenter', 'Compute');
  }
}
