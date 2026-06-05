import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
export interface CdnStackProps extends cdk.StackProps {
    /** Logical environment name, e.g. "staging" or "prod". Used for naming. */
    readonly envName: string;
    /** S3 bucket hosting React SPA build artifacts (static website). */
    readonly assetsBucket: s3.IBucket;
    /** Application Load Balancer — origin for /api/* requests. */
    readonly alb: elbv2.IApplicationLoadBalancer;
    /** Custom domain name for CloudFront distribution (optional). */
    readonly domainName?: string;
    /** Hosted Zone ID for Route53 (required if domainName is provided). */
    readonly hostedZoneId?: string;
}
/**
 * CdnStack
 *
 * Provisions the CloudFront CDN for the Food Cost Calculator:
 *
 *  • CloudFront distribution with two origins:
 *    - S3 assets bucket (for `/*`) — React SPA static files
 *    - ALB (for `/api/*`) — Spring Boot API service
 *  • AWS WAF WebACL with:
 *    - Rate-limit rule (max 2000 requests per 5 minutes per IP)
 *    - AWS managed rule groups (Core Rule Set, Known Bad Inputs, SQL injection)
 *  • SSL certificate via ACM (us-east-1, required for CloudFront)
 *  • Origin Access Identity (OAI) for secure S3 access (bucket not public)
 *  • Cache behaviors:
 *    - `/api/*` → ALB (no caching, pass all headers/cookies)
 *    - `/*` → S3 (cache with versioned asset names, long-lived TTL)
 *
 * Satisfies Requirements: 10.10 (2-second load time via CDN edge caching)
 */
export declare class CdnStack extends cdk.Stack {
    /** CloudFront distribution serving the React SPA and proxying API requests to ALB. */
    readonly distribution: cloudfront.Distribution;
    /** AWS WAF WebACL attached to CloudFront — rate limiting + managed rules. */
    readonly webAcl: wafv2.CfnWebACL;
    /** SSL certificate for custom domain (us-east-1, CloudFront requirement). */
    readonly certificate?: acm.ICertificate;
    constructor(scope: Construct, id: string, props: CdnStackProps);
}
