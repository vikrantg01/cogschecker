"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetworkStackOptimized = void 0;
const cdk = require("aws-cdk-lib");
const ec2 = require("aws-cdk-lib/aws-ec2");
const logs = require("aws-cdk-lib/aws-logs");
const iam = require("aws-cdk-lib/aws-iam");
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
class NetworkStackOptimized extends cdk.Stack {
    /** The VPC */
    vpc;
    /** Security group for ALB */
    albSecurityGroup;
    /** Security group for ECS tasks */
    ecsSecurityGroup;
    /** Security group for RDS */
    rdsSecurityGroup;
    /** Security group for ElastiCache Redis */
    redisSecurityGroup;
    /** CloudWatch log group for VPC Flow Logs */
    flowLogsLogGroup;
    constructor(scope, id, props) {
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
            description: 'ALB — internet-facing load balancer',
            allowAllOutbound: false,
        });
        this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP from internet');
        this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS from internet');
        // Allow outbound to ECS tasks
        this.albSecurityGroup.addEgressRule(ec2.Peer.ipv4(this.vpc.vpcCidrBlock), ec2.Port.tcp(8080), 'Allow traffic to ECS tasks');
        // 2. ECS Security Group
        //    Allow traffic from ALB on port 8080
        this.ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
            vpc: this.vpc,
            securityGroupName: `foodcost-ecs-${envName}`,
            description: 'ECS tasks — Spring Boot API',
            allowAllOutbound: true, // Allow outbound for AWS services, Docker Hub, etc.
        });
        this.ecsSecurityGroup.addIngressRule(ec2.Peer.securityGroupId(this.albSecurityGroup.securityGroupId), ec2.Port.tcp(8080), 'Allow traffic from ALB');
        // 3. RDS Security Group
        //    Allow PostgreSQL from ECS tasks only
        this.rdsSecurityGroup = new ec2.SecurityGroup(this, 'RdsSecurityGroup', {
            vpc: this.vpc,
            securityGroupName: `foodcost-rds-${envName}`,
            description: 'RDS PostgreSQL — accepts connections from ECS only',
            allowAllOutbound: false,
        });
        this.rdsSecurityGroup.addIngressRule(ec2.Peer.securityGroupId(this.ecsSecurityGroup.securityGroupId), ec2.Port.tcp(5432), 'Allow PostgreSQL from ECS tasks');
        // 4. Redis Security Group
        //    Allow Redis from ECS tasks only
        this.redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
            vpc: this.vpc,
            securityGroupName: `foodcost-redis-${envName}`,
            description: 'ElastiCache Redis — accepts connections from ECS only',
            allowAllOutbound: false,
        });
        this.redisSecurityGroup.addIngressRule(ec2.Peer.securityGroupId(this.ecsSecurityGroup.securityGroupId), ec2.Port.tcp(6379), 'Allow Redis from ECS tasks');
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
exports.NetworkStackOptimized = NetworkStackOptimized;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTmV0d29ya1N0YWNrT3B0aW1pemVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vbGliL3N0YWNrcy9OZXR3b3JrU3RhY2tPcHRpbWl6ZWQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBQ25DLDJDQUEyQztBQUMzQyw2Q0FBNkM7QUFDN0MsMkNBQTJDO0FBUTNDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW9CRztBQUNILE1BQWEscUJBQXNCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDbEQsY0FBYztJQUNFLEdBQUcsQ0FBVTtJQUU3Qiw2QkFBNkI7SUFDYixnQkFBZ0IsQ0FBb0I7SUFFcEQsbUNBQW1DO0lBQ25CLGdCQUFnQixDQUFvQjtJQUVwRCw2QkFBNkI7SUFDYixnQkFBZ0IsQ0FBb0I7SUFFcEQsMkNBQTJDO0lBQzNCLGtCQUFrQixDQUFvQjtJQUV0RCw2Q0FBNkM7SUFDN0IsZ0JBQWdCLENBQWdCO0lBRWhELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBaUM7UUFDekUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLE9BQU8sRUFBRSxHQUFHLEtBQUssQ0FBQztRQUUxQiwyRUFBMkU7UUFDM0UsRUFBRTtRQUNGLGNBQWM7UUFDZCxpREFBaUQ7UUFDakQsNkRBQTZEO1FBQzdELDZEQUE2RDtRQUM3RCxvQ0FBb0M7UUFDcEMsRUFBRTtRQUNGLElBQUksQ0FBQyxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7WUFDbEMsT0FBTyxFQUFFLFlBQVksT0FBTyxFQUFFO1lBQzlCLFdBQVcsRUFBRSxHQUFHLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUM7WUFDaEQsTUFBTSxFQUFFLENBQUM7WUFDVCxXQUFXLEVBQUUsQ0FBQyxFQUFFLHdDQUF3QztZQUV4RCxtQkFBbUIs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U0FBUyxDQUFDLElBQUksRUFBRSxvQkFBb0IsRUFBRTtZQUM1QyxLQUFLLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixDQUFDLGVBQWU7WUFDNUMsV0FBVyxFQUFFLHVCQUF1QjtZQUNwQyxVQUFVLEVBQUUsc0JBQXNCLE9BQU8scUJBQXFCO1NBQy9ELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUU7WUFDOUMsS0FBSyxFQUFFLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxlQUFlO1lBQzlDLFdBQVcsRUFBRSx5QkFBeUI7WUFDdEMsVUFBVSxFQUFFLHNCQUFzQixPQUFPLHVCQUF1QjtTQUNqRSxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLHlCQUF5QixFQUFFO1lBQ2pELEtBQUssRUFBRSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsWUFBWTtZQUN6QyxXQUFXLEVBQUUsd0NBQXdDO1lBQ3JELFVBQVUsRUFBRSxzQkFBc0IsT0FBTywwQkFBMEI7U0FDcEUsQ0FBQyxDQUFDO1FBRUgsNEVBQTRFO1FBQzVFLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsU0FBUyxDQUFDLENBQUM7UUFDOUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLFlBQVksRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDO0lBQ3hELENBQUM7Q0FDRjtBQXBPRCxzREFvT0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBOZXR3b3JrU3RhY2tPcHRpbWl6ZWRQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgLyoqIExvZ2ljYWwgZW52aXJvbm1lbnQgbmFtZSwgZS5nLiBcInN0YWdpbmdcIiBvciBcInByb2RcIiAqL1xuICByZWFkb25seSBlbnZOYW1lOiBzdHJpbmc7XG59XG5cbi8qKlxuICogTmV0d29ya1N0YWNrT3B0aW1pemVkXG4gKlxuICogQ29zdC1vcHRpbWl6ZWQgbmV0d29yayBzdGFjayBmb3IgRUNTLWJhc2VkIGRlcGxveW1lbnQ6XG4gKlxuICogIOKAoiBWUEMgc3Bhbm5pbmcgMiBBdmFpbGFiaWxpdHkgWm9uZXMgKHN1ZmZpY2llbnQgZm9yIEhBKVxuICogIOKAoiAyIHB1YmxpYyBzdWJuZXRzIChBTEIpXG4gKiAg4oCiIDIgcHJpdmF0ZSBzdWJuZXRzIHdpdGggTkFUIGVncmVzcyAoRUNTIHRhc2tzKVxuICogIOKAoiAyIHByaXZhdGUgaXNvbGF0ZWQgc3VibmV0cyAoUkRTLCBSZWRpcylcbiAqICDigKIgKioxIE5BVCBHYXRld2F5KiogKG5vdCAyKSBmb3IgY29zdCBzYXZpbmdzXG4gKiAg4oCiIFNlY3VyaXR5IGdyb3VwcyBmb3IgQUxCLCBFQ1MsIFJEUywgUmVkaXNcbiAqXG4gKiBDb3N0IHNhdmluZ3MgdnMgTmV0d29ya1N0YWNrOlxuICogIC0gMSBOQVQgZ2F0ZXdheSB2cyAyOiBTYXZlICQzNS9tb250aFxuICogIC0gMiBBWnMgdnMgMzogU2ltcGxlciwgc3VmZmljaWVudCBmb3IgSEFcbiAqXG4gKiBUcmFkZS1vZmY6XG4gKiAgLSBTaW5nbGUgTkFUIGdhdGV3YXkgPSBzaW5nbGUgcG9pbnQgb2YgZmFpbHVyZSBmb3IgaW50ZXJuZXQgZWdyZXNzXG4gKiAgLSBJZiBOQVQgZmFpbHMsIEVDUyB0YXNrcyBjYW4ndCByZWFjaCBpbnRlcm5ldCAoQVdTIHNlcnZpY2VzLCBEb2NrZXIgSHViKVxuICogIC0gRm9yIHByb2R1Y3Rpb24sIGNvbnNpZGVyIDIgTkFUIGdhdGV3YXlzIG9yIFZQQyBlbmRwb2ludHNcbiAqL1xuZXhwb3J0IGNsYXNzIE5ldHdvcmtTdGFja09wdGltaXplZCBleHRlbmRzIGNkay5TdGFjayB7XG4gIC8qKiBUaGUgVlBDICovXG4gIHB1YmxpYyByZWFkb25seSB2cGM6IGVjMi5WcGM7XG5cbiAgLyoqIFNlY3VyaXR5IGdyb3VwIGZvciBBTEIgKi9cbiAgcHVibGljIHJlYWRvbmx5IGFsYlNlY3VyaXR5R3JvdXA6IGVjMi5TZWN1cml0eUdyb3VwO1xuXG4gIC8qKiBTZWN1cml0eSBncm91cCBmb3IgRUNTIHRhc2tzICovXG4gIHB1YmxpYyByZWFkb25seSBlY3NTZWN1cml0eUdyb3VwOiBlYzIuU2VjdXJpdHlHcm91cDtcblxuICAvKiogU2VjdXJpdHkgZ3JvdXAgZm9yIFJEUyAqL1xuICBwdWJsaWMgcmVhZG9ubHkgcmRzU2VjdXJpdHlHcm91cDogZWMyLlNlY3VyaXR5R3JvdXA7XG5cbiAgLyoqIFNlY3VyaXR5IGdyb3VwIGZvciBFbGFzdGlDYWNoZSBSZWRpcyAqL1xuICBwdWJsaWMgcmVhZG9ubHkgcmVkaXNTZWN1cml0eUdyb3VwOiBlYzIuU2VjdXJpdHlHcm91cDtcblxuICAvKiogQ2xvdWRXYXRjaCBsb2cgZ3JvdXAgZm9yIFZQQyBGbG93IExvZ3MgKi9cbiAgcHVibGljIHJlYWRvbmx5IGZsb3dMb2dzTG9nR3JvdXA6IGxvZ3MuTG9nR3JvdXA7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IE5ldHdvcmtTdGFja09wdGltaXplZFByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7IGVudk5hbWUgfSA9IHByb3BzO1xuXG4gICAgLy8g4pSA4pSAIFZQQyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvL1xuICAgIC8vIDIgQVpzIHdpdGg6XG4gICAgLy8gIC0gMiBwdWJsaWMgc3VibmV0cyAoMTAuMC4xLjAvMjQsIDEwLjAuMi4wLzI0KVxuICAgIC8vICAtIDIgcHJpdmF0ZSBzdWJuZXRzIHdpdGggTkFUICgxMC4wLjExLjAvMjQsIDEwLjAuMTIuMC8yNClcbiAgICAvLyAgLSAyIHByaXZhdGUgaXNvbGF0ZWQgc3VibmV0cyAoMTAuMC4yMS4wLzI0LCAxMC4wLjIyLjAvMjQpXG4gICAgLy8gIC0gMSBOQVQgZ2F0ZXdheSBpbiBmaXJzdCBBWiBvbmx5XG4gICAgLy9cbiAgICB0aGlzLnZwYyA9IG5ldyBlYzIuVnBjKHRoaXMsICdWcGMnLCB7XG4gICAgICB2cGNOYW1lOiBgZm9vZGNvc3QtJHtlbnZOYW1lfWAsXG4gICAgICBpcEFkZHJlc3NlczogZWMyLklwQWRkcmVzc2VzLmNpZHIoJzEwLjAuMC4wLzE2JyksXG4gICAgICBtYXhBenM6IDIsXG4gICAgICBuYXRHYXRld2F5czogMSwgLy8gQ29zdCBvcHRpbWl6YXRpb246IHNpbmdsZSBOQVQgZ2F0ZXdheVxuXG4gICAgICBzdWJuZXRDb25maWd1cmF0aW9uOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgICAgbmFtZTogJ3B1YmxpYycsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFVCTElDLFxuICAgICAgICAgIG1hcFB1YmxpY0lwT25MYXVuY2g6IGZhbHNlLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgY2lkck1hc2s6IDI0LFxuICAgICAgICAgIG5hbWU6ICdwcml2YXRlJyxcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgY2lkck1hc2s6IDI0LFxuICAgICAgICAgIG5hbWU6ICdpc29sYXRlZCcsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9JU09MQVRFRCxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgU2VjdXJpdHkgR3JvdXBzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG4gICAgLy8gMS4gQUxCIFNlY3VyaXR5IEdyb3VwXG4gICAgLy8gICAgQWxsb3cgSFRUUC9IVFRQUyBmcm9tIGludGVybmV0XG4gICAgdGhpcy5hbGJTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdBbGJTZWN1cml0eUdyb3VwJywge1xuICAgICAgdnBjOiB0aGlzLnZwYyxcbiAgICAgIHNlY3VyaXR5R3JvdXBOYW1lOiBgZm9vZGNvc3QtYWxiLSR7ZW52TmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdBTEIg4oCUIGludGVybmV0LWZhY2luZyBsb2FkIGJhbGFuY2VyJyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IGZhbHNlLFxuICAgIH0pO1xuXG4gICAgdGhpcy5hbGJTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFxuICAgICAgZWMyLlBlZXIuYW55SXB2NCgpLFxuICAgICAgZWMyLlBvcnQudGNwKDgwKSxcbiAgICAgICdBbGxvdyBIVFRQIGZyb20gaW50ZXJuZXQnLFxuICAgICk7XG5cbiAgICB0aGlzLmFsYlNlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoXG4gICAgICBlYzIuUGVlci5hbnlJcHY0KCksXG4gICAgICBlYzIuUG9ydC50Y3AoNDQzKSxcbiAgICAgICdBbGxvdyBIVFRQUyBmcm9tIGludGVybmV0JyxcbiAgICApO1xuXG4gICAgLy8gQWxsb3cgb3V0Ym91bmQgdG8gRUNTIHRhc2tzXG4gICAgdGhpcy5hbGJTZWN1cml0eUdyb3VwLmFkZEVncmVzc1J1bGUoXG4gICAgICBlYzIuUGVlci5pcHY0KHRoaXMudnBjLnZwY0NpZHJCbG9jayksXG4gICAgICBlYzIuUG9ydC50Y3AoODA4MCksXG4gICAgICAnQWxsb3cgdHJhZmZpYyB0byBFQ1MgdGFza3MnLFxuICAgICk7XG5cbiAgICAvLyAyLiBFQ1MgU2VjdXJpdHkgR3JvdXBcbiAgICAvLyAgICBBbGxvdyB0cmFmZmljIGZyb20gQUxCIG9uIHBvcnQgODA4MFxuICAgIHRoaXMuZWNzU2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnRWNzU2VjdXJpdHlHcm91cCcsIHtcbiAgICAgIHZwYzogdGhpcy52cGMsXG4gICAgICBzZWN1cml0eUdyb3VwTmFtZTogYGZvb2Rjb3N0LWVjcy0ke2Vudk5hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRUNTIHRhc2tzIOKAlCBTcHJpbmcgQm9vdCBBUEknLFxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZSwgLy8gQWxsb3cgb3V0Ym91bmQgZm9yIEFXUyBzZXJ2aWNlcywgRG9ja2VyIEh1YiwgZXRjLlxuICAgIH0pO1xuXG4gICAgdGhpcy5lY3NTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFxuICAgICAgZWMyLlBlZXIuc2VjdXJpdHlHcm91cElkKHRoaXMuYWxiU2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWQpLFxuICAgICAgZWMyLlBvcnQudGNwKDgwODApLFxuICAgICAgJ0FsbG93IHRyYWZmaWMgZnJvbSBBTEInLFxuICAgICk7XG5cbiAgICAvLyAzLiBSRFMgU2VjdXJpdHkgR3JvdXBcbiAgICAvLyAgICBBbGxvdyBQb3N0Z3JlU1FMIGZyb20gRUNTIHRhc2tzIG9ubHlcbiAgICB0aGlzLnJkc1NlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ1Jkc1NlY3VyaXR5R3JvdXAnLCB7XG4gICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgc2VjdXJpdHlHcm91cE5hbWU6IGBmb29kY29zdC1yZHMtJHtlbnZOYW1lfWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ1JEUyBQb3N0Z3JlU1FMIOKAlCBhY2NlcHRzIGNvbm5lY3Rpb25zIGZyb20gRUNTIG9ubHknLFxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogZmFsc2UsXG4gICAgfSk7XG5cbiAgICB0aGlzLnJkc1NlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoXG4gICAgICBlYzIuUGVlci5zZWN1cml0eUdyb3VwSWQodGhpcy5lY3NTZWN1cml0eUdyb3VwLnNlY3VyaXR5R3JvdXBJZCksXG4gICAgICBlYzIuUG9ydC50Y3AoNTQzMiksXG4gICAgICAnQWxsb3cgUG9zdGdyZVNRTCBmcm9tIEVDUyB0YXNrcycsXG4gICAgKTtcblxuICAgIC8vIDQuIFJlZGlzIFNlY3VyaXR5IEdyb3VwXG4gICAgLy8gICAgQWxsb3cgUmVkaXMgZnJvbSBFQ1MgdGFza3Mgb25seVxuICAgIHRoaXMucmVkaXNTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdSZWRpc1NlY3VyaXR5R3JvdXAnLCB7XG4gICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgc2VjdXJpdHlHcm91cE5hbWU6IGBmb29kY29zdC1yZWRpcy0ke2Vudk5hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRWxhc3RpQ2FjaGUgUmVkaXMg4oCUIGFjY2VwdHMgY29ubmVjdGlvbnMgZnJvbSBFQ1Mgb25seScsXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiBmYWxzZSxcbiAgICB9KTtcblxuICAgIHRoaXMucmVkaXNTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFxuICAgICAgZWMyLlBlZXIuc2VjdXJpdHlHcm91cElkKHRoaXMuZWNzU2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWQpLFxuICAgICAgZWMyLlBvcnQudGNwKDYzNzkpLFxuICAgICAgJ0FsbG93IFJlZGlzIGZyb20gRUNTIHRhc2tzJyxcbiAgICApO1xuXG4gICAgLy8g4pSA4pSAIFZQQyBGbG93IExvZ3Mg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBDYXB0dXJlIGFsbCBuZXR3b3JrIHRyYWZmaWMgbWV0YWRhdGEgKEFDQ0VQVCArIFJFSkVDVCkgZm9yIHNlY3VyaXR5IGF1ZGl0aW5nXG4gICAgLy8gUmVxdWlyZW1lbnQgMTEuNzogVlBDIEZsb3cgTG9ncyBmb3IgbmV0d29yayB0cmFmZmljIGFuYWx5c2lzXG4gICAgLy9cbiAgICAvLyBDcmVhdGUgQ2xvdWRXYXRjaCBMb2cgR3JvdXAgZm9yIFZQQyBmbG93IGxvZ3NcbiAgICB0aGlzLmZsb3dMb2dzTG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnVnBjRmxvd0xvZ3NMb2dHcm91cCcsIHtcbiAgICAgIGxvZ0dyb3VwTmFtZTogYC9hd3MvdnBjL2Zsb3dsb2dzLSR7ZW52TmFtZX1gLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssIC8vIENvc3Qgb3B0aW1pemF0aW9uOiA3LWRheSByZXRlbnRpb25cbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICAvLyBJQU0gcm9sZSBmb3IgVlBDIEZsb3cgTG9ncyB0byB3cml0ZSB0byBDbG91ZFdhdGNoXG4gICAgY29uc3QgZmxvd0xvZ3NSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdWcGNGbG93TG9nc1JvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgndnBjLWZsb3ctbG9ncy5hbWF6b25hd3MuY29tJyksXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyB0byB3cml0ZSBsb2dzXG4gICAgdGhpcy5mbG93TG9nc0xvZ0dyb3VwLmdyYW50V3JpdGUoZmxvd0xvZ3NSb2xlKTtcblxuICAgIC8vIEVuYWJsZSBWUEMgRmxvdyBMb2dzXG4gICAgbmV3IGVjMi5DZm5GbG93TG9nKHRoaXMsICdWcGNGbG93TG9nJywge1xuICAgICAgcmVzb3VyY2VUeXBlOiAnVlBDJyxcbiAgICAgIHJlc291cmNlSWQ6IHRoaXMudnBjLnZwY0lkLFxuICAgICAgdHJhZmZpY1R5cGU6ICdBTEwnLCAvLyBDYXB0dXJlIGJvdGggQUNDRVBUIGFuZCBSRUpFQ1QgdHJhZmZpY1xuICAgICAgbG9nRGVzdGluYXRpb25UeXBlOiAnY2xvdWQtd2F0Y2gtbG9ncycsXG4gICAgICBsb2dHcm91cE5hbWU6IHRoaXMuZmxvd0xvZ3NMb2dHcm91cC5sb2dHcm91cE5hbWUsXG4gICAgICBkZWxpdmVyTG9nc1Blcm1pc3Npb25Bcm46IGZsb3dMb2dzUm9sZS5yb2xlQXJuLFxuICAgICAgdGFnczogW1xuICAgICAgICB7IGtleTogJ05hbWUnLCB2YWx1ZTogYGZvb2Rjb3N0LXZwYy1mbG93bG9ncy0ke2Vudk5hbWV9YCB9LFxuICAgICAgICB7IGtleTogJ0NvbXBvbmVudCcsIHZhbHVlOiAnTmV0d29yaycgfSxcbiAgICAgICAgeyBrZXk6ICdDb3N0Q2VudGVyJywgdmFsdWU6ICdJbmZyYXN0cnVjdHVyZScgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgQ2xvdWRGb3JtYXRpb24gT3V0cHV0cyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVnBjSWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy52cGMudnBjSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ1ZQQyBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tVnBjSWRgLFxuICAgIH0pO1xuXG4gICAgLy8gRXhwb3J0IHN1Ym5ldCBJRHMgZm9yIGRlcGVuZGVudCBzdGFja3MgKFJlcXVpcmVtZW50IDIuMTApXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1B1YmxpY1N1Ym5ldElkcycsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnZwYy5wdWJsaWNTdWJuZXRzLm1hcChzdWJuZXQgPT4gc3VibmV0LnN1Ym5ldElkKS5qb2luKCcsJyksXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvbW1hLXNlcGFyYXRlZCBsaXN0IG9mIHB1YmxpYyBzdWJuZXQgSURzJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1QdWJsaWNTdWJuZXRJZHNgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1ByaXZhdGVTdWJuZXRJZHMnLCB7XG4gICAgICB2YWx1ZTogdGhpcy52cGMucHJpdmF0ZVN1Ym5ldHMubWFwKHN1Ym5ldCA9PiBzdWJuZXQuc3VibmV0SWQpLmpvaW4oJywnKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29tbWEtc2VwYXJhdGVkIGxpc3Qgb2YgcHJpdmF0ZSBzdWJuZXQgSURzICh3aXRoIE5BVCBlZ3Jlc3MpJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1Qcml2YXRlU3VibmV0SWRzYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdJc29sYXRlZFN1Ym5ldElkcycsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnZwYy5pc29sYXRlZFN1Ym5ldHMubWFwKHN1Ym5ldCA9PiBzdWJuZXQuc3VibmV0SWQpLmpvaW4oJywnKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29tbWEtc2VwYXJhdGVkIGxpc3Qgb2YgaXNvbGF0ZWQgc3VibmV0IElEcyAoUkRTLCBSZWRpcyknLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LUlzb2xhdGVkU3VibmV0SWRzYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBbGJTZWN1cml0eUdyb3VwSWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5hbGJTZWN1cml0eUdyb3VwLnNlY3VyaXR5R3JvdXBJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQUxCIHNlY3VyaXR5IGdyb3VwIElEJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1BbGJTZWN1cml0eUdyb3VwSWRgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Vjc1NlY3VyaXR5R3JvdXBJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmVjc1NlY3VyaXR5R3JvdXAuc2VjdXJpdHlHcm91cElkLFxuICAgICAgZGVzY3JpcHRpb246ICdFQ1Mgc2VjdXJpdHkgZ3JvdXAgSUQnLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LUVjc1NlY3VyaXR5R3JvdXBJZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmRzU2VjdXJpdHlHcm91cElkJywge1xuICAgICAgdmFsdWU6IHRoaXMucmRzU2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ1JEUyBzZWN1cml0eSBncm91cCBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tUmRzU2VjdXJpdHlHcm91cElkYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSZWRpc1NlY3VyaXR5R3JvdXBJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnJlZGlzU2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ1JlZGlzIHNlY3VyaXR5IGdyb3VwIElEJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1SZWRpc1NlY3VyaXR5R3JvdXBJZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVnBjRmxvd0xvZ3NMb2dHcm91cE5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5mbG93TG9nc0xvZ0dyb3VwLmxvZ0dyb3VwTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWRXYXRjaCBsb2cgZ3JvdXAgZm9yIFZQQyBGbG93IExvZ3MnLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LVZwY0Zsb3dMb2dzTG9nR3JvdXBOYW1lYCxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCBUYWdzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnQ29tcG9uZW50JywgJ05ldHdvcmsnKTtcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ0Nvc3RDZW50ZXInLCAnSW5mcmFzdHJ1Y3R1cmUnKTtcbiAgfVxufVxuIl19