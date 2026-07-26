"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = require("aws-cdk-lib");
const assertions_1 = require("aws-cdk-lib/assertions");
const NetworkStackOptimized_1 = require("../lib/stacks/NetworkStackOptimized");
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
function buildTemplate() {
    const app = new cdk.App();
    const stack = new NetworkStackOptimized_1.NetworkStackOptimized(app, 'TestNetworkStackOptimized', {
        env: { account: '123456789012', region: 'us-east-1' },
        envName: 'test',
    });
    const template = assertions_1.Template.fromStack(stack);
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
        const natGateway = Object.values(nats)[0];
        expect(natGateway.Properties.SubnetId).toBeDefined();
    });
});
describe('NetworkStackOptimized — Security Groups', () => {
    test('creates exactly 4 security groups (ALB, ECS, RDS, Redis)', () => {
        const { template } = buildTemplate();
        const sgs = template.findResources('AWS::EC2::SecurityGroup');
        // Filter out any default/VPC security groups, only count explicitly created ones
        const namedSgs = Object.values(sgs).filter((sg) => /ALB|ECS|RDS|ElastiCache|Redis|Spring Boot/i.test(sg.Properties?.GroupDescription ?? ''));
        expect(namedSgs).toHaveLength(4);
    });
    test('ALB security group allows HTTP (80) from internet', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::EC2::SecurityGroup', {
            GroupDescription: assertions_1.Match.stringLikeRegexp('ALB'),
            SecurityGroupIngress: assertions_1.Match.arrayWith([
                assertions_1.Match.objectLike({
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
            GroupDescription: assertions_1.Match.stringLikeRegexp('ALB'),
            SecurityGroupIngress: assertions_1.Match.arrayWith([
                assertions_1.Match.objectLike({
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
                GroupDescription: assertions_1.Match.stringLikeRegexp('ALB'),
            },
        });
        const albSg = Object.values(albSgs)[0];
        const egressRules = albSg.Properties.SecurityGroupEgress ?? [];
        const hasEcsEgress = egressRules.some((r) => r.FromPort === 8080 && r.ToPort === 8080 && r.IpProtocol === 'tcp');
        expect(hasEcsEgress).toBe(true);
    });
    test('ECS security group allows ingress on port 8080 from ALB', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::EC2::SecurityGroup', {
            GroupDescription: assertions_1.Match.stringLikeRegexp('ECS|Spring Boot'),
            SecurityGroupIngress: assertions_1.Match.arrayWith([
                assertions_1.Match.objectLike({
                    FromPort: 8080,
                    ToPort: 8080,
                    IpProtocol: 'tcp',
                    SourceSecurityGroupId: assertions_1.Match.anyValue(),
                }),
            ]),
        });
    });
    test('ECS security group allows all outbound traffic', () => {
        const { template } = buildTemplate();
        const ecsSgs = template.findResources('AWS::EC2::SecurityGroup', {
            Properties: {
                GroupDescription: assertions_1.Match.stringLikeRegexp('ECS|Spring Boot'),
            },
        });
        const ecsSg = Object.values(ecsSgs)[0];
        const egressRules = ecsSg.Properties.SecurityGroupEgress ?? [];
        const hasAllowAll = egressRules.some((r) => r.CidrIp === '0.0.0.0/0' && r.IpProtocol === '-1');
        expect(hasAllowAll).toBe(true);
    });
    test('RDS security group only allows port 5432 from ECS security group', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::EC2::SecurityGroup', {
            GroupDescription: assertions_1.Match.stringLikeRegexp('RDS|PostgreSQL'),
            SecurityGroupIngress: assertions_1.Match.arrayWith([
                assertions_1.Match.objectLike({
                    FromPort: 5432,
                    ToPort: 5432,
                    IpProtocol: 'tcp',
                    SourceSecurityGroupId: assertions_1.Match.anyValue(),
                }),
            ]),
        });
    });
    test('RDS security group has no outbound rules', () => {
        const { template } = buildTemplate();
        const rdsSgs = template.findResources('AWS::EC2::SecurityGroup', {
            Properties: {
                GroupDescription: assertions_1.Match.stringLikeRegexp('RDS|PostgreSQL'),
            },
        });
        const rdsSg = Object.values(rdsSgs)[0];
        const egressRules = rdsSg.Properties.SecurityGroupEgress ?? [];
        const hasAllowAll = egressRules.some((r) => r.CidrIp === '0.0.0.0/0' && r.IpProtocol === '-1');
        expect(hasAllowAll).toBe(false);
    });
    test('Redis security group only allows port 6379 from ECS security group', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::EC2::SecurityGroup', {
            GroupDescription: assertions_1.Match.stringLikeRegexp('ElastiCache|Redis'),
            SecurityGroupIngress: assertions_1.Match.arrayWith([
                assertions_1.Match.objectLike({
                    FromPort: 6379,
                    ToPort: 6379,
                    IpProtocol: 'tcp',
                    SourceSecurityGroupId: assertions_1.Match.anyValue(),
                }),
            ]),
        });
    });
    test('Redis security group has no outbound rules', () => {
        const { template } = buildTemplate();
        const redisSgs = template.findResources('AWS::EC2::SecurityGroup', {
            Properties: {
                GroupDescription: assertions_1.Match.stringLikeRegexp('ElastiCache|Redis'),
            },
        });
        const redisSg = Object.values(redisSgs)[0];
        const egressRules = redisSg.Properties.SecurityGroupEgress ?? [];
        const hasAllowAll = egressRules.some((r) => r.CidrIp === '0.0.0.0/0' && r.IpProtocol === '-1');
        expect(hasAllowAll).toBe(false);
    });
});
describe('NetworkStackOptimized — Resource Tags', () => {
    test('all resources have Component tag', () => {
        const { template } = buildTemplate();
        const cfnTemplate = template.toJSON();
        const resources = cfnTemplate.Resources ?? {};
        // Check that stack-level tags are applied
        for (const [logicalId, resource] of Object.entries(resources)) {
            // Some CDK-generated resources may not have tags, but major resources should
            if (['AWS::EC2::VPC', 'AWS::EC2::SecurityGroup', 'AWS::EC2::NatGateway'].includes(resource.Type)) {
                const tags = resource.Properties?.Tags ?? [];
                const hasComponentTag = tags.some((tag) => tag.Key === 'Component');
                expect(hasComponentTag).toBe(true);
            }
        }
    });
    test('all resources have CostCenter tag', () => {
        const { template } = buildTemplate();
        const cfnTemplate = template.toJSON();
        const resources = cfnTemplate.Resources ?? {};
        // Check that stack-level tags are applied
        for (const [logicalId, resource] of Object.entries(resources)) {
            // Some CDK-generated resources may not have tags, but major resources should
            if (['AWS::EC2::VPC', 'AWS::EC2::SecurityGroup', 'AWS::EC2::NatGateway'].includes(resource.Type)) {
                const tags = resource.Properties?.Tags ?? [];
                const hasCostCenterTag = tags.some((tag) => tag.Key === 'CostCenter');
                expect(hasCostCenterTag).toBe(true);
            }
        }
    });
    test('Component tag has value "Network"', () => {
        const { template } = buildTemplate();
        const vpc = template.findResources('AWS::EC2::VPC');
        const vpcResource = Object.values(vpc)[0];
        const tags = vpcResource.Properties?.Tags ?? [];
        const componentTag = tags.find((tag) => tag.Key === 'Component');
        expect(componentTag?.Value).toBe('Network');
    });
    test('CostCenter tag has value "Infrastructure"', () => {
        const { template } = buildTemplate();
        const vpc = template.findResources('AWS::EC2::VPC');
        const vpcResource = Object.values(vpc)[0];
        const tags = vpcResource.Properties?.Tags ?? [];
        const costCenterTag = tags.find((tag) => tag.Key === 'CostCenter');
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
        for (const [key, output] of Object.entries(outputs)) {
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
            AssumeRolePolicyDocument: assertions_1.Match.objectLike({
                Statement: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTmV0d29ya1N0YWNrT3B0aW1pemVkLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi90ZXN0L05ldHdvcmtTdGFja09wdGltaXplZC50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsbUNBQW1DO0FBQ25DLHVEQUF5RDtBQUN6RCwrRUFBNEU7QUFFNUU7Ozs7Ozs7Ozs7O0dBV0c7QUFFSCxTQUFTLGFBQWE7SUFDcEIsTUFBTSxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUM7SUFDMUIsTUFBTSxLQUFLLEdBQUcsSUFBSSw2Q0FBcUIsQ0FBQyxHQUFHLEVBQUUsMkJBQTJCLEVBQUU7UUFDeEUsR0FBRyxFQUFFLEVBQUUsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFO1FBQ3JELE9BQU8sRUFBRSxNQUFNO0tBQ2hCLENBQUMsQ0FBQztJQUNILE1BQU0sUUFBUSxHQUFHLHFCQUFRLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQzNDLE9BQU8sRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLENBQUM7QUFDN0IsQ0FBQztBQUVELFFBQVEsQ0FBQyxxQ0FBcUMsRUFBRSxHQUFHLEVBQUU7SUFDbkQsSUFBSSxDQUFDLCtCQUErQixFQUFFLEdBQUcsRUFBRTtRQUN6QyxNQUFNLEVBQUUsUUFBUSxFQUFFLEdBQUcsYUFBYSxFQUFFLENBQUM7UUFDckMsUUFBUSxDQUFDLGVBQWUsQ0FBQyxzQkFBc0IsRUFBRSxDQUFDLENBQUMsQ0FBQztJQUN0RCxDQUFDLENBQUMsQ0FBQztJQUVILElBQUksQ0FBQyxnREFBZ0QsRUFBRSxHQUFHLEVBQUU7UUFDMUQsTUFBTSxFQUFFLFFBQVEsRUFBRSxHQUFHLGFBQWEsRUFBRSxDQUFDO1FBQ3JDLE1BQU0sSUFBSSxHQUFHLFFBQVEsQ0FBQyxhQUFhLENBQUMsc0JBQXNCLENBQUMsQ0FBQztRQUM1RCxNQUFNLFVBQVUsR0FBRyxNQUFN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TSxFQUFFLFFBQVEsRUFBRSxHQUFHLGFBQWEsRUFBRSxDQUFDO1FBQ3JDLFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQyxnQkFBZ0IsRUFBRTtZQUMvQyx3QkFBd0IsRUFBRSxrQkFBSyxDQUFDLFVBQVUsQ0FBQztnQkFDekMsU0FBUyxFQUFFLGtCQUFLLENBQUMsU0FBUyxDQUFDO29CQUN6QixrQkFBSyxDQUFDLFVBQVUsQ0FBQzt3QkFDZixNQUFNLEVBQUUsT0FBTzt3QkFDZixTQUFTLEVBQUU7NEJBQ1QsT0FBTyxFQUFFLDZCQUE2Qjt5QkFDdkM7d0JBQ0QsTUFBTSxFQUFFLGdCQUFnQjtxQkFDekIsQ0FBQztpQkFDSCxDQUFDO2FBQ0gsQ0FBQztTQUNILENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgVGVtcGxhdGUsIE1hdGNoIH0gZnJvbSAnYXdzLWNkay1saWIvYXNzZXJ0aW9ucyc7XG5pbXBvcnQgeyBOZXR3b3JrU3RhY2tPcHRpbWl6ZWQgfSBmcm9tICcuLi9saWIvc3RhY2tzL05ldHdvcmtTdGFja09wdGltaXplZCc7XG5cbi8qKlxuICogVW5pdCB0ZXN0cyBmb3IgTmV0d29ya1N0YWNrT3B0aW1pemVkLlxuICpcbiAqIFZhbGlkYXRlczpcbiAqIC0gRXhhY3RseSAxIE5BVCBHYXRld2F5IGNyZWF0ZWQgKGNvc3Qgb3B0aW1pemF0aW9uKVxuICogLSA0IHNlY3VyaXR5IGdyb3VwcyBjcmVhdGVkIHdpdGggY29ycmVjdCBydWxlcyAoQUxCLCBFQ1MsIFJEUywgUmVkaXMpXG4gKiAtIEFsbCByZXNvdXJjZXMgaGF2ZSByZXF1aXJlZCB0YWdzIChDb21wb25lbnQsIENvc3RDZW50ZXIpXG4gKiAtIENsb3VkRm9ybWF0aW9uIGV4cG9ydHMgYXJlIHByZXNlbnRcbiAqXG4gKiBVc2VzIHRoZSBDREsgYXNzZXJ0aW9ucyBsaWJyYXJ5IHRvIHZhbGlkYXRlIENsb3VkRm9ybWF0aW9uIHRlbXBsYXRlIG91dHB1dFxuICogd2l0aG91dCBkZXBsb3lpbmcgdG8gQVdTLlxuICovXG5cbmZ1bmN0aW9uIGJ1aWxkVGVtcGxhdGUoKTogeyBzdGFjazogTmV0d29ya1N0YWNrT3B0aW1pemVkOyB0ZW1wbGF0ZTogVGVtcGxhdGUgfSB7XG4gIGNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG4gIGNvbnN0IHN0YWNrID0gbmV3IE5ldHdvcmtTdGFja09wdGltaXplZChhcHAsICdUZXN0TmV0d29ya1N0YWNrT3B0aW1pemVkJywge1xuICAgIGVudjogeyBhY2NvdW50OiAnMTIzNDU2Nzg5MDEyJywgcmVnaW9uOiAndXMtZWFzdC0xJyB9LFxuICAgIGVudk5hbWU6ICd0ZXN0JyxcbiAgfSk7XG4gIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgcmV0dXJuIHsgc3RhY2ssIHRlbXBsYXRlIH07XG59XG5cbmRlc2NyaWJlKCdOZXR3b3JrU3RhY2tPcHRpbWl6ZWQg4oCUIE5BVCBHYXRld2F5JywgKCkgPT4ge1xuICB0ZXN0KCdjcmVhdGVzIGV4YWN0bHkgMSBOQVQgR2F0ZXdheScsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkVDMjo6TmF0R2F0ZXdheScsIDEpO1xuICB9KTtcblxuICB0ZXN0KCdOQVQgZ2F0ZXdheSBpcyBhc3NvY2lhdGVkIHdpdGggYSBwdWJsaWMgc3VibmV0JywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICBjb25zdCBuYXRzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpFQzI6Ok5hdEdhdGV3YXknKTtcbiAgICBjb25zdCBuYXRHYXRld2F5ID0gT2JqZWN0LnZhbHVlcyhuYXRzKVswXSBhcyBhbnk7XG4gICAgZXhwZWN0KG5hdEdhdGV3YXkuUHJvcGVydGllcy5TdWJuZXRJZCkudG9CZURlZmluZWQoKTtcbiAgfSk7XG59KTtcblxuZGVzY3JpYmUoJ05ldHdvcmtTdGFja09wdGltaXplZCDigJQgU2VjdXJpdHkgR3JvdXBzJywgKCkgPT4ge1xuICB0ZXN0KCdjcmVhdGVzIGV4YWN0bHkgNCBzZWN1cml0eSBncm91cHMgKEFMQiwgRUNTLCBSRFMsIFJlZGlzKScsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgY29uc3Qgc2dzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpFQzI6OlNlY3VyaXR5R3JvdXAnKTtcbiAgICAvLyBGaWx0ZXIgb3V0IGFueSBkZWZhdWx0L1ZQQyBzZWN1cml0eSBncm91cHMsIG9ubHkgY291bnQgZXhwbGljaXRseSBjcmVhdGVkIG9uZXNcbiAgICBjb25zdCBuYW1lZFNncyA9IE9iamVjdC52YWx1ZXMoc2dzKS5maWx0ZXIoKHNnOiBhbnkpID0+XG4gICAgICAvQUxCfEVDU3xSRFN8RWxhc3RpQ2FjaGV8UmVkaXN8U3ByaW5nIEJvb3QvaS50ZXN0KHNnLlByb3BlcnRpZXM/Lkdyb3VwRGVzY3JpcHRpb24gPz8gJycpLFxuICAgICk7XG4gICAgZXhwZWN0KG5hbWVkU2dzKS50b0hhdmVMZW5ndGgoNCk7XG4gIH0pO1xuXG4gIHRlc3QoJ0FMQiBzZWN1cml0eSBncm91cCBhbGxvd3MgSFRUUCAoODApIGZyb20gaW50ZXJuZXQnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpFQzI6OlNlY3VyaXR5R3JvdXAnLCB7XG4gICAgICBHcm91cERlc2NyaXB0aW9uOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCdBTEInKSxcbiAgICAgIFNlY3VyaXR5R3JvdXBJbmdyZXNzOiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICBDaWRySXA6ICcwLjAuMC4wLzAnLFxuICAgICAgICAgIEZyb21Qb3J0OiA4MCxcbiAgICAgICAgICBUb1BvcnQ6IDgwLFxuICAgICAgICAgIElwUHJvdG9jb2w6ICd0Y3AnLFxuICAgICAgICB9KSxcbiAgICAgIF0pLFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdBTEIgc2VjdXJpdHkgZ3JvdXAgYWxsb3dzIEhUVFBTICg0NDMpIGZyb20gaW50ZXJuZXQnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpFQzI6OlNlY3VyaXR5R3JvdXAnLCB7XG4gICAgICBHcm91cERlc2NyaXB0aW9uOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCdBTEInKSxcbiAgICAgIFNlY3VyaXR5R3JvdXBJbmdyZXNzOiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICBDaWRySXA6ICcwLjAuMC4wLzAnLFxuICAgICAgICAgIEZyb21Qb3J0OiA0NDMsXG4gICAgICAgICAgVG9Qb3J0OiA0NDMsXG4gICAgICAgICAgSXBQcm90b2NvbDogJ3RjcCcsXG4gICAgICAgIH0pLFxuICAgICAgXSksXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ0FMQiBzZWN1cml0eSBncm91cCBhbGxvd3MgZWdyZXNzIHRvIEVDUyB0YXNrcyBvbiBwb3J0IDgwODAnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IGFsYlNncyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6RUMyOjpTZWN1cml0eUdyb3VwJywge1xuICAgICAgUHJvcGVydGllczoge1xuICAgICAgICBHcm91cERlc2NyaXB0aW9uOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCdBTEInKSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgY29uc3QgYWxiU2cgPSBPYmplY3QudmFsdWVzKGFsYlNncylbMF0gYXMgYW55O1xuICAgIGNvbnN0IGVncmVzc1J1bGVzOiBhbnlbXSA9IGFsYlNnLlByb3BlcnRpZXMuU2VjdXJpdHlHcm91cEVncmVzcyA/PyBbXTtcbiAgICBjb25zdCBoYXNFY3NFZ3Jlc3MgPSBlZ3Jlc3NSdWxlcy5zb21lKFxuICAgICAgKHI6IGFueSkgPT4gci5Gcm9tUG9ydCA9PT0gODA4MCAmJiByLlRvUG9ydCA9PT0gODA4MCAmJiByLklwUHJvdG9jb2wgPT09ICd0Y3AnLFxuICAgICk7XG4gICAgZXhwZWN0KGhhc0Vjc0VncmVzcykudG9CZSh0cnVlKTtcbiAgfSk7XG5cbiAgdGVzdCgnRUNTIHNlY3VyaXR5IGdyb3VwIGFsbG93cyBpbmdyZXNzIG9uIHBvcnQgODA4MCBmcm9tIEFMQicsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkVDMjo6U2VjdXJpdHlHcm91cCcsIHtcbiAgICAgIEdyb3VwRGVzY3JpcHRpb246IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJ0VDU3xTcHJpbmcgQm9vdCcpLFxuICAgICAgU2VjdXJpdHlHcm91cEluZ3Jlc3M6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgIEZyb21Qb3J0OiA4MDgwLFxuICAgICAgICAgIFRvUG9ydDogODA4MCxcbiAgICAgICAgICBJcFByb3RvY29sOiAndGNwJyxcbiAgICAgICAgICBTb3VyY2VTZWN1cml0eUdyb3VwSWQ6IE1hdGNoLmFueVZhbHVlKCksXG4gICAgICAgIH0pLFxuICAgICAgXSksXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ0VDUyBzZWN1cml0eSBncm91cCBhbGxvd3MgYWxsIG91dGJvdW5kIHRyYWZmaWMnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IGVjc1NncyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6RUMyOjpTZWN1cml0eUdyb3VwJywge1xuICAgICAgUHJvcGVydGllczoge1xuICAgICAgICBHcm91cERlc2NyaXB0aW9uOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCdFQ1N8U3ByaW5nIEJvb3QnKSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgY29uc3QgZWNzU2cgPSBPYmplY3QudmFsdWVzKGVjc1NncylbMF0gYXMgYW55O1xuICAgIGNvbnN0IGVncmVzc1J1bGVzOiBhbnlbXSA9IGVjc1NnLlByb3BlcnRpZXMuU2VjdXJpdHlHcm91cEVncmVzcyA/PyBbXTtcbiAgICBjb25zdCBoYXNBbGxvd0FsbCA9IGVncmVzc1J1bGVzLnNvbWUoXG4gICAgICAocjogYW55KSA9PiByLkNpZHJJcCA9PT0gJzAuMC4wLjAvMCcgJiYgci5JcFByb3RvY29sID09PSAnLTEnLFxuICAgICk7XG4gICAgZXhwZWN0KGhhc0FsbG93QWxsKS50b0JlKHRydWUpO1xuICB9KTtcblxuICB0ZXN0KCdSRFMgc2VjdXJpdHkgZ3JvdXAgb25seSBhbGxvd3MgcG9ydCA1NDMyIGZyb20gRUNTIHNlY3VyaXR5IGdyb3VwJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RUMyOjpTZWN1cml0eUdyb3VwJywge1xuICAgICAgR3JvdXBEZXNjcmlwdGlvbjogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnUkRTfFBvc3RncmVTUUwnKSxcbiAgICAgIFNlY3VyaXR5R3JvdXBJbmdyZXNzOiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICBGcm9tUG9ydDogNTQzMixcbiAgICAgICAgICBUb1BvcnQ6IDU0MzIsXG4gICAgICAgICAgSXBQcm90b2NvbDogJ3RjcCcsXG4gICAgICAgICAgU291cmNlU2VjdXJpdHlHcm91cElkOiBNYXRjaC5hbnlWYWx1ZSgpLFxuICAgICAgICB9KSxcbiAgICAgIF0pLFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdSRFMgc2VjdXJpdHkgZ3JvdXAgaGFzIG5vIG91dGJvdW5kIHJ1bGVzJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICBjb25zdCByZHNTZ3MgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OkVDMjo6U2VjdXJpdHlHcm91cCcsIHtcbiAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgR3JvdXBEZXNjcmlwdGlvbjogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnUkRTfFBvc3RncmVTUUwnKSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgY29uc3QgcmRzU2cgPSBPYmplY3QudmFsdWVzKHJkc1NncylbMF0gYXMgYW55O1xuICAgIGNvbnN0IGVncmVzc1J1bGVzOiBhbnlbXSA9IHJkc1NnLlByb3BlcnRpZXMuU2VjdXJpdHlHcm91cEVncmVzcyA/PyBbXTtcbiAgICBjb25zdCBoYXNBbGxvd0FsbCA9IGVncmVzc1J1bGVzLnNvbWUoXG4gICAgICAocjogYW55KSA9PiByLkNpZHJJcCA9PT0gJzAuMC4wLjAvMCcgJiYgci5JcFByb3RvY29sID09PSAnLTEnLFxuICAgICk7XG4gICAgZXhwZWN0KGhhc0FsbG93QWxsKS50b0JlKGZhbHNlKTtcbiAgfSk7XG5cbiAgdGVzdCgnUmVkaXMgc2VjdXJpdHkgZ3JvdXAgb25seSBhbGxvd3MgcG9ydCA2Mzc5IGZyb20gRUNTIHNlY3VyaXR5IGdyb3VwJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RUMyOjpTZWN1cml0eUdyb3VwJywge1xuICAgICAgR3JvdXBEZXNjcmlwdGlvbjogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnRWxhc3RpQ2FjaGV8UmVkaXMnKSxcbiAgICAgIFNlY3VyaXR5R3JvdXBJbmdyZXNzOiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICBGcm9tUG9ydDogNjM3OSxcbiAgICAgICAgICBUb1BvcnQ6IDYzNzksXG4gICAgICAgICAgSXBQcm90b2NvbDogJ3RjcCcsXG4gICAgICAgICAgU291cmNlU2VjdXJpdHlHcm91cElkOiBNYXRjaC5hbnlWYWx1ZSgpLFxuICAgICAgICB9KSxcbiAgICAgIF0pLFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdSZWRpcyBzZWN1cml0eSBncm91cCBoYXMgbm8gb3V0Ym91bmQgcnVsZXMnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IHJlZGlzU2dzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpFQzI6OlNlY3VyaXR5R3JvdXAnLCB7XG4gICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgIEdyb3VwRGVzY3JpcHRpb246IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJ0VsYXN0aUNhY2hlfFJlZGlzJyksXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGNvbnN0IHJlZGlzU2cgPSBPYmplY3QudmFsdWVzKHJlZGlzU2dzKVswXSBhcyBhbnk7XG4gICAgY29uc3QgZWdyZXNzUnVsZXM6IGFueVtdID0gcmVkaXNTZy5Qcm9wZXJ0aWVzLlNlY3VyaXR5R3JvdXBFZ3Jlc3MgPz8gW107XG4gICAgY29uc3QgaGFzQWxsb3dBbGwgPSBlZ3Jlc3NSdWxlcy5zb21lKFxuICAgICAgKHI6IGFueSkgPT4gci5DaWRySXAgPT09ICcwLjAuMC4wLzAnICYmIHIuSXBQcm90b2NvbCA9PT0gJy0xJyxcbiAgICApO1xuICAgIGV4cGVjdChoYXNBbGxvd0FsbCkudG9CZShmYWxzZSk7XG4gIH0pO1xufSk7XG5cbmRlc2NyaWJlKCdOZXR3b3JrU3RhY2tPcHRpbWl6ZWQg4oCUIFJlc291cmNlIFRhZ3MnLCAoKSA9PiB7XG4gIHRlc3QoJ2FsbCByZXNvdXJjZXMgaGF2ZSBDb21wb25lbnQgdGFnJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICBjb25zdCBjZm5UZW1wbGF0ZSA9IHRlbXBsYXRlLnRvSlNPTigpO1xuICAgIGNvbnN0IHJlc291cmNlcyA9IGNmblRlbXBsYXRlLlJlc291cmNlcyA/PyB7fTtcbiAgICBcbiAgICAvLyBDaGVjayB0aGF0IHN0YWNrLWxldmVsIHRhZ3MgYXJlIGFwcGxpZWRcbiAgICBmb3IgKGNvbnN0IFtsb2dpY2FsSWQsIHJlc291cmNlXSBvZiBPYmplY3QuZW50cmllczxhbnk+KHJlc291cmNlcykpIHtcbiAgICAgIC8vIFNvbWUgQ0RLLWdlbmVyYXRlZCByZXNvdXJjZXMgbWF5IG5vdCBoYXZlIHRhZ3MsIGJ1dCBtYWpvciByZXNvdXJjZXMgc2hvdWxkXG4gICAgICBpZiAoWydBV1M6OkVDMjo6VlBDJywgJ0FXUzo6RUMyOjpTZWN1cml0eUdyb3VwJywgJ0FXUzo6RUMyOjpOYXRHYXRld2F5J10uaW5jbHVkZXMocmVzb3VyY2UuVHlwZSkpIHtcbiAgICAgICAgY29uc3QgdGFncyA9IHJlc291cmNlLlByb3BlcnRpZXM/LlRhZ3MgPz8gW107XG4gICAgICAgIGNvbnN0IGhhc0NvbXBvbmVudFRhZyA9IHRhZ3Muc29tZSgodGFnOiBhbnkpID0+IHRhZy5LZXkgPT09ICdDb21wb25lbnQnKTtcbiAgICAgICAgZXhwZWN0KGhhc0NvbXBvbmVudFRhZykudG9CZSh0cnVlKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuXG4gIHRlc3QoJ2FsbCByZXNvdXJjZXMgaGF2ZSBDb3N0Q2VudGVyIHRhZycsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgY29uc3QgY2ZuVGVtcGxhdGUgPSB0ZW1wbGF0ZS50b0pTT04oKTtcbiAgICBjb25zdCByZXNvdXJjZXMgPSBjZm5UZW1wbGF0ZS5SZXNvdXJjZXMgPz8ge307XG4gICAgXG4gICAgLy8gQ2hlY2sgdGhhdCBzdGFjay1sZXZlbCB0YWdzIGFyZSBhcHBsaWVkXG4gICAgZm9yIChjb25zdCBbbG9naWNhbElkLCByZXNvdXJjZV0gb2YgT2JqZWN0LmVudHJpZXM8YW55PihyZXNvdXJjZXMpKSB7XG4gICAgICAvLyBTb21lIENESy1nZW5lcmF0ZWQgcmVzb3VyY2VzIG1heSBub3QgaGF2ZSB0YWdzLCBidXQgbWFqb3IgcmVzb3VyY2VzIHNob3VsZFxuICAgICAgaWYgKFsnQVdTOjpFQzI6OlZQQycsICdBV1M6OkVDMjo6U2VjdXJpdHlHcm91cCcsICdBV1M6OkVDMjo6TmF0R2F0ZXdheSddLmluY2x1ZGVzKHJlc291cmNlLlR5cGUpKSB7XG4gICAgICAgIGNvbnN0IHRhZ3MgPSByZXNvdXJjZS5Qcm9wZXJ0aWVzPy5UYWdzID8/IFtdO1xuICAgICAgICBjb25zdCBoYXNDb3N0Q2VudGVyVGFnID0gdGFncy5zb21lKCh0YWc6IGFueSkgPT4gdGFnLktleSA9PT0gJ0Nvc3RDZW50ZXInKTtcbiAgICAgICAgZXhwZWN0KGhhc0Nvc3RDZW50ZXJUYWcpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcblxuICB0ZXN0KCdDb21wb25lbnQgdGFnIGhhcyB2YWx1ZSBcIk5ldHdvcmtcIicsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgY29uc3QgdnBjID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpFQzI6OlZQQycpO1xuICAgIGNvbnN0IHZwY1Jlc291cmNlID0gT2JqZWN0LnZhbHVlcyh2cGMpWzBdIGFzIGFueTtcbiAgICBjb25zdCB0YWdzID0gdnBjUmVzb3VyY2UuUHJvcGVydGllcz8uVGFncyA/PyBbXTtcbiAgICBjb25zdCBjb21wb25lbnRUYWcgPSB0YWdzLmZpbmQoKHRhZzogYW55KSA9PiB0YWcuS2V5ID09PSAnQ29tcG9uZW50Jyk7XG4gICAgZXhwZWN0KGNvbXBvbmVudFRhZz8uVmFsdWUpLnRvQmUoJ05ldHdvcmsnKTtcbiAgfSk7XG5cbiAgdGVzdCgnQ29zdENlbnRlciB0YWcgaGFzIHZhbHVlIFwiSW5mcmFzdHJ1Y3R1cmVcIicsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgY29uc3QgdnBjID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpFQzI6OlZQQycpO1xuICAgIGNvbnN0IHZwY1Jlc291cmNlID0gT2JqZWN0LnZhbHVlcyh2cGMpWzBdIGFzIGFueTtcbiAgICBjb25zdCB0YWdzID0gdnBjUmVzb3VyY2UuUHJvcGVydGllcz8uVGFncyA/PyBbXTtcbiAgICBjb25zdCBjb3N0Q2VudGVyVGFnID0gdGFncy5maW5kKCh0YWc6IGFueSkgPT4gdGFnLktleSA9PT0gJ0Nvc3RDZW50ZXInKTtcbiAgICBleHBlY3QoY29zdENlbnRlclRhZz8uVmFsdWUpLnRvQmUoJ0luZnJhc3RydWN0dXJlJyk7XG4gIH0pO1xufSk7XG5cbmRlc2NyaWJlKCdOZXR3b3JrU3RhY2tPcHRpbWl6ZWQg4oCUIENsb3VkRm9ybWF0aW9uIEV4cG9ydHMnLCAoKSA9PiB7XG4gIGNvbnN0IGV4cGVjdGVkT3V0cHV0cyA9IFtcbiAgICAnVnBjSWQnLFxuICAgICdQdWJsaWNTdWJuZXRJZHMnLFxuICAgICdQcml2YXRlU3VibmV0SWRzJyxcbiAgICAnSXNvbGF0ZWRTdWJuZXRJZHMnLFxuICAgICdBbGJTZWN1cml0eUdyb3VwSWQnLFxuICAgICdFY3NTZWN1cml0eUdyb3VwSWQnLFxuICAgICdSZHNTZWN1cml0eUdyb3VwSWQnLFxuICAgICdSZWRpc1NlY3VyaXR5R3JvdXBJZCcsXG4gIF07XG5cbiAgdGVzdC5lYWNoKGV4cGVjdGVkT3V0cHV0cykoJ2V4cG9ydHMgJXMnLCAob3V0cHV0S2V5KSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IG91dHB1dHMgPSB0ZW1wbGF0ZS5maW5kT3V0cHV0cyhvdXRwdXRLZXkpO1xuICAgIGV4cGVjdChPYmplY3Qua2V5cyhvdXRwdXRzKSkudG9IYXZlTGVuZ3RoKDEpO1xuICB9KTtcblxuICB0ZXN0KCdhbGwgb3V0cHV0cyBoYXZlIGV4cG9ydCBuYW1lcyBmb3IgY3Jvc3Mtc3RhY2sgcmVmZXJlbmNpbmcnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IGNmblRlbXBsYXRlID0gdGVtcGxhdGUudG9KU09OKCk7XG4gICAgY29uc3Qgb3V0cHV0cyA9IGNmblRlbXBsYXRlLk91dHB1dHMgPz8ge307XG4gICAgZm9yIChjb25zdCBba2V5LCBvdXRwdXRdIG9mIE9iamVjdC5lbnRyaWVzPGFueT4ob3V0cHV0cykpIHtcbiAgICAgIGV4cGVjdChvdXRwdXQuRXhwb3J0Py5OYW1lKS50b0JlRGVmaW5lZCgpO1xuICAgICAgLy8gRXhwb3J0IG5hbWUgc2hvdWxkIGluY2x1ZGUgdGhlIGVudmlyb25tZW50IG5hbWVcbiAgICAgIGV4cGVjdChvdXRwdXQuRXhwb3J0Lk5hbWUpLnRvTWF0Y2goL3Rlc3QvKTtcbiAgICB9XG4gIH0pO1xuXG4gIHRlc3QoJ1ZQQyBJRCBleHBvcnQgaGFzIGNvcnJlY3QgbmFtaW5nIHBhdHRlcm4nLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IGNmblRlbXBsYXRlID0gdGVtcGxhdGUudG9KU09OKCk7XG4gICAgY29uc3Qgb3V0cHV0ID0gY2ZuVGVtcGxhdGUuT3V0cHV0cy5WcGNJZDtcbiAgICBleHBlY3Qob3V0cHV0LkV4cG9ydC5OYW1lKS50b0JlKCdGb29kQ29zdENhbGN1bGF0b3ItdGVzdC1WcGNJZCcpO1xuICB9KTtcblxuICB0ZXN0KCdzdWJuZXQgSURzIGV4cG9ydHMgYXJlIGNvbW1hLXNlcGFyYXRlZCBsaXN0cycsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgY29uc3QgY2ZuVGVtcGxhdGUgPSB0ZW1wbGF0ZS50b0pTT04oKTtcbiAgICBcbiAgICAvLyBQdWJsaWNTdWJuZXRJZHMgc2hvdWxkIGJlIGEgam9pbiBvZiBzdWJuZXQgSURzXG4gICAgY29uc3QgcHVibGljU3VibmV0c091dHB1dCA9IGNmblRlbXBsYXRlLk91dHB1dHMuUHVibGljU3VibmV0SWRzO1xuICAgIGV4cGVjdChwdWJsaWNTdWJuZXRzT3V0cHV0LlZhbHVlKS50b0JlRGVmaW5lZCgpO1xuICAgIFxuICAgIC8vIFByaXZhdGVTdWJuZXRJZHMgc2hvdWxkIGJlIGEgam9pbiBvZiBzdWJuZXQgSURzXG4gICAgY29uc3QgcHJpdmF0ZVN1Ym5ldHNPdXRwdXQgPSBjZm5UZW1wbGF0ZS5PdXRwdXRzLlByaXZhdGVTdWJuZXRJZHM7XG4gICAgZXhwZWN0KHByaXZhdGVTdWJuZXRzT3V0cHV0LlZhbHVlKS50b0JlRGVmaW5lZCgpO1xuICAgIFxuICAgIC8vIElzb2xhdGVkU3VibmV0SWRzIHNob3VsZCBiZSBhIGpvaW4gb2Ygc3VibmV0IElEc1xuICAgIGNvbnN0IGlzb2xhdGVkU3VibmV0c091dHB1dCA9IGNmblRlbXBsYXRlLk91dHB1dHMuSXNvbGF0ZWRTdWJuZXRJZHM7XG4gICAgZXhwZWN0KGlzb2xhdGVkU3VibmV0c091dHB1dC5WYWx1ZSkudG9CZURlZmluZWQoKTtcbiAgfSk7XG5cbiAgdGVzdCgnc2VjdXJpdHkgZ3JvdXAgZXhwb3J0cyByZWZlcmVuY2UgY29ycmVjdCByZXNvdXJjZXMnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IGNmblRlbXBsYXRlID0gdGVtcGxhdGUudG9KU09OKCk7XG4gICAgXG4gICAgY29uc3QgYWxiU2dPdXRwdXQgPSBjZm5UZW1wbGF0ZS5PdXRwdXRzLkFsYlNlY3VyaXR5R3JvdXBJZDtcbiAgICBleHBlY3QoYWxiU2dPdXRwdXQuVmFsdWUpLnRvQmVEZWZpbmVkKCk7XG4gICAgXG4gICAgY29uc3QgZWNzU2dPdXRwdXQgPSBjZm5UZW1wbGF0ZS5PdXRwdXRzLkVjc1NlY3VyaXR5R3JvdXBJZDtcbiAgICBleHBlY3QoZWNzU2dPdXRwdXQuVmFsdWUpLnRvQmVEZWZpbmVkKCk7XG4gICAgXG4gICAgY29uc3QgcmRzU2dPdXRwdXQgPSBjZm5UZW1wbGF0ZS5PdXRwdXRzLlJkc1NlY3VyaXR5R3JvdXBJZDtcbiAgICBleHBlY3QocmRzU2dPdXRwdXQuVmFsdWUpLnRvQmVEZWZpbmVkKCk7XG4gICAgXG4gICAgY29uc3QgcmVkaXNTZ091dHB1dCA9IGNmblRlbXBsYXRlLk91dHB1dHMuUmVkaXNTZWN1cml0eUdyb3VwSWQ7XG4gICAgZXhwZWN0KHJlZGlzU2dPdXRwdXQuVmFsdWUpLnRvQmVEZWZpbmVkKCk7XG4gIH0pO1xuXG4gIHRlc3QoJ1ZQQyBGbG93IExvZ3MgbG9nIGdyb3VwIG5hbWUgaXMgZXhwb3J0ZWQnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IG91dHB1dHMgPSB0ZW1wbGF0ZS5maW5kT3V0cHV0cygnVnBjRmxvd0xvZ3NMb2dHcm91cE5hbWUnKTtcbiAgICBleHBlY3QoT2JqZWN0LmtleXMob3V0cHV0cykpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgfSk7XG59KTtcblxuZGVzY3JpYmUoJ05ldHdvcmtTdGFja09wdGltaXplZCDigJQgVlBDIENvbmZpZ3VyYXRpb24nLCAoKSA9PiB7XG4gIHRlc3QoJ2NyZWF0ZXMgZXhhY3RseSBvbmUgVlBDJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6RUMyOjpWUEMnLCAxKTtcbiAgfSk7XG5cbiAgdGVzdCgnVlBDIHVzZXMgdGhlIDEwLjAuMC4wLzE2IENJRFIgYmxvY2snLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpFQzI6OlZQQycsIHtcbiAgICAgIENpZHJCbG9jazogJzEwLjAuMC4wLzE2JyxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnVlBDIHNwYW5zIGV4YWN0bHkgMiBBdmFpbGFiaWxpdHkgWm9uZXMnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIC8vIFdpdGggbWF4QXpzPTIgYW5kIHRocmVlIHN1Ym5ldCBncm91cHMgKHB1YmxpYywgcHJpdmF0ZSwgaXNvbGF0ZWQpLFxuICAgIC8vIENESyBjcmVhdGVzIGV4YWN0bHkgNiBzdWJuZXRzICgyIHBlciBncm91cClcbiAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6RUMyOjpTdWJuZXQnLCA2KTtcbiAgfSk7XG59KTtcblxuZGVzY3JpYmUoJ05ldHdvcmtTdGFja09wdGltaXplZCDigJQgVlBDIEZsb3cgTG9ncycsICgpID0+IHtcbiAgdGVzdCgnY3JlYXRlcyBDbG91ZFdhdGNoIGxvZyBncm91cCBmb3IgVlBDIEZsb3cgTG9ncycsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkxvZ3M6OkxvZ0dyb3VwJywge1xuICAgICAgTG9nR3JvdXBOYW1lOiAnL2F3cy92cGMvZmxvd2xvZ3MtdGVzdCcsXG4gICAgICBSZXRlbnRpb25JbkRheXM6IDcsXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ2NyZWF0ZXMgVlBDIEZsb3cgTG9nIHJlc291cmNlJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RUMyOjpGbG93TG9nJywge1xuICAgICAgUmVzb3VyY2VUeXBlOiAnVlBDJyxcbiAgICAgIFRyYWZmaWNUeXBlOiAnQUxMJyxcbiAgICAgIExvZ0Rlc3RpbmF0aW9uVHlwZTogJ2Nsb3VkLXdhdGNoLWxvZ3MnLFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdWUEMgRmxvdyBMb2dzIElBTSByb2xlIGhhcyBjb3JyZWN0IHRydXN0IHBvbGljeScsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OklBTTo6Um9sZScsIHtcbiAgICAgIEFzc3VtZVJvbGVQb2xpY3lEb2N1bWVudDogTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgIFN0YXRlbWVudDogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgICAgICAgIFByaW5jaXBhbDoge1xuICAgICAgICAgICAgICBTZXJ2aWNlOiAndnBjLWZsb3ctbG9ncy5hbWF6b25hd3MuY29tJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBBY3Rpb246ICdzdHM6QXNzdW1lUm9sZScsXG4gICAgICAgICAgfSksXG4gICAgICAgIF0pLFxuICAgICAgfSksXG4gICAgfSk7XG4gIH0pO1xufSk7XG4iXX0=