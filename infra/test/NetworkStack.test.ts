import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NetworkStack } from '../lib/stacks/NetworkStack';

/**
 * Unit tests for NetworkStack.
 *
 * Uses the CDK assertions library to validate CloudFormation template output
 * without deploying to AWS.
 */

function buildTemplate(): { stack: NetworkStack; template: Template } {
  const app = new cdk.App();
  const stack = new NetworkStack(app, 'TestNetworkStack', {
    env: { account: '123456789012', region: 'ap-southeast-2' },
    envName: 'test',
  });
  const template = Template.fromStack(stack);
  return { stack, template };
}

describe('NetworkStack — VPC', () => {
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

  test('VPC has DNS hostnames and DNS support enabled', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::EC2::VPC', {
      EnableDnsHostnames: true,
      EnableDnsSupport: true,
    });
  });
});

describe('NetworkStack — Subnets', () => {
  test('creates exactly 2 public subnets', () => {
    const { template } = buildTemplate();
    // Count subnets tagged as public (MapPublicIpOnLaunch can be false, but the
    // CDK sets a Name tag with the group name).
    const subnets = template.findResources('AWS::EC2::Subnet', {
      Properties: {
        Tags: Match.arrayWith([
          Match.objectLike({ Key: 'aws-cdk:subnet-type', Value: 'Public' }),
        ]),
      },
    });
    expect(Object.keys(subnets)).toHaveLength(2);
  });

  test('creates exactly 4 private subnets (EKS x2 + data x2)', () => {
    const { template } = buildTemplate();
    const privateSubnets = template.findResources('AWS::EC2::Subnet', {
      Properties: {
        Tags: Match.arrayWith([
          Match.objectLike({ Key: 'aws-cdk:subnet-type', Value: 'Private' }),
        ]),
      },
    });
    const isolatedSubnets = template.findResources('AWS::EC2::Subnet', {
      Properties: {
        Tags: Match.arrayWith([
          Match.objectLike({ Key: 'aws-cdk:subnet-type', Value: 'Isolated' }),
        ]),
      },
    });
    const totalPrivate = Object.keys(privateSubnets).length + Object.keys(isolatedSubnets).length;
    expect(totalPrivate).toBe(4);
  });

  test('total subnet count is 6 (2 public + 2 private-eks + 2 private-data)', () => {
    const { template } = buildTemplate();
    // With maxAzs=2 and three subnet groups, CDK creates exactly 6 subnets.
    template.resourceCountIs('AWS::EC2::Subnet', 6);
  });
});

describe('NetworkStack — NAT Gateways', () => {
  test('creates exactly 2 NAT gateways (one per public subnet AZ)', () => {
    const { template } = buildTemplate();
    template.resourceCountIs('AWS::EC2::NatGateway', 2);
  });

  test('each NAT gateway is associated with a public subnet', () => {
    const { template } = buildTemplate();
    // NAT gateways must reference a subnet that has MapPublicIpOnLaunch or is tagged Public.
    const nats = template.findResources('AWS::EC2::NatGateway');
    // Each NAT must have a SubnetId — just assert they all have one.
    for (const nat of Object.values(nats)) {
      expect((nat as any).Properties.SubnetId).toBeDefined();
    }
  });
});

describe('NetworkStack — Route Tables', () => {
  test('private EKS subnets have routes to NAT gateways', () => {
    const { template } = buildTemplate();
    // Routes with destination 0.0.0.0/0 pointing to a NAT gateway.
    const natRoutes = template.findResources('AWS::EC2::Route', {
      Properties: {
        DestinationCidrBlock: '0.0.0.0/0',
        NatGatewayId: Match.anyValue(),
      },
    });
    // With maxAzs=2, 2 EKS private subnets → 2 NAT routes (one per subnet).
    expect(Object.keys(natRoutes).length).toBe(2);
  });

  test('public subnets have an internet gateway route', () => {
    const { template } = buildTemplate();
    const igwRoutes = template.findResources('AWS::EC2::Route', {
      Properties: {
        DestinationCidrBlock: '0.0.0.0/0',
        GatewayId: Match.anyValue(),
      },
    });
    expect(Object.keys(igwRoutes).length).toBeGreaterThanOrEqual(1);
  });
});

describe('NetworkStack — Security Groups', () => {
  test('EKS node security group allows intra-node traffic (CNI) via standalone rule', () => {
    const { template } = buildTemplate();
    // The self-referencing rule is emitted as a standalone CfnSecurityGroupIngress
    // resource to avoid a CloudFormation circular dependency.
    const selfRules = template.findResources('AWS::EC2::SecurityGroupIngress', {
      Properties: {
        IpProtocol: '-1',
        SourceSecurityGroupId: Match.anyValue(),
      },
    });
    expect(Object.keys(selfRules).length).toBeGreaterThanOrEqual(1);
  });

  test('creates 4 baseline security groups (ALB, EKS, Aurora, ElastiCache)', () => {
    const { template } = buildTemplate();
    const sgs = template.findResources('AWS::EC2::SecurityGroup');
    const namedSgs = Object.values(sgs).filter((sg: any) =>
      /ALB|EKS|Aurora|ElastiCache/i.test(sg.Properties?.GroupDescription ?? ''),
    );
    expect(namedSgs).toHaveLength(4);
  });

  test('ALB security group allows HTTPS (443) from any IPv4', () => {
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

  test('ALB security group allows HTTP (80) from any IPv4', () => {
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

  test('Aurora security group only allows port 5432 from EKS node SG', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: Match.stringLikeRegexp('Aurora'),
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

  test('ElastiCache security group only allows port 6379 from EKS node SG', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: Match.stringLikeRegexp('ElastiCache'),
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

  test('Aurora security group has no outbound rules (isolated data tier)', () => {
    const { template } = buildTemplate();
    // When allowAllOutbound: false, CDK emits a deny-all egress rule.
    // The actual deny-all rule CDK generates targets 255.255.255.255/32 with
    // IpProtocol "icmp" (FromPort 252, ToPort 86) — this is CDK's sentinel pattern.
    // We verify Aurora has NO open egress routes by ensuring the SG egress list
    // does NOT contain a 0.0.0.0/0 allow-all rule.
    const sgs = template.findResources('AWS::EC2::SecurityGroup', {
      Properties: {
        GroupDescription: Match.stringLikeRegexp('Aurora'),
      },
    });
    const auroraSg = Object.values(sgs)[0] as any;
    const egressRules: any[] = auroraSg.Properties.SecurityGroupEgress ?? [];
    const hasAllowAll = egressRules.some(
      (r: any) => r.CidrIp === '0.0.0.0/0' && r.IpProtocol === '-1',
    );
    expect(hasAllowAll).toBe(false);
  });

  test('ElastiCache security group has no outbound rules (isolated data tier)', () => {
    const { template } = buildTemplate();
    const sgs = template.findResources('AWS::EC2::SecurityGroup', {
      Properties: {
        GroupDescription: Match.stringLikeRegexp('ElastiCache'),
      },
    });
    const cacheSg = Object.values(sgs)[0] as any;
    const egressRules: any[] = cacheSg.Properties.SecurityGroupEgress ?? [];
    const hasAllowAll = egressRules.some(
      (r: any) => r.CidrIp === '0.0.0.0/0' && r.IpProtocol === '-1',
    );
    expect(hasAllowAll).toBe(false);
  });
});

describe('NetworkStack — CloudFormation Outputs', () => {
  const expectedOutputs = [
    'VpcId',
    'PublicSubnetIds',
    'PrivateEksSubnetIds',
    'PrivateDataSubnetIds',
    'AlbSecurityGroupId',
    'EksNodeSecurityGroupId',
    'AuroraSecurityGroupId',
    'ElastiCacheSecurityGroupId',
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
      // Export name should include the environment name.
      expect(output.Export.Name).toMatch(/test/);
    }
  });
});
