"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = require("aws-cdk-lib");
const assertions_1 = require("aws-cdk-lib/assertions");
const ec2 = require("aws-cdk-lib/aws-ec2");
const CacheStack_1 = require("../lib/stacks/CacheStack");
describe('CacheStack', () => {
    let app;
    let stack;
    let template;
    beforeEach(() => {
        app = new cdk.App();
        // Create a mock VPC with the expected subnet configuration.
        const vpcStack = new cdk.Stack(app, 'VpcStack');
        const vpc = new ec2.Vpc(vpcStack, 'TestVpc', {
            maxAzs: 2,
            subnetConfiguration: [
                {
                    cidrMask: 24,
                    name: 'public',
                    subnetType: ec2.SubnetType.PUBLIC,
                },
                {
                    cidrMask: 24,
                    name: 'private-eks',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                },
                {
                    cidrMask: 24,
                    name: 'private-data',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                },
            ],
        });
        const redisSecurityGroup = new ec2.SecurityGroup(vpcStack, 'TestRedisSG', {
            vpc,
            description: 'Test Redis security group',
        });
        // Create the CacheStack.
        stack = new CacheStack_1.CacheStack(app, 'TestCacheStack', {
            envName: 'test',
            vpc,
            redisSecurityGroup,
        });
        template = assertions_1.Template.fromStack(stack);
    });
    test('creates ElastiCache subnet group in private data subnets', () => {
        template.hasResourceProperties('AWS::ElastiCache::SubnetGroup', {
            CacheSubnetGroupName: 'fcc-redis-test',
            Description: assertions_1.Match.stringLikeRegexp('ElastiCache Redis subnet group'),
        });
    });
    test('creates Redis parameter group for single-node mode', () => {
        template.hasResourceProperties('AWS::ElastiCache::ParameterGroup', {
            CacheParameterGroupFamily: 'redis7',
            Description: assertions_1.Match.stringLikeRegexp('Food Cost Calculator Redis 7 parameters'),
            Properties: {
                'maxmemory-policy': 'allkeys-lru',
                'timeout': '300',
            },
        });
    });
    test('creates Redis replication group with single node (no cluster mode)', () => {
        template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
            ReplicationGroupId: 'fcc-redis-test',
            Engine: 'redis',
            EngineVersion: '7.1',
            CacheNodeType: 'cache.t4g.micro',
            AutomaticFailoverEnabled: false,
            MultiAZEnabled: false,
            Port: 6379,
        });
        // Verify that cluster mode properties are NOT present
        const resources = template.findResources('AWS::ElastiCache::ReplicationGroup');
        const replicationGroupLogicalId = Object.keys(resources)[0];
        const replicationGroup = resources[replicationGroupLogicalId];
        expect(replicationGroup.Properties.NumNodeGroups).toBeUndefined();
        expect(replicationGroup.Properties.ReplicasPerNodeGroup).toBeUndefined();
    });
    test('enables encryption at rest and in transit', () => {
        template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
            AtRestEncryptionEnabled: true,
            TransitEncryptionEnabled: true,
        });
    });
    test('configures snapshot retention and maintenance windows', () => {
        template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
            SnapshotRetentionLimit: 7,
            SnapshotWindow: '02:00-03:00',
            PreferredMaintenanceWindow: 'sun:03:00-sun:04:00',
            AutoMinorVersionUpgrade: true,
        });
    });
    test('configures CloudWatch log delivery for slow-log and engine-log', () => {
        template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
            LogDeliveryConfigurations: assertions_1.Match.arrayWith([
                assertions_1.Match.objectLike({
                    DestinationType: 'cloudwatch-logs',
                    LogFormat: 'json',
                    LogType: 'slow-log',
                    DestinationDetails: {
                        CloudWatchLogsDetails: {
                            LogGroup: '/aws/elasticache/test/redis/slow-log',
                        },
                    },
                }),
                assertions_1.Match.objectLike({
                    DestinationType: 'cloudwatch-logs',
                    LogFormat: 'json',
                    LogType: 'engine-log',
                    DestinationDetails: {
                        CloudWatchLogsDetails: {
                            LogGroup: '/aws/elasticache/test/redis/engine-log',
                        },
                    },
                }),
            ]),
        });
    });
    test('exports Redis primary endpoint outputs', () => {
        template.hasOutput('RedisPrimaryEndpoint', {
            Description: assertions_1.Match.stringLikeRegexp('primary endpoint'),
            Export: {
                Name: 'FoodCostCalculator-test-RedisEndpoint',
            },
        });
        template.hasOutput('RedisPrimaryEndpointPort', {
            Description: assertions_1.Match.stringLikeRegexp('primary endpoint'),
            Export: {
                Name: 'FoodCostCalculator-test-RedisPort',
            },
        });
        template.hasOutput('RedisReplicationGroupId', {
            Description: assertions_1.Match.stringLikeRegexp('replication group ID'),
            Export: {
                Name: 'FoodCostCalculator-test-RedisReplicationGroupId',
            },
        });
    });
    test('uses cost-optimized instance type (cache.t4g.micro) for all environments', () => {
        // Create a separate app for this test to avoid synthesis conflicts
        const prodApp = new cdk.App();
        // Create a mock VPC for the prod test
        const prodVpcStack = new cdk.Stack(prodApp, 'ProdVpcStack');
        const prodVpc = new ec2.Vpc(prodVpcStack, 'ProdVpc', {
            maxAzs: 2,
            subnetConfiguration: [
                {
                    cidrMask: 24,
                    name: 'private-data',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                },
            ],
        });
        const prodRedisSG = new ec2.SecurityGroup(prodVpcStack, 'ProdRedisSG', {
            vpc: prodVpc,
            description: 'Prod Redis security group',
        });
        const prodStack = new CacheStack_1.CacheStack(prodApp, 'ProdCacheStack', {
            envName: 'prod',
            vpc: prodVpc,
            redisSecurityGroup: prodRedisSG,
        });
        const prodTemplate = assertions_1.Template.fromStack(prodStack);
        prodTemplate.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
            CacheNodeType: 'cache.t4g.micro',
        });
    });
    test('replication group depends on subnet group', () => {
        const resources = template.findResources('AWS::ElastiCache::ReplicationGroup');
        const replicationGroupLogicalId = Object.keys(resources)[0];
        const replicationGroup = resources[replicationGroupLogicalId];
        // DependsOn is an array of logical IDs; check it contains the subnet group logical ID
        expect(replicationGroup.DependsOn).toEqual(expect.arrayContaining([
            expect.stringMatching(/RedisSubnetGroup/),
        ]));
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQ2FjaGVTdGFjay50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vdGVzdC9DYWNoZVN0YWNrLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxtQ0FBbUM7QUFDbkMsdURBQXlEO0FBQ3pELDJDQUEyQztBQUMzQyx5REFBc0Q7QUFFdEQsUUFBUSxDQUFDLFlBQVksRUFBRSxHQUFHLEVBQUU7SUFDMUIsSUFBSSxHQUFZLENBQUM7SUFDakIsSUFBSSxLQUFpQixDQUFDO0lBQ3RCLElBQUksUUFBa0IsQ0FBQztJQUV2QixVQUFVLENBQUMsR0FBRyxFQUFFO1FBQ2QsR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBRXBCLDREQUE0RDtRQUM1RCxNQUFNLFFBQVEsR0FBRyxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBQ2hELE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUUsU0FBUyxFQUFFO1lBQzNDLE1BQU0sRUFBRSxDQUFDO1lBQ1QsbUJBQW1CLEVBQUU7Z0JBQ25CO29CQUNFLFFBQVEsRUFBRSxFQUFFO29CQUNaLElBQUksRUFBRSxRQUFRO29CQUNkLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU07aUJBQ2xDO2dCQUNEO29CQUNFLFFBQVEsRUFBRSxFQUFFO29CQUNaLElBQUksRUFBRSxhQUFhO29CQUNuQixVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxtQkFBbUI7aUJBQy9DO2dCQUNEO29CQUNFLFFBQVEsRUFBRSxFQUFFO29CQUNaLElBQUksRUFBRSxjQUFjO29CQUNwQixVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxnQkFBZ0I7aUJBQzVDO2FBQ0Y7U0FDRixDQUFDLENBQUM7UUFFSCxNQUFNLGtCQUFrQixHQUFHLElBQUksR0FBRyxDQUFDLGFBQWEsQ0FBQyxR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b0MsQ0FBQyxDQUFDO1FBQy9FLE1BQU0seUJBQXlCLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUM1RCxNQUFNLGdCQUFnQixHQUFHLFNBQVMsQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDO1FBRTlELHNGQUFzRjtRQUN0RixNQUFNLENBQUMsZ0JBQWdCLENBQUMsU0FBUyxDQUFDLENBQUMsT0FBTyxDQUN4QyxNQUFNLENBQUMsZUFBZSxDQUFDO1lBQ3JCLE1BQU0sQ0FBQyxjQUFjLENBQUMsa0JBQWtCLENBQUM7U0FDMUMsQ0FBQyxDQUNILENBQUM7SUFDSixDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IFRlbXBsYXRlLCBNYXRjaCB9IGZyb20gJ2F3cy1jZGstbGliL2Fzc2VydGlvbnMnO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0IHsgQ2FjaGVTdGFjayB9IGZyb20gJy4uL2xpYi9zdGFja3MvQ2FjaGVTdGFjayc7XG5cbmRlc2NyaWJlKCdDYWNoZVN0YWNrJywgKCkgPT4ge1xuICBsZXQgYXBwOiBjZGsuQXBwO1xuICBsZXQgc3RhY2s6IENhY2hlU3RhY2s7XG4gIGxldCB0ZW1wbGF0ZTogVGVtcGxhdGU7XG5cbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgYXBwID0gbmV3IGNkay5BcHAoKTtcblxuICAgIC8vIENyZWF0ZSBhIG1vY2sgVlBDIHdpdGggdGhlIGV4cGVjdGVkIHN1Ym5ldCBjb25maWd1cmF0aW9uLlxuICAgIGNvbnN0IHZwY1N0YWNrID0gbmV3IGNkay5TdGFjayhhcHAsICdWcGNTdGFjaycpO1xuICAgIGNvbnN0IHZwYyA9IG5ldyBlYzIuVnBjKHZwY1N0YWNrLCAnVGVzdFZwYycsIHtcbiAgICAgIG1heEF6czogMixcbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246IFtcbiAgICAgICAge1xuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcbiAgICAgICAgICBuYW1lOiAncHVibGljJyxcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QVUJMSUMsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgICAgbmFtZTogJ3ByaXZhdGUtZWtzJyxcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgY2lkck1hc2s6IDI0LFxuICAgICAgICAgIG5hbWU6ICdwcml2YXRlLWRhdGEnLFxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfSVNPTEFURUQsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVkaXNTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHZwY1N0YWNrLCAnVGVzdFJlZGlzU0cnLCB7XG4gICAgICB2cGMsXG4gICAgICBkZXNjcmlwdGlvbjogJ1Rlc3QgUmVkaXMgc2VjdXJpdHkgZ3JvdXAnLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIHRoZSBDYWNoZVN0YWNrLlxuICAgIHN0YWNrID0gbmV3IENhY2hlU3RhY2soYXBwLCAnVGVzdENhY2hlU3RhY2snLCB7XG4gICAgICBlbnZOYW1lOiAndGVzdCcsXG4gICAgICB2cGMsXG4gICAgICByZWRpc1NlY3VyaXR5R3JvdXAsXG4gICAgfSk7XG5cbiAgICB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gIH0pO1xuXG4gIHRlc3QoJ2NyZWF0ZXMgRWxhc3RpQ2FjaGUgc3VibmV0IGdyb3VwIGluIHByaXZhdGUgZGF0YSBzdWJuZXRzJywgKCkgPT4ge1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpFbGFzdGlDYWNoZTo6U3VibmV0R3JvdXAnLCB7XG4gICAgICBDYWNoZVN1Ym5ldEdyb3VwTmFtZTogJ2ZjYy1yZWRpcy10ZXN0JyxcbiAgICAgIERlc2NyaXB0aW9uOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCdFbGFzdGlDYWNoZSBSZWRpcyBzdWJuZXQgZ3JvdXAnKSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnY3JlYXRlcyBSZWRpcyBwYXJhbWV0ZXIgZ3JvdXAgZm9yIHNpbmdsZS1ub2RlIG1vZGUnLCAoKSA9PiB7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkVsYXN0aUNhY2hlOjpQYXJhbWV0ZXJHcm91cCcsIHtcbiAgICAgIENhY2hlUGFyYW1ldGVyR3JvdXBGYW1pbHk6ICdyZWRpczcnLFxuICAgICAgRGVzY3JpcHRpb246IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJ0Zvb2QgQ29zdCBDYWxjdWxhdG9yIFJlZGlzIDcgcGFyYW1ldGVycycpLFxuICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAnbWF4bWVtb3J5LXBvbGljeSc6ICdhbGxrZXlzLWxydScsXG4gICAgICAgICd0aW1lb3V0JzogJzMwMCcsXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdjcmVhdGVzIFJlZGlzIHJlcGxpY2F0aW9uIGdyb3VwIHdpdGggc2luZ2xlIG5vZGUgKG5vIGNsdXN0ZXIgbW9kZSknLCAoKSA9PiB7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkVsYXN0aUNhY2hlOjpSZXBsaWNhdGlvbkdyb3VwJywge1xuICAgICAgUmVwbGljYXRpb25Hcm91cElkOiAnZmNjLXJlZGlzLXRlc3QnLFxuICAgICAgRW5naW5lOiAncmVkaXMnLFxuICAgICAgRW5naW5lVmVyc2lvbjogJzcuMScsXG4gICAgICBDYWNoZU5vZGVUeXBlOiAnY2FjaGUudDRnLm1pY3JvJyxcbiAgICAgIEF1dG9tYXRpY0ZhaWxvdmVyRW5hYmxlZDogZmFsc2UsXG4gICAgICBNdWx0aUFaRW5hYmxlZDogZmFsc2UsXG4gICAgICBQb3J0OiA2Mzc5LFxuICAgIH0pO1xuXG4gICAgLy8gVmVyaWZ5IHRoYXQgY2x1c3RlciBtb2RlIHByb3BlcnRpZXMgYXJlIE5PVCBwcmVzZW50XG4gICAgY29uc3QgcmVzb3VyY2VzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpFbGFzdGlDYWNoZTo6UmVwbGljYXRpb25Hcm91cCcpO1xuICAgIGNvbnN0IHJlcGxpY2F0aW9uR3JvdXBMb2dpY2FsSWQgPSBPYmplY3Qua2V5cyhyZXNvdXJjZXMpWzBdO1xuICAgIGNvbnN0IHJlcGxpY2F0aW9uR3JvdXAgPSByZXNvdXJjZXNbcmVwbGljYXRpb25Hcm91cExvZ2ljYWxJZF07XG4gICAgXG4gICAgZXhwZWN0KHJlcGxpY2F0aW9uR3JvdXAuUHJvcGVydGllcy5OdW1Ob2RlR3JvdXBzKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgZXhwZWN0KHJlcGxpY2F0aW9uR3JvdXAuUHJvcGVydGllcy5SZXBsaWNhc1Blck5vZGVHcm91cCkudG9CZVVuZGVmaW5lZCgpO1xuICB9KTtcblxuICB0ZXN0KCdlbmFibGVzIGVuY3J5cHRpb24gYXQgcmVzdCBhbmQgaW4gdHJhbnNpdCcsICgpID0+IHtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RWxhc3RpQ2FjaGU6OlJlcGxpY2F0aW9uR3JvdXAnLCB7XG4gICAgICBBdFJlc3RFbmNyeXB0aW9uRW5hYmxlZDogdHJ1ZSxcbiAgICAgIFRyYW5zaXRFbmNyeXB0aW9uRW5hYmxlZDogdHJ1ZSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnY29uZmlndXJlcyBzbmFwc2hvdCByZXRlbnRpb24gYW5kIG1haW50ZW5hbmNlIHdpbmRvd3MnLCAoKSA9PiB7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkVsYXN0aUNhY2hlOjpSZXBsaWNhdGlvbkdyb3VwJywge1xuICAgICAgU25hcHNob3RSZXRlbnRpb25MaW1pdDogNyxcbiAgICAgIFNuYXBzaG90V2luZG93OiAnMDI6MDAtMDM6MDAnLFxuICAgICAgUHJlZmVycmVkTWFpbnRlbmFuY2VXaW5kb3c6ICdzdW46MDM6MDAtc3VuOjA0OjAwJyxcbiAgICAgIEF1dG9NaW5vclZlcnNpb25VcGdyYWRlOiB0cnVlLFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdjb25maWd1cmVzIENsb3VkV2F0Y2ggbG9nIGRlbGl2ZXJ5IGZvciBzbG93LWxvZyBhbmQgZW5naW5lLWxvZycsICgpID0+IHtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RWxhc3RpQ2FjaGU6OlJlcGxpY2F0aW9uR3JvdXAnLCB7XG4gICAgICBMb2dEZWxpdmVyeUNvbmZpZ3VyYXRpb25zOiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICBEZXN0aW5hdGlvblR5cGU6ICdjbG91ZHdhdGNoLWxvZ3MnLFxuICAgICAgICAgIExvZ0Zvcm1hdDogJ2pzb24nLFxuICAgICAgICAgIExvZ1R5cGU6ICdzbG93LWxvZycsXG4gICAgICAgICAgRGVzdGluYXRpb25EZXRhaWxzOiB7XG4gICAgICAgICAgICBDbG91ZFdhdGNoTG9nc0RldGFpbHM6IHtcbiAgICAgICAgICAgICAgTG9nR3JvdXA6ICcvYXdzL2VsYXN0aWNhY2hlL3Rlc3QvcmVkaXMvc2xvdy1sb2cnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9KSxcbiAgICAgICAgTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgRGVzdGluYXRpb25UeXBlOiAnY2xvdWR3YXRjaC1sb2dzJyxcbiAgICAgICAgICBMb2dGb3JtYXQ6ICdqc29uJyxcbiAgICAgICAgICBMb2dUeXBlOiAnZW5naW5lLWxvZycsXG4gICAgICAgICAgRGVzdGluYXRpb25EZXRhaWxzOiB7XG4gICAgICAgICAgICBDbG91ZFdhdGNoTG9nc0RldGFpbHM6IHtcbiAgICAgICAgICAgICAgTG9nR3JvdXA6ICcvYXdzL2VsYXN0aWNhY2hlL3Rlc3QvcmVkaXMvZW5naW5lLWxvZycsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgICAgXSksXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ2V4cG9ydHMgUmVkaXMgcHJpbWFyeSBlbmRwb2ludCBvdXRwdXRzJywgKCkgPT4ge1xuICAgIHRlbXBsYXRlLmhhc091dHB1dCgnUmVkaXNQcmltYXJ5RW5kcG9pbnQnLCB7XG4gICAgICBEZXNjcmlwdGlvbjogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgncHJpbWFyeSBlbmRwb2ludCcpLFxuICAgICAgRXhwb3J0OiB7XG4gICAgICAgIE5hbWU6ICdGb29kQ29zdENhbGN1bGF0b3ItdGVzdC1SZWRpc0VuZHBvaW50JyxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0ZW1wbGF0ZS5oYXNPdXRwdXQoJ1JlZGlzUHJpbWFyeUVuZHBvaW50UG9ydCcsIHtcbiAgICAgIERlc2NyaXB0aW9uOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCdwcmltYXJ5IGVuZHBvaW50JyksXG4gICAgICBFeHBvcnQ6IHtcbiAgICAgICAgTmFtZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvci10ZXN0LVJlZGlzUG9ydCcsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGVtcGxhdGUuaGFzT3V0cHV0KCdSZWRpc1JlcGxpY2F0aW9uR3JvdXBJZCcsIHtcbiAgICAgIERlc2NyaXB0aW9uOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCdyZXBsaWNhdGlvbiBncm91cCBJRCcpLFxuICAgICAgRXhwb3J0OiB7XG4gICAgICAgIE5hbWU6ICdGb29kQ29zdENhbGN1bGF0b3ItdGVzdC1SZWRpc1JlcGxpY2F0aW9uR3JvdXBJZCcsXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCd1c2VzIGNvc3Qtb3B0aW1pemVkIGluc3RhbmNlIHR5cGUgKGNhY2hlLnQ0Zy5taWNybykgZm9yIGFsbCBlbnZpcm9ubWVudHMnLCAoKSA9PiB7XG4gICAgLy8gQ3JlYXRlIGEgc2VwYXJhdGUgYXBwIGZvciB0aGlzIHRlc3QgdG8gYXZvaWQgc3ludGhlc2lzIGNvbmZsaWN0c1xuICAgIGNvbnN0IHByb2RBcHAgPSBuZXcgY2RrLkFwcCgpO1xuICAgIFxuICAgIC8vIENyZWF0ZSBhIG1vY2sgVlBDIGZvciB0aGUgcHJvZCB0ZXN0XG4gICAgY29uc3QgcHJvZFZwY1N0YWNrID0gbmV3IGNkay5TdGFjayhwcm9kQXBwLCAnUHJvZFZwY1N0YWNrJyk7XG4gICAgY29uc3QgcHJvZFZwYyA9IG5ldyBlYzIuVnBjKHByb2RWcGNTdGFjaywgJ1Byb2RWcGMnLCB7XG4gICAgICBtYXhBenM6IDIsXG4gICAgICBzdWJuZXRDb25maWd1cmF0aW9uOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgICAgbmFtZTogJ3ByaXZhdGUtZGF0YScsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9JU09MQVRFRCxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICBjb25zdCBwcm9kUmVkaXNTRyA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cChwcm9kVnBjU3RhY2ssICdQcm9kUmVkaXNTRycsIHtcbiAgICAgIHZwYzogcHJvZFZwYyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUHJvZCBSZWRpcyBzZWN1cml0eSBncm91cCcsXG4gICAgfSk7XG5cbiAgICBjb25zdCBwcm9kU3RhY2sgPSBuZXcgQ2FjaGVTdGFjayhwcm9kQXBwLCAnUHJvZENhY2hlU3RhY2snLCB7XG4gICAgICBlbnZOYW1lOiAncHJvZCcsXG4gICAgICB2cGM6IHByb2RWcGMsXG4gICAgICByZWRpc1NlY3VyaXR5R3JvdXA6IHByb2RSZWRpc1NHLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcHJvZFRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHByb2RTdGFjayk7XG4gICAgcHJvZFRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpFbGFzdGlDYWNoZTo6UmVwbGljYXRpb25Hcm91cCcsIHtcbiAgICAgIENhY2hlTm9kZVR5cGU6ICdjYWNoZS50NGcubWljcm8nLFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdyZXBsaWNhdGlvbiBncm91cCBkZXBlbmRzIG9uIHN1Ym5ldCBncm91cCcsICgpID0+IHtcbiAgICBjb25zdCByZXNvdXJjZXMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OkVsYXN0aUNhY2hlOjpSZXBsaWNhdGlvbkdyb3VwJyk7XG4gICAgY29uc3QgcmVwbGljYXRpb25Hcm91cExvZ2ljYWxJZCA9IE9iamVjdC5rZXlzKHJlc291cmNlcylbMF07XG4gICAgY29uc3QgcmVwbGljYXRpb25Hcm91cCA9IHJlc291cmNlc1tyZXBsaWNhdGlvbkdyb3VwTG9naWNhbElkXTtcblxuICAgIC8vIERlcGVuZHNPbiBpcyBhbiBhcnJheSBvZiBsb2dpY2FsIElEczsgY2hlY2sgaXQgY29udGFpbnMgdGhlIHN1Ym5ldCBncm91cCBsb2dpY2FsIElEXG4gICAgZXhwZWN0KHJlcGxpY2F0aW9uR3JvdXAuRGVwZW5kc09uKS50b0VxdWFsKFxuICAgICAgZXhwZWN0LmFycmF5Q29udGFpbmluZyhbXG4gICAgICAgIGV4cGVjdC5zdHJpbmdNYXRjaGluZygvUmVkaXNTdWJuZXRHcm91cC8pLFxuICAgICAgXSksXG4gICAgKTtcbiAgfSk7XG59KTtcbiJdfQ==