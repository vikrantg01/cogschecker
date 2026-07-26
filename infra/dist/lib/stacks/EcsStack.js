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
const s3 = require("aws-cdk-lib/aws-s3");
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
    /** S3 bucket for ALB access logs */
    albLogsBucket;
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
        taskExecutionRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['secretsmanager:GetSecretValue'],
            resources: [databaseSecretArn, `${databaseSecretArn}-??????`], // Include auto-generated suffix
        }));
        // ── IAM Task Role ────────────────────────────────────────────────────────
        //
        // Role used by application code to access AWS services.
        // Follows least-privilege principle with specific resource ARNs.
        const taskRole = new iam.Role(this, 'TaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        });
        // Grant S3 access for invoice uploads (least-privilege: specific bucket only)
        taskRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
            resources: [
                `arn:aws:s3:::fcc-invoices-${envName}`,
                `arn:aws:s3:::fcc-invoices-${envName}/*`,
            ],
        }));
        // Grant Cognito access for user attribute read (least-privilege: specific User Pool only)
        const userPoolArn = `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${cognitoUserPoolId}`;
        taskRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'cognito-idp:AdminGetUser',
                'cognito-idp:AdminUpdateUserAttributes',
                'cognito-idp:ListUsers',
            ],
            resources: [userPoolArn],
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
            healthCheckGracePeriod: cdk.Duration.seconds(60),
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
exports.EcsStack = EcsStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiRWNzU3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9saWIvc3RhY2tzL0Vjc1N0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQywyQ0FBMkM7QUFDM0MsMkNBQTJDO0FBQzNDLGdFQUFnRTtBQUNoRSwyQ0FBMkM7QUFDM0MsMkNBQTJDO0FBQzNDLDZDQUE2QztBQUM3Qyx5Q0FBeUM7QUFnQ3pDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBbUJHO0FBQ0gsTUFBYSxRQUFTLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDckMsc0JBQXNCO0lBQ04sT0FBTyxDQUFjO0lBRXJDLHlCQUF5QjtJQUNULFVBQVUsQ0FBaUI7SUFFM0Msb0NBQW9DO0lBQ3BCLEdBQUcsQ0FBZ0M7SUFFbkQsc0JBQXNCO0lBQ04sT0FBTyxDQUFxQjtJQUU1Qyx1QkFBdUI7SUFDUCxVQUFVLENBQVM7SUFFbkMsb0NBQW9DO0lBQ3BCLGFBQWEsQ0FBWTtJQUV6QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQW9CO1FBQzVELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sRUFBRSxPQUFPLEVBQUUsR0FBRyxFQUFFLGdCQUFnQixFQUFFLGdCQUFnQixFQUFFLGdCQUFnQixFQUFFLGlCQUFpQixFQUFFLGFBQWEsRUFBRSxpQkFBaUIsRUFBRSxlQUFlLEVBQUUsR0FBRyxLQUFLLENBQUM7UUFFM0osNEVBQTRFO1FBQzVFLEVBQUU7UUFDRiw4REFBOEQ7UUFDOUQsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUN2RCxjQUFjLEVBQUUsd0JBQXdCLE9BQU8sRUFBRTtZQUNqRCxlQUFlLEVBQUUsSUFBSTtZQUNyQixVQUFVLEVBQUUsR0FBRyxDQUFDLG9CQUFvQixDQUFDLE9BQU87WUFDNUMsYUFBYSxF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QUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsWUFBWSxFQUFFLFNBQVMsQ0FBQyxDQUFDO0lBQ2pELENBQUM7Q0FDRjtBQWhVRCw0QkFnVUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0ICogYXMgZWNzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3MnO1xuaW1wb3J0ICogYXMgZWxidjIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVsYXN0aWNsb2FkYmFsYW5jaW5ndjInO1xuaW1wb3J0ICogYXMgZWNyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3InO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRWNzU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgLyoqIExvZ2ljYWwgZW52aXJvbm1lbnQgbmFtZSwgZS5nLiBcInN0YWdpbmdcIiBvciBcInByb2RcIiAqL1xuICByZWFkb25seSBlbnZOYW1lOiBzdHJpbmc7XG5cbiAgLyoqIFZQQyB3aGVyZSBFQ1Mgd2lsbCBiZSBkZXBsb3llZCAqL1xuICByZWFkb25seSB2cGM6IGVjMi5JVnBjO1xuXG4gIC8qKiBTZWN1cml0eSBncm91cCBmb3IgRUNTIHRhc2tzICovXG4gIHJlYWRvbmx5IGVjc1NlY3VyaXR5R3JvdXA6IGVjMi5JU2VjdXJpdHlHcm91cDtcblxuICAvKiogU2VjdXJpdHkgZ3JvdXAgZm9yIEFMQiAqL1xuICByZWFkb25seSBhbGJTZWN1cml0eUdyb3VwOiBlYzIuSVNlY3VyaXR5R3JvdXA7XG5cbiAgLyoqIERhdGFiYXNlIGVuZHBvaW50IChSRFMgb3IgQXVyb3JhKSAqL1xuICByZWFkb25seSBkYXRhYmFzZUVuZHBvaW50OiBzdHJpbmc7XG5cbiAgLyoqIERhdGFiYXNlIHNlY3JldCBBUk4gKi9cbiAgcmVhZG9ubHkgZGF0YWJhc2VTZWNyZXRBcm46IHN0cmluZztcblxuICAvKiogUmVkaXMgZW5kcG9pbnQgKEVsYXN0aUNhY2hlKSAqL1xuICByZWFkb25seSByZWRpc0VuZHBvaW50OiBzdHJpbmc7XG5cbiAgLyoqIENvZ25pdG8gVXNlciBQb29sIElEICovXG4gIHJlYWRvbmx5IGNvZ25pdG9Vc2VyUG9vbElkOiBzdHJpbmc7XG5cbiAgLyoqIENvZ25pdG8gQ2xpZW50IElEICovXG4gIHJlYWRvbmx5IGNvZ25pdG9DbGllbnRJZDogc3RyaW5nO1xufVxuXG4vKipcbiAqIEVjc1N0YWNrXG4gKlxuICogQ29zdC1vcHRpbWl6ZWQgY29tcHV0ZSBzdGFjayB1c2luZyBFQ1MgRmFyZ2F0ZSBpbnN0ZWFkIG9mIEVLUzpcbiAqXG4gKiAg4oCiIEVDUyBDbHVzdGVyIHdpdGggRmFyZ2F0ZSBjYXBhY2l0eSBwcm92aWRlclxuICogIOKAoiBFQ1IgcmVwb3NpdG9yeSBmb3IgRG9ja2VyIGltYWdlc1xuICogIOKAoiBBcHBsaWNhdGlvbiBMb2FkIEJhbGFuY2VyIChwdWJsaWMgc3VibmV0cylcbiAqICDigKIgRUNTIFNlcnZpY2Ugd2l0aCBGYXJnYXRlIHRhc2tzIChwcml2YXRlIHN1Ym5ldHMpXG4gKiAg4oCiIEF1dG8tc2NhbGluZyBiYXNlZCBvbiBDUFUvbWVtb3J5XG4gKiAg4oCiIElBTSB0YXNrIHJvbGVzIHdpdGggbGVhc3QgcHJpdmlsZWdlXG4gKiAg4oCiIENsb3VkV2F0Y2ggTG9ncyBpbnRlZ3JhdGlvblxuICpcbiAqIENvc3Qgc2F2aW5ncyB2cyBFS1M6XG4gKiAgLSBObyAkNzIvbW9udGggY29udHJvbCBwbGFuZSBmZWVcbiAqICAtIFBheSBvbmx5IGZvciB0YXNrIENQVS9tZW1vcnkgKG5vdCBpZGxlIG5vZGVzKVxuICogIC0gQXV0b21hdGljIGNhcGFjaXR5IG1hbmFnZW1lbnRcbiAqXG4gKiBFeHBlY3RlZCBjb3N0OiAkNDUtOTAvbW9udGggZm9yIDIgdGFza3NcbiAqL1xuZXhwb3J0IGNsYXNzIEVjc1N0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgLyoqIFRoZSBFQ1MgY2x1c3RlciAqL1xuICBwdWJsaWMgcmVhZG9ubHkgY2x1c3RlcjogZWNzLkNsdXN0ZXI7XG5cbiAgLyoqIFRoZSBFQ1IgcmVwb3NpdG9yeSAqL1xuICBwdWJsaWMgcmVhZG9ubHkgcmVwb3NpdG9yeTogZWNyLlJlcG9zaXRvcnk7XG5cbiAgLyoqIFRoZSBBcHBsaWNhdGlvbiBMb2FkIEJhbGFuY2VyICovXG4gIHB1YmxpYyByZWFkb25seSBhbGI6IGVsYnYyLkFwcGxpY2F0aW9uTG9hZEJhbGFuY2VyO1xuXG4gIC8qKiBUaGUgRUNTIHNlcnZpY2UgKi9cbiAgcHVibGljIHJlYWRvbmx5IHNlcnZpY2U6IGVjcy5GYXJnYXRlU2VydmljZTtcblxuICAvKiogVGhlIEFMQiBETlMgbmFtZSAqL1xuICBwdWJsaWMgcmVhZG9ubHkgYWxiRG5zTmFtZTogc3RyaW5nO1xuXG4gIC8qKiBTMyBidWNrZXQgZm9yIEFMQiBhY2Nlc3MgbG9ncyAqL1xuICBwdWJsaWMgcmVhZG9ubHkgYWxiTG9nc0J1Y2tldDogczMuQnVja2V0O1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBFY3NTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7IGVudk5hbWUsIHZwYywgZWNzU2VjdXJpdHlHcm91cCwgYWxiU2VjdXJpdHlHcm91cCwgZGF0YWJhc2VFbmRwb2ludCwgZGF0YWJhc2VTZWNyZXRBcm4sIHJlZGlzRW5kcG9pbnQsIGNvZ25pdG9Vc2VyUG9vbElkLCBjb2duaXRvQ2xpZW50SWQgfSA9IHByb3BzO1xuXG4gICAgLy8g4pSA4pSAIEVDUiBSZXBvc2l0b3J5IOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vXG4gICAgLy8gU3RvcmUgRG9ja2VyIGltYWdlcyB3aXRoIGF1dG9tYXRpYyBzY2FubmluZyBhbmQgZW5jcnlwdGlvbi5cbiAgICB0aGlzLnJlcG9zaXRvcnkgPSBuZXcgZWNyLlJlcG9zaXRvcnkodGhpcywgJ1JlcG9zaXRvcnknLCB7XG4gICAgICByZXBvc2l0b3J5TmFtZTogYGZvb2QtY29zdC1jYWxjdWxhdG9yLSR7ZW52TmFtZX1gLFxuICAgICAgaW1hZ2VTY2FuT25QdXNoOiB0cnVlLFxuICAgICAgZW5jcnlwdGlvbjogZWNyLlJlcG9zaXRvcnlFbmNyeXB0aW9uLkFFU18yNTYsXG4gICAgICByZW1vdmFsUG9saWN5OiBlbnZOYW1lID09PSAncHJvZCcgPyBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4gOiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnS2VlcCBsYXN0IDEwIGltYWdlcycsXG4gICAgICAgICAgbWF4SW1hZ2VDb3VudDogMTAsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSAIEVDUyBDbHVzdGVyIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vXG4gICAgLy8gRmFyZ2F0ZS1iYXNlZCBjbHVzdGVyIChubyBFQzIgaW5zdGFuY2VzIHRvIG1hbmFnZSkuXG4gICAgdGhpcy5jbHVzdGVyID0gbmV3IGVjcy5DbHVzdGVyKHRoaXMsICdDbHVzdGVyJywge1xuICAgICAgY2x1c3Rlck5hbWU6IGBmb29kY29zdC0ke2Vudk5hbWV9YCxcbiAgICAgIHZwYyxcbiAgICAgIGNvbnRhaW5lckluc2lnaHRzOiB0cnVlLCAvLyBDbG91ZFdhdGNoIENvbnRhaW5lciBJbnNpZ2h0c1xuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSAIEFwcGxpY2F0aW9uIExvYWQgQmFsYW5jZXIg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBJbnRlcm5ldC1mYWNpbmcgQUxCIGluIHB1YmxpYyBzdWJuZXRzLlxuICAgIFxuICAgIC8vIENyZWF0ZSBTMyBidWNrZXQgZm9yIEFMQiBhY2Nlc3MgbG9nc1xuICAgIC8vIFJlcXVpcmVtZW50IDExLjg6IEFMQiBhY2Nlc3MgbG9ncyBmb3IgSFRUUCByZXF1ZXN0IGxvZ2dpbmdcbiAgICB0aGlzLmFsYkxvZ3NCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdBbGJMb2dzQnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogYGZjYy1hbGItbG9ncy0ke2Vudk5hbWV9YCxcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICBsaWZlY3ljbGVSdWxlczogW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdEZWxldGVPbGRMb2dzJyxcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIGV4cGlyYXRpb246IGNkay5EdXJhdGlvbi5kYXlzKDkwKSwgLy8gRGVsZXRlIGxvZ3MgYWZ0ZXIgOTAgZGF5cyBmb3IgY29zdCBvcHRpbWl6YXRpb25cbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICByZW1vdmFsUG9saWN5OiBlbnZOYW1lID09PSAncHJvZCcgPyBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4gOiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgYXV0b0RlbGV0ZU9iamVjdHM6IGVudk5hbWUgIT09ICdwcm9kJywgLy8gQXV0by1kZWxldGUgZm9yIG5vbi1wcm9kIGVudmlyb25tZW50c1xuICAgIH0pO1xuXG4gICAgdGhpcy5hbGIgPSBuZXcgZWxidjIuQXBwbGljYXRpb25Mb2FkQmFsYW5jZXIodGhpcywgJ0FMQicsIHtcbiAgICAgIHZwYyxcbiAgICAgIGludGVybmV0RmFjaW5nOiB0cnVlLFxuICAgICAgc2VjdXJpdHlHcm91cDogYWxiU2VjdXJpdHlHcm91cCxcbiAgICAgIHZwY1N1Ym5ldHM6IHZwYy5zZWxlY3RTdWJuZXRzKHtcbiAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFVCTElDLFxuICAgICAgfSksXG4gICAgICBsb2FkQmFsYW5jZXJOYW1lOiBgZm9vZGNvc3QtYWxiLSR7ZW52TmFtZX1gLFxuICAgIH0pO1xuXG4gICAgdGhpcy5hbGJEbnNOYW1lID0gdGhpcy5hbGIubG9hZEJhbGFuY2VyRG5zTmFtZTtcblxuICAgIC8vIEVuYWJsZSBBTEIgYWNjZXNzIGxvZ3MgdG8gUzNcbiAgICB0aGlzLmFsYi5sb2dBY2Nlc3NMb2dzKHRoaXMuYWxiTG9nc0J1Y2tldCk7XG5cbiAgICAvLyDilIDilIAgSUFNIFRhc2sgRXhlY3V0aW9uIFJvbGUg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBSb2xlIHVzZWQgYnkgRUNTIGFnZW50IHRvIHB1bGwgaW1hZ2VzLCB3cml0ZSBsb2dzLCByZWFkIHNlY3JldHMuXG4gICAgLy8gUGVybWlzc2lvbnM6XG4gICAgLy8gICAtIEVDUjogUHVsbCBEb2NrZXIgaW1hZ2VzIGZyb20gcmVwb3NpdG9yeVxuICAgIC8vICAgLSBDbG91ZFdhdGNoIExvZ3M6IFdyaXRlIGFwcGxpY2F0aW9uIGxvZ3NcbiAgICAvLyAgIC0gU2VjcmV0cyBNYW5hZ2VyOiBSZWFkIGRhdGFiYXNlIGNyZWRlbnRpYWxzXG4gICAgLy9cbiAgICAvLyBOb3RlOiBBbWF6b25FQ1NUYXNrRXhlY3V0aW9uUm9sZVBvbGljeSBpbmNsdWRlcyBFQ1IgcHVsbCBhbmQgQ2xvdWRXYXRjaCBMb2dzIHdyaXRlXG4gICAgY29uc3QgdGFza0V4ZWN1dGlvblJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1Rhc2tFeGVjdXRpb25Sb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2Vjcy10YXNrcy5hbWF6b25hd3MuY29tJyksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQW1hem9uRUNTVGFza0V4ZWN1dGlvblJvbGVQb2xpY3knKSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBhY2Nlc3MgdG8gU2VjcmV0cyBNYW5hZ2VyIGZvciBkYXRhYmFzZSBjcmVkZW50aWFscyAobGVhc3QtcHJpdmlsZWdlOiBzcGVjaWZpYyBzZWNyZXQgb25seSlcbiAgICB0YXNrRXhlY3V0aW9uUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ3NlY3JldHNtYW5hZ2VyOkdldFNlY3JldFZhbHVlJ10sXG4gICAgICAgIHJlc291cmNlczogW2RhdGFiYXNlU2VjcmV0QXJuLCBgJHtkYXRhYmFzZVNlY3JldEFybn0tPz8/Pz8/YF0sIC8vIEluY2x1ZGUgYXV0by1nZW5lcmF0ZWQgc3VmZml4XG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgLy8g4pSA4pSAIElBTSBUYXNrIFJvbGUg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBSb2xlIHVzZWQgYnkgYXBwbGljYXRpb24gY29kZSB0byBhY2Nlc3MgQVdTIHNlcnZpY2VzLlxuICAgIC8vIEZvbGxvd3MgbGVhc3QtcHJpdmlsZWdlIHByaW5jaXBsZSB3aXRoIHNwZWNpZmljIHJlc291cmNlIEFSTnMuXG4gICAgY29uc3QgdGFza1JvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1Rhc2tSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2Vjcy10YXNrcy5hbWF6b25hd3MuY29tJyksXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBTMyBhY2Nlc3MgZm9yIGludm9pY2UgdXBsb2FkcyAobGVhc3QtcHJpdmlsZWdlOiBzcGVjaWZpYyBidWNrZXQgb25seSlcbiAgICB0YXNrUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ3MzOkdldE9iamVjdCcsICdzMzpQdXRPYmplY3QnLCAnczM6TGlzdEJ1Y2tldCddLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpzMzo6OmZjYy1pbnZvaWNlcy0ke2Vudk5hbWV9YCxcbiAgICAgICAgICBgYXJuOmF3czpzMzo6OmZjYy1pbnZvaWNlcy0ke2Vudk5hbWV9LypgLFxuICAgICAgICBdLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIC8vIEdyYW50IENvZ25pdG8gYWNjZXNzIGZvciB1c2VyIGF0dHJpYnV0ZSByZWFkIChsZWFzdC1wcml2aWxlZ2U6IHNwZWNpZmljIFVzZXIgUG9vbCBvbmx5KVxuICAgIGNvbnN0IHVzZXJQb29sQXJuID0gYGFybjphd3M6Y29nbml0by1pZHA6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnVzZXJwb29sLyR7Y29nbml0b1VzZXJQb29sSWR9YDtcbiAgICB0YXNrUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgJ2NvZ25pdG8taWRwOkFkbWluR2V0VXNlcicsXG4gICAgICAgICAgJ2NvZ25pdG8taWRwOkFkbWluVXBkYXRlVXNlckF0dHJpYnV0ZXMnLFxuICAgICAgICAgICdjb2duaXRvLWlkcDpMaXN0VXNlcnMnLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFt1c2VyUG9vbEFybl0sXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgLy8g4pSA4pSAIENsb3VkV2F0Y2ggTG9ncyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBjb25zdCBsb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdMb2dHcm91cCcsIHtcbiAgICAgIGxvZ0dyb3VwTmFtZTogYC9lY3MvZm9vZGNvc3QtYXBpLSR7ZW52TmFtZX1gLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssIC8vIENvc3Qgb3B0aW1pemF0aW9uXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSAIFRhc2sgRGVmaW5pdGlvbiDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvL1xuICAgIC8vIEZhcmdhdGUgdGFzazogMSB2Q1BVLCAyIEdCIFJBTSAoc3VmZmljaWVudCBmb3IgU3ByaW5nIEJvb3QpXG4gICAgY29uc3QgdGFza0RlZmluaXRpb24gPSBuZXcgZWNzLkZhcmdhdGVUYXNrRGVmaW5pdGlvbih0aGlzLCAnVGFza0RlZmluaXRpb24nLCB7XG4gICAgICBmYW1pbHk6IGBmb29kY29zdC1hcGktJHtlbnZOYW1lfWAsXG4gICAgICBjcHU6IDEwMjQsIC8vIDEgdkNQVVxuICAgICAgbWVtb3J5TGltaXRNaUI6IDIwNDgsIC8vIDIgR0JcbiAgICAgIGV4ZWN1dGlvblJvbGU6IHRhc2tFeGVjdXRpb25Sb2xlLFxuICAgICAgdGFza1JvbGUsXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgY29udGFpbmVyXG4gICAgY29uc3QgY29udGFpbmVyID0gdGFza0RlZmluaXRpb24uYWRkQ29udGFpbmVyKCdhcGknLCB7XG4gICAgICBjb250YWluZXJOYW1lOiAnYXBpJyxcbiAgICAgIGltYWdlOiBlY3MuQ29udGFpbmVySW1hZ2UuZnJvbUVjclJlcG9zaXRvcnkodGhpcy5yZXBvc2l0b3J5LCAnbGF0ZXN0JyksXG4gICAgICBsb2dnaW5nOiBlY3MuTG9nRHJpdmVycy5hd3NMb2dzKHtcbiAgICAgICAgc3RyZWFtUHJlZml4OiAnZWNzJyxcbiAgICAgICAgbG9nR3JvdXAsXG4gICAgICB9KSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIFNQUklOR19QUk9GSUxFU19BQ1RJVkU6ICdwcm9kdWN0aW9uJyxcbiAgICAgICAgREFUQUJBU0VfVVJMOiBgamRiYzpwb3N0Z3Jlc3FsOi8vJHtkYXRhYmFzZUVuZHBvaW50fS9mb29kY29zdGAsXG4gICAgICAgIERBVEFCQVNFX1VTRVJOQU1FOiAncG9zdGdyZXMnLFxuICAgICAgICBSRURJU19IT1NUOiByZWRpc0VuZHBvaW50LFxuICAgICAgICBSRURJU19QT1JUOiAnNjM3OScsXG4gICAgICAgIEFXU19SRUdJT046IHRoaXMucmVnaW9uLFxuICAgICAgICBDT0dOSVRPX1VTRVJfUE9PTF9JRDogY29nbml0b1VzZXJQb29sSWQsXG4gICAgICAgIENPR05JVE9fQ0xJRU5UX0lEOiBjb2duaXRvQ2xpZW50SWQsXG4gICAgICB9LFxuICAgICAgc2VjcmV0czoge1xuICAgICAgICBEQVRBQkFTRV9QQVNTV09SRDogZWNzLlNlY3JldC5mcm9tU2VjcmV0c01hbmFnZXIoXG4gICAgICAgICAgY2RrLmF3c19zZWNyZXRzbWFuYWdlci5TZWNyZXQuZnJvbVNlY3JldENvbXBsZXRlQXJuKHRoaXMsICdEYXRhYmFzZVNlY3JldCcsIGRhdGFiYXNlU2VjcmV0QXJuKSxcbiAgICAgICAgICAncGFzc3dvcmQnLFxuICAgICAgICApLFxuICAgICAgfSxcbiAgICAgIGhlYWx0aENoZWNrOiB7XG4gICAgICAgIGNvbW1hbmQ6IFsnQ01ELVNIRUxMJywgJ2N1cmwgLWYgaHR0cDovL2xvY2FsaG9zdDo4MDgwL2FjdHVhdG9yL2hlYWx0aCB8fCBleGl0IDEnXSxcbiAgICAgICAgaW50ZXJ2YWw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNSksXG4gICAgICAgIHJldHJpZXM6IDMsXG4gICAgICAgIHN0YXJ0UGVyaW9kOiBjZGsuRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgY29udGFpbmVyLmFkZFBvcnRNYXBwaW5ncyh7XG4gICAgICBjb250YWluZXJQb3J0OiA4MDgwLFxuICAgICAgcHJvdG9jb2w6IGVjcy5Qcm90b2NvbC5UQ1AsXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgRUNTIFNlcnZpY2Ug4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBGYXJnYXRlIHNlcnZpY2Ugd2l0aCBhdXRvLXNjYWxpbmcgKDEtNCB0YXNrcylcbiAgICAvLyBDaXJjdWl0IGJyZWFrZXIgZW5hYmxlcyBhdXRvbWF0aWMgcm9sbGJhY2sgaWYgaGVhbHRoIGNoZWNrcyBmYWlsIGFmdGVyIGRlcGxveW1lbnRcbiAgICB0aGlzLnNlcnZpY2UgPSBuZXcgZWNzLkZhcmdhdGVTZXJ2aWNlKHRoaXMsICdTZXJ2aWNlJywge1xuICAgICAgY2x1c3RlcjogdGhpcy5jbHVzdGVyLFxuICAgICAgdGFza0RlZmluaXRpb24sXG4gICAgICBzZXJ2aWNlTmFtZTogYGZvb2Rjb3N0LWFwaS0ke2Vudk5hbWV9YCxcbiAgICAgIGRlc2lyZWRDb3VudDogMSwgLy8gU3RhcnQgd2l0aCAxIHRhc2sgZm9yIGNvc3Qgb3B0aW1pemF0aW9uXG4gICAgICBtaW5IZWFsdGh5UGVyY2VudDogNTAsXG4gICAgICBtYXhIZWFsdGh5UGVyY2VudDogMjAwLFxuICAgICAgdnBjU3VibmV0czogdnBjLnNlbGVjdFN1Ym5ldHMoe1xuICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTLFxuICAgICAgfSksXG4gICAgICBzZWN1cml0eUdyb3VwczogW2Vjc1NlY3VyaXR5R3JvdXBdLFxuICAgICAgYXNzaWduUHVibGljSXA6IGZhbHNlLFxuICAgICAgaGVhbHRoQ2hlY2tHcmFjZVBlcmlvZDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNjApLFxuICAgICAgLy8gQXV0b21hdGljIHJvbGxiYWNrIGNvbmZpZ3VyYXRpb24gLSBSZXF1aXJlbWVudCA5LjdcbiAgICAgIGNpcmN1aXRCcmVha2VyOiB7XG4gICAgICAgIHJvbGxiYWNrOiB0cnVlLCAvLyBFbmFibGUgYXV0b21hdGljIHJvbGxiYWNrIG9uIGRlcGxveW1lbnQgZmFpbHVyZVxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCBBdXRvIFNjYWxpbmcg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgY29uc3Qgc2NhbGluZyA9IHRoaXMuc2VydmljZS5hdXRvU2NhbGVUYXNrQ291bnQoe1xuICAgICAgbWluQ2FwYWNpdHk6IDEsXG4gICAgICBtYXhDYXBhY2l0eTogNCxcbiAgICB9KTtcblxuICAgIC8vIFNjYWxlIG9uIENQVSB1dGlsaXphdGlvblxuICAgIHNjYWxpbmcuc2NhbGVPbkNwdVV0aWxpemF0aW9uKCdDcHVTY2FsaW5nJywge1xuICAgICAgdGFyZ2V0VXRpbGl6YXRpb25QZXJjZW50OiA3MCxcbiAgICAgIHNjYWxlSW5Db29sZG93bjogY2RrLkR1cmF0aW9uLnNlY29uZHMoNjApLFxuICAgICAgc2NhbGVPdXRDb29sZG93bjogY2RrLkR1cmF0aW9uLnNlY29uZHMoNjApLFxuICAgIH0pO1xuXG4gICAgLy8gU2NhbGUgb24gbWVtb3J5IHV0aWxpemF0aW9uXG4gICAgc2NhbGluZy5zY2FsZU9uTWVtb3J5VXRpbGl6YXRpb24oJ01lbW9yeVNjYWxpbmcnLCB7XG4gICAgICB0YXJnZXRVdGlsaXphdGlvblBlcmNlbnQ6IDgwLFxuICAgICAgc2NhbGVJbkNvb2xkb3duOiBjZGsuRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gICAgICBzY2FsZU91dENvb2xkb3duOiBjZGsuRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgQUxCIFRhcmdldCBHcm91cCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBjb25zdCB0YXJnZXRHcm91cCA9IG5ldyBlbGJ2Mi5BcHBsaWNhdGlvblRhcmdldEdyb3VwKHRoaXMsICdUYXJnZXRHcm91cCcsIHtcbiAgICAgIHZwYyxcbiAgICAgIHBvcnQ6IDgwODAsXG4gICAgICBwcm90b2NvbDogZWxidjIuQXBwbGljYXRpb25Qcm90b2NvbC5IVFRQLFxuICAgICAgdGFyZ2V0VHlwZTogZWxidjIuVGFyZ2V0VHlwZS5JUCxcbiAgICAgIGhlYWx0aENoZWNrOiB7XG4gICAgICAgIHBhdGg6ICcvYWN0dWF0b3IvaGVhbHRoJyxcbiAgICAgICAgaW50ZXJ2YWw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNSksXG4gICAgICAgIGhlYWx0aHlUaHJlc2hvbGRDb3VudDogMixcbiAgICAgICAgdW5oZWFsdGh5VGhyZXNob2xkQ291bnQ6IDMsXG4gICAgICAgIGhlYWx0aHlIdHRwQ29kZXM6ICcyMDAnLFxuICAgICAgfSxcbiAgICAgIGRlcmVnaXN0cmF0aW9uRGVsYXk6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICB9KTtcblxuICAgIC8vIFJlZ2lzdGVyIEVDUyBzZXJ2aWNlIHdpdGggdGFyZ2V0IGdyb3VwXG4gICAgdGhpcy5zZXJ2aWNlLmF0dGFjaFRvQXBwbGljYXRpb25UYXJnZXRHcm91cCh0YXJnZXRHcm91cCk7XG5cbiAgICAvLyDilIDilIAgQUxCIExpc3RlbmVyIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vXG4gICAgLy8gSFRUUCBsaXN0ZW5lciAocG9ydCA4MCkgLSByZWRpcmVjdCB0byBIVFRQUyBpbiBwcm9kdWN0aW9uXG4gICAgY29uc3QgbGlzdGVuZXIgPSB0aGlzLmFsYi5hZGRMaXN0ZW5lcignSHR0cExpc3RlbmVyJywge1xuICAgICAgcG9ydDogODAsXG4gICAgICBwcm90b2NvbDogZWxidjIuQXBwbGljYXRpb25Qcm90b2NvbC5IVFRQLFxuICAgICAgZGVmYXVsdEFjdGlvbjogZWxidjIuTGlzdGVuZXJBY3Rpb24uZm9yd2FyZChbdGFyZ2V0R3JvdXBdKSxcbiAgICB9KTtcblxuICAgIC8vIFRPRE86IEFkZCBIVFRQUyBsaXN0ZW5lciB3aGVuIFNTTCBjZXJ0aWZpY2F0ZSBpcyBhdmFpbGFibGVcbiAgICAvLyBjb25zdCBodHRwc0xpc3RlbmVyID0gdGhpcy5hbGIuYWRkTGlzdGVuZXIoJ0h0dHBzTGlzdGVuZXInLCB7XG4gICAgLy8gICBwb3J0OiA0NDMsXG4gICAgLy8gICBwcm90b2NvbDogZWxidjIuQXBwbGljYXRpb25Qcm90b2NvbC5IVFRQUyxcbiAgICAvLyAgIGNlcnRpZmljYXRlczogW2NlcnRpZmljYXRlXSxcbiAgICAvLyAgIGRlZmF1bHRBY3Rpb246IGVsYnYyLkxpc3RlbmVyQWN0aW9uLmZvcndhcmQoW3RhcmdldEdyb3VwXSksXG4gICAgLy8gfSk7XG5cbiAgICAvLyDilIDilIAgQ2xvdWRGb3JtYXRpb24gT3V0cHV0cyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmVwb3NpdG9yeVVyaScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRUNSIHJlcG9zaXRvcnkgVVJJIGZvciBEb2NrZXIgaW1hZ2VzJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1SZXBvc2l0b3J5VXJpYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDbHVzdGVyTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmNsdXN0ZXIuY2x1c3Rlck5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0VDUyBjbHVzdGVyIG5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LUVjc0NsdXN0ZXJOYW1lYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTZXJ2aWNlTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnNlcnZpY2Uuc2VydmljZU5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0VDUyBzZXJ2aWNlIG5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LUVjc1NlcnZpY2VOYW1lYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdMb2FkQmFsYW5jZXJETlMnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5hbGIubG9hZEJhbGFuY2VyRG5zTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQXBwbGljYXRpb24gTG9hZCBCYWxhbmNlciBETlMgbmFtZScsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tQWxiRG5zYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdMb2FkQmFsYW5jZXJVcmwnLCB7XG4gICAgICB2YWx1ZTogYGh0dHA6Ly8ke3RoaXMuYWxiLmxvYWRCYWxhbmNlckRuc05hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQXBwbGljYXRpb24gTG9hZCBCYWxhbmNlciBVUkwnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FsYkxvZ3NCdWNrZXROYW1lJywge1xuICAgICAgdmFsdWU6IHRoaXMuYWxiTG9nc0J1Y2tldC5idWNrZXROYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdTMyBidWNrZXQgZm9yIEFMQiBhY2Nlc3MgbG9ncycsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tQWxiTG9nc0J1Y2tldE5hbWVgLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSAIFRhZ3Mg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgY2RrLlRhZ3Mub2YodGhpcykuYWRkKCdDb21wb25lbnQnLCAnRUNTJyk7XG4gICAgY2RrLlRhZ3Mub2YodGhpcykuYWRkKCdDb3N0Q2VudGVyJywgJ0NvbXB1dGUnKTtcbiAgfVxufVxuIl19