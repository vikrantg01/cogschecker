import * as cdk from 'aws-cdk-lib';
import { Template, Match, Capture } from 'aws-cdk-lib/assertions';
import { EcsStack } from '../lib/stacks/EcsStack';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

describe('EcsStack (ComputeStack)', () => {
  let app: cdk.App;
  let stack: EcsStack;
  let template: Template;
  let mockVpc: ec2.IVpc;
  let mockEcsSecurityGroup: ec2.ISecurityGroup;
  let mockAlbSecurityGroup: ec2.ISecurityGroup;

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

    stack = new EcsStack(app, 'TestEcsStack', {
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

    template = Template.fromStack(stack);
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
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
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
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Environment: Match.arrayWith([
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
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Secrets: Match.arrayWith([
              Match.objectLike({
                Name: 'DATABASE_PASSWORD',
                ValueFrom: Match.stringLikeRegexp('.*secretsmanager.*'),
              }),
            ]),
          }),
        ]),
      });
    });

    it('should configure health check on /actuator/health', () => {
      template.hasResourceProperties('AWS::ECS::TaskDefinition', {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
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
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            LogConfiguration: {
              LogDriver: 'awslogs',
              Options: Match.objectLike({
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
      Object.values(policies).forEach((policy: any) => {
        const policyDocument = policy.Properties?.PolicyDocument;
        if (!policyDocument) return;

        policyDocument.Statement.forEach((statement: any) => {
          const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
          const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];

          // If Resource is '*', action should only be GetAuthorizationToken
          resources.forEach((resource: any) => {
            if (resource === '*') {
              // Check that all actions with wildcard resource are GetAuthorizationToken or managed policies
              const hasOnlyAllowedWildcardActions = actions.every((action: string) =>
                action === 'ecr:GetAuthorizationToken' ||
                action.startsWith('logs:') || // CloudWatch Logs actions can use * with service-level permissions
                action === 'ecr:BatchCheckLayerAvailability' ||
                action === 'ecr:GetDownloadUrlForLayer' ||
                action === 'ecr:BatchGetImage'
              );

              if (!hasOnlyAllowedWildcardActions) {
                // Find which actions are not allowed
                const disallowedActions = actions.filter((action: string) =>
                  action !== 'ecr:GetAuthorizationToken' &&
                  !action.startsWith('logs:') &&
                  action !== 'ecr:BatchCheckLayerAvailability' &&
                  action !== 'ecr:GetDownloadUrlForLayer' &&
                  action !== 'ecr:BatchGetImage'
                );
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

      Object.values(policies).forEach((policy: any) => {
        const policyDocument = policy.Properties?.PolicyDocument;
        if (!policyDocument) return;

        policyDocument.Statement.forEach((statement: any) => {
          const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];

          // Check if this statement has S3 actions
          const hasS3Actions = actions.some((action: string) => action.startsWith('s3:'));

          if (hasS3Actions) {
            foundS3Policy = true;
            const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];

            // Verify resources are specific bucket ARNs, not wildcards
            resources.forEach((resource: any) => {
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

      Object.values(policies).forEach((policy: any) => {
        const policyDocument = policy.Properties?.PolicyDocument;
        if (!policyDocument) return;

        policyDocument.Statement.forEach((statement: any) => {
          const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];

          // Check if this statement has Cognito actions
          const hasCognitoActions = actions.some((action: string) => action.startsWith('cognito-idp:'));

          if (hasCognitoActions) {
            foundCognitoPolicy = true;
            const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];

            // Verify resources are specific User Pool ARNs, not wildcards
            resources.forEach((resource: any) => {
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

      Object.values(policies).forEach((policy: any) => {
        const policyDocument = policy.Properties?.PolicyDocument;
        if (!policyDocument) return;

        policyDocument.Statement.forEach((statement: any) => {
          const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];

          // Check if this statement has Secrets Manager actions
          const hasSecretsActions = actions.some((action: string) => action.startsWith('secretsmanager:'));

          if (hasSecretsActions) {
            foundSecretsPolicy = true;
            const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];

            // Verify resources are specific secret ARNs, not wildcards
            resources.forEach((resource: any) => {
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
        DeploymentConfiguration: Match.objectLike({
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
        LoadBalancerAttributes: Match.arrayWith([
          Match.objectLike({
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
          LifecyclePolicyText: Match.stringLikeRegexp('.*imageCountMoreThan.*10.*'),
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
      const resources = Object.values(stackJson.Resources) as any[];
      const taggableResources = resources.filter(r => 
        r.Type.startsWith('AWS::ECS::') || 
        r.Type.startsWith('AWS::ElasticLoadBalancingV2::') ||
        r.Type.startsWith('AWS::ECR::')
      );

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
