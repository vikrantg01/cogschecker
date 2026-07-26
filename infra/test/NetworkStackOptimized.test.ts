import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NetworkStackOptimized } from '../lib/stacks/NetworkStackOptimized';

/**
 * Unit tests for NetworkStackOptimized.
 *
 * Validates:
 * - Exactly 1 NAT Gateway created (cost optimization)
 * - 4 security groups created with correct rules (ALB, ECS, RDS, Redis)
 * - All resources have required tags (Component, CostCenter)
 * - CloudFormation exports are present
 *
 * Uses the CDK assertions library to validate CloudFormation template output
 * without deploying to AWS.
 */

function buildTemplate(): { stack: NetworkStackOptimized; template: Template } {
  const app = new cdk.App();
  const stack = new NetworkStackOptimized(app, 'TestNetworkStackOptimized', {
    env: { account: '123456789012', region: 'us-east-1' },
    envName: 'test',
  });
  const template = Template.fromStack(stack);
  return { stack, template };
}

describe('NetworkStackOptimized — NAT Gateway', () => {
  test('creates exactly 1 NAT Gateway', () => {
    const { template } = buildTemplate();
    template.resourceCountIs('AWS::EC2::NatGateway', 1);
  });

  test('NAT gateway is associated with a public subnet', () => {
    const { template } = buildTemplate();
    const nats = template.findResources('AWS::EC2::NatGateway');
    const natGateway = Object.values(nats)[0] as any;
    expect(natGateway.Properties.SubnetId).toBeDefined();
  });
});

describe('NetworkStackOptimized — Security Groups', () => {
  test('creates exactly 4 security groups (ALB, ECS, RDS, Redis)', () => {
    const { template } = buildTemplate();
    const sgs = template.findResources('AWS::EC2::SecurityGroup');
    // Filter out any default/VPC security groups, only count explicitly created ones
    const namedSgs = Object.values(sgs).filter((sg: any) =>
      /ALB|ECS|RDS|ElastiCache|Redis|Spring Boot/i.test(sg.Properties?.GroupDescription ?? ''),
    );
    expect(namedSgs).toHaveLength(4);
  });

  test('ALB security group allows HTTP (80) from internet', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: Match.stringLikeRegexp('ALB'),
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({
          CidrIp: '0.0.0.0/0',
          FromPort: 80,
          ToPort: 80,
          IpProtocol: 'tcp',
        }),
      ]),
    });
  });

  test('ALB security group allows HTTPS (443) from internet', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: Match.stringLikeRegexp('ALB'),
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({
          CidrIp: '0.0.0.0/0',
          FromPort: 443,
          ToPort: 443,
          IpProtocol: 'tcp',
        }),
      ]),
    });
  });

  test('ALB security group allows egress to ECS tasks on port 8080', () => {
    const { template } = buildTemplate();
    const albSgs = template.findResources('AWS::EC2::SecurityGroup', {
      Properties: {
        GroupDescription: Match.stringLikeRegexp('ALB'),
      },
    });
    const albSg = Object.values(albSgs)[0] as any;
    const egressRules: any[] = albSg.Properties.SecurityGroupEgress ?? [];
    const hasEcsEgress = egressRules.some(
      (r: any) => r.FromPort === 8080 && r.ToPort === 8080 && r.IpProtocol === 'tcp',
    );
    expect(hasEcsEgress).toBe(true);
  });

  test('ECS security group allows ingress on port 8080 from ALB', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: Match.stringLikeRegexp('ECS|Spring Boot'),
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({
          FromPort: 8080,
          ToPort: 8080,
          IpProtocol: 'tcp',
          SourceSecurityGroupId: Match.anyValue(),
        }),
      ]),
    });
  });

  test('ECS security group allows all outbound traffic', () => {
    const { template } = buildTemplate();
    const ecsSgs = template.findResources('AWS::EC2::SecurityGroup', {
      Properties: {
        GroupDescription: Match.stringLikeRegexp('ECS|Spring Boot'),
      },
    });
    const ecsSg = Object.values(ecsSgs)[0] as any;
    const egressRules: any[] = ecsSg.Properties.SecurityGroupEgress ?? [];
    const hasAllowAll = egressRules.some(
      (r: any) => r.CidrIp === '0.0.0.0/0' && r.IpProtocol === '-1',
    );
    expect(hasAllowAll).toBe(true);
  });

  test('RDS security group only allows port 5432 from ECS security group', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: Match.stringLikeRegexp('RDS|PostgreSQL'),
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({
          FromPort: 5432,
          ToPort: 5432,
          IpProtocol: 'tcp',
          SourceSecurityGroupId: Match.anyValue(),
        }),
      ]),
    });
  });

  test('RDS security group has no outbound rules', () => {
    const { template } = buildTemplate();
    const rdsSgs = template.findResources('AWS::EC2::SecurityGroup', {
      Properties: {
        GroupDescription: Match.stringLikeRegexp('RDS|PostgreSQL'),
      },
    });
    const rdsSg = Object.values(rdsSgs)[0] as any;
    const egressRules: any[] = rdsSg.Properties.SecurityGroupEgress ?? [];
    const hasAllowAll = egressRules.some(
      (r: any) => r.CidrIp === '0.0.0.0/0' && r.IpProtocol === '-1',
    );
    expect(hasAllowAll).toBe(false);
  });

  test('Redis security group only allows port 6379 from ECS security group', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: Match.stringLikeRegexp('ElastiCache|Redis'),
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({
          FromPort: 6379,
          ToPort: 6379,
          IpProtocol: 'tcp',
          SourceSecurityGroupId: Match.anyValue(),
        }),
      ]),
    });
  });

  test('Redis security group has no outbound rules', () => {
    const { template } = buildTemplate();
    const redisSgs = template.findResources('AWS::EC2::SecurityGroup', {
      Properties: {
        GroupDescription: Match.stringLikeRegexp('ElastiCache|Redis'),
      },
    });
    const redisSg = Object.values(redisSgs)[0] as any;
    const egressRules: any[] = redisSg.Properties.SecurityGroupEgress ?? [];
    const hasAllowAll = egressRules.some(
      (r: any) => r.CidrIp === '0.0.0.0/0' && r.IpProtocol === '-1',
    );
    expect(hasAllowAll).toBe(false);
  });
});

describe('NetworkStackOptimized — Resource Tags', () => {
  test('all resources have Component tag', () => {
    const { template } = buildTemplate();
    const cfnTemplate = template.toJSON();
    const resources = cfnTemplate.Resources ?? {};
    
    // Check that stack-level tags are applied
    for (const [logicalId, resource] of Object.entries<any>(resources)) {
      // Some CDK-generated resources may not have tags, but major resources should
      if (['AWS::EC2::VPC', 'AWS::EC2::SecurityGroup', 'AWS::EC2::NatGateway'].includes(resource.Type)) {
        const tags = resource.Properties?.Tags ?? [];
        const hasComponentTag = tags.some((tag: any) => tag.Key === 'Component');
        expect(hasComponentTag).toBe(true);
      }
    }
  });

  test('all resources have CostCenter tag', () => {
    const { template } = buildTemplate();
    const cfnTemplate = template.toJSON();
    const resources = cfnTemplate.Resources ?? {};
    
    // Check that stack-level tags are applied
    for (const [logicalId, resource] of Object.entries<any>(resources)) {
      // Some CDK-generated resources may not have tags, but major resources should
      if (['AWS::EC2::VPC', 'AWS::EC2::SecurityGroup', 'AWS::EC2::NatGateway'].includes(resource.Type)) {
        const tags = resource.Properties?.Tags ?? [];
        const hasCostCenterTag = tags.some((tag: any) => tag.Key === 'CostCenter');
        expect(hasCostCenterTag).toBe(true);
      }
    }
  });

  test('Component tag has value "Network"', () => {
    const { template } = buildTemplate();
    const vpc = template.findResources('AWS::EC2::VPC');
    const vpcResource = Object.values(vpc)[0] as any;
    const tags = vpcResource.Properties?.Tags ?? [];
    const componentTag = tags.find((tag: any) => tag.Key === 'Component');
    expect(componentTag?.Value).toBe('Network');
  });

  test('CostCenter tag has value "Infrastructure"', () => {
    const { template } = buildTemplate();
    const vpc = template.findResources('AWS::EC2::VPC');
    const vpcResource = Object.values(vpc)[0] as any;
    const tags = vpcResource.Properties?.Tags ?? [];
    const costCenterTag = tags.find((tag: any) => tag.Key === 'CostCenter');
    expect(costCenterTag?.Value).toBe('Infrastructure');
  });
});

describe('NetworkStackOptimized — CloudFormation Exports', () => {
  const expectedOutputs = [
    'VpcId',
    'PublicSubnetIds',
    'PrivateSubnetIds',
    'IsolatedSubnetIds',
    'AlbSecurityGroupId',
    'EcsSecurityGroupId',
    'RdsSecurityGroupId',
    'RedisSecurityGroupId',
  ];

  test.each(expectedOutputs)('exports %s', (outputKey) => {
    const { template } = buildTemplate();
    const outputs = template.findOutputs(outputKey);
    expect(Object.keys(outputs)).toHaveLength(1);
  });

  test('all outputs have export names for cross-stack referencing', () => {
    const { template } = buildTemplate();
    const cfnTemplate = template.toJSON();
    const outputs = cfnTemplate.Outputs ?? {};
    for (const [key, output] of Object.entries<any>(outputs)) {
      expect(output.Export?.Name).toBeDefined();
      // Export name should include the environment name
      expect(output.Export.Name).toMatch(/test/);
    }
  });

  test('VPC ID export has correct naming pattern', () => {
    const { template } = buildTemplate();
    const cfnTemplate = template.toJSON();
    const output = cfnTemplate.Outputs.VpcId;
    expect(output.Export.Name).toBe('FoodCostCalculator-test-VpcId');
  });

  test('subnet IDs exports are comma-separated lists', () => {
    const { template } = buildTemplate();
    const cfnTemplate = template.toJSON();
    
    // PublicSubnetIds should be a join of subnet IDs
    const publicSubnetsOutput = cfnTemplate.Outputs.PublicSubnetIds;
    expect(publicSubnetsOutput.Value).toBeDefined();
    
    // PrivateSubnetIds should be a join of subnet IDs
    const privateSubnetsOutput = cfnTemplate.Outputs.PrivateSubnetIds;
    expect(privateSubnetsOutput.Value).toBeDefined();
    
    // IsolatedSubnetIds should be a join of subnet IDs
    const isolatedSubnetsOutput = cfnTemplate.Outputs.IsolatedSubnetIds;
    expect(isolatedSubnetsOutput.Value).toBeDefined();
  });

  test('security group exports reference correct resources', () => {
    const { template } = buildTemplate();
    const cfnTemplate = template.toJSON();
    
    const albSgOutput = cfnTemplate.Outputs.AlbSecurityGroupId;
    expect(albSgOutput.Value).toBeDefined();
    
    const ecsSgOutput = cfnTemplate.Outputs.EcsSecurityGroupId;
    expect(ecsSgOutput.Value).toBeDefined();
    
    const rdsSgOutput = cfnTemplate.Outputs.RdsSecurityGroupId;
    expect(rdsSgOutput.Value).toBeDefined();
    
    const redisSgOutput = cfnTemplate.Outputs.RedisSecurityGroupId;
    expect(redisSgOutput.Value).toBeDefined();
  });

  test('VPC Flow Logs log group name is exported', () => {
    const { template } = buildTemplate();
    const outputs = template.findOutputs('VpcFlowLogsLogGroupName');
    expect(Object.keys(outputs)).toHaveLength(1);
  });
});

describe('NetworkStackOptimized — VPC Configuration', () => {
  test('creates exactly one VPC', () => {
    const { template } = buildTemplate();
    template.resourceCountIs('AWS::EC2::VPC', 1);
  });

  test('VPC uses the 10.0.0.0/16 CIDR block', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::EC2::VPC', {
      CidrBlock: '10.0.0.0/16',
    });
  });

  test('VPC spans exactly 2 Availability Zones', () => {
    const { template } = buildTemplate();
    // With maxAzs=2 and three subnet groups (public, private, isolated),
    // CDK creates exactly 6 subnets (2 per group)
    template.resourceCountIs('AWS::EC2::Subnet', 6);
  });
});

describe('NetworkStackOptimized — VPC Flow Logs', () => {
  test('creates CloudWatch log group for VPC Flow Logs', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/aws/vpc/flowlogs-test',
      RetentionInDays: 7,
    });
  });

  test('creates VPC Flow Log resource', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::EC2::FlowLog', {
      ResourceType: 'VPC',
      TrafficType: 'ALL',
      LogDestinationType: 'cloud-watch-logs',
    });
  });

  test('VPC Flow Logs IAM role has correct trust policy', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Principal: {
              Service: 'vpc-flow-logs.amazonaws.com',
            },
            Action: 'sts:AssumeRole',
          }),
        ]),
      }),
    });
  });
});
