"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EcsStack = void 0;
const cdk = require("aws-cdk-lib");
const ec2 = require("aws-cdk-lib/aws-ec2");
const ecs = require("aws-cdk-lib/aws-ecs");
const elbv2 = require("aws-cdk-lib/aws-elasticloadbalancingv2");
const ecr = require("aws-cdk-lib/aws-ecr");
const iam = require("aws-cdk-lib/aws-iam");
const logs = require("aws-cdk-lib/aws-logs");
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
class EcsStack extends cdk.Stack {
    /** The ECS cluster */
    cluster;
    /** The ECR repository */
    repository;
    /** The Application Load Balancer */
    alb;
    /** The ECS service */
    service;
    /** The ALB DNS name */
    albDnsName;
    constructor(scope, id, props) {
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
        taskExecutionRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['secretsmanager:GetSecretValue'],
            resources: [databaseSecretArn, `${databaseSecretArn}-??????`], // Include auto-generated suffix
        }));
        // ── IAM Task Role ────────────────────────────────────────────────────────
        //
        // Role used by application code to access AWS services.
        const taskRole = new iam.Role(this, 'TaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        });
        // Grant S3 access for invoice uploads
        taskRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
            resources: [
                `arn:aws:s3:::fcc-invoices-${envName}`,
                `arn:aws:s3:::fcc-invoices-${envName}/*`,
            ],
        }));
        // Grant SQS access for async jobs
        taskRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'sqs:SendMessage',
                'sqs:ReceiveMessage',
                'sqs:DeleteMessage',
                'sqs:GetQueueUrl',
                'sqs:GetQueueAttributes',
            ],
            resources: [`arn:aws:sqs:${this.region}:${this.account}:fcc-*-${envName}`],
        }));
        // Grant Cognito access for user management
        taskRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'cognito-idp:AdminGetUser',
                'cognito-idp:AdminUpdateUserAttributes',
                'cognito-idp:ListUsers',
            ],
            resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/*`],
        }));
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
                DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(cdk.aws_secretsmanager.Secret.fromSecretCompleteArn(this, 'DatabaseSecret', databaseSecretArn), 'password'),
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
exports.EcsStack = EcsStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiRWNzU3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9saWIvc3RhY2tzL0Vjc1N0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQywyQ0FBMkM7QUFDM0MsMkNBQTJDO0FBQzNDLGdFQUFnRTtBQUNoRSwyQ0FBMkM7QUFDM0MsMkNBQTJDO0FBQzNDLDZDQUE2QztBQWdDN0M7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FtQkc7QUFDSCxNQUFhLFFBQVMsU0FBUSxHQUFHLENBQUMsS0FBSztJQUNyQyxzQkFBc0I7SUFDTixPQUFPLENBQWM7SUFFckMseUJBQXlCO0lBQ1QsVUFBVSxDQUFpQjtJQUUzQyxvQ0FBb0M7SUFDcEIsR0FBRyxDQUFnQztJQUVuRCxzQkFBc0I7SUFDTixPQUFPLENBQXFCO0lBRTVDLHVCQUF1QjtJQUNQLFVBQVUsQ0FBUztJQUVuQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQW9CO1FBQzVELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sRUFBRSxPQUFPLEVBQUUsR0FBRyxFQUFFLGdCQUFnQixFQUFFLGdCQUFnQixFQUFFLGdCQUFnQixFQUFFLGlCQUFpQixFQUFFLGFBQWEsRUFBRSxpQkFBaUIsRUFBRSxlQUFlLEVBQUUsR0FBRyxLQUFLLENBQUM7UUFFM0osNEVBQTRFO1FBQzVFLEVBQUU7UUFDRiw4REFBOEQ7UUFDOUQsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUN2RCxjQUFjLEVBQUUsd0JBQXdCLE9BQU8sRUFBRTtZQUNqRCxlQUFlLEVBQUUsSUFBSTtZQUNyQixVQUFVLEVBQUUsR0FBRyxDQUFDLG9CQUFvQixDQUFDLE9BQU87WUFDNUMsYUFBYSxFQUFFLE9BQU8sS0FBSyxNQUFNLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FB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LEdBQUcsQ0FBQyxtQkFBbUIsRUFBRTtZQUMvQyxXQUFXLEVBQUUsK0JBQStCO1NBQzdDLENBQUMsQ0FBQztRQUVILDRFQUE0RTtRQUM1RSxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsV0FBVyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQzFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxZQUFZLEVBQUUsU0FBUyxDQUFDLENBQUM7SUFDakQsQ0FBQztDQUNGO0FBcFNELDRCQW9TQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgKiBhcyBlY3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcyc7XG5pbXBvcnQgKiBhcyBlbGJ2MiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWxhc3RpY2xvYWRiYWxhbmNpbmd2Mic7XG5pbXBvcnQgKiBhcyBlY3IgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcic7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEVjc1N0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIC8qKiBMb2dpY2FsIGVudmlyb25tZW50IG5hbWUsIGUuZy4gXCJzdGFnaW5nXCIgb3IgXCJwcm9kXCIgKi9cbiAgcmVhZG9ubHkgZW52TmFtZTogc3RyaW5nO1xuXG4gIC8qKiBWUEMgd2hlcmUgRUNTIHdpbGwgYmUgZGVwbG95ZWQgKi9cbiAgcmVhZG9ubHkgdnBjOiBlYzIuSVZwYztcblxuICAvKiogU2VjdXJpdHkgZ3JvdXAgZm9yIEVDUyB0YXNrcyAqL1xuICByZWFkb25seSBlY3NTZWN1cml0eUdyb3VwOiBlYzIuSVNlY3VyaXR5R3JvdXA7XG5cbiAgLyoqIFNlY3VyaXR5IGdyb3VwIGZvciBBTEIgKi9cbiAgcmVhZG9ubHkgYWxiU2VjdXJpdHlHcm91cDogZWMyLklTZWN1cml0eUdyb3VwO1xuXG4gIC8qKiBEYXRhYmFzZSBlbmRwb2ludCAoUkRTIG9yIEF1cm9yYSkgKi9cbiAgcmVhZG9ubHkgZGF0YWJhc2VFbmRwb2ludDogc3RyaW5nO1xuXG4gIC8qKiBEYXRhYmFzZSBzZWNyZXQgQVJOICovXG4gIHJlYWRvbmx5IGRhdGFiYXNlU2VjcmV0QXJuOiBzdHJpbmc7XG5cbiAgLyoqIFJlZGlzIGVuZHBvaW50IChFbGFzdGlDYWNoZSkgKi9cbiAgcmVhZG9ubHkgcmVkaXNFbmRwb2ludDogc3RyaW5nO1xuXG4gIC8qKiBDb2duaXRvIFVzZXIgUG9vbCBJRCAqL1xuICByZWFkb25seSBjb2duaXRvVXNlclBvb2xJZDogc3RyaW5nO1xuXG4gIC8qKiBDb2duaXRvIENsaWVudCBJRCAqL1xuICByZWFkb25seSBjb2duaXRvQ2xpZW50SWQ6IHN0cmluZztcbn1cblxuLyoqXG4gKiBFY3NTdGFja1xuICpcbiAqIENvc3Qtb3B0aW1pemVkIGNvbXB1dGUgc3RhY2sgdXNpbmcgRUNTIEZhcmdhdGUgaW5zdGVhZCBvZiBFS1M6XG4gKlxuICogIOKAoiBFQ1MgQ2x1c3RlciB3aXRoIEZhcmdhdGUgY2FwYWNpdHkgcHJvdmlkZXJcbiAqICDigKIgRUNSIHJlcG9zaXRvcnkgZm9yIERvY2tlciBpbWFnZXNcbiAqICDigKIgQXBwbGljYXRpb24gTG9hZCBCYWxhbmNlciAocHVibGljIHN1Ym5ldHMpXG4gKiAg4oCiIEVDUyBTZXJ2aWNlIHdpdGggRmFyZ2F0ZSB0YXNrcyAocHJpdmF0ZSBzdWJuZXRzKVxuICogIOKAoiBBdXRvLXNjYWxpbmcgYmFzZWQgb24gQ1BVL21lbW9yeVxuICogIOKAoiBJQU0gdGFzayByb2xlcyB3aXRoIGxlYXN0IHByaXZpbGVnZVxuICogIOKAoiBDbG91ZFdhdGNoIExvZ3MgaW50ZWdyYXRpb25cbiAqXG4gKiBDb3N0IHNhdmluZ3MgdnMgRUtTOlxuICogIC0gTm8gJDcyL21vbnRoIGNvbnRyb2wgcGxhbmUgZmVlXG4gKiAgLSBQYXkgb25seSBmb3IgdGFzayBDUFUvbWVtb3J5IChub3QgaWRsZSBub2RlcylcbiAqICAtIEF1dG9tYXRpYyBjYXBhY2l0eSBtYW5hZ2VtZW50XG4gKlxuICogRXhwZWN0ZWQgY29zdDogJDQ1LTkwL21vbnRoIGZvciAyIHRhc2tzXG4gKi9cbmV4cG9ydCBjbGFzcyBFY3NTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIC8qKiBUaGUgRUNTIGNsdXN0ZXIgKi9cbiAgcHVibGljIHJlYWRvbmx5IGNsdXN0ZXI6IGVjcy5DbHVzdGVyO1xuXG4gIC8qKiBUaGUgRUNSIHJlcG9zaXRvcnkgKi9cbiAgcHVibGljIHJlYWRvbmx5IHJlcG9zaXRvcnk6IGVjci5SZXBvc2l0b3J5O1xuXG4gIC8qKiBUaGUgQXBwbGljYXRpb24gTG9hZCBCYWxhbmNlciAqL1xuICBwdWJsaWMgcmVhZG9ubHkgYWxiOiBlbGJ2Mi5BcHBsaWNhdGlvbkxvYWRCYWxhbmNlcjtcblxuICAvKiogVGhlIEVDUyBzZXJ2aWNlICovXG4gIHB1YmxpYyByZWFkb25seSBzZXJ2aWNlOiBlY3MuRmFyZ2F0ZVNlcnZpY2U7XG5cbiAgLyoqIFRoZSBBTEIgRE5TIG5hbWUgKi9cbiAgcHVibGljIHJlYWRvbmx5IGFsYkRuc05hbWU6IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogRWNzU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgeyBlbnZOYW1lLCB2cGMsIGVjc1NlY3VyaXR5R3JvdXAsIGFsYlNlY3VyaXR5R3JvdXAsIGRhdGFiYXNlRW5kcG9pbnQsIGRhdGFiYXNlU2VjcmV0QXJuLCByZWRpc0VuZHBvaW50LCBjb2duaXRvVXNlclBvb2xJZCwgY29nbml0b0NsaWVudElkIH0gPSBwcm9wcztcblxuICAgIC8vIOKUgOKUgCBFQ1IgUmVwb3NpdG9yeSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvL1xuICAgIC8vIFN0b3JlIERvY2tlciBpbWFnZXMgd2l0aCBhdXRvbWF0aWMgc2Nhbm5pbmcgYW5kIGVuY3J5cHRpb24uXG4gICAgdGhpcy5yZXBvc2l0b3J5ID0gbmV3IGVjci5SZXBvc2l0b3J5KHRoaXMsICdSZXBvc2l0b3J5Jywge1xuICAgICAgcmVwb3NpdG9yeU5hbWU6IGBmb29kLWNvc3QtY2FsY3VsYXRvci0ke2Vudk5hbWV9YCxcbiAgICAgIGltYWdlU2Nhbk9uUHVzaDogdHJ1ZSxcbiAgICAgIGVuY3J5cHRpb246IGVjci5SZXBvc2l0b3J5RW5jcnlwdGlvbi5BRVNfMjU2LFxuICAgICAgcmVtb3ZhbFBvbGljeTogZW52TmFtZSA9PT0gJ3Byb2QnID8gY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOIDogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ0tlZXAgbGFzdCAxMCBpbWFnZXMnLFxuICAgICAgICAgIG1heEltYWdlQ291bnQ6IDEwLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCBFQ1MgQ2x1c3RlciDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvL1xuICAgIC8vIEZhcmdhdGUtYmFzZWQgY2x1c3RlciAobm8gRUMyIGluc3RhbmNlcyB0byBtYW5hZ2UpLlxuICAgIHRoaXMuY2x1c3RlciA9IG5ldyBlY3MuQ2x1c3Rlcih0aGlzLCAnQ2x1c3RlcicsIHtcbiAgICAgIGNsdXN0ZXJOYW1lOiBgZm9vZGNvc3QtJHtlbnZOYW1lfWAsXG4gICAgICB2cGMsXG4gICAgICBjb250YWluZXJJbnNpZ2h0czogdHJ1ZSwgLy8gQ2xvdWRXYXRjaCBDb250YWluZXIgSW5zaWdodHNcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCBBcHBsaWNhdGlvbiBMb2FkIEJhbGFuY2VyIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vXG4gICAgLy8gSW50ZXJuZXQtZmFjaW5nIEFMQiBpbiBwdWJsaWMgc3VibmV0cy5cbiAgICB0aGlzLmFsYiA9IG5ldyBlbGJ2Mi5BcHBsaWNhdGlvbkxvYWRCYWxhbmNlcih0aGlzLCAnQUxCJywge1xuICAgICAgdnBjLFxuICAgICAgaW50ZXJuZXRGYWNpbmc6IHRydWUsXG4gICAgICBzZWN1cml0eUdyb3VwOiBhbGJTZWN1cml0eUdyb3VwLFxuICAgICAgdnBjU3VibmV0czogdnBjLnNlbGVjdFN1Ym5ldHMoe1xuICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QVUJMSUMsXG4gICAgICB9KSxcbiAgICAgIGxvYWRCYWxhbmNlck5hbWU6IGBmb29kY29zdC1hbGItJHtlbnZOYW1lfWAsXG4gICAgfSk7XG5cbiAgICB0aGlzLmFsYkRuc05hbWUgPSB0aGlzLmFsYi5sb2FkQmFsYW5jZXJEbnNOYW1lO1xuXG4gICAgLy8g4pSA4pSAIElBTSBUYXNrIEV4ZWN1dGlvbiBSb2xlIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vXG4gICAgLy8gUm9sZSB1c2VkIGJ5IEVDUyBhZ2VudCB0byBwdWxsIGltYWdlcywgd3JpdGUgbG9ncywgcmVhZCBzZWNyZXRzLlxuICAgIGNvbnN0IHRhc2tFeGVjdXRpb25Sb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdUYXNrRXhlY3V0aW9uUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdlY3MtdGFza3MuYW1hem9uYXdzLmNvbScpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FtYXpvbkVDU1Rhc2tFeGVjdXRpb25Sb2xlUG9saWN5JyksXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gR3JhbnQgYWNjZXNzIHRvIFNlY3JldHMgTWFuYWdlciBmb3IgZGF0YWJhc2UgY3JlZGVudGlhbHNcbiAgICB0YXNrRXhlY3V0aW9uUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ3NlY3JldHNtYW5hZ2VyOkdldFNlY3JldFZhbHVlJ10sXG4gICAgICAgIHJlc291cmNlczogW2RhdGFiYXNlU2VjcmV0QXJuLCBgJHtkYXRhYmFzZVNlY3JldEFybn0tPz8/Pz8/YF0sIC8vIEluY2x1ZGUgYXV0by1nZW5lcmF0ZWQgc3VmZml4XG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgLy8g4pSA4pSAIElBTSBUYXNrIFJvbGUg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBSb2xlIHVzZWQgYnkgYXBwbGljYXRpb24gY29kZSB0byBhY2Nlc3MgQVdTIHNlcnZpY2VzLlxuICAgIGNvbnN0IHRhc2tSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdUYXNrUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdlY3MtdGFza3MuYW1hem9uYXdzLmNvbScpLFxuICAgIH0pO1xuXG4gICAgLy8gR3JhbnQgUzMgYWNjZXNzIGZvciBpbnZvaWNlIHVwbG9hZHNcbiAgICB0YXNrUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ3MzOkdldE9iamVjdCcsICdzMzpQdXRPYmplY3QnLCAnczM6TGlzdEJ1Y2tldCddLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpzMzo6OmZjYy1pbnZvaWNlcy0ke2Vudk5hbWV9YCxcbiAgICAgICAgICBgYXJuOmF3czpzMzo6OmZjYy1pbnZvaWNlcy0ke2Vudk5hbWV9LypgLFxuICAgICAgICBdLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIC8vIEdyYW50IFNRUyBhY2Nlc3MgZm9yIGFzeW5jIGpvYnNcbiAgICB0YXNrUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgJ3NxczpTZW5kTWVzc2FnZScsXG4gICAgICAgICAgJ3NxczpSZWNlaXZlTWVzc2FnZScsXG4gICAgICAgICAgJ3NxczpEZWxldGVNZXNzYWdlJyxcbiAgICAgICAgICAnc3FzOkdldFF1ZXVlVXJsJyxcbiAgICAgICAgICAnc3FzOkdldFF1ZXVlQXR0cmlidXRlcycsXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOnNxczoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06ZmNjLSotJHtlbnZOYW1lfWBdLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIC8vIEdyYW50IENvZ25pdG8gYWNjZXNzIGZvciB1c2VyIG1hbmFnZW1lbnRcbiAgICB0YXNrUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgJ2NvZ25pdG8taWRwOkFkbWluR2V0VXNlcicsXG4gICAgICAgICAgJ2NvZ25pdG8taWRwOkFkbWluVXBkYXRlVXNlckF0dHJpYnV0ZXMnLFxuICAgICAgICAgICdjb2duaXRvLWlkcDpMaXN0VXNlcnMnLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpjb2duaXRvLWlkcDoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dXNlcnBvb2wvKmBdLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIC8vIOKUgOKUgCBDbG91ZFdhdGNoIExvZ3Mg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgY29uc3QgbG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnTG9nR3JvdXAnLCB7XG4gICAgICBsb2dHcm91cE5hbWU6IGAvZWNzL2Zvb2Rjb3N0LWFwaS0ke2Vudk5hbWV9YCxcbiAgICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLCAvLyBDb3N0IG9wdGltaXphdGlvblxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCBUYXNrIERlZmluaXRpb24g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBGYXJnYXRlIHRhc2s6IDEgdkNQVSwgMiBHQiBSQU0gKHN1ZmZpY2llbnQgZm9yIFNwcmluZyBCb290KVxuICAgIGNvbnN0IHRhc2tEZWZpbml0aW9uID0gbmV3IGVjcy5GYXJnYXRlVGFza0RlZmluaXRpb24odGhpcywgJ1Rhc2tEZWZpbml0aW9uJywge1xuICAgICAgZmFtaWx5OiBgZm9vZGNvc3QtYXBpLSR7ZW52TmFtZX1gLFxuICAgICAgY3B1OiAxMDI0LCAvLyAxIHZDUFVcbiAgICAgIG1lbW9yeUxpbWl0TWlCOiAyMDQ4LCAvLyAyIEdCXG4gICAgICBleGVjdXRpb25Sb2xlOiB0YXNrRXhlY3V0aW9uUm9sZSxcbiAgICAgIHRhc2tSb2xlLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIGNvbnRhaW5lclxuICAgIGNvbnN0IGNvbnRhaW5lciA9IHRhc2tEZWZpbml0aW9uLmFkZENvbnRhaW5lcignYXBpJywge1xuICAgICAgY29udGFpbmVyTmFtZTogJ2FwaScsXG4gICAgICBpbWFnZTogZWNzLkNvbnRhaW5lckltYWdlLmZyb21FY3JSZXBvc2l0b3J5KHRoaXMucmVwb3NpdG9yeSwgJ2xhdGVzdCcpLFxuICAgICAgbG9nZ2luZzogZWNzLkxvZ0RyaXZlcnMuYXdzTG9ncyh7XG4gICAgICAgIHN0cmVhbVByZWZpeDogJ2VjcycsXG4gICAgICAgIGxvZ0dyb3VwLFxuICAgICAgfSksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBTUFJJTkdfUFJPRklMRVNfQUNUSVZFOiAncHJvZHVjdGlvbicsXG4gICAgICAgIERBVEFCQVNFX1VSTDogYGpkYmM6cG9zdGdyZXNxbDovLyR7ZGF0YWJhc2VFbmRwb2ludH0vZm9vZGNvc3RgLFxuICAgICAgICBEQVRBQkFTRV9VU0VSTkFNRTogJ3Bvc3RncmVzJyxcbiAgICAgICAgUkVESVNfSE9TVDogcmVkaXNFbmRwb2ludCxcbiAgICAgICAgUkVESVNfUE9SVDogJzYzNzknLFxuICAgICAgICBBV1NfUkVHSU9OOiB0aGlzLnJlZ2lvbixcbiAgICAgICAgQ09HTklUT19VU0VSX1BPT0xfSUQ6IGNvZ25pdG9Vc2VyUG9vbElkLFxuICAgICAgICBDT0dOSVRPX0NMSUVOVF9JRDogY29nbml0b0NsaWVudElkLFxuICAgICAgfSxcbiAgICAgIHNlY3JldHM6IHtcbiAgICAgICAgREFUQUJBU0VfUEFTU1dPUkQ6IGVjcy5TZWNyZXQuZnJvbVNlY3JldHNNYW5hZ2VyKFxuICAgICAgICAgIGNkay5hd3Nfc2VjcmV0c21hbmFnZXIuU2VjcmV0LmZyb21TZWNyZXRDb21wbGV0ZUFybih0aGlzLCAnRGF0YWJhc2VTZWNyZXQnLCBkYXRhYmFzZVNlY3JldEFybiksXG4gICAgICAgICAgJ3Bhc3N3b3JkJyxcbiAgICAgICAgKSxcbiAgICAgIH0sXG4gICAgICBoZWFsdGhDaGVjazoge1xuICAgICAgICBjb21tYW5kOiBbJ0NNRC1TSEVMTCcsICdjdXJsIC1mIGh0dHA6Ly9sb2NhbGhvc3Q6ODA4MC9hY3R1YXRvci9oZWFsdGggfHwgZXhpdCAxJ10sXG4gICAgICAgIGludGVydmFsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDUpLFxuICAgICAgICByZXRyaWVzOiAzLFxuICAgICAgICBzdGFydFBlcmlvZDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNjApLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGNvbnRhaW5lci5hZGRQb3J0TWFwcGluZ3Moe1xuICAgICAgY29udGFpbmVyUG9ydDogODA4MCxcbiAgICAgIHByb3RvY29sOiBlY3MuUHJvdG9jb2wuVENQLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSAIEVDUyBTZXJ2aWNlIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vXG4gICAgLy8gRmFyZ2F0ZSBzZXJ2aWNlIHdpdGggYXV0by1zY2FsaW5nICgxLTQgdGFza3MpXG4gICAgdGhpcy5zZXJ2aWNlID0gbmV3IGVjcy5GYXJnYXRlU2VydmljZSh0aGlzLCAnU2VydmljZScsIHtcbiAgICAgIGNsdXN0ZXI6IHRoaXMuY2x1c3RlcixcbiAgICAgIHRhc2tEZWZpbml0aW9uLFxuICAgICAgc2VydmljZU5hbWU6IGBmb29kY29zdC1hcGktJHtlbnZOYW1lfWAsXG4gICAgICBkZXNpcmVkQ291bnQ6IDIsIC8vIFN0YXJ0IHdpdGggMiBmb3IgSEFcbiAgICAgIG1pbkhlYWx0aHlQZXJjZW50OiA1MCxcbiAgICAgIG1heEhlYWx0aHlQZXJjZW50OiAyMDAsXG4gICAgICB2cGNTdWJuZXRzOiB2cGMuc2VsZWN0U3VibmV0cyh7XG4gICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MsXG4gICAgICB9KSxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbZWNzU2VjdXJpdHlHcm91cF0sXG4gICAgICBhc3NpZ25QdWJsaWNJcDogZmFsc2UsXG4gICAgICBoZWFsdGhDaGVja0dyYWNlUGVyaW9kOiBjZGsuRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgQXV0byBTY2FsaW5nIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIGNvbnN0IHNjYWxpbmcgPSB0aGlzLnNlcnZpY2UuYXV0b1NjYWxlVGFza0NvdW50KHtcbiAgICAgIG1pbkNhcGFjaXR5OiAxLFxuICAgICAgbWF4Q2FwYWNpdHk6IDQsXG4gICAgfSk7XG5cbiAgICAvLyBTY2FsZSBvbiBDUFUgdXRpbGl6YXRpb25cbiAgICBzY2FsaW5nLnNjYWxlT25DcHVVdGlsaXphdGlvbignQ3B1U2NhbGluZycsIHtcbiAgICAgIHRhcmdldFV0aWxpemF0aW9uUGVyY2VudDogNzAsXG4gICAgICBzY2FsZUluQ29vbGRvd246IGNkay5EdXJhdGlvbi5zZWNvbmRzKDYwKSxcbiAgICAgIHNjYWxlT3V0Q29vbGRvd246IGNkay5EdXJhdGlvbi5zZWNvbmRzKDYwKSxcbiAgICB9KTtcblxuICAgIC8vIFNjYWxlIG9uIG1lbW9yeSB1dGlsaXphdGlvblxuICAgIHNjYWxpbmcuc2NhbGVPbk1lbW9yeVV0aWxpemF0aW9uKCdNZW1vcnlTY2FsaW5nJywge1xuICAgICAgdGFyZ2V0VXRpbGl6YXRpb25QZXJjZW50OiA4MCxcbiAgICAgIHNjYWxlSW5Db29sZG93bjogY2RrLkR1cmF0aW9uLnNlY29uZHMoNjApLFxuICAgICAgc2NhbGVPdXRDb29sZG93bjogY2RrLkR1cmF0aW9uLnNlY29uZHMoNjApLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSAIEFMQiBUYXJnZXQgR3JvdXAg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgY29uc3QgdGFyZ2V0R3JvdXAgPSBuZXcgZWxidjIuQXBwbGljYXRpb25UYXJnZXRHcm91cCh0aGlzLCAnVGFyZ2V0R3JvdXAnLCB7XG4gICAgICB2cGMsXG4gICAgICBwb3J0OiA4MDgwLFxuICAgICAgcHJvdG9jb2w6IGVsYnYyLkFwcGxpY2F0aW9uUHJvdG9jb2wuSFRUUCxcbiAgICAgIHRhcmdldFR5cGU6IGVsYnYyLlRhcmdldFR5cGUuSVAsXG4gICAgICBoZWFsdGhDaGVjazoge1xuICAgICAgICBwYXRoOiAnL2FjdHVhdG9yL2hlYWx0aCcsXG4gICAgICAgIGludGVydmFsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDUpLFxuICAgICAgICBoZWFsdGh5VGhyZXNob2xkQ291bnQ6IDIsXG4gICAgICAgIHVuaGVhbHRoeVRocmVzaG9sZENvdW50OiAzLFxuICAgICAgICBoZWFsdGh5SHR0cENvZGVzOiAnMjAwJyxcbiAgICAgIH0sXG4gICAgICBkZXJlZ2lzdHJhdGlvbkRlbGF5OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgfSk7XG5cbiAgICAvLyBSZWdpc3RlciBFQ1Mgc2VydmljZSB3aXRoIHRhcmdldCBncm91cFxuICAgIHRoaXMuc2VydmljZS5hdHRhY2hUb0FwcGxpY2F0aW9uVGFyZ2V0R3JvdXAodGFyZ2V0R3JvdXApO1xuXG4gICAgLy8g4pSA4pSAIEFMQiBMaXN0ZW5lciDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvL1xuICAgIC8vIEhUVFAgbGlzdGVuZXIgKHBvcnQgODApIC0gcmVkaXJlY3QgdG8gSFRUUFMgaW4gcHJvZHVjdGlvblxuICAgIGNvbnN0IGxpc3RlbmVyID0gdGhpcy5hbGIuYWRkTGlzdGVuZXIoJ0h0dHBMaXN0ZW5lcicsIHtcbiAgICAgIHBvcnQ6IDgwLFxuICAgICAgcHJvdG9jb2w6IGVsYnYyLkFwcGxpY2F0aW9uUHJvdG9jb2wuSFRUUCxcbiAgICAgIGRlZmF1bHRBY3Rpb246IGVsYnYyLkxpc3RlbmVyQWN0aW9uLmZvcndhcmQoW3RhcmdldEdyb3VwXSksXG4gICAgfSk7XG5cbiAgICAvLyBUT0RPOiBBZGQgSFRUUFMgbGlzdGVuZXIgd2hlbiBTU0wgY2VydGlmaWNhdGUgaXMgYXZhaWxhYmxlXG4gICAgLy8gY29uc3QgaHR0cHNMaXN0ZW5lciA9IHRoaXMuYWxiLmFkZExpc3RlbmVyKCdIdHRwc0xpc3RlbmVyJywge1xuICAgIC8vICAgcG9ydDogNDQzLFxuICAgIC8vICAgcHJvdG9jb2w6IGVsYnYyLkFwcGxpY2F0aW9uUHJvdG9jb2wuSFRUUFMsXG4gICAgLy8gICBjZXJ0aWZpY2F0ZXM6IFtjZXJ0aWZpY2F0ZV0sXG4gICAgLy8gICBkZWZhdWx0QWN0aW9uOiBlbGJ2Mi5MaXN0ZW5lckFjdGlvbi5mb3J3YXJkKFt0YXJnZXRHcm91cF0pLFxuICAgIC8vIH0pO1xuXG4gICAgLy8g4pSA4pSAIENsb3VkRm9ybWF0aW9uIE91dHB1dHMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1JlcG9zaXRvcnlVcmknLCB7XG4gICAgICB2YWx1ZTogdGhpcy5yZXBvc2l0b3J5LnJlcG9zaXRvcnlVcmksXG4gICAgICBkZXNjcmlwdGlvbjogJ0VDUiByZXBvc2l0b3J5IFVSSSBmb3IgRG9ja2VyIGltYWdlcycsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tUmVwb3NpdG9yeVVyaWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ2x1c3Rlck5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5jbHVzdGVyLmNsdXN0ZXJOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdFQ1MgY2x1c3RlciBuYW1lJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1FY3NDbHVzdGVyTmFtZWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU2VydmljZU5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5zZXJ2aWNlLnNlcnZpY2VOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdFQ1Mgc2VydmljZSBuYW1lJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1FY3NTZXJ2aWNlTmFtZWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTG9hZEJhbGFuY2VyRE5TJywge1xuICAgICAgdmFsdWU6IHRoaXMuYWxiLmxvYWRCYWxhbmNlckRuc05hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FwcGxpY2F0aW9uIExvYWQgQmFsYW5jZXIgRE5TIG5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LUFsYkRuc2AsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTG9hZEJhbGFuY2VyVXJsJywge1xuICAgICAgdmFsdWU6IGBodHRwOi8vJHt0aGlzLmFsYi5sb2FkQmFsYW5jZXJEbnNOYW1lfWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FwcGxpY2F0aW9uIExvYWQgQmFsYW5jZXIgVVJMJyxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCBUYWdzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnQ29tcG9uZW50JywgJ0VDUycpO1xuICAgIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnQ29zdENlbnRlcicsICdDb21wdXRlJyk7XG4gIH1cbn1cbiJdfQ==