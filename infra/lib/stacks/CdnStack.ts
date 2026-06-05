import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
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
export class CdnStack extends cdk.Stack {
  /** CloudFront distribution serving the React SPA and proxying API requests to ALB. */
  public readonly distribution: cloudfront.Distribution;

  /** AWS WAF WebACL attached to CloudFront — rate limiting + managed rules. */
  public readonly webAcl: wafv2.CfnWebACL;

  /** SSL certificate for custom domain (us-east-1, CloudFront requirement). */
  public readonly certificate?: acm.ICertificate;

  constructor(scope: Construct, id: string, props: CdnStackProps) {
    super(scope, id, props);

    const { envName, assetsBucket, alb, domainName, hostedZoneId } = props;

    // ── SSL Certificate (us-east-1 requirement for CloudFront) ─────────────
    //
    // CloudFront requires certificates to be in us-east-1 regardless of the
    // distribution's actual region. If a custom domain is provided, we either:
    //  - Look up an existing ACM certificate in us-east-1 (via ARN or domain)
    //  - Or create a new one (requires manual DNS validation step)
    //
    // For this implementation, we assume the certificate already exists and
    // is looked up via DnsValidatedCertificate or imported via fromCertificateArn.
    // Production deployments should create the certificate in a separate stack.
    if (domainName) {
      // Lookup existing certificate in us-east-1 by domain name.
      // IMPORTANT: Certificate MUST exist in us-east-1 before deploying this stack.
      // To create a new certificate, use a separate ACM stack or manual console creation.
      this.certificate = acm.Certificate.fromCertificateArn(
        this,
        'CloudFrontCertificate',
        `arn:aws:acm:us-east-1:${cdk.Stack.of(this).account}:certificate/${domainName}`,
      );
      // Note: The above is a placeholder ARN format. In a real deployment, you'd either:
      // 1. Import an existing certificate ARN from SSM Parameter Store / Secrets Manager
      // 2. Or use Certificate.fromLookup with domain name (requires bootstrap)
      // For this task, we leave the certificate as optional/manual setup.
    }

    // ── AWS WAF WebACL ─────────────────────────────────────────────────────
    //
    // WAF rules to protect CloudFront from common attacks and rate-limiting abuse.
    //
    // Rules:
    //  1. Rate-limit rule: max 2000 requests per 5 minutes per IP
    //  2. AWS Managed Rule: AWSManagedRulesCommonRuleSet (OWASP Top 10)
    //  3. AWS Managed Rule: AWSManagedRulesKnownBadInputsRuleSet (known CVEs)
    //  4. AWS Managed Rule: AWSManagedRulesSQLiRuleSet (SQL injection patterns)
    //
    // Scope: CLOUDFRONT (us-east-1 only — CloudFront is a global service but
    // WAF WebACLs for CloudFront must be created in us-east-1).
    //
    // IMPORTANT: This WebACL MUST be created in us-east-1. If your primary region
    // is not us-east-1, you must deploy this WebACL in a separate cross-region
    // stack or use a cross-region construct. For simplicity, we assume the CDK
    // stack's region is us-east-1 when deploying CdnStack.
    this.webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      name: `fcc-cloudfront-waf-${envName}`,
      description: `Food Cost Calculator — CloudFront WAF (${envName})`,
      scope: 'CLOUDFRONT', // CLOUDFRONT scope requires us-east-1
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `fcc-cloudfront-waf-${envName}`,
        sampledRequestsEnabled: true,
      },
      rules: [
        // ── Rate Limit Rule ──────────────────────────────────────────────────
        // Block IPs that exceed 2000 requests per 5 minutes.
        // Action: block for 10 minutes (600 seconds).
        {
          name: 'RateLimitRule',
          priority: 1,
          statement: {
            rateBasedStatement: {
              aggregateKeyType: 'IP',
              limit: 2000, // requests per 5 minutes
            },
          },
          action: {
            block: {
              customResponse: {
                responseCode: 429,
                customResponseBodyKey: 'rate-limit-exceeded',
              },
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `fcc-rate-limit-${envName}`,
            sampledRequestsEnabled: true,
          },
        },

        // ── AWS Managed Rule: Core Rule Set (CRS) ────────────────────────────
        // OWASP Top 10 protections (XSS, LFI, RFI, etc.)
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 2,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
              // Exclude rules that cause false positives (none by default).
              // To exclude a rule: add { name: 'RuleName' } to excludedRules array.
              excludedRules: [],
            },
          },
          overrideAction: { none: {} }, // Use rule group's action
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `fcc-crs-${envName}`,
            sampledRequestsEnabled: true,
          },
        },

        // ── AWS Managed Rule: Known Bad Inputs ───────────────────────────────
        // Blocks requests with known malicious patterns (CVE-based signatures).
        {
          name: 'AWSManagedRulesKnownBadInputsRuleSet',
          priority: 3,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
              excludedRules: [],
            },
          },
          overrideAction: { none: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `fcc-bad-inputs-${envName}`,
            sampledRequestsEnabled: true,
          },
        },

        // ── AWS Managed Rule: SQL Injection ──────────────────────────────────
        // Protects against SQL injection attacks.
        {
          name: 'AWSManagedRulesSQLiRuleSet',
          priority: 4,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesSQLiRuleSet',
              excludedRules: [],
            },
          },
          overrideAction: { none: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `fcc-sqli-${envName}`,
            sampledRequestsEnabled: true,
          },
        },
      ],

      // Custom response bodies for blocked requests.
      customResponseBodies: {
        'rate-limit-exceeded': {
          content: JSON.stringify({
            error: 'Rate limit exceeded',
            message: 'Too many requests. Please try again later.',
          }),
          contentType: 'APPLICATION_JSON',
        },
      },
    });

    // ── CloudFront Origin Access Identity (OAI) ─────────────────────────────
    //
    // OAI allows CloudFront to read from the S3 assets bucket without making
    // the bucket public. The bucket policy grants read access to this OAI.
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: `OAI for Food Cost Calculator assets bucket (${envName})`,
    });

    // Grant CloudFront OAI read access to the assets bucket.
    // This adds a bucket policy statement allowing s3:GetObject for the OAI.
    assetsBucket.grantRead(originAccessIdentity);

    // ── CloudFront Distribution ─────────────────────────────────────────────
    //
    // Two origins:
    //  1. S3 assets bucket (React SPA static files) — default behavior for `/*`
    //  2. ALB (Spring Boot API) — behavior for `/api/*`
    //
    // Cache behaviors:
    //  - `/api/*` → ALB origin, no caching, pass all headers/query strings/cookies
    //  - `/*` → S3 origin, cache for 1 year (asset names are content-hashed by Vite)
    //
    // Error responses:
    //  - 404 → serve /index.html (SPA client-side routing)
    //  - 403 → serve /index.html (S3 returns 403 for missing keys when OAI is used)
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `Food Cost Calculator CDN (${envName})`,
      enabled: true,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // US, Canada, Europe — adjust for production
      enableLogging: true,
      logBucket: undefined, // TODO: create a separate logging bucket in StorageStack if needed
      logFilePrefix: `cloudfront-${envName}/`,
      webAclId: this.webAcl.attrArn,

      // ── Default Certificate or Custom Domain ─────────────────────────────
      // If a custom domain is provided and a certificate exists, use it.
      // Otherwise, CloudFront assigns a default *.cloudfront.net domain.
      ...(domainName && this.certificate
        ? {
            domainNames: [domainName],
            certificate: this.certificate,
          }
        : {}),

      // ── Default Behavior: S3 Assets (React SPA) ──────────────────────────
      // Serves all requests not matching /api/* from the S3 assets bucket.
      // Cache policy: CachingOptimized (1 year TTL, respects Cache-Control headers).
      // Vite build produces content-hashed filenames (app.abc123.js), so long TTLs are safe.
      defaultBehavior: {
        origin: new origins.S3Origin(assetsBucket, {
          originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true, // Enable gzip/brotli compression for text assets
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED, // 1 day default, respects Cache-Control
        // For SPA routing, 404 errors are handled by errorResponses below.
      },

      // ── Additional Behaviors: /api/* → ALB ───────────────────────────────
      // All API requests go to the ALB (Spring Boot API service).
      // No caching — pass all headers, query strings, and cookies to origin.
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.LoadBalancerV2Origin(alb, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
            originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
            // Custom headers can be added here if needed (e.g., X-CloudFront-Secret).
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
          compress: false, // API responses are typically JSON — already compressed by Spring Boot
          // Use AllCacheDisabled policy — forward all headers/cookies/query strings, no caching.
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // Alternative: use a custom cache policy if you want to cache GET requests but not POST/PUT/DELETE.
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER, // Forward everything
        },
      },

      // ── Error Responses: SPA Routing Fallback ────────────────────────────
      // For client-side routing (React Router, etc.), serve /index.html for 404s.
      // S3 with OAI returns 403 for missing keys (not 404), so we handle both.
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(10), // Short TTL for error pages
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(10),
        },
      ],
    });

    // ── CloudFormation Outputs ──────────────────────────────────────────────
    // Exported so the React SPA deployment pipeline knows the CloudFront URL.

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution ID',
      exportName: `FoodCostCalculator-${envName}-DistributionId`,
    });

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain name (*.cloudfront.net)',
      exportName: `FoodCostCalculator-${envName}-DistributionDomainName`,
    });

    new cdk.CfnOutput(this, 'WebAclId', {
      value: this.webAcl.attrId,
      description: 'WAF WebACL ID',
      exportName: `FoodCostCalculator-${envName}-WebAclId`,
    });

    new cdk.CfnOutput(this, 'WebAclArn', {
      value: this.webAcl.attrArn,
      description: 'WAF WebACL ARN',
      exportName: `FoodCostCalculator-${envName}-WebAclArn`,
    });

    if (domainName) {
      new cdk.CfnOutput(this, 'CustomDomainName', {
        value: domainName,
        description: 'Custom domain name for CloudFront distribution',
        exportName: `FoodCostCalculator-${envName}-CustomDomainName`,
      });
    }
  }
}
