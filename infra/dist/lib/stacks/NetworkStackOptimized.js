"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetworkStackOptimized = void 0;
const cdk = require("aws-cdk-lib");
const ec2 = require("aws-cdk-lib/aws-ec2");
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
        // ── Tags ─────────────────────────────────────────────────────────────────
        cdk.Tags.of(this).add('Component', 'Network');
        cdk.Tags.of(this).add('CostCenter', 'Infrastructure');
    }
}
exports.NetworkStackOptimized = NetworkStackOptimized;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTmV0d29ya1N0YWNrT3B0aW1pemVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vbGliL3N0YWNrcy9OZXR3b3JrU3RhY2tPcHRpbWl6ZWQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBQ25DLDJDQUEyQztBQVEzQzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FvQkc7QUFDSCxNQUFhLHFCQUFzQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ2xELGNBQWM7SUFDRSxHQUFHLENBQVU7SUFFN0IsNkJBQTZCO0lBQ2IsZ0JBQWdCLENBQW9CO0lBRXBELG1DQUFtQztJQUNuQixnQkFBZ0IsQ0FBb0I7SUFFcEQsNkJBQTZCO0lBQ2IsZ0JBQWdCLENBQW9CO0lBRXBELDJDQUEyQztJQUMzQixrQkFBa0IsQ0FBb0I7SUFFdEQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFpQztRQUN6RSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsT0FBTyxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRTFCLDJFQUEyRTtRQUMzRSxFQUFFO1FBQ0YsY0FBYztRQUNkLGlEQUFpRDtRQUNqRCw2REFBNkQ7UUFDN0QsNkRBQTZEO1FBQzdELG9DQUFvQztRQUNwQyxFQUFFO1FBQ0YsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRTtZQUNsQyxPQUFPLEVBQUUsWUFBWSxPQUFPLEVBQUU7WUFDOUIsV0FBVyxFQUFFLEdBQUcsQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQztZQUNoRCxNQUFNLEVBQUUsQ0FBQztZQUNULFdBQVcsRUFBRSxDQUFDLEVBQUUsd0NBQXdDO1lBRXhELG1CQUFtQixFQUFFO2dCQUNuQjtvQkFDRSxRQUFRLEVBQUUsRUFBRTtvQkFDWixJQUFJLEVBQUUsUUFBUTtvQkFD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QXFCO1NBQy9ELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUU7WUFDOUMsS0FBSyxFQUFFLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxlQUFlO1lBQzlDLFdBQVcsRUFBRSx5QkFBeUI7WUFDdEMsVUFBVSxFQUFFLHNCQUFzQixPQUFPLHVCQUF1QjtTQUNqRSxDQUFDLENBQUM7UUFFSCw0RUFBNEU7UUFDNUUsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLFdBQVcsRUFBRSxTQUFTLENBQUMsQ0FBQztRQUM5QyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsWUFBWSxFQUFFLGdCQUFnQixDQUFDLENBQUM7SUFDeEQsQ0FBQztDQUNGO0FBeExELHNEQXdMQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBOZXR3b3JrU3RhY2tPcHRpbWl6ZWRQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgLyoqIExvZ2ljYWwgZW52aXJvbm1lbnQgbmFtZSwgZS5nLiBcInN0YWdpbmdcIiBvciBcInByb2RcIiAqL1xuICByZWFkb25seSBlbnZOYW1lOiBzdHJpbmc7XG59XG5cbi8qKlxuICogTmV0d29ya1N0YWNrT3B0aW1pemVkXG4gKlxuICogQ29zdC1vcHRpbWl6ZWQgbmV0d29yayBzdGFjayBmb3IgRUNTLWJhc2VkIGRlcGxveW1lbnQ6XG4gKlxuICogIOKAoiBWUEMgc3Bhbm5pbmcgMiBBdmFpbGFiaWxpdHkgWm9uZXMgKHN1ZmZpY2llbnQgZm9yIEhBKVxuICogIOKAoiAyIHB1YmxpYyBzdWJuZXRzIChBTEIpXG4gKiAg4oCiIDIgcHJpdmF0ZSBzdWJuZXRzIHdpdGggTkFUIGVncmVzcyAoRUNTIHRhc2tzKVxuICogIOKAoiAyIHByaXZhdGUgaXNvbGF0ZWQgc3VibmV0cyAoUkRTLCBSZWRpcylcbiAqICDigKIgKioxIE5BVCBHYXRld2F5KiogKG5vdCAyKSBmb3IgY29zdCBzYXZpbmdzXG4gKiAg4oCiIFNlY3VyaXR5IGdyb3VwcyBmb3IgQUxCLCBFQ1MsIFJEUywgUmVkaXNcbiAqXG4gKiBDb3N0IHNhdmluZ3MgdnMgTmV0d29ya1N0YWNrOlxuICogIC0gMSBOQVQgZ2F0ZXdheSB2cyAyOiBTYXZlICQzNS9tb250aFxuICogIC0gMiBBWnMgdnMgMzogU2ltcGxlciwgc3VmZmljaWVudCBmb3IgSEFcbiAqXG4gKiBUcmFkZS1vZmY6XG4gKiAgLSBTaW5nbGUgTkFUIGdhdGV3YXkgPSBzaW5nbGUgcG9pbnQgb2YgZmFpbHVyZSBmb3IgaW50ZXJuZXQgZWdyZXNzXG4gKiAgLSBJZiBOQVQgZmFpbHMsIEVDUyB0YXNrcyBjYW4ndCByZWFjaCBpbnRlcm5ldCAoQVdTIHNlcnZpY2VzLCBEb2NrZXIgSHViKVxuICogIC0gRm9yIHByb2R1Y3Rpb24sIGNvbnNpZGVyIDIgTkFUIGdhdGV3YXlzIG9yIFZQQyBlbmRwb2ludHNcbiAqL1xuZXhwb3J0IGNsYXNzIE5ldHdvcmtTdGFja09wdGltaXplZCBleHRlbmRzIGNkay5TdGFjayB7XG4gIC8qKiBUaGUgVlBDICovXG4gIHB1YmxpYyByZWFkb25seSB2cGM6IGVjMi5WcGM7XG5cbiAgLyoqIFNlY3VyaXR5IGdyb3VwIGZvciBBTEIgKi9cbiAgcHVibGljIHJlYWRvbmx5IGFsYlNlY3VyaXR5R3JvdXA6IGVjMi5TZWN1cml0eUdyb3VwO1xuXG4gIC8qKiBTZWN1cml0eSBncm91cCBmb3IgRUNTIHRhc2tzICovXG4gIHB1YmxpYyByZWFkb25seSBlY3NTZWN1cml0eUdyb3VwOiBlYzIuU2VjdXJpdHlHcm91cDtcblxuICAvKiogU2VjdXJpdHkgZ3JvdXAgZm9yIFJEUyAqL1xuICBwdWJsaWMgcmVhZG9ubHkgcmRzU2VjdXJpdHlHcm91cDogZWMyLlNlY3VyaXR5R3JvdXA7XG5cbiAgLyoqIFNlY3VyaXR5IGdyb3VwIGZvciBFbGFzdGlDYWNoZSBSZWRpcyAqL1xuICBwdWJsaWMgcmVhZG9ubHkgcmVkaXNTZWN1cml0eUdyb3VwOiBlYzIuU2VjdXJpdHlHcm91cDtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogTmV0d29ya1N0YWNrT3B0aW1pemVkUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgZW52TmFtZSB9ID0gcHJvcHM7XG5cbiAgICAvLyDilIDilIAgVlBDIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vXG4gICAgLy8gMiBBWnMgd2l0aDpcbiAgICAvLyAgLSAyIHB1YmxpYyBzdWJuZXRzICgxMC4wLjEuMC8yNCwgMTAuMC4yLjAvMjQpXG4gICAgLy8gIC0gMiBwcml2YXRlIHN1Ym5ldHMgd2l0aCBOQVQgKDEwLjAuMTEuMC8yNCwgMTAuMC4xMi4wLzI0KVxuICAgIC8vICAtIDIgcHJpdmF0ZSBpc29sYXRlZCBzdWJuZXRzICgxMC4wLjIxLjAvMjQsIDEwLjAuMjIuMC8yNClcbiAgICAvLyAgLSAxIE5BVCBnYXRld2F5IGluIGZpcnN0IEFaIG9ubHlcbiAgICAvL1xuICAgIHRoaXMudnBjID0gbmV3IGVjMi5WcGModGhpcywgJ1ZwYycsIHtcbiAgICAgIHZwY05hbWU6IGBmb29kY29zdC0ke2Vudk5hbWV9YCxcbiAgICAgIGlwQWRkcmVzc2VzOiBlYzIuSXBBZGRyZXNzZXMuY2lkcignMTAuMC4wLjAvMTYnKSxcbiAgICAgIG1heEF6czogMixcbiAgICAgIG5hdEdhdGV3YXlzOiAxLCAvLyBDb3N0IG9wdGltaXphdGlvbjogc2luZ2xlIE5BVCBnYXRld2F5XG5cbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246IFtcbiAgICAgICAge1xuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcbiAgICAgICAgICBuYW1lOiAncHVibGljJyxcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QVUJMSUMsXG4gICAgICAgICAgbWFwUHVibGljSXBPbkxhdW5jaDogZmFsc2UsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgICAgbmFtZTogJ3ByaXZhdGUnLFxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgICAgbmFtZTogJ2lzb2xhdGVkJyxcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX0lTT0xBVEVELFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCBTZWN1cml0eSBHcm91cHMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbiAgICAvLyAxLiBBTEIgU2VjdXJpdHkgR3JvdXBcbiAgICAvLyAgICBBbGxvdyBIVFRQL0hUVFBTIGZyb20gaW50ZXJuZXRcbiAgICB0aGlzLmFsYlNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ0FsYlNlY3VyaXR5R3JvdXAnLCB7XG4gICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgc2VjdXJpdHlHcm91cE5hbWU6IGBmb29kY29zdC1hbGItJHtlbnZOYW1lfWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FMQiDigJQgaW50ZXJuZXQtZmFjaW5nIGxvYWQgYmFsYW5jZXInLFxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogZmFsc2UsXG4gICAgfSk7XG5cbiAgICB0aGlzLmFsYlNlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoXG4gICAgICBlYzIuUGVlci5hbnlJcHY0KCksXG4gICAgICBlYzIuUG9ydC50Y3AoODApLFxuICAgICAgJ0FsbG93IEhUVFAgZnJvbSBpbnRlcm5ldCcsXG4gICAgKTtcblxuICAgIHRoaXMuYWxiU2VjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShcbiAgICAgIGVjMi5QZWVyLmFueUlwdjQoKSxcbiAgICAgIGVjMi5Qb3J0LnRjcCg0NDMpLFxuICAgICAgJ0FsbG93IEhUVFBTIGZyb20gaW50ZXJuZXQnLFxuICAgICk7XG5cbiAgICAvLyBBbGxvdyBvdXRib3VuZCB0byBFQ1MgdGFza3NcbiAgICB0aGlzLmFsYlNlY3VyaXR5R3JvdXAuYWRkRWdyZXNzUnVsZShcbiAgICAgIGVjMi5QZWVyLmlwdjQodGhpcy52cGMudnBjQ2lkckJsb2NrKSxcbiAgICAgIGVjMi5Qb3J0LnRjcCg4MDgwKSxcbiAgICAgICdBbGxvdyB0cmFmZmljIHRvIEVDUyB0YXNrcycsXG4gICAgKTtcblxuICAgIC8vIDIuIEVDUyBTZWN1cml0eSBHcm91cFxuICAgIC8vICAgIEFsbG93IHRyYWZmaWMgZnJvbSBBTEIgb24gcG9ydCA4MDgwXG4gICAgdGhpcy5lY3NTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdFY3NTZWN1cml0eUdyb3VwJywge1xuICAgICAgdnBjOiB0aGlzLnZwYyxcbiAgICAgIHNlY3VyaXR5R3JvdXBOYW1lOiBgZm9vZGNvc3QtZWNzLSR7ZW52TmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdFQ1MgdGFza3Mg4oCUIFNwcmluZyBCb290IEFQSScsXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiB0cnVlLCAvLyBBbGxvdyBvdXRib3VuZCBmb3IgQVdTIHNlcnZpY2VzLCBEb2NrZXIgSHViLCBldGMuXG4gICAgfSk7XG5cbiAgICB0aGlzLmVjc1NlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoXG4gICAgICBlYzIuUGVlci5zZWN1cml0eUdyb3VwSWQodGhpcy5hbGJTZWN1cml0eUdyb3VwLnNlY3VyaXR5R3JvdXBJZCksXG4gICAgICBlYzIuUG9ydC50Y3AoODA4MCksXG4gICAgICAnQWxsb3cgdHJhZmZpYyBmcm9tIEFMQicsXG4gICAgKTtcblxuICAgIC8vIDMuIFJEUyBTZWN1cml0eSBHcm91cFxuICAgIC8vICAgIEFsbG93IFBvc3RncmVTUUwgZnJvbSBFQ1MgdGFza3Mgb25seVxuICAgIHRoaXMucmRzU2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnUmRzU2VjdXJpdHlHcm91cCcsIHtcbiAgICAgIHZwYzogdGhpcy52cGMsXG4gICAgICBzZWN1cml0eUdyb3VwTmFtZTogYGZvb2Rjb3N0LXJkcy0ke2Vudk5hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUkRTIFBvc3RncmVTUUwg4oCUIGFjY2VwdHMgY29ubmVjdGlvbnMgZnJvbSBFQ1Mgb25seScsXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiBmYWxzZSxcbiAgICB9KTtcblxuICAgIHRoaXMucmRzU2VjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShcbiAgICAgIGVjMi5QZWVyLnNlY3VyaXR5R3JvdXBJZCh0aGlzLmVjc1NlY3VyaXR5R3JvdXAuc2VjdXJpdHlHcm91cElkKSxcbiAgICAgIGVjMi5Qb3J0LnRjcCg1NDMyKSxcbiAgICAgICdBbGxvdyBQb3N0Z3JlU1FMIGZyb20gRUNTIHRhc2tzJyxcbiAgICApO1xuXG4gICAgLy8gNC4gUmVkaXMgU2VjdXJpdHkgR3JvdXBcbiAgICAvLyAgICBBbGxvdyBSZWRpcyBmcm9tIEVDUyB0YXNrcyBvbmx5XG4gICAgdGhpcy5yZWRpc1NlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ1JlZGlzU2VjdXJpdHlHcm91cCcsIHtcbiAgICAgIHZwYzogdGhpcy52cGMsXG4gICAgICBzZWN1cml0eUdyb3VwTmFtZTogYGZvb2Rjb3N0LXJlZGlzLSR7ZW52TmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdFbGFzdGlDYWNoZSBSZWRpcyDigJQgYWNjZXB0cyBjb25uZWN0aW9ucyBmcm9tIEVDUyBvbmx5JyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IGZhbHNlLFxuICAgIH0pO1xuXG4gICAgdGhpcy5yZWRpc1NlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoXG4gICAgICBlYzIuUGVlci5zZWN1cml0eUdyb3VwSWQodGhpcy5lY3NTZWN1cml0eUdyb3VwLnNlY3VyaXR5R3JvdXBJZCksXG4gICAgICBlYzIuUG9ydC50Y3AoNjM3OSksXG4gICAgICAnQWxsb3cgUmVkaXMgZnJvbSBFQ1MgdGFza3MnLFxuICAgICk7XG5cbiAgICAvLyDilIDilIAgQ2xvdWRGb3JtYXRpb24gT3V0cHV0cyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVnBjSWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy52cGMudnBjSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ1ZQQyBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tVnBjSWRgLFxuICAgIH0pO1xuXG4gICAgLy8gRXhwb3J0IHN1Ym5ldCBJRHMgZm9yIGRlcGVuZGVudCBzdGFja3MgKFJlcXVpcmVtZW50IDIuMTApXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1B1YmxpY1N1Ym5ldElkcycsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnZwYy5wdWJsaWNTdWJuZXRzLm1hcChzdWJuZXQgPT4gc3VibmV0LnN1Ym5ldElkKS5qb2luKCcsJyksXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvbW1hLXNlcGFyYXRlZCBsaXN0IG9mIHB1YmxpYyBzdWJuZXQgSURzJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1QdWJsaWNTdWJuZXRJZHNgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1ByaXZhdGVTdWJuZXRJZHMnLCB7XG4gICAgICB2YWx1ZTogdGhpcy52cGMucHJpdmF0ZVN1Ym5ldHMubWFwKHN1Ym5ldCA9PiBzdWJuZXQuc3VibmV0SWQpLmpvaW4oJywnKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29tbWEtc2VwYXJhdGVkIGxpc3Qgb2YgcHJpdmF0ZSBzdWJuZXQgSURzICh3aXRoIE5BVCBlZ3Jlc3MpJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1Qcml2YXRlU3VibmV0SWRzYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdJc29sYXRlZFN1Ym5ldElkcycsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnZwYy5pc29sYXRlZFN1Ym5ldHMubWFwKHN1Ym5ldCA9PiBzdWJuZXQuc3VibmV0SWQpLmpvaW4oJywnKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29tbWEtc2VwYXJhdGVkIGxpc3Qgb2YgaXNvbGF0ZWQgc3VibmV0IElEcyAoUkRTLCBSZWRpcyknLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LUlzb2xhdGVkU3VibmV0SWRzYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBbGJTZWN1cml0eUdyb3VwSWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5hbGJTZWN1cml0eUdyb3VwLnNlY3VyaXR5R3JvdXBJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQUxCIHNlY3VyaXR5IGdyb3VwIElEJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1BbGJTZWN1cml0eUdyb3VwSWRgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Vjc1NlY3VyaXR5R3JvdXBJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmVjc1NlY3VyaXR5R3JvdXAuc2VjdXJpdHlHcm91cElkLFxuICAgICAgZGVzY3JpcHRpb246ICdFQ1Mgc2VjdXJpdHkgZ3JvdXAgSUQnLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LUVjc1NlY3VyaXR5R3JvdXBJZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmRzU2VjdXJpdHlHcm91cElkJywge1xuICAgICAgdmFsdWU6IHRoaXMucmRzU2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ1JEUyBzZWN1cml0eSBncm91cCBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tUmRzU2VjdXJpdHlHcm91cElkYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSZWRpc1NlY3VyaXR5R3JvdXBJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnJlZGlzU2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ1JlZGlzIHNlY3VyaXR5IGdyb3VwIElEJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1SZWRpc1NlY3VyaXR5R3JvdXBJZGAsXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgVGFncyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ0NvbXBvbmVudCcsICdOZXR3b3JrJyk7XG4gICAgY2RrLlRhZ3Mub2YodGhpcykuYWRkKCdDb3N0Q2VudGVyJywgJ0luZnJhc3RydWN0dXJlJyk7XG4gIH1cbn1cbiJdfQ==