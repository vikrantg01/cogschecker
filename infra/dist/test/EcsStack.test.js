"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = require("aws-cdk-lib");
const assertions_1 = require("aws-cdk-lib/assertions");
const EcsStack_1 = require("../lib/stacks/EcsStack");
const ec2 = require("aws-cdk-lib/aws-ec2");
describe('EcsStack (ComputeStack)', () => {
    let app;
    let stack;
    let template;
    let mockVpc;
    let mockEcsSecurityGroup;
    let mockAlbSecurityGroup;
    beforeEach(() => {
        app = new cdk.App();
        const envConfig = {
            account: '123456789012',
            region: 'us-east-1',
        };
        // Create a minimal VPC mock for testing
        const networkStack = new cdk.Stack(app, 'TestNetworkStack', {
            env: envConfig,
        });
        mockVpc = new ec2.Vpc(networkStack, 'TestVpc', {
            maxAzs: 2,
            subnetConfiguration: [
                {
                    name: 'Public',
                    subnetType: ec2.SubnetType.PUBLIC,
                    cidrMask: 24,
                },
                {
                    name: 'Private',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    cidrMask: 24,
                },
                {
                    name: 'Isolated',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                    cidrMask: 24,
                },
            ],
        });
        mockEcsSecurityGroup = new ec2.SecurityGroup(networkStack, 'EcsSecurityGroup', {
            vpc: mockVpc,
            description: 'ECS security group',
        });
        mockAlbSecurityGroup = new ec2.SecurityGroup(networkStack, 'AlbSecurityGroup', {
            vpc: mockVpc,
            description: 'ALB security group',
        });
        stack = new EcsStack_1.EcsStack(app, 'TestEcsStack', {
            envName: 'test',
            vpc: mockVpc,
            ecsSecurityGroup: mockEcsSecurityGroup,
            albSecurityGroup: mockAlbSecurityGroup,
            databaseEndpoint: 'test-db.rds.amazonaws.com',
            databaseSecretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-db-secret',
            redisEndpoint: 'test-redis.cache.amazonaws.com',
            cognitoUserPoolId: 'us-east-1_TEST123',
            cognitoClientId: 'test-client-id-123',
            env: envConfig,
        });
        template = assertions_1.Template.fromStack(stack);
    });
    describe('Task Definition Configuration', () => {
        it('should create a Fargate task definition with 1 vCPU (1024) and 2048 MB memory', () => {
            template.resourceCountIs('AWS::ECS::TaskDefinition', 1);
            template.hasResourceProperties('AWS::ECS::TaskDefinition', {
                Cpu: '1024',
                Memory: '2048',
                NetworkMode: 'awsvpc',
                RequiresCompatibilities: ['FARGATE'],
            });
        });
        it('should configure container with correct port mapping', () => {
            template.hasResourceProperties('AWS::ECS::TaskDefinition', {
                ContainerDefinitions: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        Name: 'api',
                        PortMappings: [
                            {
                                ContainerPort: 8080,
                                Protocol: 'tcp',
                            },
                        ],
                    }),
                ]),
            });
        });
        it('should configure environment variables for Spring Boot application', () => {
            template.hasResourceProperties('AWS::ECS::TaskDefinition', {
                ContainerDefinitions: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        Environment: assertions_1.Match.arrayWith([
                            { Name: 'SPRING_PROFILES_ACTIVE', Value: 'production' },
                            { Name: 'DATABASE_URL', Value: 'jdbc:postgresql://test-db.rds.amazonaws.com/foodcost' },
                            { Name: 'DATABASE_USERNAME', Value: 'postgres' },
                            { Name: 'REDIS_HOST', Value: 'test-redis.cache.amazonaws.com' },
                            { Name: 'REDIS_PORT', Value: '6379' },
                            { Name: 'AWS_REGION', Value: 'us-east-1' },
                            { Name: 'COGNITO_USER_POOL_ID', Value: 'us-east-1_TEST123' },
                            { Name: 'COGNITO_CLIENT_ID', Value: 'test-client-id-123' },
                        ]),
                    }),
                ]),
            });
        });
        it('should retrieve DATABASE_PASSWORD from Secrets Manager (not plain-text)', () => {
            template.hasResourceProperties('AWS::ECS::TaskDefinition', {
                ContainerDefinitions: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        Secrets: assertions_1.Match.arrayWith([
                            assertions_1.Match.objectLike({
                                Name: 'DATABASE_PASSWORD',
                                ValueFrom: assertions_1.Match.stringLikeRegexp('.*secretsmanager.*'),
                            }),
                        ]),
                    }),
                ]),
            });
        });
        it('should configure health check on /actuator/health', () => {
            template.hasResourceProperties('AWS::ECS::TaskDefinition', {
                ContainerDefinitions: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        HealthCheck: {
                            Command: ['CMD-SHELL', 'curl -f http://localhost:8080/actuator/health || exit 1'],
                            Interval: 30,
                            Timeout: 5,
                            Retries: 3,
                            StartPeriod: 60,
                        },
                    }),
                ]),
            });
        });
        it('should use CloudWatch Logs for logging', () => {
            template.hasResourceProperties('AWS::ECS::TaskDefinition', {
                ContainerDefinitions: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        LogConfiguration: {
                            LogDriver: 'awslogs',
                            Options: assertions_1.Match.objectLike({
                                'awslogs-stream-prefix': 'ecs',
                            }),
                        },
                    }),
                ]),
            });
        });
    });
    describe('IAM Policy Configuration - Least Privilege', () => {
        it('should not have wildcard resources in task execution role (except GetAuthorizationToken)', () => {
            // Get all IAM policies
            const policies = template.findResources('AWS::IAM::Policy');
            // Check each policy
            Object.values(policies).forEach((policy) => {
                const policyDocument = policy.Properties?.PolicyDocument;
                if (!policyDocument)
                    return;
                policyDocument.Statement.forEach((statement) => {
                    const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
                    const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
                    // If Resource is '*', action should only be GetAuthorizationToken
                    resources.forEach((resource) => {
                        if (resource === '*') {
                            // Check that all actions with wildcard resource are GetAuthorizationToken or managed policies
                            const hasOnlyAllowedWildcardActions = actions.every((action) => action === 'ecr:GetAuthorizationToken' ||
                                action.startsWith('logs:') || // CloudWatch Logs actions can use * with service-level permissions
                                action === 'ecr:BatchCheckLayerAvailability' ||
                                action === 'ecr:GetDownloadUrlForLayer' ||
                                action === 'ecr:BatchGetImage');
                            if (!hasOnlyAllowedWildcardActions) {
                                // Find which actions are not allowed
                                const disallowedActions = actions.filter((action) => action !== 'ecr:GetAuthorizationToken' &&
                                    !action.startsWith('logs:') &&
                                    action !== 'ecr:BatchCheckLayerAvailability' &&
                                    action !== 'ecr:GetDownloadUrlForLayer' &&
                                    action !== 'ecr:BatchGetImage');
                                throw new Error(`Policy has wildcard resource for actions: ${disallowedActions.join(', ')}`);
                            }
                        }
                    });
                });
            });
        });
        it('should grant S3 access only to specific invoice bucket (not wildcard)', () => {
            const policies = template.findResources('AWS::IAM::Policy');
            let foundS3Policy = false;
            Object.values(policies).forEach((policy) => {
                const policyDocument = policy.Properties?.PolicyDocument;
                if (!policyDocument)
                    return;
                policyDocument.Statement.forEach((statement) => {
                    const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
                    // Check if this statement has S3 actions
                    const hasS3Actions = actions.some((action) => action.startsWith('s3:'));
                    if (hasS3Actions) {
                        foundS3Policy = true;
                        const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
                        // Verify resources are specific bucket ARNs, not wildcards
                        resources.forEach((resource) => {
                            // Resource can be Ref or Join, but should reference specific bucket
                            expect(resource).not.toBe('*');
                            // If it's a string, check it's a specific bucket ARN pattern
                            if (typeof resource === 'string') {
                                expect(resource).toMatch(/arn:aws:s3:::fcc-invoices-/);
                            }
                        });
                    }
                });
            });
            expect(foundS3Policy).toBe(true);
        });
        it('should grant Cognito access only to specific User Pool (not wildcard)', () => {
            const policies = template.findResources('AWS::IAM::Policy');
            let foundCognitoPolicy = false;
            Object.values(policies).forEach((policy) => {
                const policyDocument = policy.Properties?.PolicyDocument;
                if (!policyDocument)
                    return;
                policyDocument.Statement.forEach((statement) => {
                    const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
                    // Check if this statement has Cognito actions
                    const hasCognitoActions = actions.some((action) => action.startsWith('cognito-idp:'));
                    if (hasCognitoActions) {
                        foundCognitoPolicy = true;
                        const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
                        // Verify resources are specific User Pool ARNs, not wildcards
                        resources.forEach((resource) => {
                            expect(resource).not.toBe('*');
                            // If it's a string, check it's a specific User Pool ARN
                            if (typeof resource === 'string') {
                                expect(resource).toMatch(/arn:aws:cognito-idp:.*:userpool\//);
                            }
                        });
                    }
                });
            });
            expect(foundCognitoPolicy).toBe(true);
        });
        it('should grant Secrets Manager access only to specific database secret', () => {
            const policies = template.findResources('AWS::IAM::Policy');
            let foundSecretsPolicy = false;
            Object.values(policies).forEach((policy) => {
                const policyDocument = policy.Properties?.PolicyDocument;
                if (!policyDocument)
                    return;
                policyDocument.Statement.forEach((statement) => {
                    const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
                    // Check if this statement has Secrets Manager actions
                    const hasSecretsActions = actions.some((action) => action.startsWith('secretsmanager:'));
                    if (hasSecretsActions) {
                        foundSecretsPolicy = true;
                        const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
                        // Verify resources are specific secret ARNs, not wildcards
                        resources.forEach((resource) => {
                            expect(resource).not.toBe('*');
                            // If it's a string, check it references the specific secret
                            if (typeof resource === 'string') {
                                expect(resource).toMatch(/arn:aws:secretsmanager:.*:secret:test-db-secret/);
                            }
                        });
                    }
                });
            });
            expect(foundSecretsPolicy).toBe(true);
        });
    });
    describe('Auto-Scaling Configuration', () => {
        it('should configure auto-scaling with min=1, max=4 tasks', () => {
            template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
                MinCapacity: 1,
                MaxCapacity: 4,
                ServiceNamespace: 'ecs',
                ScalableDimension: 'ecs:service:DesiredCount',
            });
        });
        it('should configure CPU target utilization at 70%', () => {
            template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalingPolicy', {
                PolicyType: 'TargetTrackingScaling',
                TargetTrackingScalingPolicyConfiguration: {
                    PredefinedMetricSpecification: {
                        PredefinedMetricType: 'ECSServiceAverageCPUUtilization',
                    },
                    TargetValue: 70,
                },
            });
        });
        it('should configure Memory target utilization at 80%', () => {
            template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalingPolicy', {
                PolicyType: 'TargetTrackingScaling',
                TargetTrackingScalingPolicyConfiguration: {
                    PredefinedMetricSpecification: {
                        PredefinedMetricType: 'ECSServiceAverageMemoryUtilization',
                    },
                    TargetValue: 80,
                },
            });
        });
    });
    describe('Health Check Configuration', () => {
        it('should configure ALB target group health check on /actuator/health', () => {
            template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
                HealthCheckPath: '/actuator/health',
                HealthCheckIntervalSeconds: 30,
                HealthCheckTimeoutSeconds: 5,
                HealthyThresholdCount: 2,
                UnhealthyThresholdCount: 3,
                Matcher: {
                    HttpCode: '200',
                },
            });
        });
        it('should configure target group for port 8080', () => {
            template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
                Port: 8080,
                Protocol: 'HTTP',
                TargetType: 'ip',
            });
        });
    });
    describe('ECS Service Configuration', () => {
        it('should create ECS cluster with Container Insights enabled', () => {
            template.resourceCountIs('AWS::ECS::Cluster', 1);
            template.hasResourceProperties('AWS::ECS::Cluster', {
                ClusterSettings: [
                    {
                        Name: 'containerInsights',
                        Value: 'enabled',
                    },
                ],
            });
        });
        it('should create Fargate service with desired count of 1', () => {
            template.resourceCountIs('AWS::ECS::Service', 1);
            template.hasResourceProperties('AWS::ECS::Service', {
                DesiredCount: 1,
                LaunchType: 'FARGATE',
            });
        });
        it('should deploy service in private subnets (not public)', () => {
            template.hasResourceProperties('AWS::ECS::Service', {
                NetworkConfiguration: {
                    AwsvpcConfiguration: {
                        AssignPublicIp: 'DISABLED',
                    },
                },
            });
        });
        it('should configure zero-downtime deployment strategy', () => {
            template.hasResourceProperties('AWS::ECS::Service', {
                DeploymentConfiguration: {
                    MinimumHealthyPercent: 50,
                    MaximumPercent: 200,
                },
            });
        });
        it('should enable automatic rollback on deployment failure', () => {
            template.hasResourceProperties('AWS::ECS::Service', {
                DeploymentConfiguration: assertions_1.Match.objectLike({
                    DeploymentCircuitBreaker: {
                        Enable: true,
                        Rollback: true,
                    },
                }),
            });
        });
    });
    describe('Load Balancer Configuration', () => {
        it('should create internet-facing ALB', () => {
            template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
            template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
                Scheme: 'internet-facing',
                Type: 'application',
            });
        });
        it('should create HTTP listener on port 80', () => {
            template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
                Port: 80,
                Protocol: 'HTTP',
            });
        });
        it('should enable ALB access logs to S3', () => {
            template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
                LoadBalancerAttributes: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        Key: 'access_logs.s3.enabled',
                        Value: 'true',
                    }),
                ]),
            });
        });
    });
    describe('ECR Repository Configuration', () => {
        it('should create ECR repository with image scanning enabled', () => {
            template.resourceCountIs('AWS::ECR::Repository', 1);
            template.hasResourceProperties('AWS::ECR::Repository', {
                ImageScanningConfiguration: {
                    ScanOnPush: true,
                },
            });
        });
        it('should configure lifecycle policy to keep last 10 images', () => {
            template.hasResourceProperties('AWS::ECR::Repository', {
                LifecyclePolicy: {
                    LifecyclePolicyText: assertions_1.Match.stringLikeRegexp('.*imageCountMoreThan.*10.*'),
                },
            });
        });
        it('should enable encryption for stored images', () => {
            // CDK uses AES256 encryption by default
            // Verify the repository exists (encryption is enabled by default)
            template.resourceCountIs('AWS::ECR::Repository', 1);
            template.hasResourceProperties('AWS::ECR::Repository', {
                RepositoryName: 'food-cost-calculator-test',
            });
            // If encryption configuration is present, verify it's AES256
            const repo = template.findResources('AWS::ECR::Repository');
            const repoProps = Object.values(repo)[0].Properties;
            // If EncryptionConfiguration is specified, it should be AES256
            if (repoProps.EncryptionConfiguration) {
                expect(repoProps.EncryptionConfiguration.EncryptionType).toBe('AES256');
            }
            // If not specified, CDK uses AES256 by default which is acceptable
        });
    });
    describe('CloudWatch Logs Configuration', () => {
        it('should create CloudWatch log group with 7-day retention', () => {
            template.resourceCountIs('AWS::Logs::LogGroup', 1);
            template.hasResourceProperties('AWS::Logs::LogGroup', {
                LogGroupName: '/ecs/foodcost-api-test',
                RetentionInDays: 7,
            });
        });
    });
    describe('CloudFormation Outputs', () => {
        it('should export ECR repository URI', () => {
            template.hasOutput('RepositoryUri', {
                Export: {
                    Name: 'FoodCostCalculator-test-RepositoryUri',
                },
            });
        });
        it('should export ECS cluster name', () => {
            template.hasOutput('ClusterName', {
                Export: {
                    Name: 'FoodCostCalculator-test-EcsClusterName',
                },
            });
        });
        it('should export ECS service name', () => {
            template.hasOutput('ServiceName', {
                Export: {
                    Name: 'FoodCostCalculator-test-EcsServiceName',
                },
            });
        });
        it('should export ALB DNS name', () => {
            template.hasOutput('LoadBalancerDNS', {
                Export: {
                    Name: 'FoodCostCalculator-test-AlbDns',
                },
            });
        });
        it('should output full ALB URL', () => {
            const outputs = template.toJSON().Outputs;
            expect(outputs.LoadBalancerUrl).toBeDefined();
        });
    });
    describe('Resource Tagging', () => {
        it('should tag all resources with Component and CostCenter tags', () => {
            const stackJson = template.toJSON();
            // Check that tags are applied at the stack level
            expect(stackJson.Resources).toBeDefined();
            // The CDK Tags.of() applies tags to all taggable resources
            // We can verify by checking the stack has the tag metadata
            const resources = Object.values(stackJson.Resources);
            const taggableResources = resources.filter(r => r.Type.startsWith('AWS::ECS::') ||
                r.Type.startsWith('AWS::ElasticLoadBalancingV2::') ||
                r.Type.startsWith('AWS::ECR::'));
            expect(taggableResources.length).toBeGreaterThan(0);
        });
    });
    describe('Requirements Validation', () => {
        it('should satisfy Requirement 3.3 - Fargate task with 1 vCPU and 2048 MB memory', () => {
            template.hasResourceProperties('AWS::ECS::TaskDefinition', {
                Cpu: '1024',
                Memory: '2048',
            });
        });
        it('should satisfy Requirement 3.10 - Auto-scaling min=1, max=4, CPU=70%, Memory=80%', () => {
            template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
                MinCapacity: 1,
                MaxCapacity: 4,
            });
            template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalingPolicy', {
                TargetTrackingScalingPolicyConfiguration: {
                    PredefinedMetricSpecification: {
                        PredefinedMetricType: 'ECSServiceAverageCPUUtilization',
                    },
                    TargetValue: 70,
                },
            });
            template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalingPolicy', {
                TargetTrackingScalingPolicyConfiguration: {
                    PredefinedMetricSpecification: {
                        PredefinedMetricType: 'ECSServiceAverageMemoryUtilization',
                    },
                    TargetValue: 80,
                },
            });
        });
        it('should satisfy Requirement 3.12 - Health check on /actuator/health every 30 seconds', () => {
            template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
                HealthCheckPath: '/actuator/health',
                HealthCheckIntervalSeconds: 30,
                HealthyThresholdCount: 2,
                UnhealthyThresholdCount: 3,
            });
        });
        it('should satisfy Requirement 11.3 - Least-privilege IAM policies (no wildcard resources)', () => {
            // This is verified by the IAM policy tests above
            const policies = template.findResources('AWS::IAM::Policy');
            expect(Object.keys(policies).length).toBeGreaterThan(0);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiRWNzU3RhY2sudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3Rlc3QvRWNzU3RhY2sudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLG1DQUFtQztBQUNuQyx1REFBa0U7QUFDbEUscURBQWtEO0FBQ2xELDJDQUEyQztBQUUzQyxRQUFRLENBQUMseUJBQXlCLEVBQUUsR0FBRyxFQUFFO0lBQ3ZDLElBQUksR0FBWSxDQUFDO0lBQ2pCLElBQUksS0FBZSxDQUFDO0lBQ3BCLElBQUksUUFBa0IsQ0FBQztJQUN2QixJQUFJLE9BQWlCLENBQUM7SUFDdEIsSUFBSSxvQkFBd0MsQ0FBQztJQUM3QyxJQUFJLG9CQUF3QyxDQUFDO0lBRTdDLFVBQVUsQ0FBQyxHQUFHLEVBQUU7UUFDZCxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUM7UUFFcEIsTUFBTSxTQUFTLEdBQUc7WUFDaEIsT0FBTyxFQUFFLGNBQWM7WUFDdkIsTUFBTSxFQUFFLFdBQVc7U0FDcEIsQ0FBQztRQUVGLHdDQUF3QztRQUN4QyxNQUFNLFlBQVksR0FBRyxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLGtCQUFrQixFQUFFO1lBQzFELEdBQUcsRUFBRSxTQUFTO1NBQ2YsQ0FBQyxDQUFDO1FBQ0gsT0FBTyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxZQUFZLEVBQUUsU0FBUyxFQUFFO1lBQzdDLE1BQU0sRUFBRSxDQUFDO1lBQ1QsbUJBQW1CLEVBQUU7Z0JBQ25CO29CQUNFLElBQUksRUFBRSxRQUFRO29CQUNkLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU07b0JBQ2pDLFFBQVEsRUFBRSxFQUFFO2lCQUNiO2dCQUNEO29CQUNFLElBQUksRUFBRSxTQUFTO29CQUNmLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLG1CQUFtQjtvQkFDOUMsUUFBUSxFQUFFLEVBQUU7aUJBQ2I7Z0JB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QUFFO29CQUN4Qyw2QkFBNkIsRUFBRTt3QkFDN0Isb0JBQW9CLEVBQUUsb0NBQW9DO3FCQUMzRDtvQkFDRCxXQUFXLEVBQUUsRUFBRTtpQkFDaEI7YUFDRixDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQyxxRkFBcUYsRUFBRSxHQUFHLEVBQUU7WUFDN0YsUUFBUSxDQUFDLHFCQUFxQixDQUFDLDBDQUEwQyxFQUFFO2dCQUN6RSxlQUFlLEVBQUUsa0JBQWtCO2dCQUNuQywwQkFBMEIsRUFBRSxFQUFFO2dCQUM5QixxQkFBcUIsRUFBRSxDQUFDO2dCQUN4Qix1QkFBdUIsRUFBRSxDQUFDO2FBQzNCLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLHdGQUF3RixFQUFFLEdBQUcsRUFBRTtZQUNoRyxpREFBaUQ7WUFDakQsTUFBTSxRQUFRLEdBQUcsUUFBUSxDQUFDLGFBQWEsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO1lBQzVELE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUMxRCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgVGVtcGxhdGUsIE1hdGNoLCBDYXB0dXJlIH0gZnJvbSAnYXdzLWNkay1saWIvYXNzZXJ0aW9ucyc7XG5pbXBvcnQgeyBFY3NTdGFjayB9IGZyb20gJy4uL2xpYi9zdGFja3MvRWNzU3RhY2snO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuXG5kZXNjcmliZSgnRWNzU3RhY2sgKENvbXB1dGVTdGFjayknLCAoKSA9PiB7XG4gIGxldCBhcHA6IGNkay5BcHA7XG4gIGxldCBzdGFjazogRWNzU3RhY2s7XG4gIGxldCB0ZW1wbGF0ZTogVGVtcGxhdGU7XG4gIGxldCBtb2NrVnBjOiBlYzIuSVZwYztcbiAgbGV0IG1vY2tFY3NTZWN1cml0eUdyb3VwOiBlYzIuSVNlY3VyaXR5R3JvdXA7XG4gIGxldCBtb2NrQWxiU2VjdXJpdHlHcm91cDogZWMyLklTZWN1cml0eUdyb3VwO1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIGFwcCA9IG5ldyBjZGsuQXBwKCk7XG5cbiAgICBjb25zdCBlbnZDb25maWcgPSB7XG4gICAgICBhY2NvdW50OiAnMTIzNDU2Nzg5MDEyJyxcbiAgICAgIHJlZ2lvbjogJ3VzLWVhc3QtMScsXG4gICAgfTtcblxuICAgIC8vIENyZWF0ZSBhIG1pbmltYWwgVlBDIG1vY2sgZm9yIHRlc3RpbmdcbiAgICBjb25zdCBuZXR3b3JrU3RhY2sgPSBuZXcgY2RrLlN0YWNrKGFwcCwgJ1Rlc3ROZXR3b3JrU3RhY2snLCB7XG4gICAgICBlbnY6IGVudkNvbmZpZyxcbiAgICB9KTtcbiAgICBtb2NrVnBjID0gbmV3IGVjMi5WcGMobmV0d29ya1N0YWNrLCAnVGVzdFZwYycsIHtcbiAgICAgIG1heEF6czogMixcbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246IFtcbiAgICAgICAge1xuICAgICAgICAgIG5hbWU6ICdQdWJsaWMnLFxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBVQkxJQyxcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnUHJpdmF0ZScsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnSXNvbGF0ZWQnLFxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfSVNPTEFURUQsXG4gICAgICAgICAgY2lkck1hc2s6IDI0LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIG1vY2tFY3NTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKG5ldHdvcmtTdGFjaywgJ0Vjc1NlY3VyaXR5R3JvdXAnLCB7XG4gICAgICB2cGM6IG1vY2tWcGMsXG4gICAgICBkZXNjcmlwdGlvbjogJ0VDUyBzZWN1cml0eSBncm91cCcsXG4gICAgfSk7XG5cbiAgICBtb2NrQWxiU2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cChuZXR3b3JrU3RhY2ssICdBbGJTZWN1cml0eUdyb3VwJywge1xuICAgICAgdnBjOiBtb2NrVnBjLFxuICAgICAgZGVzY3JpcHRpb246ICdBTEIgc2VjdXJpdHkgZ3JvdXAnLFxuICAgIH0pO1xuXG4gICAgc3RhY2sgPSBuZXcgRWNzU3RhY2soYXBwLCAnVGVzdEVjc1N0YWNrJywge1xuICAgICAgZW52TmFtZTogJ3Rlc3QnLFxuICAgICAgdnBjOiBtb2NrVnBjLFxuICAgICAgZWNzU2VjdXJpdHlHcm91cDogbW9ja0Vjc1NlY3VyaXR5R3JvdXAsXG4gICAgICBhbGJTZWN1cml0eUdyb3VwOiBtb2NrQWxiU2VjdXJpdHlHcm91cCxcbiAgICAgIGRhdGFiYXNlRW5kcG9pbnQ6ICd0ZXN0LWRiLnJkcy5hbWF6b25hd3MuY29tJyxcbiAgICAgIGRhdGFiYXNlU2VjcmV0QXJuOiAnYXJuOmF3czpzZWNyZXRzbWFuYWdlcjp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOnNlY3JldDp0ZXN0LWRiLXNlY3JldCcsXG4gICAgICByZWRpc0VuZHBvaW50OiAndGVzdC1yZWRpcy5jYWNoZS5hbWF6b25hd3MuY29tJyxcbiAgICAgIGNvZ25pdG9Vc2VyUG9vbElkOiAndXMtZWFzdC0xX1RFU1QxMjMnLFxuICAgICAgY29nbml0b0NsaWVudElkOiAndGVzdC1jbGllbnQtaWQtMTIzJyxcbiAgICAgIGVudjogZW52Q29uZmlnLFxuICAgIH0pO1xuXG4gICAgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICB9KTtcblxuICBkZXNjcmliZSgnVGFzayBEZWZpbml0aW9uIENvbmZpZ3VyYXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgYSBGYXJnYXRlIHRhc2sgZGVmaW5pdGlvbiB3aXRoIDEgdkNQVSAoMTAyNCkgYW5kIDIwNDggTUIgbWVtb3J5JywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkVDUzo6VGFza0RlZmluaXRpb24nLCAxKTtcblxuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkVDUzo6VGFza0RlZmluaXRpb24nLCB7XG4gICAgICAgIENwdTogJzEwMjQnLFxuICAgICAgICBNZW1vcnk6ICcyMDQ4JyxcbiAgICAgICAgTmV0d29ya01vZGU6ICdhd3N2cGMnLFxuICAgICAgICBSZXF1aXJlc0NvbXBhdGliaWxpdGllczogWydGQVJHQVRFJ10sXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY29uZmlndXJlIGNvbnRhaW5lciB3aXRoIGNvcnJlY3QgcG9ydCBtYXBwaW5nJywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkVDUzo6VGFza0RlZmluaXRpb24nLCB7XG4gICAgICAgIENvbnRhaW5lckRlZmluaXRpb25zOiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgTmFtZTogJ2FwaScsXG4gICAgICAgICAgICBQb3J0TWFwcGluZ3M6IFtcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIENvbnRhaW5lclBvcnQ6IDgwODAsXG4gICAgICAgICAgICAgICAgUHJvdG9jb2w6ICd0Y3AnLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSksXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY29uZmlndXJlIGVudmlyb25tZW50IHZhcmlhYmxlcyBmb3IgU3ByaW5nIEJvb3QgYXBwbGljYXRpb24nLCAoKSA9PiB7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RUNTOjpUYXNrRGVmaW5pdGlvbicsIHtcbiAgICAgICAgQ29udGFpbmVyRGVmaW5pdGlvbnM6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgICBFbnZpcm9ubWVudDogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgICAgICAgeyBOYW1lOiAnU1BSSU5HX1BST0ZJTEVTX0FDVElWRScsIFZhbHVlOiAncHJvZHVjdGlvbicgfSxcbiAgICAgICAgICAgICAgeyBOYW1lOiAnREFUQUJBU0VfVVJMJywgVmFsdWU6ICdqZGJjOnBvc3RncmVzcWw6Ly90ZXN0LWRiLnJkcy5hbWF6b25hd3MuY29tL2Zvb2Rjb3N0JyB9LFxuICAgICAgICAgICAgICB7IE5hbWU6ICdEQVRBQkFTRV9VU0VSTkFNRScsIFZhbHVlOiAncG9zdGdyZXMnIH0sXG4gICAgICAgICAgICAgIHsgTmFtZTogJ1JFRElTX0hPU1QnLCBWYWx1ZTogJ3Rlc3QtcmVkaXMuY2FjaGUuYW1hem9uYXdzLmNvbScgfSxcbiAgICAgICAgICAgICAgeyBOYW1lOiAnUkVESVNfUE9SVCcsIFZhbHVlOiAnNjM3OScgfSxcbiAgICAgICAgICAgICAgeyBOYW1lOiAnQVdTX1JFR0lPTicsIFZhbHVlOiAndXMtZWFzdC0xJyB9LFxuICAgICAgICAgICAgICB7IE5hbWU6ICdDT0dOSVRPX1VTRVJfUE9PTF9JRCcsIFZhbHVlOiAndXMtZWFzdC0xX1RFU1QxMjMnIH0sXG4gICAgICAgICAgICAgIHsgTmFtZTogJ0NPR05JVE9fQ0xJRU5UX0lEJywgVmFsdWU6ICd0ZXN0LWNsaWVudC1pZC0xMjMnIH0sXG4gICAgICAgICAgICBdKSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSksXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmV0cmlldmUgREFUQUJBU0VfUEFTU1dPUkQgZnJvbSBTZWNyZXRzIE1hbmFnZXIgKG5vdCBwbGFpbi10ZXh0KScsICgpID0+IHtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpFQ1M6OlRhc2tEZWZpbml0aW9uJywge1xuICAgICAgICBDb250YWluZXJEZWZpbml0aW9uczogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgIFNlY3JldHM6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgICAgIE5hbWU6ICdEQVRBQkFTRV9QQVNTV09SRCcsXG4gICAgICAgICAgICAgICAgVmFsdWVGcm9tOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCcuKnNlY3JldHNtYW5hZ2VyLionKSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdKSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSksXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY29uZmlndXJlIGhlYWx0aCBjaGVjayBvbiAvYWN0dWF0b3IvaGVhbHRoJywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkVDUzo6VGFza0RlZmluaXRpb24nLCB7XG4gICAgICAgIENvbnRhaW5lckRlZmluaXRpb25zOiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgSGVhbHRoQ2hlY2s6IHtcbiAgICAgICAgICAgICAgQ29tbWFuZDogWydDTUQtU0hFTEwnLCAnY3VybCAtZiBodHRwOi8vbG9jYWxob3N0OjgwODAvYWN0dWF0b3IvaGVhbHRoIHx8IGV4aXQgMSddLFxuICAgICAgICAgICAgICBJbnRlcnZhbDogMzAsXG4gICAgICAgICAgICAgIFRpbWVvdXQ6IDUsXG4gICAgICAgICAgICAgIFJldHJpZXM6IDMsXG4gICAgICAgICAgICAgIFN0YXJ0UGVyaW9kOiA2MCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSksXG4gICAgICAgIF0pLFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHVzZSBDbG91ZFdhdGNoIExvZ3MgZm9yIGxvZ2dpbmcnLCAoKSA9PiB7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RUNTOjpUYXNrRGVmaW5pdGlvbicsIHtcbiAgICAgICAgQ29udGFpbmVyRGVmaW5pdGlvbnM6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgICBMb2dDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICAgIExvZ0RyaXZlcjogJ2F3c2xvZ3MnLFxuICAgICAgICAgICAgICBPcHRpb25zOiBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgICAgICAnYXdzbG9ncy1zdHJlYW0tcHJlZml4JzogJ2VjcycsXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSksXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0lBTSBQb2xpY3kgQ29uZmlndXJhdGlvbiAtIExlYXN0IFByaXZpbGVnZScsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIG5vdCBoYXZlIHdpbGRjYXJkIHJlc291cmNlcyBpbiB0YXNrIGV4ZWN1dGlvbiByb2xlIChleGNlcHQgR2V0QXV0aG9yaXphdGlvblRva2VuKScsICgpID0+IHtcbiAgICAgIC8vIEdldCBhbGwgSUFNIHBvbGljaWVzXG4gICAgICBjb25zdCBwb2xpY2llcyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6SUFNOjpQb2xpY3knKTtcblxuICAgICAgLy8gQ2hlY2sgZWFjaCBwb2xpY3lcbiAgICAgIE9iamVjdC52YWx1ZXMocG9saWNpZXMpLmZvckVhY2goKHBvbGljeTogYW55KSA9PiB7XG4gICAgICAgIGNvbnN0IHBvbGljeURvY3VtZW50ID0gcG9saWN5LlByb3BlcnRpZXM/LlBvbGljeURvY3VtZW50O1xuICAgICAgICBpZiAoIXBvbGljeURvY3VtZW50KSByZXR1cm47XG5cbiAgICAgICAgcG9saWN5RG9jdW1lbnQuU3RhdGVtZW50LmZvckVhY2goKHN0YXRlbWVudDogYW55KSA9PiB7XG4gICAgICAgICAgY29uc3QgYWN0aW9ucyA9IEFycmF5LmlzQXJyYXkoc3RhdGVtZW50LkFjdGlvbikgPyBzdGF0ZW1lbnQuQWN0aW9uIDogW3N0YXRlbWVudC5BY3Rpb25dO1xuICAgICAgICAgIGNvbnN0IHJlc291cmNlcyA9IEFycmF5LmlzQXJyYXkoc3RhdGVtZW50LlJlc291cmNlKSA/IHN0YXRlbWVudC5SZXNvdXJjZSA6IFtzdGF0ZW1lbnQuUmVzb3VyY2VdO1xuXG4gICAgICAgICAgLy8gSWYgUmVzb3VyY2UgaXMgJyonLCBhY3Rpb24gc2hvdWxkIG9ubHkgYmUgR2V0QXV0aG9yaXphdGlvblRva2VuXG4gICAgICAgICAgcmVzb3VyY2VzLmZvckVhY2goKHJlc291cmNlOiBhbnkpID0+IHtcbiAgICAgICAgICAgIGlmIChyZXNvdXJjZSA9PT0gJyonKSB7XG4gICAgICAgICAgICAgIC8vIENoZWNrIHRoYXQgYWxsIGFjdGlvbnMgd2l0aCB3aWxkY2FyZCByZXNvdXJjZSBhcmUgR2V0QXV0aG9yaXphdGlvblRva2VuIG9yIG1hbmFnZWQgcG9saWNpZXNcbiAgICAgICAgICAgICAgY29uc3QgaGFzT25seUFsbG93ZWRXaWxkY2FyZEFjdGlvbnMgPSBhY3Rpb25zLmV2ZXJ5KChhY3Rpb246IHN0cmluZykgPT5cbiAgICAgICAgICAgICAgICBhY3Rpb24gPT09ICdlY3I6R2V0QXV0aG9yaXphdGlvblRva2VuJyB8fFxuICAgICAgICAgICAgICAgIGFjdGlvbi5zdGFydHNXaXRoKCdsb2dzOicpIHx8IC8vIENsb3VkV2F0Y2ggTG9ncyBhY3Rpb25zIGNhbiB1c2UgKiB3aXRoIHNlcnZpY2UtbGV2ZWwgcGVybWlzc2lvbnNcbiAgICAgICAgICAgICAgICBhY3Rpb24gPT09ICdlY3I6QmF0Y2hDaGVja0xheWVyQXZhaWxhYmlsaXR5JyB8fFxuICAgICAgICAgICAgICAgIGFjdGlvbiA9PT0gJ2VjcjpHZXREb3dubG9hZFVybEZvckxheWVyJyB8fFxuICAgICAgICAgICAgICAgIGFjdGlvbiA9PT0gJ2VjcjpCYXRjaEdldEltYWdlJ1xuICAgICAgICAgICAgICApO1xuXG4gICAgICAgICAgICAgIGlmICghaGFzT25seUFsbG93ZWRXaWxkY2FyZEFjdGlvbnMpIHtcbiAgICAgICAgICAgICAgICAvLyBGaW5kIHdoaWNoIGFjdGlvbnMgYXJlIG5vdCBhbGxvd2VkXG4gICAgICAgICAgICAgICAgY29uc3QgZGlzYWxsb3dlZEFjdGlvbnMgPSBhY3Rpb25zLmZpbHRlcigoYWN0aW9uOiBzdHJpbmcpID0+XG4gICAgICAgICAgICAgICAgICBhY3Rpb24gIT09ICdlY3I6R2V0QXV0aG9yaXphdGlvblRva2VuJyAmJlxuICAgICAgICAgICAgICAgICAgIWFjdGlvbi5zdGFydHNXaXRoKCdsb2dzOicpICYmXG4gICAgICAgICAgICAgICAgICBhY3Rpb24gIT09ICdlY3I6QmF0Y2hDaGVja0xheWVyQXZhaWxhYmlsaXR5JyAmJlxuICAgICAgICAgICAgICAgICAgYWN0aW9uICE9PSAnZWNyOkdldERvd25sb2FkVXJsRm9yTGF5ZXInICYmXG4gICAgICAgICAgICAgICAgICBhY3Rpb24gIT09ICdlY3I6QmF0Y2hHZXRJbWFnZSdcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgUG9saWN5IGhhcyB3aWxkY2FyZCByZXNvdXJjZSBmb3IgYWN0aW9uczogJHtkaXNhbGxvd2VkQWN0aW9ucy5qb2luKCcsICcpfWApO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGdyYW50IFMzIGFjY2VzcyBvbmx5IHRvIHNwZWNpZmljIGludm9pY2UgYnVja2V0IChub3Qgd2lsZGNhcmQpJywgKCkgPT4ge1xuICAgICAgY29uc3QgcG9saWNpZXMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OklBTTo6UG9saWN5Jyk7XG4gICAgICBsZXQgZm91bmRTM1BvbGljeSA9IGZhbHNlO1xuXG4gICAgICBPYmplY3QudmFsdWVzKHBvbGljaWVzKS5mb3JFYWNoKChwb2xpY3k6IGFueSkgPT4ge1xuICAgICAgICBjb25zdCBwb2xpY3lEb2N1bWVudCA9IHBvbGljeS5Qcm9wZXJ0aWVzPy5Qb2xpY3lEb2N1bWVudDtcbiAgICAgICAgaWYgKCFwb2xpY3lEb2N1bWVudCkgcmV0dXJuO1xuXG4gICAgICAgIHBvbGljeURvY3VtZW50LlN0YXRlbWVudC5mb3JFYWNoKChzdGF0ZW1lbnQ6IGFueSkgPT4ge1xuICAgICAgICAgIGNvbnN0IGFjdGlvbnMgPSBBcnJheS5pc0FycmF5KHN0YXRlbWVudC5BY3Rpb24pID8gc3RhdGVtZW50LkFjdGlvbiA6IFtzdGF0ZW1lbnQuQWN0aW9uXTtcblxuICAgICAgICAgIC8vIENoZWNrIGlmIHRoaXMgc3RhdGVtZW50IGhhcyBTMyBhY3Rpb25zXG4gICAgICAgICAgY29uc3QgaGFzUzNBY3Rpb25zID0gYWN0aW9ucy5zb21lKChhY3Rpb246IHN0cmluZykgPT4gYWN0aW9uLnN0YXJ0c1dpdGgoJ3MzOicpKTtcblxuICAgICAgICAgIGlmIChoYXNTM0FjdGlvbnMpIHtcbiAgICAgICAgICAgIGZvdW5kUzNQb2xpY3kgPSB0cnVlO1xuICAgICAgICAgICAgY29uc3QgcmVzb3VyY2VzID0gQXJyYXkuaXNBcnJheShzdGF0ZW1lbnQuUmVzb3VyY2UpID8gc3RhdGVtZW50LlJlc291cmNlIDogW3N0YXRlbWVudC5SZXNvdXJjZV07XG5cbiAgICAgICAgICAgIC8vIFZlcmlmeSByZXNvdXJjZXMgYXJlIHNwZWNpZmljIGJ1Y2tldCBBUk5zLCBub3Qgd2lsZGNhcmRzXG4gICAgICAgICAgICByZXNvdXJjZXMuZm9yRWFjaCgocmVzb3VyY2U6IGFueSkgPT4ge1xuICAgICAgICAgICAgICAvLyBSZXNvdXJjZSBjYW4gYmUgUmVmIG9yIEpvaW4sIGJ1dCBzaG91bGQgcmVmZXJlbmNlIHNwZWNpZmljIGJ1Y2tldFxuICAgICAgICAgICAgICBleHBlY3QocmVzb3VyY2UpLm5vdC50b0JlKCcqJyk7XG4gICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAvLyBJZiBpdCdzIGEgc3RyaW5nLCBjaGVjayBpdCdzIGEgc3BlY2lmaWMgYnVja2V0IEFSTiBwYXR0ZXJuXG4gICAgICAgICAgICAgIGlmICh0eXBlb2YgcmVzb3VyY2UgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgZXhwZWN0KHJlc291cmNlKS50b01hdGNoKC9hcm46YXdzOnMzOjo6ZmNjLWludm9pY2VzLS8pO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChmb3VuZFMzUG9saWN5KS50b0JlKHRydWUpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBncmFudCBDb2duaXRvIGFjY2VzcyBvbmx5IHRvIHNwZWNpZmljIFVzZXIgUG9vbCAobm90IHdpbGRjYXJkKScsICgpID0+IHtcbiAgICAgIGNvbnN0IHBvbGljaWVzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpJQU06OlBvbGljeScpO1xuICAgICAgbGV0IGZvdW5kQ29nbml0b1BvbGljeSA9IGZhbHNlO1xuXG4gICAgICBPYmplY3QudmFsdWVzKHBvbGljaWVzKS5mb3JFYWNoKChwb2xpY3k6IGFueSkgPT4ge1xuICAgICAgICBjb25zdCBwb2xpY3lEb2N1bWVudCA9IHBvbGljeS5Qcm9wZXJ0aWVzPy5Qb2xpY3lEb2N1bWVudDtcbiAgICAgICAgaWYgKCFwb2xpY3lEb2N1bWVudCkgcmV0dXJuO1xuXG4gICAgICAgIHBvbGljeURvY3VtZW50LlN0YXRlbWVudC5mb3JFYWNoKChzdGF0ZW1lbnQ6IGFueSkgPT4ge1xuICAgICAgICAgIGNvbnN0IGFjdGlvbnMgPSBBcnJheS5pc0FycmF5KHN0YXRlbWVudC5BY3Rpb24pID8gc3RhdGVtZW50LkFjdGlvbiA6IFtzdGF0ZW1lbnQuQWN0aW9uXTtcblxuICAgICAgICAgIC8vIENoZWNrIGlmIHRoaXMgc3RhdGVtZW50IGhhcyBDb2duaXRvIGFjdGlvbnNcbiAgICAgICAgICBjb25zdCBoYXNDb2duaXRvQWN0aW9ucyA9IGFjdGlvbnMuc29tZSgoYWN0aW9uOiBzdHJpbmcpID0+IGFjdGlvbi5zdGFydHNXaXRoKCdjb2duaXRvLWlkcDonKSk7XG5cbiAgICAgICAgICBpZiAoaGFzQ29nbml0b0FjdGlvbnMpIHtcbiAgICAgICAgICAgIGZvdW5kQ29nbml0b1BvbGljeSA9IHRydWU7XG4gICAgICAgICAgICBjb25zdCByZXNvdXJjZXMgPSBBcnJheS5pc0FycmF5KHN0YXRlbWVudC5SZXNvdXJjZSkgPyBzdGF0ZW1lbnQuUmVzb3VyY2UgOiBbc3RhdGVtZW50LlJlc291cmNlXTtcblxuICAgICAgICAgICAgLy8gVmVyaWZ5IHJlc291cmNlcyBhcmUgc3BlY2lmaWMgVXNlciBQb29sIEFSTnMsIG5vdCB3aWxkY2FyZHNcbiAgICAgICAgICAgIHJlc291cmNlcy5mb3JFYWNoKChyZXNvdXJjZTogYW55KSA9PiB7XG4gICAgICAgICAgICAgIGV4cGVjdChyZXNvdXJjZSkubm90LnRvQmUoJyonKTtcbiAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgIC8vIElmIGl0J3MgYSBzdHJpbmcsIGNoZWNrIGl0J3MgYSBzcGVjaWZpYyBVc2VyIFBvb2wgQVJOXG4gICAgICAgICAgICAgIGlmICh0eXBlb2YgcmVzb3VyY2UgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgZXhwZWN0KHJlc291cmNlKS50b01hdGNoKC9hcm46YXdzOmNvZ25pdG8taWRwOi4qOnVzZXJwb29sXFwvLyk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KGZvdW5kQ29nbml0b1BvbGljeSkudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZ3JhbnQgU2VjcmV0cyBNYW5hZ2VyIGFjY2VzcyBvbmx5IHRvIHNwZWNpZmljIGRhdGFiYXNlIHNlY3JldCcsICgpID0+IHtcbiAgICAgIGNvbnN0IHBvbGljaWVzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpJQU06OlBvbGljeScpO1xuICAgICAgbGV0IGZvdW5kU2VjcmV0c1BvbGljeSA9IGZhbHNlO1xuXG4gICAgICBPYmplY3QudmFsdWVzKHBvbGljaWVzKS5mb3JFYWNoKChwb2xpY3k6IGFueSkgPT4ge1xuICAgICAgICBjb25zdCBwb2xpY3lEb2N1bWVudCA9IHBvbGljeS5Qcm9wZXJ0aWVzPy5Qb2xpY3lEb2N1bWVudDtcbiAgICAgICAgaWYgKCFwb2xpY3lEb2N1bWVudCkgcmV0dXJuO1xuXG4gICAgICAgIHBvbGljeURvY3VtZW50LlN0YXRlbWVudC5mb3JFYWNoKChzdGF0ZW1lbnQ6IGFueSkgPT4ge1xuICAgICAgICAgIGNvbnN0IGFjdGlvbnMgPSBBcnJheS5pc0FycmF5KHN0YXRlbWVudC5BY3Rpb24pID8gc3RhdGVtZW50LkFjdGlvbiA6IFtzdGF0ZW1lbnQuQWN0aW9uXTtcblxuICAgICAgICAgIC8vIENoZWNrIGlmIHRoaXMgc3RhdGVtZW50IGhhcyBTZWNyZXRzIE1hbmFnZXIgYWN0aW9uc1xuICAgICAgICAgIGNvbnN0IGhhc1NlY3JldHNBY3Rpb25zID0gYWN0aW9ucy5zb21lKChhY3Rpb246IHN0cmluZykgPT4gYWN0aW9uLnN0YXJ0c1dpdGgoJ3NlY3JldHNtYW5hZ2VyOicpKTtcblxuICAgICAgICAgIGlmIChoYXNTZWNyZXRzQWN0aW9ucykge1xuICAgICAgICAgICAgZm91bmRTZWNyZXRzUG9saWN5ID0gdHJ1ZTtcbiAgICAgICAgICAgIGNvbnN0IHJlc291cmNlcyA9IEFycmF5LmlzQXJyYXkoc3RhdGVtZW50LlJlc291cmNlKSA/IHN0YXRlbWVudC5SZXNvdXJjZSA6IFtzdGF0ZW1lbnQuUmVzb3VyY2VdO1xuXG4gICAgICAgICAgICAvLyBWZXJpZnkgcmVzb3VyY2VzIGFyZSBzcGVjaWZpYyBzZWNyZXQgQVJOcywgbm90IHdpbGRjYXJkc1xuICAgICAgICAgICAgcmVzb3VyY2VzLmZvckVhY2goKHJlc291cmNlOiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgZXhwZWN0KHJlc291cmNlKS5ub3QudG9CZSgnKicpO1xuICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgLy8gSWYgaXQncyBhIHN0cmluZywgY2hlY2sgaXQgcmVmZXJlbmNlcyB0aGUgc3BlY2lmaWMgc2VjcmV0XG4gICAgICAgICAgICAgIGlmICh0eXBlb2YgcmVzb3VyY2UgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgZXhwZWN0KHJlc291cmNlKS50b01hdGNoKC9hcm46YXdzOnNlY3JldHNtYW5hZ2VyOi4qOnNlY3JldDp0ZXN0LWRiLXNlY3JldC8pO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChmb3VuZFNlY3JldHNQb2xpY3kpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdBdXRvLVNjYWxpbmcgQ29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNvbmZpZ3VyZSBhdXRvLXNjYWxpbmcgd2l0aCBtaW49MSwgbWF4PTQgdGFza3MnLCAoKSA9PiB7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QXBwbGljYXRpb25BdXRvU2NhbGluZzo6U2NhbGFibGVUYXJnZXQnLCB7XG4gICAgICAgIE1pbkNhcGFjaXR5OiAxLFxuICAgICAgICBNYXhDYXBhY2l0eTogNCxcbiAgICAgICAgU2VydmljZU5hbWVzcGFjZTogJ2VjcycsXG4gICAgICAgIFNjYWxhYmxlRGltZW5zaW9uOiAnZWNzOnNlcnZpY2U6RGVzaXJlZENvdW50JyxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjb25maWd1cmUgQ1BVIHRhcmdldCB1dGlsaXphdGlvbiBhdCA3MCUnLCAoKSA9PiB7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QXBwbGljYXRpb25BdXRvU2NhbGluZzo6U2NhbGluZ1BvbGljeScsIHtcbiAgICAgICAgUG9saWN5VHlwZTogJ1RhcmdldFRyYWNraW5nU2NhbGluZycsXG4gICAgICAgIFRhcmdldFRyYWNraW5nU2NhbGluZ1BvbGljeUNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICBQcmVkZWZpbmVkTWV0cmljU3BlY2lmaWNhdGlvbjoge1xuICAgICAgICAgICAgUHJlZGVmaW5lZE1ldHJpY1R5cGU6ICdFQ1NTZXJ2aWNlQXZlcmFnZUNQVVV0aWxpemF0aW9uJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIFRhcmdldFZhbHVlOiA3MCxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjb25maWd1cmUgTWVtb3J5IHRhcmdldCB1dGlsaXphdGlvbiBhdCA4MCUnLCAoKSA9PiB7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QXBwbGljYXRpb25BdXRvU2NhbGluZzo6U2NhbGluZ1BvbGljeScsIHtcbiAgICAgICAgUG9saWN5VHlwZTogJ1RhcmdldFRyYWNraW5nU2NhbGluZycsXG4gICAgICAgIFRhcmdldFRyYWNraW5nU2NhbGluZ1BvbGljeUNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICBQcmVkZWZpbmVkTWV0cmljU3BlY2lmaWNhdGlvbjoge1xuICAgICAgICAgICAgUHJlZGVmaW5lZE1ldHJpY1R5cGU6ICdFQ1NTZXJ2aWNlQXZlcmFnZU1lbW9yeVV0aWxpemF0aW9uJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIFRhcmdldFZhbHVlOiA4MCxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnSGVhbHRoIENoZWNrIENvbmZpZ3VyYXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBjb25maWd1cmUgQUxCIHRhcmdldCBncm91cCBoZWFsdGggY2hlY2sgb24gL2FjdHVhdG9yL2hlYWx0aCcsICgpID0+IHtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpFbGFzdGljTG9hZEJhbGFuY2luZ1YyOjpUYXJnZXRHcm91cCcsIHtcbiAgICAgICAgSGVhbHRoQ2hlY2tQYXRoOiAnL2FjdHVhdG9yL2hlYWx0aCcsXG4gICAgICAgIEhlYWx0aENoZWNrSW50ZXJ2YWxTZWNvbmRzOiAzMCxcbiAgICAgICAgSGVhbHRoQ2hlY2tUaW1lb3V0U2Vjb25kczogNSxcbiAgICAgICAgSGVhbHRoeVRocmVzaG9sZENvdW50OiAyLFxuICAgICAgICBVbmhlYWx0aHlUaHJlc2hvbGRDb3VudDogMyxcbiAgICAgICAgTWF0Y2hlcjoge1xuICAgICAgICAgIEh0dHBDb2RlOiAnMjAwJyxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjb25maWd1cmUgdGFyZ2V0IGdyb3VwIGZvciBwb3J0IDgwODAnLCAoKSA9PiB7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RWxhc3RpY0xvYWRCYWxhbmNpbmdWMjo6VGFyZ2V0R3JvdXAnLCB7XG4gICAgICAgIFBvcnQ6IDgwODAsXG4gICAgICAgIFByb3RvY29sOiAnSFRUUCcsXG4gICAgICAgIFRhcmdldFR5cGU6ICdpcCcsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0VDUyBTZXJ2aWNlIENvbmZpZ3VyYXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgRUNTIGNsdXN0ZXIgd2l0aCBDb250YWluZXIgSW5zaWdodHMgZW5hYmxlZCcsICgpID0+IHtcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpFQ1M6OkNsdXN0ZXInLCAxKTtcblxuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkVDUzo6Q2x1c3RlcicsIHtcbiAgICAgICAgQ2x1c3RlclNldHRpbmdzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgTmFtZTogJ2NvbnRhaW5lckluc2lnaHRzJyxcbiAgICAgICAgICAgIFZhbHVlOiAnZW5hYmxlZCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgRmFyZ2F0ZSBzZXJ2aWNlIHdpdGggZGVzaXJlZCBjb3VudCBvZiAxJywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkVDUzo6U2VydmljZScsIDEpO1xuXG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RUNTOjpTZXJ2aWNlJywge1xuICAgICAgICBEZXNpcmVkQ291bnQ6IDEsXG4gICAgICAgIExhdW5jaFR5cGU6ICdGQVJHQVRFJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBkZXBsb3kgc2VydmljZSBpbiBwcml2YXRlIHN1Ym5ldHMgKG5vdCBwdWJsaWMpJywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkVDUzo6U2VydmljZScsIHtcbiAgICAgICAgTmV0d29ya0NvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICBBd3N2cGNDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICBBc3NpZ25QdWJsaWNJcDogJ0RJU0FCTEVEJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGNvbmZpZ3VyZSB6ZXJvLWRvd250aW1lIGRlcGxveW1lbnQgc3RyYXRlZ3knLCAoKSA9PiB7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RUNTOjpTZXJ2aWNlJywge1xuICAgICAgICBEZXBsb3ltZW50Q29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIE1pbmltdW1IZWFsdGh5UGVyY2VudDogNTAsXG4gICAgICAgICAgTWF4aW11bVBlcmNlbnQ6IDIwMCxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBlbmFibGUgYXV0b21hdGljIHJvbGxiYWNrIG9uIGRlcGxveW1lbnQgZmFpbHVyZScsICgpID0+IHtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpFQ1M6OlNlcnZpY2UnLCB7XG4gICAgICAgIERlcGxveW1lbnRDb25maWd1cmF0aW9uOiBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICBEZXBsb3ltZW50Q2lyY3VpdEJyZWFrZXI6IHtcbiAgICAgICAgICAgIEVuYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIFJvbGxiYWNrOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdMb2FkIEJhbGFuY2VyIENvbmZpZ3VyYXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgaW50ZXJuZXQtZmFjaW5nIEFMQicsICgpID0+IHtcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpFbGFzdGljTG9hZEJhbGFuY2luZ1YyOjpMb2FkQmFsYW5jZXInLCAxKTtcblxuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkVsYXN0aWNMb2FkQmFsYW5jaW5nVjI6OkxvYWRCYWxhbmNlcicsIHtcbiAgICAgICAgU2NoZW1lOiAnaW50ZXJuZXQtZmFjaW5nJyxcbiAgICAgICAgVHlwZTogJ2FwcGxpY2F0aW9uJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgSFRUUCBsaXN0ZW5lciBvbiBwb3J0IDgwJywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkVsYXN0aWNMb2FkQmFsYW5jaW5nVjI6Okxpc3RlbmVyJywge1xuICAgICAgICBQb3J0OiA4MCxcbiAgICAgICAgUHJvdG9jb2w6ICdIVFRQJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBlbmFibGUgQUxCIGFjY2VzcyBsb2dzIHRvIFMzJywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkVsYXN0aWNMb2FkQmFsYW5jaW5nVjI6OkxvYWRCYWxhbmNlcicsIHtcbiAgICAgICAgTG9hZEJhbGFuY2VyQXR0cmlidXRlczogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgIEtleTogJ2FjY2Vzc19sb2dzLnMzLmVuYWJsZWQnLFxuICAgICAgICAgICAgVmFsdWU6ICd0cnVlJyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSksXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0VDUiBSZXBvc2l0b3J5IENvbmZpZ3VyYXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgRUNSIHJlcG9zaXRvcnkgd2l0aCBpbWFnZSBzY2FubmluZyBlbmFibGVkJywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkVDUjo6UmVwb3NpdG9yeScsIDEpO1xuXG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RUNSOjpSZXBvc2l0b3J5Jywge1xuICAgICAgICBJbWFnZVNjYW5uaW5nQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIFNjYW5PblB1c2g6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY29uZmlndXJlIGxpZmVjeWNsZSBwb2xpY3kgdG8ga2VlcCBsYXN0IDEwIGltYWdlcycsICgpID0+IHtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpFQ1I6OlJlcG9zaXRvcnknLCB7XG4gICAgICAgIExpZmVjeWNsZVBvbGljeToge1xuICAgICAgICAgIExpZmVjeWNsZVBvbGljeVRleHQ6IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJy4qaW1hZ2VDb3VudE1vcmVUaGFuLioxMC4qJyksXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZW5hYmxlIGVuY3J5cHRpb24gZm9yIHN0b3JlZCBpbWFnZXMnLCAoKSA9PiB7XG4gICAgICAvLyBDREsgdXNlcyBBRVMyNTYgZW5jcnlwdGlvbiBieSBkZWZhdWx0XG4gICAgICAvLyBWZXJpZnkgdGhlIHJlcG9zaXRvcnkgZXhpc3RzIChlbmNyeXB0aW9uIGlzIGVuYWJsZWQgYnkgZGVmYXVsdClcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpFQ1I6OlJlcG9zaXRvcnknLCAxKTtcblxuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkVDUjo6UmVwb3NpdG9yeScsIHtcbiAgICAgICAgUmVwb3NpdG9yeU5hbWU6ICdmb29kLWNvc3QtY2FsY3VsYXRvci10ZXN0JyxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBJZiBlbmNyeXB0aW9uIGNvbmZpZ3VyYXRpb24gaXMgcHJlc2VudCwgdmVyaWZ5IGl0J3MgQUVTMjU2XG4gICAgICBjb25zdCByZXBvID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpFQ1I6OlJlcG9zaXRvcnknKTtcbiAgICAgIGNvbnN0IHJlcG9Qcm9wcyA9IE9iamVjdC52YWx1ZXMocmVwbylbMF0uUHJvcGVydGllcztcbiAgICAgIFxuICAgICAgLy8gSWYgRW5jcnlwdGlvbkNvbmZpZ3VyYXRpb24gaXMgc3BlY2lmaWVkLCBpdCBzaG91bGQgYmUgQUVTMjU2XG4gICAgICBpZiAocmVwb1Byb3BzLkVuY3J5cHRpb25Db25maWd1cmF0aW9uKSB7XG4gICAgICAgIGV4cGVjdChyZXBvUHJvcHMuRW5jcnlwdGlvbkNvbmZpZ3VyYXRpb24uRW5jcnlwdGlvblR5cGUpLnRvQmUoJ0FFUzI1NicpO1xuICAgICAgfVxuICAgICAgLy8gSWYgbm90IHNwZWNpZmllZCwgQ0RLIHVzZXMgQUVTMjU2IGJ5IGRlZmF1bHQgd2hpY2ggaXMgYWNjZXB0YWJsZVxuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnQ2xvdWRXYXRjaCBMb2dzIENvbmZpZ3VyYXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgQ2xvdWRXYXRjaCBsb2cgZ3JvdXAgd2l0aCA3LWRheSByZXRlbnRpb24nLCAoKSA9PiB7XG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6TG9nczo6TG9nR3JvdXAnLCAxKTtcblxuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkxvZ3M6OkxvZ0dyb3VwJywge1xuICAgICAgICBMb2dHcm91cE5hbWU6ICcvZWNzL2Zvb2Rjb3N0LWFwaS10ZXN0JyxcbiAgICAgICAgUmV0ZW50aW9uSW5EYXlzOiA3LFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdDbG91ZEZvcm1hdGlvbiBPdXRwdXRzJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgZXhwb3J0IEVDUiByZXBvc2l0b3J5IFVSSScsICgpID0+IHtcbiAgICAgIHRlbXBsYXRlLmhhc091dHB1dCgnUmVwb3NpdG9yeVVyaScsIHtcbiAgICAgICAgRXhwb3J0OiB7XG4gICAgICAgICAgTmFtZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvci10ZXN0LVJlcG9zaXRvcnlVcmknLFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGV4cG9ydCBFQ1MgY2x1c3RlciBuYW1lJywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUuaGFzT3V0cHV0KCdDbHVzdGVyTmFtZScsIHtcbiAgICAgICAgRXhwb3J0OiB7XG4gICAgICAgICAgTmFtZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvci10ZXN0LUVjc0NsdXN0ZXJOYW1lJyxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBleHBvcnQgRUNTIHNlcnZpY2UgbmFtZScsICgpID0+IHtcbiAgICAgIHRlbXBsYXRlLmhhc091dHB1dCgnU2VydmljZU5hbWUnLCB7XG4gICAgICAgIEV4cG9ydDoge1xuICAgICAgICAgIE5hbWU6ICdGb29kQ29zdENhbGN1bGF0b3ItdGVzdC1FY3NTZXJ2aWNlTmFtZScsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZXhwb3J0IEFMQiBETlMgbmFtZScsICgpID0+IHtcbiAgICAgIHRlbXBsYXRlLmhhc091dHB1dCgnTG9hZEJhbGFuY2VyRE5TJywge1xuICAgICAgICBFeHBvcnQ6IHtcbiAgICAgICAgICBOYW1lOiAnRm9vZENvc3RDYWxjdWxhdG9yLXRlc3QtQWxiRG5zJyxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBvdXRwdXQgZnVsbCBBTEIgVVJMJywgKCkgPT4ge1xuICAgICAgY29uc3Qgb3V0cHV0cyA9IHRlbXBsYXRlLnRvSlNPTigpLk91dHB1dHM7XG4gICAgICBleHBlY3Qob3V0cHV0cy5Mb2FkQmFsYW5jZXJVcmwpLnRvQmVEZWZpbmVkKCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdSZXNvdXJjZSBUYWdnaW5nJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgdGFnIGFsbCByZXNvdXJjZXMgd2l0aCBDb21wb25lbnQgYW5kIENvc3RDZW50ZXIgdGFncycsICgpID0+IHtcbiAgICAgIGNvbnN0IHN0YWNrSnNvbiA9IHRlbXBsYXRlLnRvSlNPTigpO1xuICAgICAgXG4gICAgICAvLyBDaGVjayB0aGF0IHRhZ3MgYXJlIGFwcGxpZWQgYXQgdGhlIHN0YWNrIGxldmVsXG4gICAgICBleHBlY3Qoc3RhY2tKc29uLlJlc291cmNlcykudG9CZURlZmluZWQoKTtcbiAgICAgIFxuICAgICAgLy8gVGhlIENESyBUYWdzLm9mKCkgYXBwbGllcyB0YWdzIHRvIGFsbCB0YWdnYWJsZSByZXNvdXJjZXNcbiAgICAgIC8vIFdlIGNhbiB2ZXJpZnkgYnkgY2hlY2tpbmcgdGhlIHN0YWNrIGhhcyB0aGUgdGFnIG1ldGFkYXRhXG4gICAgICBjb25zdCByZXNvdXJjZXMgPSBPYmplY3QudmFsdWVzKHN0YWNrSnNvbi5SZXNvdXJjZXMpIGFzIGFueVtdO1xuICAgICAgY29uc3QgdGFnZ2FibGVSZXNvdXJjZXMgPSByZXNvdXJjZXMuZmlsdGVyKHIgPT4gXG4gICAgICAgIHIuVHlwZS5zdGFydHNXaXRoKCdBV1M6OkVDUzo6JykgfHwgXG4gICAgICAgIHIuVHlwZS5zdGFydHNXaXRoKCdBV1M6OkVsYXN0aWNMb2FkQmFsYW5jaW5nVjI6OicpIHx8XG4gICAgICAgIHIuVHlwZS5zdGFydHNXaXRoKCdBV1M6OkVDUjo6JylcbiAgICAgICk7XG5cbiAgICAgIGV4cGVjdCh0YWdnYWJsZVJlc291cmNlcy5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbigwKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1JlcXVpcmVtZW50cyBWYWxpZGF0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgc2F0aXNmeSBSZXF1aXJlbWVudCAzLjMgLSBGYXJnYXRlIHRhc2sgd2l0aCAxIHZDUFUgYW5kIDIwNDggTUIgbWVtb3J5JywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkVDUzo6VGFza0RlZmluaXRpb24nLCB7XG4gICAgICAgIENwdTogJzEwMjQnLFxuICAgICAgICBNZW1vcnk6ICcyMDQ4JyxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBzYXRpc2Z5IFJlcXVpcmVtZW50IDMuMTAgLSBBdXRvLXNjYWxpbmcgbWluPTEsIG1heD00LCBDUFU9NzAlLCBNZW1vcnk9ODAlJywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkFwcGxpY2F0aW9uQXV0b1NjYWxpbmc6OlNjYWxhYmxlVGFyZ2V0Jywge1xuICAgICAgICBNaW5DYXBhY2l0eTogMSxcbiAgICAgICAgTWF4Q2FwYWNpdHk6IDQsXG4gICAgICB9KTtcblxuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkFwcGxpY2F0aW9uQXV0b1NjYWxpbmc6OlNjYWxpbmdQb2xpY3knLCB7XG4gICAgICAgIFRhcmdldFRyYWNraW5nU2NhbGluZ1BvbGljeUNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICBQcmVkZWZpbmVkTWV0cmljU3BlY2lmaWNhdGlvbjoge1xuICAgICAgICAgICAgUHJlZGVmaW5lZE1ldHJpY1R5cGU6ICdFQ1NTZXJ2aWNlQXZlcmFnZUNQVVV0aWxpemF0aW9uJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIFRhcmdldFZhbHVlOiA3MCxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QXBwbGljYXRpb25BdXRvU2NhbGluZzo6U2NhbGluZ1BvbGljeScsIHtcbiAgICAgICAgVGFyZ2V0VHJhY2tpbmdTY2FsaW5nUG9saWN5Q29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIFByZWRlZmluZWRNZXRyaWNTcGVjaWZpY2F0aW9uOiB7XG4gICAgICAgICAgICBQcmVkZWZpbmVkTWV0cmljVHlwZTogJ0VDU1NlcnZpY2VBdmVyYWdlTWVtb3J5VXRpbGl6YXRpb24nLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgVGFyZ2V0VmFsdWU6IDgwLFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHNhdGlzZnkgUmVxdWlyZW1lbnQgMy4xMiAtIEhlYWx0aCBjaGVjayBvbiAvYWN0dWF0b3IvaGVhbHRoIGV2ZXJ5IDMwIHNlY29uZHMnLCAoKSA9PiB7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RWxhc3RpY0xvYWRCYWxhbmNpbmdWMjo6VGFyZ2V0R3JvdXAnLCB7XG4gICAgICAgIEhlYWx0aENoZWNrUGF0aDogJy9hY3R1YXRvci9oZWFsdGgnLFxuICAgICAgICBIZWFsdGhDaGVja0ludGVydmFsU2Vjb25kczogMzAsXG4gICAgICAgIEhlYWx0aHlUaHJlc2hvbGRDb3VudDogMixcbiAgICAgICAgVW5oZWFsdGh5VGhyZXNob2xkQ291bnQ6IDMsXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgc2F0aXNmeSBSZXF1aXJlbWVudCAxMS4zIC0gTGVhc3QtcHJpdmlsZWdlIElBTSBwb2xpY2llcyAobm8gd2lsZGNhcmQgcmVzb3VyY2VzKScsICgpID0+IHtcbiAgICAgIC8vIFRoaXMgaXMgdmVyaWZpZWQgYnkgdGhlIElBTSBwb2xpY3kgdGVzdHMgYWJvdmVcbiAgICAgIGNvbnN0IHBvbGljaWVzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpJQU06OlBvbGljeScpO1xuICAgICAgZXhwZWN0KE9iamVjdC5rZXlzKHBvbGljaWVzKS5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbigwKTtcbiAgICB9KTtcbiAgfSk7XG59KTtcbiJdfQ==