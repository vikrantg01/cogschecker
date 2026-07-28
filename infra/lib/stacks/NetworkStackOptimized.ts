import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface NetworkStackOptimizedProps extends cdk.StackProps {
  /** Logical environment name, e.g. "staging" or "prod" */
  readonly envName: string;
}

/**
 * NetworkStackOptimized
 *
 * Cost-optimized network stack for ECS-based deployment:
 *
 *  • VPC spanning 2 Availability Zones (sufficient for HA)
 *  • 2 public subnets (ALB)
 *  • 2 private subnets with NAT egress (ECS tasks)
 *  • 2 private isolated subnets (RDS, Redis)
 *  • **1 NAT Gateway** (not 2) for cost savings
 *  • Security groups for ALB, ECS, RDS, Redis
 *
 * Cost savings vs NetworkStack:
 *  - 1 NAT gateway vs 2: Save $35/month
 *  - 2 AZs vs 3: Simpler, sufficient for HA
 *
 * Trade-off:
 *  - Single NAT gateway = single point of failure for internet egress
 *  - If NAT fails, ECS tasks can't reach internet (AWS services, Docker Hub)
 *  - For production, consider 2 NAT gateways or VPC endpoints
 */
export class NetworkStackOptimized extends cdk.Stack {
  /** The VPC */
  public readonly vpc: ec2.Vpc;

  /** Security group for ALB */
  public readonly albSecurityGroup: ec2.SecurityGroup;

  /** Security group for ECS tasks */
  public readonly ecsSecurityGroup: ec2.SecurityGroup;

  /** Security group for RDS */
  public readonly rdsSecurityGroup: ec2.SecurityGroup;

  /** Security group for ElastiCache Redis */
  public readonly redisSecurityGroup: ec2.SecurityGroup;

  /** CloudWatch log group for VPC Flow Logs */
  public readonly flowLogsLogGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: NetworkStackOptimizedProps) {
    super(scope, id, props);

    const { envName } = props;

    // ── VPC ─────────────────────────────────────────────────────────────────
    //
    // 2 AZs with:
    //  - 2 public subnets (10.0.1.0/24, 10.0.2.0/24)
    //  - 2 private subnets with NAT (10.0.11.0/24, 10.0.12.0/24)
    //  - 2 private isolated subnets (10.0.21.0/24, 10.0.22.0/24)
    //  - 1 NAT gateway in first AZ only
    //
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `foodcost-${envName}`,
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2,
      natGateways: 1, // Cost optimization: single NAT gateway

      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          mapPublicIpOnLaunch: false,
        },
        {
          cidrMask: 24,
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 24,
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // ── Security Groups ──────────────────────────────────────────────────────

    // 1. ALB Security Group
    //    Allow HTTP/HTTPS from internet
    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: `foodcost-alb-${envName}`,
      description: 'ALB - internet-facing load balancer',
      allowAllOutbound: false,
    });

    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP from internet',
    );

    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS from internet',
    );

    // Allow outbound to ECS tasks
    this.albSecurityGroup.addEgressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(8080),
      'Allow traffic to ECS tasks',
    );

    // 2. ECS Security Group
    //    Allow traffic from ALB on port 8080
    this.ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: `foodcost-ecs-${envName}`,
      description: 'ECS tasks - Spring Boot API',
      allowAllOutbound: true, // Allow outbound for AWS services, Docker Hub, etc.
    });

    this.ecsSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(this.albSecurityGroup.securityGroupId),
      ec2.Port.tcp(8080),
      'Allow traffic from ALB',
    );

    // 3. RDS Security Group
    //    Allow PostgreSQL from ECS tasks only
    this.rdsSecurityGroup = new ec2.SecurityGroup(this, 'RdsSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: `foodcost-rds-${envName}`,
      description: 'RDS PostgreSQL - accepts connections from ECS only',
      allowAllOutbound: false,
    });

    this.rdsSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(this.ecsSecurityGroup.securityGroupId),
      ec2.Port.tcp(5432),
      'Allow PostgreSQL from ECS tasks',
    );

    // 4. Redis Security Group
    //    Allow Redis from ECS tasks only
    this.redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: `foodcost-redis-${envName}`,
      description: 'ElastiCache Redis - accepts connections from ECS only',
      allowAllOutbound: false,
    });

    this.redisSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(this.ecsSecurityGroup.securityGroupId),
      ec2.Port.tcp(6379),
      'Allow Redis from ECS tasks',
    );

    // ── VPC Flow Logs ────────────────────────────────────────────────────────
    //
    // Capture all network traffic metadata (ACCEPT + REJECT) for security auditing
    // Requirement 11.7: VPC Flow Logs for network traffic analysis
    //
    // Create CloudWatch Log Group for VPC flow logs
    this.flowLogsLogGroup = new logs.LogGroup(this, 'VpcFlowLogsLogGroup', {
      logGroupName: `/aws/vpc/flowlogs-${envName}`,
      retention: logs.RetentionDays.ONE_WEEK, // Cost optimization: 7-day retention
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // IAM role for VPC Flow Logs to write to CloudWatch
    const flowLogsRole = new iam.Role(this, 'VpcFlowLogsRole', {
      assumedBy: new iam.ServicePrincipal('vpc-flow-logs.amazonaws.com'),
    });

    // Grant permissions to write logs
    this.flowLogsLogGroup.grantWrite(flowLogsRole);

    // Enable VPC Flow Logs
    new ec2.CfnFlowLog(this, 'VpcFlowLog', {
      resourceType: 'VPC',
      resourceId: this.vpc.vpcId,
      trafficType: 'ALL', // Capture both ACCEPT and REJECT traffic
      logDestinationType: 'cloud-watch-logs',
      logGroupName: this.flowLogsLogGroup.logGroupName,
      deliverLogsPermissionArn: flowLogsRole.roleArn,
      tags: [
        { key: 'Name', value: `foodcost-vpc-flowlogs-${envName}` },
        { key: 'Component', value: 'Network' },
        { key: 'CostCenter', value: 'Infrastructure' },
      ],
    });

    // ── CloudFormation Outputs ───────────────────────────────────────────────
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID',
      exportName: `FoodCostCalculator-${envName}-VpcId`,
    });

    // Export subnet IDs for dependent stacks (Requirement 2.10)
    new cdk.CfnOutput(this, 'PublicSubnetIds', {
      value: this.vpc.publicSubnets.map(subnet => subnet.subnetId).join(','),
      description: 'Comma-separated list of public subnet IDs',
      exportName: `FoodCostCalculator-${envName}-PublicSubnetIds`,
    });

    new cdk.CfnOutput(this, 'PrivateSubnetIds', {
      value: this.vpc.privateSubnets.map(subnet => subnet.subnetId).join(','),
      description: 'Comma-separated list of private subnet IDs (with NAT egress)',
      exportName: `FoodCostCalculator-${envName}-PrivateSubnetIds`,
    });

    new cdk.CfnOutput(this, 'IsolatedSubnetIds', {
      value: this.vpc.isolatedSubnets.map(subnet => subnet.subnetId).join(','),
      description: 'Comma-separated list of isolated subnet IDs (RDS, Redis)',
      exportName: `FoodCostCalculator-${envName}-IsolatedSubnetIds`,
    });

    new cdk.CfnOutput(this, 'AlbSecurityGroupId', {
      value: this.albSecurityGroup.securityGroupId,
      description: 'ALB security group ID',
      exportName: `FoodCostCalculator-${envName}-AlbSecurityGroupId`,
    });

    new cdk.CfnOutput(this, 'EcsSecurityGroupId', {
      value: this.ecsSecurityGroup.securityGroupId,
      description: 'ECS security group ID',
      exportName: `FoodCostCalculator-${envName}-EcsSecurityGroupId`,
    });

    new cdk.CfnOutput(this, 'RdsSecurityGroupId', {
      value: this.rdsSecurityGroup.securityGroupId,
      description: 'RDS security group ID',
      exportName: `FoodCostCalculator-${envName}-RdsSecurityGroupId`,
    });

    new cdk.CfnOutput(this, 'RedisSecurityGroupId', {
      value: this.redisSecurityGroup.securityGroupId,
      description: 'Redis security group ID',
      exportName: `FoodCostCalculator-${envName}-RedisSecurityGroupId`,
    });

    new cdk.CfnOutput(this, 'VpcFlowLogsLogGroupName', {
      value: this.flowLogsLogGroup.logGroupName,
      description: 'CloudWatch log group for VPC Flow Logs',
      exportName: `FoodCostCalculator-${envName}-VpcFlowLogsLogGroupName`,
    });

    // ── Tags ─────────────────────────────────────────────────────────────────
    cdk.Tags.of(this).add('Component', 'Network');
    cdk.Tags.of(this).add('CostCenter', 'Infrastructure');
  }
}
