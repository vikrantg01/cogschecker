import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { CacheStack } from '../lib/stacks/CacheStack';

describe('CacheStack', () => {
  let app: cdk.App;
  let stack: CacheStack;
  let template: Template;

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
    stack = new CacheStack(app, 'TestCacheStack', {
      envName: 'test',
      vpc,
      redisSecurityGroup,
    });

    template = Template.fromStack(stack);
  });

  test('creates ElastiCache subnet group in private data subnets', () => {
    template.hasResourceProperties('AWS::ElastiCache::SubnetGroup', {
      CacheSubnetGroupName: 'fcc-redis-test',
      Description: Match.stringLikeRegexp('ElastiCache Redis subnet group'),
    });
  });

  test('creates Redis parameter group for single-node mode', () => {
    template.hasResourceProperties('AWS::ElastiCache::ParameterGroup', {
      CacheParameterGroupFamily: 'redis7',
      Description: Match.stringLikeRegexp('Food Cost Calculator Redis 7 parameters'),
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
      LogDeliveryConfigurations: Match.arrayWith([
        Match.objectLike({
          DestinationType: 'cloudwatch-logs',
          LogFormat: 'json',
          LogType: 'slow-log',
          DestinationDetails: {
            CloudWatchLogsDetails: {
              LogGroup: '/aws/elasticache/test/redis/slow-log',
            },
          },
        }),
        Match.objectLike({
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
      Description: Match.stringLikeRegexp('primary endpoint'),
      Export: {
        Name: 'FoodCostCalculator-test-RedisEndpoint',
      },
    });

    template.hasOutput('RedisPrimaryEndpointPort', {
      Description: Match.stringLikeRegexp('primary endpoint'),
      Export: {
        Name: 'FoodCostCalculator-test-RedisPort',
      },
    });

    template.hasOutput('RedisReplicationGroupId', {
      Description: Match.stringLikeRegexp('replication group ID'),
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

    const prodStack = new CacheStack(prodApp, 'ProdCacheStack', {
      envName: 'prod',
      vpc: prodVpc,
      redisSecurityGroup: prodRedisSG,
    });

    const prodTemplate = Template.fromStack(prodStack);
    prodTemplate.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
      CacheNodeType: 'cache.t4g.micro',
    });
  });

  test('replication group depends on subnet group', () => {
    const resources = template.findResources('AWS::ElastiCache::ReplicationGroup');
    const replicationGroupLogicalId = Object.keys(resources)[0];
    const replicationGroup = resources[replicationGroupLogicalId];

    // DependsOn is an array of logical IDs; check it contains the subnet group logical ID
    expect(replicationGroup.DependsOn).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/RedisSubnetGroup/),
      ]),
    );
  });
});
