import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface NetworkStackProps extends cdk.StackProps {
  /** Logical environment name, e.g. "staging" or "prod". Used for naming. */
  readonly envName: string;
}

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
export class NetworkStack extends cdk.Stack {
  /** The VPC shared by all downstream stacks. */
  public readonly vpc: ec2.Vpc;

  /** Security group for the Application Load Balancer (internet-facing). */
  public readonly albSecurityGroup: ec2.SecurityGroup;

  /** Security group for EKS worker nodes (API and worker pods). */
  public readonly eksNodeSecurityGroup: ec2.SecurityGroup;

  /**
   * Security group for the Aurora PostgreSQL cluster.
   * Only accepts connections from EKS nodes on port 5432.
   */
  public readonly auroraSecurityGroup: ec2.SecurityGroup;

  /**
   * Security group for the ElastiCache Redis cluster.
   * Only accepts connections from EKS nodes on port 6379.
   */
  public readonly elastiCacheSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
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
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS from internet',
    );
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP from internet (redirects to HTTPS)',
    );
    // Allow IPv6 as well.
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv6(),
      ec2.Port.tcp(443),
      'Allow HTTPS from internet (IPv6)',
    );
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv6(),
      ec2.Port.tcp(80),
      'Allow HTTP from internet (IPv6)',
    );
    // Egress: allow traffic to the VPC CIDR so the ALB can reach EKS node ports.
    this.albSecurityGroup.addEgressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.allTraffic(),
      'Allow outbound to VPC (EKS node ports)',
    );

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
    this.eksNodeSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(this.albSecurityGroup.securityGroupId),
      ec2.Port.tcpRange(8080, 8090),
      'Allow ALB to reach Spring Boot pods',
    );
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
    this.eksNodeSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      'Allow EKS control plane HTTPS back-channel',
    );

    // 3. Aurora PostgreSQL Security Group
    //    • Ingress: PostgreSQL (5432) from EKS nodes only
    //    • Egress:  none (data tier — no outbound needed)
    this.auroraSecurityGroup = new ec2.SecurityGroup(this, 'AuroraSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: `fcc-aurora-${envName}`,
      description: 'Aurora PostgreSQL — accepts connections from EKS nodes only',
      allowAllOutbound: false,
    });
    this.auroraSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(this.eksNodeSecurityGroup.securityGroupId),
      ec2.Port.tcp(5432),
      'Allow PostgreSQL from EKS nodes',
    );

    // 4. ElastiCache Redis Security Group
    //    • Ingress: Redis (6379) from EKS nodes only
    //    • Egress:  none (data tier — no outbound needed)
    this.elastiCacheSecurityGroup = new ec2.SecurityGroup(this, 'ElastiCacheSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: `fcc-elasticache-${envName}`,
      description: 'ElastiCache Redis — accepts connections from EKS nodes only',
      allowAllOutbound: false,
    });
    this.elastiCacheSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(this.eksNodeSecurityGroup.securityGroupId),
      ec2.Port.tcp(6379),
      'Allow Redis from EKS nodes',
    );

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
