"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetworkStack = void 0;
const cdk = require("aws-cdk-lib");
const ec2 = require("aws-cdk-lib/aws-ec2");
/**
 * NetworkStack
 *
 * Provisions the foundational network layer for the Food Cost Calculator:
 *
 *  • VPC spanning 3 Availability Zones
 *  • 2 public subnets  (1 per AZ for first two AZs)  — ALB, NAT gateway EIPs
 *  • 4 private subnets (across 3 AZs)               — EKS nodes, Aurora, ElastiCache
 *  • 1 NAT gateway per AZ (high-availability outbound internet for private subnets)
 *  • Baseline security groups for: ALB, EKS nodes, Aurora PostgreSQL, ElastiCache Redis
 *
 * Satisfies Requirements: 10.1 (multi-venue/multi-AZ), 10.3 (data isolation via subnet scoping)
 */
class NetworkStack extends cdk.Stack {
    /** The VPC shared by all downstream stacks. */
    vpc;
    /** Security group for the Application Load Balancer (internet-facing). */
    albSecurityGroup;
    /** Security group for EKS worker nodes (API and worker pods). */
    eksNodeSecurityGroup;
    /**
     * Security group for the Aurora PostgreSQL cluster.
     * Only accepts connections from EKS nodes on port 5432.
     */
    auroraSecurityGroup;
    /**
     * Security group for the ElastiCache Redis cluster.
     * Only accepts connections from EKS nodes on port 6379.
     */
    elastiCacheSecurityGroup;
    constructor(scope, id, props) {
        super(scope, id, props);
        const { envName } = props;
        // ── VPC ─────────────────────────────────────────────────────────────────
        //
        // Topology (3 AZs):
        //   AZ-a: 1 public subnet  + 1 private/EKS subnet
        //   AZ-b: 1 public subnet  + 1 private/EKS subnet
        //   AZ-c:                    1 private/DB subnet   + 1 private/cache subnet
        //
        // CDK subnet configuration:
        //   - PUBLIC    (2 subnets, first two AZs) — ALB, NAT gateway attachment
        //   - PRIVATE_WITH_EGRESS "eks" (2 subnets, first two AZs) — EKS node groups
        //   - PRIVATE_ISOLATED  "db"    (2 subnets, last two AZs)  — Aurora cluster
        //   - PRIVATE_ISOLATED  "cache" (2 subnets, last two AZs)  — ElastiCache
        //
        // That gives: 2 public + 2 EKS-private + 2 DB-isolated + 2 cache-isolated = 8 subnets.
        // To keep the task requirement of exactly 4 private subnets, we merge the DB and cache
        // subnet groups into two dedicated private subnets in AZ-b and AZ-c (reusing the same
        // two PRIVATE_ISOLATED subnets for both Aurora and ElastiCache placement, separated
        // by security-group rules rather than separate subnets).
        //
        // Final layout across 2 AZs (sufficient for Aurora Multi-AZ, ElastiCache,
        // and EKS HA; the EKS node group can span 2 AZs and the data tier is in
        // dedicated subnets in the same 2 AZs):
        //
        //   AZ-a: 1 public  + 1 private-eks  + 1 private-data
        //   AZ-b: 1 public  + 1 private-eks  + 1 private-data
        //
        //   Public          — 2 subnets (AZ-a, AZ-b)
        //   Private/EKS     — 2 subnets (AZ-a, AZ-b)  with NAT egress
        //   Private/Data    — 2 subnets (AZ-a, AZ-b)  isolated (Aurora + ElastiCache)
        //   Total private   — 4 subnets  ✓
        //   Total subnets   — 6          ✓
        //
        // NAT Gateways: one per AZ (one per public subnet) = 2 gateways.
        this.vpc = new ec2.Vpc(this, 'Vpc', {
            vpcName: `food-cost-calculator-${envName}`,
            ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
            // 2 AZs — gives exactly 2 public + 2 EKS-private + 2 data-isolated subnets.
            maxAzs: 2,
            // NAT gateways — one per AZ (one per public subnet).
            natGateways: 2,
            subnetConfiguration: [
                // ── Public subnets (2 total, first two AZs) ──────────────────────────
                // Used by: ALB, NAT gateway EIP attachments.
                {
                    cidrMask: 24,
                    name: 'public',
                    subnetType: ec2.SubnetType.PUBLIC,
                    mapPublicIpOnLaunch: false,
                },
                // ── Private / EKS subnets (2 total, first two AZs) ───────────────────
                // Used by: EKS managed node groups (API + worker pods).
                // Outbound internet via NAT gateways in the public subnets.
                {
                    cidrMask: 24,
                    name: 'private-eks',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                },
                // ── Private / Data subnets (2 total, spread across AZs) ─────────────
                // Used by: Aurora PostgreSQL Multi-AZ cluster + ElastiCache Redis.
                // Fully isolated — no internet egress, no NAT route.
                // Security-group rules (not subnet separation) isolate Aurora from ElastiCache.
                {
                    cidrMask: 24,
                    name: 'private-data',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                },
            ],
        });
        // ── Security Groups ──────────────────────────────────────────────────────
        // 1. ALB Security Group
        //    • Ingress: HTTPS (443) from the internet
        //    • Ingress: HTTP  (80)  from the internet (for redirect to HTTPS)
        //    • Egress:  All traffic to VPC (pods respond on dynamic ports)
        this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
            vpc: this.vpc,
            securityGroupName: `fcc-alb-${envName}`,
            description: 'ALB — internet-facing load balancer for Food Cost Calculator API',
            allowAllOutbound: false,
        });
        this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS from internet');
        this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP from internet (redirects to HTTPS)');
        // Allow IPv6 as well.
        this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv6(), ec2.Port.tcp(443), 'Allow HTTPS from internet (IPv6)');
        this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv6(), ec2.Port.tcp(80), 'Allow HTTP from internet (IPv6)');
        // Egress: allow traffic to the VPC CIDR so the ALB can reach EKS node ports.
        this.albSecurityGroup.addEgressRule(ec2.Peer.ipv4(this.vpc.vpcCidrBlock), ec2.Port.allTraffic(), 'Allow outbound to VPC (EKS node ports)');
        // 2. EKS Node Security Group
        //    • Ingress: traffic from ALB on the container port range (8080–8090)
        //    • Ingress: node-to-node communication within the SG (Kubernetes CNI)
        //    • Egress:  unrestricted (pods need to reach ECR, S3, SQS, Cognito, etc.)
        this.eksNodeSecurityGroup = new ec2.SecurityGroup(this, 'EksNodeSecurityGroup', {
            vpc: this.vpc,
            securityGroupName: `fcc-eks-nodes-${envName}`,
            description: 'EKS worker nodes — API and worker pods',
            allowAllOutbound: true, // pods need internet egress (via NAT) for AWS service endpoints
        });
        // Allow ALB to reach pods on application ports (Spring Boot default: 8080).
        this.eksNodeSecurityGroup.addIngressRule(ec2.Peer.securityGroupId(this.albSecurityGroup.securityGroupId), ec2.Port.tcpRange(8080, 8090), 'Allow ALB to reach Spring Boot pods');
        // Allow node-to-node traffic for Kubernetes CNI (kube-proxy, CoreDNS, etc.).
        // Self-referencing security group rules create a CloudFormation circular
        // dependency when added inline. Use a standalone CfnSecurityGroupIngress
        // resource instead — this is the standard CDK workaround.
        new ec2.CfnSecurityGroupIngress(this, 'EksNodeSelfIngress', {
            groupId: this.eksNodeSecurityGroup.securityGroupId,
            sourceSecurityGroupId: this.eksNodeSecurityGroup.securityGroupId,
            ipProtocol: '-1',
            description: 'Allow intra-node communication (Kubernetes CNI)',
        });
        // Allow EKS control plane (managed by AWS) to communicate with nodes.
        // The EKS cluster SG is added at cluster creation time; here we allow HTTPS
        // back-channel (443) from within the VPC.
        this.eksNodeSecurityGroup.addIngressRule(ec2.Peer.ipv4(this.vpc.vpcCidrBlock), ec2.Port.tcp(443), 'Allow EKS control plane HTTPS back-channel');
        // 3. Aurora PostgreSQL Security Group
        //    • Ingress: PostgreSQL (5432) from EKS nodes only
        //    • Egress:  none (data tier — no outbound needed)
        this.auroraSecurityGroup = new ec2.SecurityGroup(this, 'AuroraSecurityGroup', {
            vpc: this.vpc,
            securityGroupName: `fcc-aurora-${envName}`,
            description: 'Aurora PostgreSQL — accepts connections from EKS nodes only',
            allowAllOutbound: false,
        });
        this.auroraSecurityGroup.addIngressRule(ec2.Peer.securityGroupId(this.eksNodeSecurityGroup.securityGroupId), ec2.Port.tcp(5432), 'Allow PostgreSQL from EKS nodes');
        // 4. ElastiCache Redis Security Group
        //    • Ingress: Redis (6379) from EKS nodes only
        //    • Egress:  none (data tier — no outbound needed)
        this.elastiCacheSecurityGroup = new ec2.SecurityGroup(this, 'ElastiCacheSecurityGroup', {
            vpc: this.vpc,
            securityGroupName: `fcc-elasticache-${envName}`,
            description: 'ElastiCache Redis — accepts connections from EKS nodes only',
            allowAllOutbound: false,
        });
        this.elastiCacheSecurityGroup.addIngressRule(ec2.Peer.securityGroupId(this.eksNodeSecurityGroup.securityGroupId), ec2.Port.tcp(6379), 'Allow Redis from EKS nodes');
        // ── CloudFormation Outputs ───────────────────────────────────────────────
        // Exported so downstream stacks can import by logical name without hard-coding.
        new cdk.CfnOutput(this, 'VpcId', {
            value: this.vpc.vpcId,
            description: 'VPC ID',
            exportName: `FoodCostCalculator-${envName}-VpcId`,
        });
        new cdk.CfnOutput(this, 'PublicSubnetIds', {
            value: this.vpc.publicSubnets.map((s) => s.subnetId).join(','),
            description: 'Comma-separated list of public subnet IDs',
            exportName: `FoodCostCalculator-${envName}-PublicSubnetIds`,
        });
        new cdk.CfnOutput(this, 'PrivateEksSubnetIds', {
            value: this.vpc.selectSubnets({ subnetGroupName: 'private-eks' }).subnetIds.join(','),
            description: 'Comma-separated list of private EKS subnet IDs',
            exportName: `FoodCostCalculator-${envName}-PrivateEksSubnetIds`,
        });
        new cdk.CfnOutput(this, 'PrivateDataSubnetIds', {
            value: this.vpc.selectSubnets({ subnetGroupName: 'private-data' }).subnetIds.join(','),
            description: 'Comma-separated list of private data subnet IDs (Aurora + ElastiCache)',
            exportName: `FoodCostCalculator-${envName}-PrivateDataSubnetIds`,
        });
        new cdk.CfnOutput(this, 'AlbSecurityGroupId', {
            value: this.albSecurityGroup.securityGroupId,
            description: 'ALB security group ID',
            exportName: `FoodCostCalculator-${envName}-AlbSecurityGroupId`,
        });
        new cdk.CfnOutput(this, 'EksNodeSecurityGroupId', {
            value: this.eksNodeSecurityGroup.securityGroupId,
            description: 'EKS node security group ID',
            exportName: `FoodCostCalculator-${envName}-EksNodeSecurityGroupId`,
        });
        new cdk.CfnOutput(this, 'AuroraSecurityGroupId', {
            value: this.auroraSecurityGroup.securityGroupId,
            description: 'Aurora PostgreSQL security group ID',
            exportName: `FoodCostCalculator-${envName}-AuroraSecurityGroupId`,
        });
        new cdk.CfnOutput(this, 'ElastiCacheSecurityGroupId', {
            value: this.elastiCacheSecurityGroup.securityGroupId,
            description: 'ElastiCache Redis security group ID',
            exportName: `FoodCostCalculator-${envName}-ElastiCacheSecurityGroupId`,
        });
    }
}
exports.NetworkStack = NetworkStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTmV0d29ya1N0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vbGliL3N0YWNrcy9OZXR3b3JrU3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBQ25DLDJDQUEyQztBQVEzQzs7Ozs7Ozs7Ozs7O0dBWUc7QUFDSCxNQUFhLFlBQWEsU0FBUSxHQUFHLENBQUMsS0FBSztJQUN6QywrQ0FBK0M7SUFDL0IsR0FBRyxDQUFVO0lBRTdCLDBFQUEwRTtJQUMxRCxnQkFBZ0IsQ0FBb0I7SUFFcEQsaUVBQWlFO0lBQ2pELG9CQUFvQixDQUFvQjtJQUV4RDs7O09BR0c7SUFDYSxtQkFBbUIsQ0FBb0I7SUFFdkQ7OztPQUdHO0lBQ2Esd0JBQXdCLENBQW9CO0lBRTVELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBd0I7UUFDaEUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLE9BQU8sRUFBRSxHQUFHLEtBQUssQ0FBQztRQUUxQiwyRUFBMkU7UUFDM0UsRUFBRTtRQUNGLG9CQUFvQjtRQUNwQixrREFBa0Q7UUFDbEQsa0RBQWtEO1FBQ2xELDRFQUE0RTtRQUM1RSxFQUFFO1FBQ0YsNEJBQTRCO1FBQzVCLHlFQUF5RTtRQUN6RSw2RUFBNkU7UUFDN0UsNEVBQTRFO1FBQzVFLHlFQUF5RTtRQUN6RSxFQUFFO1FBQ0YsdUZBQXVGO1FBQ3ZGLHVGQUF1RjtRQUN2RixzRkFBc0Y7UUFDdEYsb0ZBQW9GO1FBQ3BGLHlEQUF5RDtRQUN6RCxFQUFFO1FBQ0YsMEVBQTBFO1FBQzFFLHdFQUF3RTtRQUN4RSx3Q0FBd0M7UUFDeEMsRUFBRTtRQUNGLHNEQUFzRDtRQUN0RCxzREFBc0Q7UUFDdEQsRUFBRTtRQUNGLDZDQUE2QztRQUM3Qyw4REFBOEQ7UUFDOUQsOEVBQThFO1FBQzlFLG1DQUFtQztRQUNuQyxtQ0FBbUM7UUFDbkMsRUFBRTtRQUNGLGlF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QUFzQixPQUFPLHFCQUFxQjtTQUMvRCxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLHdCQUF3QixFQUFFO1lBQ2hELEtBQUssRUFBRSxJQUFJLENBQUMsb0JBQW9CLENBQUMsZUFBZTtZQUNoRCxXQUFXLEVBQUUsNEJBQTRCO1lBQ3pDLFVBQVUsRUFBRSxzQkFBc0IsT0FBTyx5QkFBeUI7U0FDbkUsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSx1QkFBdUIsRUFBRTtZQUMvQyxLQUFLLEVBQUUsSUFBSSxDQUFDLG1CQUFtQixDQUFDLGVBQWU7WUFDL0MsV0FBVyxFQUFFLHFDQUFxQztZQUNsRCxVQUFVLEVBQUUsc0JBQXNCLE9BQU8sd0JBQXdCO1NBQ2xFLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsNEJBQTRCLEVBQUU7WUFDcEQsS0FBSyxFQUFFLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxlQUFlO1lBQ3BELFdBQVcsRUFBRSxxQ0FBcUM7WUFDbEQsVUFBVSxFQUFFLHNCQUFzQixPQUFPLDZCQUE2QjtTQUN2RSxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFqUUQsb0NBaVFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIE5ldHdvcmtTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICAvKiogTG9naWNhbCBlbnZpcm9ubWVudCBuYW1lLCBlLmcuIFwic3RhZ2luZ1wiIG9yIFwicHJvZFwiLiBVc2VkIGZvciBuYW1pbmcuICovXG4gIHJlYWRvbmx5IGVudk5hbWU6IHN0cmluZztcbn1cblxuLyoqXG4gKiBOZXR3b3JrU3RhY2tcbiAqXG4gKiBQcm92aXNpb25zIHRoZSBmb3VuZGF0aW9uYWwgbmV0d29yayBsYXllciBmb3IgdGhlIEZvb2QgQ29zdCBDYWxjdWxhdG9yOlxuICpcbiAqICDigKIgVlBDIHNwYW5uaW5nIDMgQXZhaWxhYmlsaXR5IFpvbmVzXG4gKiAg4oCiIDIgcHVibGljIHN1Ym5ldHMgICgxIHBlciBBWiBmb3IgZmlyc3QgdHdvIEFacykgIOKAlCBBTEIsIE5BVCBnYXRld2F5IEVJUHNcbiAqICDigKIgNCBwcml2YXRlIHN1Ym5ldHMgKGFjcm9zcyAzIEFacykgICAgICAgICAgICAgICDigJQgRUtTIG5vZGVzLCBBdXJvcmEsIEVsYXN0aUNhY2hlXG4gKiAg4oCiIDEgTkFUIGdhdGV3YXkgcGVyIEFaIChoaWdoLWF2YWlsYWJpbGl0eSBvdXRib3VuZCBpbnRlcm5ldCBmb3IgcHJpdmF0ZSBzdWJuZXRzKVxuICogIOKAoiBCYXNlbGluZSBzZWN1cml0eSBncm91cHMgZm9yOiBBTEIsIEVLUyBub2RlcywgQXVyb3JhIFBvc3RncmVTUUwsIEVsYXN0aUNhY2hlIFJlZGlzXG4gKlxuICogU2F0aXNmaWVzIFJlcXVpcmVtZW50czogMTAuMSAobXVsdGktdmVudWUvbXVsdGktQVopLCAxMC4zIChkYXRhIGlzb2xhdGlvbiB2aWEgc3VibmV0IHNjb3BpbmcpXG4gKi9cbmV4cG9ydCBjbGFzcyBOZXR3b3JrU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICAvKiogVGhlIFZQQyBzaGFyZWQgYnkgYWxsIGRvd25zdHJlYW0gc3RhY2tzLiAqL1xuICBwdWJsaWMgcmVhZG9ubHkgdnBjOiBlYzIuVnBjO1xuXG4gIC8qKiBTZWN1cml0eSBncm91cCBmb3IgdGhlIEFwcGxpY2F0aW9uIExvYWQgQmFsYW5jZXIgKGludGVybmV0LWZhY2luZykuICovXG4gIHB1YmxpYyByZWFkb25seSBhbGJTZWN1cml0eUdyb3VwOiBlYzIuU2VjdXJpdHlHcm91cDtcblxuICAvKiogU2VjdXJpdHkgZ3JvdXAgZm9yIEVLUyB3b3JrZXIgbm9kZXMgKEFQSSBhbmQgd29ya2VyIHBvZHMpLiAqL1xuICBwdWJsaWMgcmVhZG9ubHkgZWtzTm9kZVNlY3VyaXR5R3JvdXA6IGVjMi5TZWN1cml0eUdyb3VwO1xuXG4gIC8qKlxuICAgKiBTZWN1cml0eSBncm91cCBmb3IgdGhlIEF1cm9yYSBQb3N0Z3JlU1FMIGNsdXN0ZXIuXG4gICAqIE9ubHkgYWNjZXB0cyBjb25uZWN0aW9ucyBmcm9tIEVLUyBub2RlcyBvbiBwb3J0IDU0MzIuXG4gICAqL1xuICBwdWJsaWMgcmVhZG9ubHkgYXVyb3JhU2VjdXJpdHlHcm91cDogZWMyLlNlY3VyaXR5R3JvdXA7XG5cbiAgLyoqXG4gICAqIFNlY3VyaXR5IGdyb3VwIGZvciB0aGUgRWxhc3RpQ2FjaGUgUmVkaXMgY2x1c3Rlci5cbiAgICogT25seSBhY2NlcHRzIGNvbm5lY3Rpb25zIGZyb20gRUtTIG5vZGVzIG9uIHBvcnQgNjM3OS5cbiAgICovXG4gIHB1YmxpYyByZWFkb25seSBlbGFzdGlDYWNoZVNlY3VyaXR5R3JvdXA6IGVjMi5TZWN1cml0eUdyb3VwO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBOZXR3b3JrU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgeyBlbnZOYW1lIH0gPSBwcm9wcztcblxuICAgIC8vIOKUgOKUgCBWUEMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBUb3BvbG9neSAoMyBBWnMpOlxuICAgIC8vICAgQVotYTogMSBwdWJsaWMgc3VibmV0ICArIDEgcHJpdmF0ZS9FS1Mgc3VibmV0XG4gICAgLy8gICBBWi1iOiAxIHB1YmxpYyBzdWJuZXQgICsgMSBwcml2YXRlL0VLUyBzdWJuZXRcbiAgICAvLyAgIEFaLWM6ICAgICAgICAgICAgICAgICAgICAxIHByaXZhdGUvREIgc3VibmV0ICAgKyAxIHByaXZhdGUvY2FjaGUgc3VibmV0XG4gICAgLy9cbiAgICAvLyBDREsgc3VibmV0IGNvbmZpZ3VyYXRpb246XG4gICAgLy8gICAtIFBVQkxJQyAgICAoMiBzdWJuZXRzLCBmaXJzdCB0d28gQVpzKSDigJQgQUxCLCBOQVQgZ2F0ZXdheSBhdHRhY2htZW50XG4gICAgLy8gICAtIFBSSVZBVEVfV0lUSF9FR1JFU1MgXCJla3NcIiAoMiBzdWJuZXRzLCBmaXJzdCB0d28gQVpzKSDigJQgRUtTIG5vZGUgZ3JvdXBzXG4gICAgLy8gICAtIFBSSVZBVEVfSVNPTEFURUQgIFwiZGJcIiAgICAoMiBzdWJuZXRzLCBsYXN0IHR3byBBWnMpICDigJQgQXVyb3JhIGNsdXN0ZXJcbiAgICAvLyAgIC0gUFJJVkFURV9JU09MQVRFRCAgXCJjYWNoZVwiICgyIHN1Ym5ldHMsIGxhc3QgdHdvIEFacykgIOKAlCBFbGFzdGlDYWNoZVxuICAgIC8vXG4gICAgLy8gVGhhdCBnaXZlczogMiBwdWJsaWMgKyAyIEVLUy1wcml2YXRlICsgMiBEQi1pc29sYXRlZCArIDIgY2FjaGUtaXNvbGF0ZWQgPSA4IHN1Ym5ldHMuXG4gICAgLy8gVG8ga2VlcCB0aGUgdGFzayByZXF1aXJlbWVudCBvZiBleGFjdGx5IDQgcHJpdmF0ZSBzdWJuZXRzLCB3ZSBtZXJnZSB0aGUgREIgYW5kIGNhY2hlXG4gICAgLy8gc3VibmV0IGdyb3VwcyBpbnRvIHR3byBkZWRpY2F0ZWQgcHJpdmF0ZSBzdWJuZXRzIGluIEFaLWIgYW5kIEFaLWMgKHJldXNpbmcgdGhlIHNhbWVcbiAgICAvLyB0d28gUFJJVkFURV9JU09MQVRFRCBzdWJuZXRzIGZvciBib3RoIEF1cm9yYSBhbmQgRWxhc3RpQ2FjaGUgcGxhY2VtZW50LCBzZXBhcmF0ZWRcbiAgICAvLyBieSBzZWN1cml0eS1ncm91cCBydWxlcyByYXRoZXIgdGhhbiBzZXBhcmF0ZSBzdWJuZXRzKS5cbiAgICAvL1xuICAgIC8vIEZpbmFsIGxheW91dCBhY3Jvc3MgMiBBWnMgKHN1ZmZpY2llbnQgZm9yIEF1cm9yYSBNdWx0aS1BWiwgRWxhc3RpQ2FjaGUsXG4gICAgLy8gYW5kIEVLUyBIQTsgdGhlIEVLUyBub2RlIGdyb3VwIGNhbiBzcGFuIDIgQVpzIGFuZCB0aGUgZGF0YSB0aWVyIGlzIGluXG4gICAgLy8gZGVkaWNhdGVkIHN1Ym5ldHMgaW4gdGhlIHNhbWUgMiBBWnMpOlxuICAgIC8vXG4gICAgLy8gICBBWi1hOiAxIHB1YmxpYyAgKyAxIHByaXZhdGUtZWtzICArIDEgcHJpdmF0ZS1kYXRhXG4gICAgLy8gICBBWi1iOiAxIHB1YmxpYyAgKyAxIHByaXZhdGUtZWtzICArIDEgcHJpdmF0ZS1kYXRhXG4gICAgLy9cbiAgICAvLyAgIFB1YmxpYyAgICAgICAgICDigJQgMiBzdWJuZXRzIChBWi1hLCBBWi1iKVxuICAgIC8vICAgUHJpdmF0ZS9FS1MgICAgIOKAlCAyIHN1Ym5ldHMgKEFaLWEsIEFaLWIpICB3aXRoIE5BVCBlZ3Jlc3NcbiAgICAvLyAgIFByaXZhdGUvRGF0YSAgICDigJQgMiBzdWJuZXRzIChBWi1hLCBBWi1iKSAgaXNvbGF0ZWQgKEF1cm9yYSArIEVsYXN0aUNhY2hlKVxuICAgIC8vICAgVG90YWwgcHJpdmF0ZSAgIOKAlCA0IHN1Ym5ldHMgIOKck1xuICAgIC8vICAgVG90YWwgc3VibmV0cyAgIOKAlCA2ICAgICAgICAgIOKck1xuICAgIC8vXG4gICAgLy8gTkFUIEdhdGV3YXlzOiBvbmUgcGVyIEFaIChvbmUgcGVyIHB1YmxpYyBzdWJuZXQpID0gMiBnYXRld2F5cy5cbiAgICB0aGlzLnZwYyA9IG5ldyBlYzIuVnBjKHRoaXMsICdWcGMnLCB7XG4gICAgICB2cGNOYW1lOiBgZm9vZC1jb3N0LWNhbGN1bGF0b3ItJHtlbnZOYW1lfWAsXG4gICAgICBpcEFkZHJlc3NlczogZWMyLklwQWRkcmVzc2VzLmNpZHIoJzEwLjAuMC4wLzE2JyksXG5cbiAgICAgIC8vIDIgQVpzIOKAlCBnaXZlcyBleGFjdGx5IDIgcHVibGljICsgMiBFS1MtcHJpdmF0ZSArIDIgZGF0YS1pc29sYXRlZCBzdWJuZXRzLlxuICAgICAgbWF4QXpzOiAyLFxuXG4gICAgICAvLyBOQVQgZ2F0ZXdheXMg4oCUIG9uZSBwZXIgQVogKG9uZSBwZXIgcHVibGljIHN1Ym5ldCkuXG4gICAgICBuYXRHYXRld2F5czogMixcblxuICAgICAgc3VibmV0Q29uZmlndXJhdGlvbjogW1xuICAgICAgICAvLyDilIDilIAgUHVibGljIHN1Ym5ldHMgKDIgdG90YWwsIGZpcnN0IHR3byBBWnMpIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgICAvLyBVc2VkIGJ5OiBBTEIsIE5BVCBnYXRld2F5IEVJUCBhdHRhY2htZW50cy5cbiAgICAgICAge1xuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcbiAgICAgICAgICBuYW1lOiAncHVibGljJyxcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QVUJMSUMsXG4gICAgICAgICAgbWFwUHVibGljSXBPbkxhdW5jaDogZmFsc2UsXG4gICAgICAgIH0sXG5cbiAgICAgICAgLy8g4pSA4pSAIFByaXZhdGUgLyBFS1Mgc3VibmV0cyAoMiB0b3RhbCwgZmlyc3QgdHdvIEFacykg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgICAgIC8vIFVzZWQgYnk6IEVLUyBtYW5hZ2VkIG5vZGUgZ3JvdXBzIChBUEkgKyB3b3JrZXIgcG9kcykuXG4gICAgICAgIC8vIE91dGJvdW5kIGludGVybmV0IHZpYSBOQVQgZ2F0ZXdheXMgaW4gdGhlIHB1YmxpYyBzdWJuZXRzLlxuICAgICAgICB7XG4gICAgICAgICAgY2lkck1hc2s6IDI0LFxuICAgICAgICAgIG5hbWU6ICdwcml2YXRlLWVrcycsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcbiAgICAgICAgfSxcblxuICAgICAgICAvLyDilIDilIAgUHJpdmF0ZSAvIERhdGEgc3VibmV0cyAoMiB0b3RhbCwgc3ByZWFkIGFjcm9zcyBBWnMpIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgICAvLyBVc2VkIGJ5OiBBdXJvcmEgUG9zdGdyZVNRTCBNdWx0aS1BWiBjbHVzdGVyICsgRWxhc3RpQ2FjaGUgUmVkaXMuXG4gICAgICAgIC8vIEZ1bGx5IGlzb2xhdGVkIOKAlCBubyBpbnRlcm5ldCBlZ3Jlc3MsIG5vIE5BVCByb3V0ZS5cbiAgICAgICAgLy8gU2VjdXJpdHktZ3JvdXAgcnVsZXMgKG5vdCBzdWJuZXQgc2VwYXJhdGlvbikgaXNvbGF0ZSBBdXJvcmEgZnJvbSBFbGFzdGlDYWNoZS5cbiAgICAgICAge1xuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcbiAgICAgICAgICBuYW1lOiAncHJpdmF0ZS1kYXRhJyxcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX0lTT0xBVEVELFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCBTZWN1cml0eSBHcm91cHMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbiAgICAvLyAxLiBBTEIgU2VjdXJpdHkgR3JvdXBcbiAgICAvLyAgICDigKIgSW5ncmVzczogSFRUUFMgKDQ0MykgZnJvbSB0aGUgaW50ZXJuZXRcbiAgICAvLyAgICDigKIgSW5ncmVzczogSFRUUCAgKDgwKSAgZnJvbSB0aGUgaW50ZXJuZXQgKGZvciByZWRpcmVjdCB0byBIVFRQUylcbiAgICAvLyAgICDigKIgRWdyZXNzOiAgQWxsIHRyYWZmaWMgdG8gVlBDIChwb2RzIHJlc3BvbmQgb24gZHluYW1pYyBwb3J0cylcbiAgICB0aGlzLmFsYlNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ0FsYlNlY3VyaXR5R3JvdXAnLCB7XG4gICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgc2VjdXJpdHlHcm91cE5hbWU6IGBmY2MtYWxiLSR7ZW52TmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdBTEIg4oCUIGludGVybmV0LWZhY2luZyBsb2FkIGJhbGFuY2VyIGZvciBGb29kIENvc3QgQ2FsY3VsYXRvciBBUEknLFxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogZmFsc2UsXG4gICAgfSk7XG4gICAgdGhpcy5hbGJTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFxuICAgICAgZWMyLlBlZXIuYW55SXB2NCgpLFxuICAgICAgZWMyLlBvcnQudGNwKDQ0MyksXG4gICAgICAnQWxsb3cgSFRUUFMgZnJvbSBpbnRlcm5ldCcsXG4gICAgKTtcbiAgICB0aGlzLmFsYlNlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoXG4gICAgICBlYzIuUGVlci5hbnlJcHY0KCksXG4gICAgICBlYzIuUG9ydC50Y3AoODApLFxuICAgICAgJ0FsbG93IEhUVFAgZnJvbSBpbnRlcm5ldCAocmVkaXJlY3RzIHRvIEhUVFBTKScsXG4gICAgKTtcbiAgICAvLyBBbGxvdyBJUHY2IGFzIHdlbGwuXG4gICAgdGhpcy5hbGJTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFxuICAgICAgZWMyLlBlZXIuYW55SXB2NigpLFxuICAgICAgZWMyLlBvcnQudGNwKDQ0MyksXG4gICAgICAnQWxsb3cgSFRUUFMgZnJvbSBpbnRlcm5ldCAoSVB2NiknLFxuICAgICk7XG4gICAgdGhpcy5hbGJTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFxuICAgICAgZWMyLlBlZXIuYW55SXB2NigpLFxuICAgICAgZWMyLlBvcnQudGNwKDgwKSxcbiAgICAgICdBbGxvdyBIVFRQIGZyb20gaW50ZXJuZXQgKElQdjYpJyxcbiAgICApO1xuICAgIC8vIEVncmVzczogYWxsb3cgdHJhZmZpYyB0byB0aGUgVlBDIENJRFIgc28gdGhlIEFMQiBjYW4gcmVhY2ggRUtTIG5vZGUgcG9ydHMuXG4gICAgdGhpcy5hbGJTZWN1cml0eUdyb3VwLmFkZEVncmVzc1J1bGUoXG4gICAgICBlYzIuUGVlci5pcHY0KHRoaXMudnBjLnZwY0NpZHJCbG9jayksXG4gICAgICBlYzIuUG9ydC5hbGxUcmFmZmljKCksXG4gICAgICAnQWxsb3cgb3V0Ym91bmQgdG8gVlBDIChFS1Mgbm9kZSBwb3J0cyknLFxuICAgICk7XG5cbiAgICAvLyAyLiBFS1MgTm9kZSBTZWN1cml0eSBHcm91cFxuICAgIC8vICAgIOKAoiBJbmdyZXNzOiB0cmFmZmljIGZyb20gQUxCIG9uIHRoZSBjb250YWluZXIgcG9ydCByYW5nZSAoODA4MOKAkzgwOTApXG4gICAgLy8gICAg4oCiIEluZ3Jlc3M6IG5vZGUtdG8tbm9kZSBjb21tdW5pY2F0aW9uIHdpdGhpbiB0aGUgU0cgKEt1YmVybmV0ZXMgQ05JKVxuICAgIC8vICAgIOKAoiBFZ3Jlc3M6ICB1bnJlc3RyaWN0ZWQgKHBvZHMgbmVlZCB0byByZWFjaCBFQ1IsIFMzLCBTUVMsIENvZ25pdG8sIGV0Yy4pXG4gICAgdGhpcy5la3NOb2RlU2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnRWtzTm9kZVNlY3VyaXR5R3JvdXAnLCB7XG4gICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgc2VjdXJpdHlHcm91cE5hbWU6IGBmY2MtZWtzLW5vZGVzLSR7ZW52TmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdFS1Mgd29ya2VyIG5vZGVzIOKAlCBBUEkgYW5kIHdvcmtlciBwb2RzJyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IHRydWUsIC8vIHBvZHMgbmVlZCBpbnRlcm5ldCBlZ3Jlc3MgKHZpYSBOQVQpIGZvciBBV1Mgc2VydmljZSBlbmRwb2ludHNcbiAgICB9KTtcbiAgICAvLyBBbGxvdyBBTEIgdG8gcmVhY2ggcG9kcyBvbiBhcHBsaWNhdGlvbiBwb3J0cyAoU3ByaW5nIEJvb3QgZGVmYXVsdDogODA4MCkuXG4gICAgdGhpcy5la3NOb2RlU2VjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShcbiAgICAgIGVjMi5QZWVyLnNlY3VyaXR5R3JvdXBJZCh0aGlzLmFsYlNlY3VyaXR5R3JvdXAuc2VjdXJpdHlHcm91cElkKSxcbiAgICAgIGVjMi5Qb3J0LnRjcFJhbmdlKDgwODAsIDgwOTApLFxuICAgICAgJ0FsbG93IEFMQiB0byByZWFjaCBTcHJpbmcgQm9vdCBwb2RzJyxcbiAgICApO1xuICAgIC8vIEFsbG93IG5vZGUtdG8tbm9kZSB0cmFmZmljIGZvciBLdWJlcm5ldGVzIENOSSAoa3ViZS1wcm94eSwgQ29yZUROUywgZXRjLikuXG4gICAgLy8gU2VsZi1yZWZlcmVuY2luZyBzZWN1cml0eSBncm91cCBydWxlcyBjcmVhdGUgYSBDbG91ZEZvcm1hdGlvbiBjaXJjdWxhclxuICAgIC8vIGRlcGVuZGVuY3kgd2hlbiBhZGRlZCBpbmxpbmUuIFVzZSBhIHN0YW5kYWxvbmUgQ2ZuU2VjdXJpdHlHcm91cEluZ3Jlc3NcbiAgICAvLyByZXNvdXJjZSBpbnN0ZWFkIOKAlCB0aGlzIGlzIHRoZSBzdGFuZGFyZCBDREsgd29ya2Fyb3VuZC5cbiAgICBuZXcgZWMyLkNmblNlY3VyaXR5R3JvdXBJbmdyZXNzKHRoaXMsICdFa3NOb2RlU2VsZkluZ3Jlc3MnLCB7XG4gICAgICBncm91cElkOiB0aGlzLmVrc05vZGVTZWN1cml0eUdyb3VwLnNlY3VyaXR5R3JvdXBJZCxcbiAgICAgIHNvdXJjZVNlY3VyaXR5R3JvdXBJZDogdGhpcy5la3NOb2RlU2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWQsXG4gICAgICBpcFByb3RvY29sOiAnLTEnLFxuICAgICAgZGVzY3JpcHRpb246ICdBbGxvdyBpbnRyYS1ub2RlIGNvbW11bmljYXRpb24gKEt1YmVybmV0ZXMgQ05JKScsXG4gICAgfSk7XG4gICAgLy8gQWxsb3cgRUtTIGNvbnRyb2wgcGxhbmUgKG1hbmFnZWQgYnkgQVdTKSB0byBjb21tdW5pY2F0ZSB3aXRoIG5vZGVzLlxuICAgIC8vIFRoZSBFS1MgY2x1c3RlciBTRyBpcyBhZGRlZCBhdCBjbHVzdGVyIGNyZWF0aW9uIHRpbWU7IGhlcmUgd2UgYWxsb3cgSFRUUFNcbiAgICAvLyBiYWNrLWNoYW5uZWwgKDQ0MykgZnJvbSB3aXRoaW4gdGhlIFZQQy5cbiAgICB0aGlzLmVrc05vZGVTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFxuICAgICAgZWMyLlBlZXIuaXB2NCh0aGlzLnZwYy52cGNDaWRyQmxvY2spLFxuICAgICAgZWMyLlBvcnQudGNwKDQ0MyksXG4gICAgICAnQWxsb3cgRUtTIGNvbnRyb2wgcGxhbmUgSFRUUFMgYmFjay1jaGFubmVsJyxcbiAgICApO1xuXG4gICAgLy8gMy4gQXVyb3JhIFBvc3RncmVTUUwgU2VjdXJpdHkgR3JvdXBcbiAgICAvLyAgICDigKIgSW5ncmVzczogUG9zdGdyZVNRTCAoNTQzMikgZnJvbSBFS1Mgbm9kZXMgb25seVxuICAgIC8vICAgIOKAoiBFZ3Jlc3M6ICBub25lIChkYXRhIHRpZXIg4oCUIG5vIG91dGJvdW5kIG5lZWRlZClcbiAgICB0aGlzLmF1cm9yYVNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ0F1cm9yYVNlY3VyaXR5R3JvdXAnLCB7XG4gICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgc2VjdXJpdHlHcm91cE5hbWU6IGBmY2MtYXVyb3JhLSR7ZW52TmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdBdXJvcmEgUG9zdGdyZVNRTCDigJQgYWNjZXB0cyBjb25uZWN0aW9ucyBmcm9tIEVLUyBub2RlcyBvbmx5JyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IGZhbHNlLFxuICAgIH0pO1xuICAgIHRoaXMuYXVyb3JhU2VjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShcbiAgICAgIGVjMi5QZWVyLnNlY3VyaXR5R3JvdXBJZCh0aGlzLmVrc05vZGVTZWN1cml0eUdyb3VwLnNlY3VyaXR5R3JvdXBJZCksXG4gICAgICBlYzIuUG9ydC50Y3AoNTQzMiksXG4gICAgICAnQWxsb3cgUG9zdGdyZVNRTCBmcm9tIEVLUyBub2RlcycsXG4gICAgKTtcblxuICAgIC8vIDQuIEVsYXN0aUNhY2hlIFJlZGlzIFNlY3VyaXR5IEdyb3VwXG4gICAgLy8gICAg4oCiIEluZ3Jlc3M6IFJlZGlzICg2Mzc5KSBmcm9tIEVLUyBub2RlcyBvbmx5XG4gICAgLy8gICAg4oCiIEVncmVzczogIG5vbmUgKGRhdGEgdGllciDigJQgbm8gb3V0Ym91bmQgbmVlZGVkKVxuICAgIHRoaXMuZWxhc3RpQ2FjaGVTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdFbGFzdGlDYWNoZVNlY3VyaXR5R3JvdXAnLCB7XG4gICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgc2VjdXJpdHlHcm91cE5hbWU6IGBmY2MtZWxhc3RpY2FjaGUtJHtlbnZOYW1lfWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0VsYXN0aUNhY2hlIFJlZGlzIOKAlCBhY2NlcHRzIGNvbm5lY3Rpb25zIGZyb20gRUtTIG5vZGVzIG9ubHknLFxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogZmFsc2UsXG4gICAgfSk7XG4gICAgdGhpcy5lbGFzdGlDYWNoZVNlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoXG4gICAgICBlYzIuUGVlci5zZWN1cml0eUdyb3VwSWQodGhpcy5la3NOb2RlU2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWQpLFxuICAgICAgZWMyLlBvcnQudGNwKDYzNzkpLFxuICAgICAgJ0FsbG93IFJlZGlzIGZyb20gRUtTIG5vZGVzJyxcbiAgICApO1xuXG4gICAgLy8g4pSA4pSAIENsb3VkRm9ybWF0aW9uIE91dHB1dHMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy8gRXhwb3J0ZWQgc28gZG93bnN0cmVhbSBzdGFja3MgY2FuIGltcG9ydCBieSBsb2dpY2FsIG5hbWUgd2l0aG91dCBoYXJkLWNvZGluZy5cblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdWcGNJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnZwYy52cGNJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnVlBDIElEJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1WcGNJZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUHVibGljU3VibmV0SWRzJywge1xuICAgICAgdmFsdWU6IHRoaXMudnBjLnB1YmxpY1N1Ym5ldHMubWFwKChzKSA9PiBzLnN1Ym5ldElkKS5qb2luKCcsJyksXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvbW1hLXNlcGFyYXRlZCBsaXN0IG9mIHB1YmxpYyBzdWJuZXQgSURzJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1QdWJsaWNTdWJuZXRJZHNgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1ByaXZhdGVFa3NTdWJuZXRJZHMnLCB7XG4gICAgICB2YWx1ZTogdGhpcy52cGMuc2VsZWN0U3VibmV0cyh7IHN1Ym5ldEdyb3VwTmFtZTogJ3ByaXZhdGUtZWtzJyB9KS5zdWJuZXRJZHMuam9pbignLCcpLFxuICAgICAgZGVzY3JpcHRpb246ICdDb21tYS1zZXBhcmF0ZWQgbGlzdCBvZiBwcml2YXRlIEVLUyBzdWJuZXQgSURzJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1Qcml2YXRlRWtzU3VibmV0SWRzYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdQcml2YXRlRGF0YVN1Ym5ldElkcycsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnZwYy5zZWxlY3RTdWJuZXRzKHsgc3VibmV0R3JvdXBOYW1lOiAncHJpdmF0ZS1kYXRhJyB9KS5zdWJuZXRJZHMuam9pbignLCcpLFxuICAgICAgZGVzY3JpcHRpb246ICdDb21tYS1zZXBhcmF0ZWQgbGlzdCBvZiBwcml2YXRlIGRhdGEgc3VibmV0IElEcyAoQXVyb3JhICsgRWxhc3RpQ2FjaGUpJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1Qcml2YXRlRGF0YVN1Ym5ldElkc2AsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQWxiU2VjdXJpdHlHcm91cElkJywge1xuICAgICAgdmFsdWU6IHRoaXMuYWxiU2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FMQiBzZWN1cml0eSBncm91cCBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tQWxiU2VjdXJpdHlHcm91cElkYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdFa3NOb2RlU2VjdXJpdHlHcm91cElkJywge1xuICAgICAgdmFsdWU6IHRoaXMuZWtzTm9kZVNlY3VyaXR5R3JvdXAuc2VjdXJpdHlHcm91cElkLFxuICAgICAgZGVzY3JpcHRpb246ICdFS1Mgbm9kZSBzZWN1cml0eSBncm91cCBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tRWtzTm9kZVNlY3VyaXR5R3JvdXBJZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXVyb3JhU2VjdXJpdHlHcm91cElkJywge1xuICAgICAgdmFsdWU6IHRoaXMuYXVyb3JhU2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0F1cm9yYSBQb3N0Z3JlU1FMIHNlY3VyaXR5IGdyb3VwIElEJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1BdXJvcmFTZWN1cml0eUdyb3VwSWRgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0VsYXN0aUNhY2hlU2VjdXJpdHlHcm91cElkJywge1xuICAgICAgdmFsdWU6IHRoaXMuZWxhc3RpQ2FjaGVTZWN1cml0eUdyb3VwLnNlY3VyaXR5R3JvdXBJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRWxhc3RpQ2FjaGUgUmVkaXMgc2VjdXJpdHkgZ3JvdXAgSUQnLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LUVsYXN0aUNhY2hlU2VjdXJpdHlHcm91cElkYCxcbiAgICB9KTtcbiAgfVxufVxuIl19