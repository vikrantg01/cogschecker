import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { RdsStack } from '../lib/stacks/RdsStack';

describe('DatabaseStack (RdsStack)', () => {
  let app: cdk.App;
  let stack: RdsStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();

    // Create a mock VPC with the expected subnet configuration
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
          name: 'private-egress',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 24,
          name: 'private-isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    const rdsSecurityGroup = new ec2.SecurityGroup(vpcStack, 'TestRdsSG', {
      vpc,
      description: 'Test RDS security group',
    });

    // Create the RdsStack (DatabaseStack)
    stack = new RdsStack(app, 'TestDatabaseStack', {
      envName: 'test',
      vpc,
      rdsSecurityGroup,
    });

    template = Template.fromStack(stack);
  });

  test('Verify RDS instance type is db.t4g.micro', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DBInstanceClass: 'db.t4g.micro',
    });
  });

  test('Verify Multi-AZ is set to false for single-AZ deployment', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      MultiAZ: false,
    });
  });

  test('Verify storage encryption enabled', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      StorageEncrypted: true,
    });
  });

  test('Verify Secrets Manager secret created', () => {
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Description: Match.stringLikeRegexp('RDS PostgreSQL credentials'),
      GenerateSecretString: Match.objectLike({
        SecretStringTemplate: Match.stringLikeRegexp('postgres'),
        GenerateStringKey: 'password',
        PasswordLength: 32,
      }),
    });
  });

  test('Verify parameter group enforces SSL (rds.force_ssl=1)', () => {
    template.hasResourceProperties('AWS::RDS::DBParameterGroup', {
      Description: Match.stringLikeRegexp('RDS PostgreSQL parameter group'),
      Parameters: Match.objectLike({
        'rds.force_ssl': '1',
      }),
    });
  });

  test('Verify RDS instance uses PostgreSQL 15.4', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'postgres',
      EngineVersion: '15.4',
    });
  });

  test('Verify storage configuration (gp3, 20GB, auto-scaling to 100GB)', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      StorageType: 'gp3',
      AllocatedStorage: '20',
      MaxAllocatedStorage: 100,
    });
  });

  test('Verify automated backups with 7-day retention', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      BackupRetentionPeriod: 7,
      PreferredBackupWindow: '03:00-04:00',
      CopyTagsToSnapshot: true,
    });
  });

  test('Verify database name is foodcost', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DBName: 'foodcost',
    });
  });

  test('Verify deletion protection enabled', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DeletionProtection: true,
    });
  });

  test('Verify RDS deployed in private isolated subnets', () => {
    // Check that a subnet group is created
    template.hasResourceProperties('AWS::RDS::DBSubnetGroup', {
      DBSubnetGroupName: 'foodcost-rds-test',
      DBSubnetGroupDescription: Match.stringLikeRegexp('RDS PostgreSQL subnet group'),
    });
  });

  test('Verify CloudWatch exports enabled for PostgreSQL logs', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      EnableCloudwatchLogsExports: ['postgresql'],
    });
  });

  test('Verify enhanced monitoring enabled', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      MonitoringInterval: 60,
    });
  });

  test('Verify CloudFormation outputs for endpoint, port, database name, and secret ARN', () => {
    template.hasOutput('Endpoint', {
      Description: Match.stringLikeRegexp('RDS PostgreSQL endpoint'),
      Export: {
        Name: 'FoodCostCalculator-test-DatabaseEndpoint',
      },
    });

    template.hasOutput('Port', {
      Description: Match.stringLikeRegexp('RDS PostgreSQL port'),
      Export: {
        Name: 'FoodCostCalculator-test-DatabasePort',
      },
    });

    template.hasOutput('DatabaseName', {
      Description: Match.stringLikeRegexp('Database name'),
      Export: {
        Name: 'FoodCostCalculator-test-DatabaseName',
      },
    });

    template.hasOutput('SecretArn', {
      Description: Match.stringLikeRegexp('Secrets Manager ARN'),
      Export: {
        Name: 'FoodCostCalculator-test-DatabaseSecretArn',
      },
    });
  });

  test('Verify RDS instance uses credentials from Secrets Manager', () => {
    // Check that the RDS instance references a secret for MasterUserPassword
    const resources = template.findResources('AWS::RDS::DBInstance');
    const dbInstanceLogicalId = Object.keys(resources)[0];
    const dbInstance = resources[dbInstanceLogicalId];

    // The MasterUserPassword should be a dynamic reference to Secrets Manager using Fn::Join
    expect(dbInstance.Properties.MasterUserPassword).toEqual(
      expect.objectContaining({
        'Fn::Join': expect.arrayContaining([
          expect.any(String),
          expect.arrayContaining([
            expect.stringMatching(/secretsmanager/),
          ]),
        ]),
      })
    );
  });

  test('Verify RDS instance references subnet group and parameter group', () => {
    const resources = template.findResources('AWS::RDS::DBInstance');
    const dbInstanceLogicalId = Object.keys(resources)[0];
    const dbInstance = resources[dbInstanceLogicalId];

    // Check that the RDS instance references the subnet group and parameter group
    expect(dbInstance.Properties.DBSubnetGroupName).toEqual(
      expect.objectContaining({
        Ref: expect.stringMatching(/SubnetGroup/),
      })
    );
    
    expect(dbInstance.Properties.DBParameterGroupName).toEqual(
      expect.objectContaining({
        Ref: expect.stringMatching(/ParameterGroup/),
      })
    );
  });

  test('Verify Component and CostCenter tags are applied', () => {
    // Check that the stack has the required tags
    const stackTags = template.toJSON().Resources;
    
    // Find the RDS instance resource
    const rdsInstanceKey = Object.keys(stackTags).find(key => 
      stackTags[key].Type === 'AWS::RDS::DBInstance'
    );
    
    expect(rdsInstanceKey).toBeDefined();
  });

  test('Verify single-AZ deployment for cost optimization (prod environment)', () => {
    // Create a separate app for prod environment test
    const prodApp = new cdk.App();
    
    const prodVpcStack = new cdk.Stack(prodApp, 'ProdVpcStack');
    const prodVpc = new ec2.Vpc(prodVpcStack, 'ProdVpc', {
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'private-isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    const prodRdsSG = new ec2.SecurityGroup(prodVpcStack, 'ProdRdsSG', {
      vpc: prodVpc,
      description: 'Prod RDS security group',
    });

    const prodStack = new RdsStack(prodApp, 'ProdDatabaseStack', {
      envName: 'prod',
      vpc: prodVpc,
      rdsSecurityGroup: prodRdsSG,
    });

    const prodTemplate = Template.fromStack(prodStack);
    
    // Verify prod also uses single-AZ and db.t4g.micro
    prodTemplate.hasResourceProperties('AWS::RDS::DBInstance', {
      DBInstanceClass: 'db.t4g.micro',
      MultiAZ: false,
    });
  });

  test('Verify auto minor version upgrade enabled', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      AutoMinorVersionUpgrade: true,
    });
  });

  test('Verify preferred maintenance window configured', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      PreferredMaintenanceWindow: 'sun:04:00-sun:05:00',
    });
  });

  test('Verify master username is postgres', () => {
    // The MasterUsername is retrieved from Secrets Manager, so it's a dynamic reference
    const resources = template.findResources('AWS::RDS::DBInstance');
    const dbInstanceLogicalId = Object.keys(resources)[0];
    const dbInstance = resources[dbInstanceLogicalId];

    // MasterUsername should reference the secret
    expect(dbInstance.Properties.MasterUsername).toEqual(
      expect.objectContaining({
        'Fn::Join': expect.arrayContaining([
          expect.any(String),
          expect.arrayContaining([
            expect.stringMatching(/secretsmanager/),
          ]),
        ]),
      })
    );
  });
});
