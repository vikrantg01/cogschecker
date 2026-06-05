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
        const elastiCacheSecurityGroup = new ec2.SecurityGroup(vpcStack, 'TestElastiCacheSG', {
            vpc,
            description: 'Test ElastiCache security group',
        });
        // Create the CacheStack.
        stack = new CacheStack_1.CacheStack(app, 'TestCacheStack', {
            envName: 'test',
            vpc,
            elastiCacheSecurityGroup,
        });
        template = assertions_1.Template.fromStack(stack);
    });
    test('creates ElastiCache subnet group in private data subnets', () => {
        template.hasResourceProperties('AWS::ElastiCache::SubnetGroup', {
            CacheSubnetGroupName: 'fcc-redis-test',
            Description: assertions_1.Match.stringLikeRegexp('ElastiCache Redis subnet group'),
        });
    });
    test('creates Redis parameter group for cluster mode', () => {
        template.hasResourceProperties('AWS::ElastiCache::ParameterGroup', {
            CacheParameterGroupFamily: 'redis7.cluster.on',
            Description: assertions_1.Match.stringLikeRegexp('Food Cost Calculator Redis 7 cluster parameters'),
            Properties: {
                'notify-keyspace-events': 'AKE',
                'maxmemory-policy': 'allkeys-lru',
                'timeout': '300',
            },
        });
    });
    test('creates Redis replication group with cluster mode enabled', () => {
        template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
            ReplicationGroupId: 'fcc-redis-test',
            Engine: 'redis',
            EngineVersion: '7.1',
            CacheNodeType: 'cache.t4g.micro',
            NumNodeGroups: 2,
            ReplicasPerNodeGroup: 2,
            AutomaticFailoverEnabled: true,
            MultiAZEnabled: true,
            Port: 6379,
        });
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
    test('exports Redis configuration endpoint outputs', () => {
        template.hasOutput('RedisConfigurationEndpoint', {
            Description: assertions_1.Match.stringLikeRegexp('configuration endpoint'),
            Export: {
                Name: 'FoodCostCalculator-test-RedisConfigurationEndpointAddress',
            },
        });
        template.hasOutput('RedisConfigurationEndpointPort', {
            Description: assertions_1.Match.stringLikeRegexp('configuration endpoint'),
            Export: {
                Name: 'FoodCostCalculator-test-RedisConfigurationEndpointPort',
            },
        });
        template.hasOutput('RedisReplicationGroupId', {
            Description: assertions_1.Match.stringLikeRegexp('replication group ID'),
            Export: {
                Name: 'FoodCostCalculator-test-RedisReplicationGroupId',
            },
        });
    });
    test('uses production-grade instance type for prod environment', () => {
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
        const prodElastiCacheSG = new ec2.SecurityGroup(prodVpcStack, 'ProdElastiCacheSG', {
            vpc: prodVpc,
            description: 'Prod ElastiCache security group',
        });
        const prodStack = new CacheStack_1.CacheStack(prodApp, 'ProdCacheStack', {
            envName: 'prod',
            vpc: prodVpc,
            elastiCacheSecurityGroup: prodElastiCacheSG,
        });
        const prodTemplate = assertions_1.Template.fromStack(prodStack);
        prodTemplate.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
            CacheNodeType: 'cache.r7g.large',
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQ2FjaGVTdGFjay50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vdGVzdC9DYWNoZVN0YWNrLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxtQ0FBbUM7QUFDbkMsdURBQXlEO0FBQ3pELDJDQUEyQztBQUMzQyx5REFBc0Q7QUFFdEQsUUFBUSxDQUFDLFlBQVksRUFBRSxHQUFHLEVBQUU7SUFDMUIsSUFBSSxHQUFZLENBQUM7SUFDakIsSUFBSSxLQUFpQixDQUFDO0lBQ3RCLElBQUksUUFBa0IsQ0FBQztJQUV2QixVQUFVLENBQUMsR0FBRyxFQUFFO1FBQ2QsR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBRXBCLDREQUE0RDtRQUM1RCxNQUFNLFFBQVEsR0FBRyxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBQ2hELE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUUsU0FBUyxFQUFFO1lBQzNDLE1BQU0sRUFBRSxDQUFDO1lBQ1QsbUJBQW1CLEVBQUU7Z0JBQ25CO29CQUNFLFFBQVEsRUFBRSxFQUFFO29CQUNaLElBQUksRUFBRSxRQUFRO29CQUNkLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU07aUJBQ2xDO2dCQUNEO29CQUNFLFFBQVEsRUFBRSxFQUFFO29CQUNaLElBQUksRUFBRSxhQUFhO29CQUNuQixVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxtQkFBbUI7aUJBQy9DO2dCQUNEO29CQUNFLFFBQVEsRUFBRSxFQUFFO29CQUNaLElBQUksRUFBRSxjQUFjO29CQUNwQixVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxnQkFBZ0I7aUJBQzVDO2FBQ0Y7U0FDRixDQUFDLENBQUM7UUFFSCxNQUFNLHdCQUF3QixHQUFHLElBQUksR0FBRyxDQUFDLGFBQWEsQ0FBQyxR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QixDQUFDO1NBQzFDLENBQUMsQ0FDSCxDQUFDO0lBQ0osQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBUZW1wbGF0ZSwgTWF0Y2ggfSBmcm9tICdhd3MtY2RrLWxpYi9hc3NlcnRpb25zJztcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCB7IENhY2hlU3RhY2sgfSBmcm9tICcuLi9saWIvc3RhY2tzL0NhY2hlU3RhY2snO1xuXG5kZXNjcmliZSgnQ2FjaGVTdGFjaycsICgpID0+IHtcbiAgbGV0IGFwcDogY2RrLkFwcDtcbiAgbGV0IHN0YWNrOiBDYWNoZVN0YWNrO1xuICBsZXQgdGVtcGxhdGU6IFRlbXBsYXRlO1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIGFwcCA9IG5ldyBjZGsuQXBwKCk7XG5cbiAgICAvLyBDcmVhdGUgYSBtb2NrIFZQQyB3aXRoIHRoZSBleHBlY3RlZCBzdWJuZXQgY29uZmlndXJhdGlvbi5cbiAgICBjb25zdCB2cGNTdGFjayA9IG5ldyBjZGsuU3RhY2soYXBwLCAnVnBjU3RhY2snKTtcbiAgICBjb25zdCB2cGMgPSBuZXcgZWMyLlZwYyh2cGNTdGFjaywgJ1Rlc3RWcGMnLCB7XG4gICAgICBtYXhBenM6IDIsXG4gICAgICBzdWJuZXRDb25maWd1cmF0aW9uOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgICAgbmFtZTogJ3B1YmxpYycsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFVCTElDLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgY2lkck1hc2s6IDI0LFxuICAgICAgICAgIG5hbWU6ICdwcml2YXRlLWVrcycsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcbiAgICAgICAgICBuYW1lOiAncHJpdmF0ZS1kYXRhJyxcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX0lTT0xBVEVELFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGVsYXN0aUNhY2hlU2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh2cGNTdGFjaywgJ1Rlc3RFbGFzdGlDYWNoZVNHJywge1xuICAgICAgdnBjLFxuICAgICAgZGVzY3JpcHRpb246ICdUZXN0IEVsYXN0aUNhY2hlIHNlY3VyaXR5IGdyb3VwJyxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSB0aGUgQ2FjaGVTdGFjay5cbiAgICBzdGFjayA9IG5ldyBDYWNoZVN0YWNrKGFwcCwgJ1Rlc3RDYWNoZVN0YWNrJywge1xuICAgICAgZW52TmFtZTogJ3Rlc3QnLFxuICAgICAgdnBjLFxuICAgICAgZWxhc3RpQ2FjaGVTZWN1cml0eUdyb3VwLFxuICAgIH0pO1xuXG4gICAgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICB9KTtcblxuICB0ZXN0KCdjcmVhdGVzIEVsYXN0aUNhY2hlIHN1Ym5ldCBncm91cCBpbiBwcml2YXRlIGRhdGEgc3VibmV0cycsICgpID0+IHtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RWxhc3RpQ2FjaGU6OlN1Ym5ldEdyb3VwJywge1xuICAgICAgQ2FjaGVTdWJuZXRHcm91cE5hbWU6ICdmY2MtcmVkaXMtdGVzdCcsXG4gICAgICBEZXNjcmlwdGlvbjogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnRWxhc3RpQ2FjaGUgUmVkaXMgc3VibmV0IGdyb3VwJyksXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ2NyZWF0ZXMgUmVkaXMgcGFyYW1ldGVyIGdyb3VwIGZvciBjbHVzdGVyIG1vZGUnLCAoKSA9PiB7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkVsYXN0aUNhY2hlOjpQYXJhbWV0ZXJHcm91cCcsIHtcbiAgICAgIENhY2hlUGFyYW1ldGVyR3JvdXBGYW1pbHk6ICdyZWRpczcuY2x1c3Rlci5vbicsXG4gICAgICBEZXNjcmlwdGlvbjogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnRm9vZCBDb3N0IENhbGN1bGF0b3IgUmVkaXMgNyBjbHVzdGVyIHBhcmFtZXRlcnMnKSxcbiAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgJ25vdGlmeS1rZXlzcGFjZS1ldmVudHMnOiAnQUtFJyxcbiAgICAgICAgJ21heG1lbW9yeS1wb2xpY3knOiAnYWxsa2V5cy1scnUnLFxuICAgICAgICAndGltZW91dCc6ICczMDAnLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnY3JlYXRlcyBSZWRpcyByZXBsaWNhdGlvbiBncm91cCB3aXRoIGNsdXN0ZXIgbW9kZSBlbmFibGVkJywgKCkgPT4ge1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpFbGFzdGlDYWNoZTo6UmVwbGljYXRpb25Hcm91cCcsIHtcbiAgICAgIFJlcGxpY2F0aW9uR3JvdXBJZDogJ2ZjYy1yZWRpcy10ZXN0JyxcbiAgICAgIEVuZ2luZTogJ3JlZGlzJyxcbiAgICAgIEVuZ2luZVZlcnNpb246ICc3LjEnLFxuICAgICAgQ2FjaGVOb2RlVHlwZTogJ2NhY2hlLnQ0Zy5taWNybycsXG4gICAgICBOdW1Ob2RlR3JvdXBzOiAyLFxuICAgICAgUmVwbGljYXNQZXJOb2RlR3JvdXA6IDIsXG4gICAgICBBdXRvbWF0aWNGYWlsb3ZlckVuYWJsZWQ6IHRydWUsXG4gICAgICBNdWx0aUFaRW5hYmxlZDogdHJ1ZSxcbiAgICAgIFBvcnQ6IDYzNzksXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ2VuYWJsZXMgZW5jcnlwdGlvbiBhdCByZXN0IGFuZCBpbiB0cmFuc2l0JywgKCkgPT4ge1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpFbGFzdGlDYWNoZTo6UmVwbGljYXRpb25Hcm91cCcsIHtcbiAgICAgIEF0UmVzdEVuY3J5cHRpb25FbmFibGVkOiB0cnVlLFxuICAgICAgVHJhbnNpdEVuY3J5cHRpb25FbmFibGVkOiB0cnVlLFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdjb25maWd1cmVzIHNuYXBzaG90IHJldGVudGlvbiBhbmQgbWFpbnRlbmFuY2Ugd2luZG93cycsICgpID0+IHtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RWxhc3RpQ2FjaGU6OlJlcGxpY2F0aW9uR3JvdXAnLCB7XG4gICAgICBTbmFwc2hvdFJldGVudGlvbkxpbWl0OiA3LFxuICAgICAgU25hcHNob3RXaW5kb3c6ICcwMjowMC0wMzowMCcsXG4gICAgICBQcmVmZXJyZWRNYWludGVuYW5jZVdpbmRvdzogJ3N1bjowMzowMC1zdW46MDQ6MDAnLFxuICAgICAgQXV0b01pbm9yVmVyc2lvblVwZ3JhZGU6IHRydWUsXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ2NvbmZpZ3VyZXMgQ2xvdWRXYXRjaCBsb2cgZGVsaXZlcnkgZm9yIHNsb3ctbG9nIGFuZCBlbmdpbmUtbG9nJywgKCkgPT4ge1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpFbGFzdGlDYWNoZTo6UmVwbGljYXRpb25Hcm91cCcsIHtcbiAgICAgIExvZ0RlbGl2ZXJ5Q29uZmlndXJhdGlvbnM6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgIERlc3RpbmF0aW9uVHlwZTogJ2Nsb3Vkd2F0Y2gtbG9ncycsXG4gICAgICAgICAgTG9nRm9ybWF0OiAnanNvbicsXG4gICAgICAgICAgTG9nVHlwZTogJ3Nsb3ctbG9nJyxcbiAgICAgICAgICBEZXN0aW5hdGlvbkRldGFpbHM6IHtcbiAgICAgICAgICAgIENsb3VkV2F0Y2hMb2dzRGV0YWlsczoge1xuICAgICAgICAgICAgICBMb2dHcm91cDogJy9hd3MvZWxhc3RpY2FjaGUvdGVzdC9yZWRpcy9zbG93LWxvZycsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICBEZXN0aW5hdGlvblR5cGU6ICdjbG91ZHdhdGNoLWxvZ3MnLFxuICAgICAgICAgIExvZ0Zvcm1hdDogJ2pzb24nLFxuICAgICAgICAgIExvZ1R5cGU6ICdlbmdpbmUtbG9nJyxcbiAgICAgICAgICBEZXN0aW5hdGlvbkRldGFpbHM6IHtcbiAgICAgICAgICAgIENsb3VkV2F0Y2hMb2dzRGV0YWlsczoge1xuICAgICAgICAgICAgICBMb2dHcm91cDogJy9hd3MvZWxhc3RpY2FjaGUvdGVzdC9yZWRpcy9lbmdpbmUtbG9nJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSksXG4gICAgICBdKSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnZXhwb3J0cyBSZWRpcyBjb25maWd1cmF0aW9uIGVuZHBvaW50IG91dHB1dHMnLCAoKSA9PiB7XG4gICAgdGVtcGxhdGUuaGFzT3V0cHV0KCdSZWRpc0NvbmZpZ3VyYXRpb25FbmRwb2ludCcsIHtcbiAgICAgIERlc2NyaXB0aW9uOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCdjb25maWd1cmF0aW9uIGVuZHBvaW50JyksXG4gICAgICBFeHBvcnQ6IHtcbiAgICAgICAgTmFtZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvci10ZXN0LVJlZGlzQ29uZmlndXJhdGlvbkVuZHBvaW50QWRkcmVzcycsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGVtcGxhdGUuaGFzT3V0cHV0KCdSZWRpc0NvbmZpZ3VyYXRpb25FbmRwb2ludFBvcnQnLCB7XG4gICAgICBEZXNjcmlwdGlvbjogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnY29uZmlndXJhdGlvbiBlbmRwb2ludCcpLFxuICAgICAgRXhwb3J0OiB7XG4gICAgICAgIE5hbWU6ICdGb29kQ29zdENhbGN1bGF0b3ItdGVzdC1SZWRpc0NvbmZpZ3VyYXRpb25FbmRwb2ludFBvcnQnLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRlbXBsYXRlLmhhc091dHB1dCgnUmVkaXNSZXBsaWNhdGlvbkdyb3VwSWQnLCB7XG4gICAgICBEZXNjcmlwdGlvbjogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgncmVwbGljYXRpb24gZ3JvdXAgSUQnKSxcbiAgICAgIEV4cG9ydDoge1xuICAgICAgICBOYW1lOiAnRm9vZENvc3RDYWxjdWxhdG9yLXRlc3QtUmVkaXNSZXBsaWNhdGlvbkdyb3VwSWQnLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgndXNlcyBwcm9kdWN0aW9uLWdyYWRlIGluc3RhbmNlIHR5cGUgZm9yIHByb2QgZW52aXJvbm1lbnQnLCAoKSA9PiB7XG4gICAgLy8gQ3JlYXRlIGEgc2VwYXJhdGUgYXBwIGZvciB0aGlzIHRlc3QgdG8gYXZvaWQgc3ludGhlc2lzIGNvbmZsaWN0c1xuICAgIGNvbnN0IHByb2RBcHAgPSBuZXcgY2RrLkFwcCgpO1xuICAgIFxuICAgIC8vIENyZWF0ZSBhIG1vY2sgVlBDIGZvciB0aGUgcHJvZCB0ZXN0XG4gICAgY29uc3QgcHJvZFZwY1N0YWNrID0gbmV3IGNkay5TdGFjayhwcm9kQXBwLCAnUHJvZFZwY1N0YWNrJyk7XG4gICAgY29uc3QgcHJvZFZwYyA9IG5ldyBlYzIuVnBjKHByb2RWcGNTdGFjaywgJ1Byb2RWcGMnLCB7XG4gICAgICBtYXhBenM6IDIsXG4gICAgICBzdWJuZXRDb25maWd1cmF0aW9uOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgICAgbmFtZTogJ3ByaXZhdGUtZGF0YScsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9JU09MQVRFRCxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICBjb25zdCBwcm9kRWxhc3RpQ2FjaGVTRyA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cChwcm9kVnBjU3RhY2ssICdQcm9kRWxhc3RpQ2FjaGVTRycsIHtcbiAgICAgIHZwYzogcHJvZFZwYyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUHJvZCBFbGFzdGlDYWNoZSBzZWN1cml0eSBncm91cCcsXG4gICAgfSk7XG5cbiAgICBjb25zdCBwcm9kU3RhY2sgPSBuZXcgQ2FjaGVTdGFjayhwcm9kQXBwLCAnUHJvZENhY2hlU3RhY2snLCB7XG4gICAgICBlbnZOYW1lOiAncHJvZCcsXG4gICAgICB2cGM6IHByb2RWcGMsXG4gICAgICBlbGFzdGlDYWNoZVNlY3VyaXR5R3JvdXA6IHByb2RFbGFzdGlDYWNoZVNHLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcHJvZFRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHByb2RTdGFjayk7XG4gICAgcHJvZFRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpFbGFzdGlDYWNoZTo6UmVwbGljYXRpb25Hcm91cCcsIHtcbiAgICAgIENhY2hlTm9kZVR5cGU6ICdjYWNoZS5yN2cubGFyZ2UnLFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdyZXBsaWNhdGlvbiBncm91cCBkZXBlbmRzIG9uIHN1Ym5ldCBncm91cCcsICgpID0+IHtcbiAgICBjb25zdCByZXNvdXJjZXMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OkVsYXN0aUNhY2hlOjpSZXBsaWNhdGlvbkdyb3VwJyk7XG4gICAgY29uc3QgcmVwbGljYXRpb25Hcm91cExvZ2ljYWxJZCA9IE9iamVjdC5rZXlzKHJlc291cmNlcylbMF07XG4gICAgY29uc3QgcmVwbGljYXRpb25Hcm91cCA9IHJlc291cmNlc1tyZXBsaWNhdGlvbkdyb3VwTG9naWNhbElkXTtcblxuICAgIC8vIERlcGVuZHNPbiBpcyBhbiBhcnJheSBvZiBsb2dpY2FsIElEczsgY2hlY2sgaXQgY29udGFpbnMgdGhlIHN1Ym5ldCBncm91cCBsb2dpY2FsIElEXG4gICAgZXhwZWN0KHJlcGxpY2F0aW9uR3JvdXAuRGVwZW5kc09uKS50b0VxdWFsKFxuICAgICAgZXhwZWN0LmFycmF5Q29udGFpbmluZyhbXG4gICAgICAgIGV4cGVjdC5zdHJpbmdNYXRjaGluZygvUmVkaXNTdWJuZXRHcm91cC8pLFxuICAgICAgXSksXG4gICAgKTtcbiAgfSk7XG59KTtcbiJdfQ==