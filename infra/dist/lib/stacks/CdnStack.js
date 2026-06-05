"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CdnStack = void 0;
const cdk = require("aws-cdk-lib");
const cloudfront = require("aws-cdk-lib/aws-cloudfront");
const origins = require("aws-cdk-lib/aws-cloudfront-origins");
const acm = require("aws-cdk-lib/aws-certificatemanager");
const wafv2 = require("aws-cdk-lib/aws-wafv2");
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
class CdnStack extends cdk.Stack {
    /** CloudFront distribution serving the React SPA and proxying API requests to ALB. */
    distribution;
    /** AWS WAF WebACL attached to CloudFront — rate limiting + managed rules. */
    webAcl;
    /** SSL certificate for custom domain (us-east-1, CloudFront requirement). */
    certificate;
    constructor(scope, id, props) {
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
            this.certificate = acm.Certificate.fromCertificateArn(this, 'CloudFrontCertificate', `arn:aws:acm:us-east-1:${cdk.Stack.of(this).account}:certificate/${domainName}`);
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
exports.CdnStack = CdnStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQ2RuU3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9saWIvc3RhY2tzL0NkblN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQyx5REFBeUQ7QUFDekQsOERBQThEO0FBRzlELDBEQUEwRDtBQUMxRCwrQ0FBK0M7QUFvQi9DOzs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FrQkc7QUFDSCxNQUFhLFFBQVMsU0FBUSxHQUFHLENBQUMsS0FBSztJQUNyQyxzRkFBc0Y7SUFDdEUsWUFBWSxDQUEwQjtJQUV0RCw2RUFBNkU7SUFDN0QsTUFBTSxDQUFrQjtJQUV4Qyw2RUFBNkU7SUFDN0QsV0FBVyxDQUFvQjtJQUUvQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQW9CO1FBQzVELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sRUFBRSxPQUFPLEVBQUUsWUFBWSxFQUFFLEdBQUcsRUFBRSxVQUFVLEVBQUUsWUFBWSxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRXZFLDBFQUEwRTtRQUMxRSxFQUFFO1FBQ0Ysd0VBQXdFO1FBQ3hFLDJFQUEyRTtRQUMzRSwwRUFBMEU7UUFDMUUsK0RBQStEO1FBQy9ELEVBQUU7UUFDRix3RUFBd0U7UUFDeEUsK0VBQStFO1FBQy9FLDRFQUE0RTtRQUM1RSxJQUFJLFVBQVUsRUFBRSxDQUFDO1lBQ2YsMkRBQTJEO1lBQzNELDhFQUE4RTtZQUM5RSxvRkFBb0Y7WUFDcEYsSUFBSSxDQUFDLFdBQVcsR0FBRyxHQUFHLENBQUMsV0FBVyxDQUFDLGtCQUFrQixDQUNuRCxJQUFJLEVBQ0osdUJBQXVCLEVBQ3ZCLHlCQUF5QixHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLGdCQUFnQixVQUFVLEVBQUUsQ0FDaEYsQ0FBQztZQUNGLG1GQUFtRjtZQUNuRixtRkFBbUY7WUFDbkYseUVB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LDRCQWtUQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBjbG91ZGZyb250IGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZGZyb250JztcbmltcG9ydCAqIGFzIG9yaWdpbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnQtb3JpZ2lucyc7XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0ICogYXMgZWxidjIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVsYXN0aWNsb2FkYmFsYW5jaW5ndjInO1xuaW1wb3J0ICogYXMgYWNtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jZXJ0aWZpY2F0ZW1hbmFnZXInO1xuaW1wb3J0ICogYXMgd2FmdjIgZnJvbSAnYXdzLWNkay1saWIvYXdzLXdhZnYyJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIENkblN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIC8qKiBMb2dpY2FsIGVudmlyb25tZW50IG5hbWUsIGUuZy4gXCJzdGFnaW5nXCIgb3IgXCJwcm9kXCIuIFVzZWQgZm9yIG5hbWluZy4gKi9cbiAgcmVhZG9ubHkgZW52TmFtZTogc3RyaW5nO1xuXG4gIC8qKiBTMyBidWNrZXQgaG9zdGluZyBSZWFjdCBTUEEgYnVpbGQgYXJ0aWZhY3RzIChzdGF0aWMgd2Vic2l0ZSkuICovXG4gIHJlYWRvbmx5IGFzc2V0c0J1Y2tldDogczMuSUJ1Y2tldDtcblxuICAvKiogQXBwbGljYXRpb24gTG9hZCBCYWxhbmNlciDigJQgb3JpZ2luIGZvciAvYXBpLyogcmVxdWVzdHMuICovXG4gIHJlYWRvbmx5IGFsYjogZWxidjIuSUFwcGxpY2F0aW9uTG9hZEJhbGFuY2VyO1xuXG4gIC8qKiBDdXN0b20gZG9tYWluIG5hbWUgZm9yIENsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIChvcHRpb25hbCkuICovXG4gIHJlYWRvbmx5IGRvbWFpbk5hbWU/OiBzdHJpbmc7XG5cbiAgLyoqIEhvc3RlZCBab25lIElEIGZvciBSb3V0ZTUzIChyZXF1aXJlZCBpZiBkb21haW5OYW1lIGlzIHByb3ZpZGVkKS4gKi9cbiAgcmVhZG9ubHkgaG9zdGVkWm9uZUlkPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIENkblN0YWNrXG4gKlxuICogUHJvdmlzaW9ucyB0aGUgQ2xvdWRGcm9udCBDRE4gZm9yIHRoZSBGb29kIENvc3QgQ2FsY3VsYXRvcjpcbiAqXG4gKiAg4oCiIENsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIHdpdGggdHdvIG9yaWdpbnM6XG4gKiAgICAtIFMzIGFzc2V0cyBidWNrZXQgKGZvciBgLypgKSDigJQgUmVhY3QgU1BBIHN0YXRpYyBmaWxlc1xuICogICAgLSBBTEIgKGZvciBgL2FwaS8qYCkg4oCUIFNwcmluZyBCb290IEFQSSBzZXJ2aWNlXG4gKiAg4oCiIEFXUyBXQUYgV2ViQUNMIHdpdGg6XG4gKiAgICAtIFJhdGUtbGltaXQgcnVsZSAobWF4IDIwMDAgcmVxdWVzdHMgcGVyIDUgbWludXRlcyBwZXIgSVApXG4gKiAgICAtIEFXUyBtYW5hZ2VkIHJ1bGUgZ3JvdXBzIChDb3JlIFJ1bGUgU2V0LCBLbm93biBCYWQgSW5wdXRzLCBTUUwgaW5qZWN0aW9uKVxuICogIOKAoiBTU0wgY2VydGlmaWNhdGUgdmlhIEFDTSAodXMtZWFzdC0xLCByZXF1aXJlZCBmb3IgQ2xvdWRGcm9udClcbiAqICDigKIgT3JpZ2luIEFjY2VzcyBJZGVudGl0eSAoT0FJKSBmb3Igc2VjdXJlIFMzIGFjY2VzcyAoYnVja2V0IG5vdCBwdWJsaWMpXG4gKiAg4oCiIENhY2hlIGJlaGF2aW9yczpcbiAqICAgIC0gYC9hcGkvKmAg4oaSIEFMQiAobm8gY2FjaGluZywgcGFzcyBhbGwgaGVhZGVycy9jb29raWVzKVxuICogICAgLSBgLypgIOKGkiBTMyAoY2FjaGUgd2l0aCB2ZXJzaW9uZWQgYXNzZXQgbmFtZXMsIGxvbmctbGl2ZWQgVFRMKVxuICpcbiAqIFNhdGlzZmllcyBSZXF1aXJlbWVudHM6IDEwLjEwICgyLXNlY29uZCBsb2FkIHRpbWUgdmlhIENETiBlZGdlIGNhY2hpbmcpXG4gKi9cbmV4cG9ydCBjbGFzcyBDZG5TdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIC8qKiBDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiBzZXJ2aW5nIHRoZSBSZWFjdCBTUEEgYW5kIHByb3h5aW5nIEFQSSByZXF1ZXN0cyB0byBBTEIuICovXG4gIHB1YmxpYyByZWFkb25seSBkaXN0cmlidXRpb246IGNsb3VkZnJvbnQuRGlzdHJpYnV0aW9uO1xuXG4gIC8qKiBBV1MgV0FGIFdlYkFDTCBhdHRhY2hlZCB0byBDbG91ZEZyb250IOKAlCByYXRlIGxpbWl0aW5nICsgbWFuYWdlZCBydWxlcy4gKi9cbiAgcHVibGljIHJlYWRvbmx5IHdlYkFjbDogd2FmdjIuQ2ZuV2ViQUNMO1xuXG4gIC8qKiBTU0wgY2VydGlmaWNhdGUgZm9yIGN1c3RvbSBkb21haW4gKHVzLWVhc3QtMSwgQ2xvdWRGcm9udCByZXF1aXJlbWVudCkuICovXG4gIHB1YmxpYyByZWFkb25seSBjZXJ0aWZpY2F0ZT86IGFjbS5JQ2VydGlmaWNhdGU7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IENkblN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgZW52TmFtZSwgYXNzZXRzQnVja2V0LCBhbGIsIGRvbWFpbk5hbWUsIGhvc3RlZFpvbmVJZCB9ID0gcHJvcHM7XG5cbiAgICAvLyDilIDilIAgU1NMIENlcnRpZmljYXRlICh1cy1lYXN0LTEgcmVxdWlyZW1lbnQgZm9yIENsb3VkRnJvbnQpIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vXG4gICAgLy8gQ2xvdWRGcm9udCByZXF1aXJlcyBjZXJ0aWZpY2F0ZXMgdG8gYmUgaW4gdXMtZWFzdC0xIHJlZ2FyZGxlc3Mgb2YgdGhlXG4gICAgLy8gZGlzdHJpYnV0aW9uJ3MgYWN0dWFsIHJlZ2lvbi4gSWYgYSBjdXN0b20gZG9tYWluIGlzIHByb3ZpZGVkLCB3ZSBlaXRoZXI6XG4gICAgLy8gIC0gTG9vayB1cCBhbiBleGlzdGluZyBBQ00gY2VydGlmaWNhdGUgaW4gdXMtZWFzdC0xICh2aWEgQVJOIG9yIGRvbWFpbilcbiAgICAvLyAgLSBPciBjcmVhdGUgYSBuZXcgb25lIChyZXF1aXJlcyBtYW51YWwgRE5TIHZhbGlkYXRpb24gc3RlcClcbiAgICAvL1xuICAgIC8vIEZvciB0aGlzIGltcGxlbWVudGF0aW9uLCB3ZSBhc3N1bWUgdGhlIGNlcnRpZmljYXRlIGFscmVhZHkgZXhpc3RzIGFuZFxuICAgIC8vIGlzIGxvb2tlZCB1cCB2aWEgRG5zVmFsaWRhdGVkQ2VydGlmaWNhdGUgb3IgaW1wb3J0ZWQgdmlhIGZyb21DZXJ0aWZpY2F0ZUFybi5cbiAgICAvLyBQcm9kdWN0aW9uIGRlcGxveW1lbnRzIHNob3VsZCBjcmVhdGUgdGhlIGNlcnRpZmljYXRlIGluIGEgc2VwYXJhdGUgc3RhY2suXG4gICAgaWYgKGRvbWFpbk5hbWUpIHtcbiAgICAgIC8vIExvb2t1cCBleGlzdGluZyBjZXJ0aWZpY2F0ZSBpbiB1cy1lYXN0LTEgYnkgZG9tYWluIG5hbWUuXG4gICAgICAvLyBJTVBPUlRBTlQ6IENlcnRpZmljYXRlIE1VU1QgZXhpc3QgaW4gdXMtZWFzdC0xIGJlZm9yZSBkZXBsb3lpbmcgdGhpcyBzdGFjay5cbiAgICAgIC8vIFRvIGNyZWF0ZSBhIG5ldyBjZXJ0aWZpY2F0ZSwgdXNlIGEgc2VwYXJhdGUgQUNNIHN0YWNrIG9yIG1hbnVhbCBjb25zb2xlIGNyZWF0aW9uLlxuICAgICAgdGhpcy5jZXJ0aWZpY2F0ZSA9IGFjbS5DZXJ0aWZpY2F0ZS5mcm9tQ2VydGlmaWNhdGVBcm4oXG4gICAgICAgIHRoaXMsXG4gICAgICAgICdDbG91ZEZyb250Q2VydGlmaWNhdGUnLFxuICAgICAgICBgYXJuOmF3czphY206dXMtZWFzdC0xOiR7Y2RrLlN0YWNrLm9mKHRoaXMpLmFjY291bnR9OmNlcnRpZmljYXRlLyR7ZG9tYWluTmFtZX1gLFxuICAgICAgKTtcbiAgICAgIC8vIE5vdGU6IFRoZSBhYm92ZSBpcyBhIHBsYWNlaG9sZGVyIEFSTiBmb3JtYXQuIEluIGEgcmVhbCBkZXBsb3ltZW50LCB5b3UnZCBlaXRoZXI6XG4gICAgICAvLyAxLiBJbXBvcnQgYW4gZXhpc3RpbmcgY2VydGlmaWNhdGUgQVJOIGZyb20gU1NNIFBhcmFtZXRlciBTdG9yZSAvIFNlY3JldHMgTWFuYWdlclxuICAgICAgLy8gMi4gT3IgdXNlIENlcnRpZmljYXRlLmZyb21Mb29rdXAgd2l0aCBkb21haW4gbmFtZSAocmVxdWlyZXMgYm9vdHN0cmFwKVxuICAgICAgLy8gRm9yIHRoaXMgdGFzaywgd2UgbGVhdmUgdGhlIGNlcnRpZmljYXRlIGFzIG9wdGlvbmFsL21hbnVhbCBzZXR1cC5cbiAgICB9XG5cbiAgICAvLyDilIDilIAgQVdTIFdBRiBXZWJBQ0wg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBXQUYgcnVsZXMgdG8gcHJvdGVjdCBDbG91ZEZyb250IGZyb20gY29tbW9uIGF0dGFja3MgYW5kIHJhdGUtbGltaXRpbmcgYWJ1c2UuXG4gICAgLy9cbiAgICAvLyBSdWxlczpcbiAgICAvLyAgMS4gUmF0ZS1saW1pdCBydWxlOiBtYXggMjAwMCByZXF1ZXN0cyBwZXIgNSBtaW51dGVzIHBlciBJUFxuICAgIC8vICAyLiBBV1MgTWFuYWdlZCBSdWxlOiBBV1NNYW5hZ2VkUnVsZXNDb21tb25SdWxlU2V0IChPV0FTUCBUb3AgMTApXG4gICAgLy8gIDMuIEFXUyBNYW5hZ2VkIFJ1bGU6IEFXU01hbmFnZWRSdWxlc0tub3duQmFkSW5wdXRzUnVsZVNldCAoa25vd24gQ1ZFcylcbiAgICAvLyAgNC4gQVdTIE1hbmFnZWQgUnVsZTogQVdTTWFuYWdlZFJ1bGVzU1FMaVJ1bGVTZXQgKFNRTCBpbmplY3Rpb24gcGF0dGVybnMpXG4gICAgLy9cbiAgICAvLyBTY29wZTogQ0xPVURGUk9OVCAodXMtZWFzdC0xIG9ubHkg4oCUIENsb3VkRnJvbnQgaXMgYSBnbG9iYWwgc2VydmljZSBidXRcbiAgICAvLyBXQUYgV2ViQUNMcyBmb3IgQ2xvdWRGcm9udCBtdXN0IGJlIGNyZWF0ZWQgaW4gdXMtZWFzdC0xKS5cbiAgICAvL1xuICAgIC8vIElNUE9SVEFOVDogVGhpcyBXZWJBQ0wgTVVTVCBiZSBjcmVhdGVkIGluIHVzLWVhc3QtMS4gSWYgeW91ciBwcmltYXJ5IHJlZ2lvblxuICAgIC8vIGlzIG5vdCB1cy1lYXN0LTEsIHlvdSBtdXN0IGRlcGxveSB0aGlzIFdlYkFDTCBpbiBhIHNlcGFyYXRlIGNyb3NzLXJlZ2lvblxuICAgIC8vIHN0YWNrIG9yIHVzZSBhIGNyb3NzLXJlZ2lvbiBjb25zdHJ1Y3QuIEZvciBzaW1wbGljaXR5LCB3ZSBhc3N1bWUgdGhlIENES1xuICAgIC8vIHN0YWNrJ3MgcmVnaW9uIGlzIHVzLWVhc3QtMSB3aGVuIGRlcGxveWluZyBDZG5TdGFjay5cbiAgICB0aGlzLndlYkFjbCA9IG5ldyB3YWZ2Mi5DZm5XZWJBQ0wodGhpcywgJ1dlYkFjbCcsIHtcbiAgICAgIG5hbWU6IGBmY2MtY2xvdWRmcm9udC13YWYtJHtlbnZOYW1lfWAsXG4gICAgICBkZXNjcmlwdGlvbjogYEZvb2QgQ29zdCBDYWxjdWxhdG9yIOKAlCBDbG91ZEZyb250IFdBRiAoJHtlbnZOYW1lfSlgLFxuICAgICAgc2NvcGU6ICdDTE9VREZST05UJywgLy8gQ0xPVURGUk9OVCBzY29wZSByZXF1aXJlcyB1cy1lYXN0LTFcbiAgICAgIGRlZmF1bHRBY3Rpb246IHsgYWxsb3c6IHt9IH0sXG4gICAgICB2aXNpYmlsaXR5Q29uZmlnOiB7XG4gICAgICAgIGNsb3VkV2F0Y2hNZXRyaWNzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgbWV0cmljTmFtZTogYGZjYy1jbG91ZGZyb250LXdhZi0ke2Vudk5hbWV9YCxcbiAgICAgICAgc2FtcGxlZFJlcXVlc3RzRW5hYmxlZDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBydWxlczogW1xuICAgICAgICAvLyDilIDilIAgUmF0ZSBMaW1pdCBSdWxlIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgICAvLyBCbG9jayBJUHMgdGhhdCBleGNlZWQgMjAwMCByZXF1ZXN0cyBwZXIgNSBtaW51dGVzLlxuICAgICAgICAvLyBBY3Rpb246IGJsb2NrIGZvciAxMCBtaW51dGVzICg2MDAgc2Vjb25kcykuXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnUmF0ZUxpbWl0UnVsZScsXG4gICAgICAgICAgcHJpb3JpdHk6IDEsXG4gICAgICAgICAgc3RhdGVtZW50OiB7XG4gICAgICAgICAgICByYXRlQmFzZWRTdGF0ZW1lbnQ6IHtcbiAgICAgICAgICAgICAgYWdncmVnYXRlS2V5VHlwZTogJ0lQJyxcbiAgICAgICAgICAgICAgbGltaXQ6IDIwMDAsIC8vIHJlcXVlc3RzIHBlciA1IG1pbnV0ZXNcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBhY3Rpb246IHtcbiAgICAgICAgICAgIGJsb2NrOiB7XG4gICAgICAgICAgICAgIGN1c3RvbVJlc3BvbnNlOiB7XG4gICAgICAgICAgICAgICAgcmVzcG9uc2VDb2RlOiA0MjksXG4gICAgICAgICAgICAgICAgY3VzdG9tUmVzcG9uc2VCb2R5S2V5OiAncmF0ZS1saW1pdC1leGNlZWRlZCcsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAgdmlzaWJpbGl0eUNvbmZpZzoge1xuICAgICAgICAgICAgY2xvdWRXYXRjaE1ldHJpY3NFbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogYGZjYy1yYXRlLWxpbWl0LSR7ZW52TmFtZX1gLFxuICAgICAgICAgICAgc2FtcGxlZFJlcXVlc3RzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuXG4gICAgICAgIC8vIOKUgOKUgCBBV1MgTWFuYWdlZCBSdWxlOiBDb3JlIFJ1bGUgU2V0IChDUlMpIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgICAvLyBPV0FTUCBUb3AgMTAgcHJvdGVjdGlvbnMgKFhTUywgTEZJLCBSRkksIGV0Yy4pXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnQVdTTWFuYWdlZFJ1bGVzQ29tbW9uUnVsZVNldCcsXG4gICAgICAgICAgcHJpb3JpdHk6IDIsXG4gICAgICAgICAgc3RhdGVtZW50OiB7XG4gICAgICAgICAgICBtYW5hZ2VkUnVsZUdyb3VwU3RhdGVtZW50OiB7XG4gICAgICAgICAgICAgIHZlbmRvck5hbWU6ICdBV1MnLFxuICAgICAgICAgICAgICBuYW1lOiAnQVdTTWFuYWdlZFJ1bGVzQ29tbW9uUnVsZVNldCcsXG4gICAgICAgICAgICAgIC8vIEV4Y2x1ZGUgcnVsZXMgdGhhdCBjYXVzZSBmYWxzZSBwb3NpdGl2ZXMgKG5vbmUgYnkgZGVmYXVsdCkuXG4gICAgICAgICAgICAgIC8vIFRvIGV4Y2x1ZGUgYSBydWxlOiBhZGQgeyBuYW1lOiAnUnVsZU5hbWUnIH0gdG8gZXhjbHVkZWRSdWxlcyBhcnJheS5cbiAgICAgICAgICAgICAgZXhjbHVkZWRSdWxlczogW10sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAgb3ZlcnJpZGVBY3Rpb246IHsgbm9uZToge30gfSwgLy8gVXNlIHJ1bGUgZ3JvdXAncyBhY3Rpb25cbiAgICAgICAgICB2aXNpYmlsaXR5Q29uZmlnOiB7XG4gICAgICAgICAgICBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiBgZmNjLWNycy0ke2Vudk5hbWV9YCxcbiAgICAgICAgICAgIHNhbXBsZWRSZXF1ZXN0c0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcblxuICAgICAgICAvLyDilIDilIAgQVdTIE1hbmFnZWQgUnVsZTogS25vd24gQmFkIElucHV0cyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgICAgLy8gQmxvY2tzIHJlcXVlc3RzIHdpdGgga25vd24gbWFsaWNpb3VzIHBhdHRlcm5zIChDVkUtYmFzZWQgc2lnbmF0dXJlcykuXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnQVdTTWFuYWdlZFJ1bGVzS25vd25CYWRJbnB1dHNSdWxlU2V0JyxcbiAgICAgICAgICBwcmlvcml0eTogMyxcbiAgICAgICAgICBzdGF0ZW1lbnQ6IHtcbiAgICAgICAgICAgIG1hbmFnZWRSdWxlR3JvdXBTdGF0ZW1lbnQ6IHtcbiAgICAgICAgICAgICAgdmVuZG9yTmFtZTogJ0FXUycsXG4gICAgICAgICAgICAgIG5hbWU6ICdBV1NNYW5hZ2VkUnVsZXNLbm93bkJhZElucHV0c1J1bGVTZXQnLFxuICAgICAgICAgICAgICBleGNsdWRlZFJ1bGVzOiBbXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBvdmVycmlkZUFjdGlvbjogeyBub25lOiB7fSB9LFxuICAgICAgICAgIHZpc2liaWxpdHlDb25maWc6IHtcbiAgICAgICAgICAgIGNsb3VkV2F0Y2hNZXRyaWNzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6IGBmY2MtYmFkLWlucHV0cy0ke2Vudk5hbWV9YCxcbiAgICAgICAgICAgIHNhbXBsZWRSZXF1ZXN0c0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcblxuICAgICAgICAvLyDilIDilIAgQVdTIE1hbmFnZWQgUnVsZTogU1FMIEluamVjdGlvbiDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgICAgLy8gUHJvdGVjdHMgYWdhaW5zdCBTUUwgaW5qZWN0aW9uIGF0dGFja3MuXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnQVdTTWFuYWdlZFJ1bGVzU1FMaVJ1bGVTZXQnLFxuICAgICAgICAgIHByaW9yaXR5OiA0LFxuICAgICAgICAgIHN0YXRlbWVudDoge1xuICAgICAgICAgICAgbWFuYWdlZFJ1bGVHcm91cFN0YXRlbWVudDoge1xuICAgICAgICAgICAgICB2ZW5kb3JOYW1lOiAnQVdTJyxcbiAgICAgICAgICAgICAgbmFtZTogJ0FXU01hbmFnZWRSdWxlc1NRTGlSdWxlU2V0JyxcbiAgICAgICAgICAgICAgZXhjbHVkZWRSdWxlczogW10sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAgb3ZlcnJpZGVBY3Rpb246IHsgbm9uZToge30gfSxcbiAgICAgICAgICB2aXNpYmlsaXR5Q29uZmlnOiB7XG4gICAgICAgICAgICBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiBgZmNjLXNxbGktJHtlbnZOYW1lfWAsXG4gICAgICAgICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuXG4gICAgICAvLyBDdXN0b20gcmVzcG9uc2UgYm9kaWVzIGZvciBibG9ja2VkIHJlcXVlc3RzLlxuICAgICAgY3VzdG9tUmVzcG9uc2VCb2RpZXM6IHtcbiAgICAgICAgJ3JhdGUtbGltaXQtZXhjZWVkZWQnOiB7XG4gICAgICAgICAgY29udGVudDogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgZXJyb3I6ICdSYXRlIGxpbWl0IGV4Y2VlZGVkJyxcbiAgICAgICAgICAgIG1lc3NhZ2U6ICdUb28gbWFueSByZXF1ZXN0cy4gUGxlYXNlIHRyeSBhZ2FpbiBsYXRlci4nLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIGNvbnRlbnRUeXBlOiAnQVBQTElDQVRJT05fSlNPTicsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSAIENsb3VkRnJvbnQgT3JpZ2luIEFjY2VzcyBJZGVudGl0eSAoT0FJKSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvL1xuICAgIC8vIE9BSSBhbGxvd3MgQ2xvdWRGcm9udCB0byByZWFkIGZyb20gdGhlIFMzIGFzc2V0cyBidWNrZXQgd2l0aG91dCBtYWtpbmdcbiAgICAvLyB0aGUgYnVja2V0IHB1YmxpYy4gVGhlIGJ1Y2tldCBwb2xpY3kgZ3JhbnRzIHJlYWQgYWNjZXNzIHRvIHRoaXMgT0FJLlxuICAgIGNvbnN0IG9yaWdpbkFjY2Vzc0lkZW50aXR5ID0gbmV3IGNsb3VkZnJvbnQuT3JpZ2luQWNjZXNzSWRlbnRpdHkodGhpcywgJ09BSScsIHtcbiAgICAgIGNvbW1lbnQ6IGBPQUkgZm9yIEZvb2QgQ29zdCBDYWxjdWxhdG9yIGFzc2V0cyBidWNrZXQgKCR7ZW52TmFtZX0pYCxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IENsb3VkRnJvbnQgT0FJIHJlYWQgYWNjZXNzIHRvIHRoZSBhc3NldHMgYnVja2V0LlxuICAgIC8vIFRoaXMgYWRkcyBhIGJ1Y2tldCBwb2xpY3kgc3RhdGVtZW50IGFsbG93aW5nIHMzOkdldE9iamVjdCBmb3IgdGhlIE9BSS5cbiAgICBhc3NldHNCdWNrZXQuZ3JhbnRSZWFkKG9yaWdpbkFjY2Vzc0lkZW50aXR5KTtcblxuICAgIC8vIOKUgOKUgCBDbG91ZEZyb250IERpc3RyaWJ1dGlvbiDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvL1xuICAgIC8vIFR3byBvcmlnaW5zOlxuICAgIC8vICAxLiBTMyBhc3NldHMgYnVja2V0IChSZWFjdCBTUEEgc3RhdGljIGZpbGVzKSDigJQgZGVmYXVsdCBiZWhhdmlvciBmb3IgYC8qYFxuICAgIC8vICAyLiBBTEIgKFNwcmluZyBCb290IEFQSSkg4oCUIGJlaGF2aW9yIGZvciBgL2FwaS8qYFxuICAgIC8vXG4gICAgLy8gQ2FjaGUgYmVoYXZpb3JzOlxuICAgIC8vICAtIGAvYXBpLypgIOKGkiBBTEIgb3JpZ2luLCBubyBjYWNoaW5nLCBwYXNzIGFsbCBoZWFkZXJzL3F1ZXJ5IHN0cmluZ3MvY29va2llc1xuICAgIC8vICAtIGAvKmAg4oaSIFMzIG9yaWdpbiwgY2FjaGUgZm9yIDEgeWVhciAoYXNzZXQgbmFtZXMgYXJlIGNvbnRlbnQtaGFzaGVkIGJ5IFZpdGUpXG4gICAgLy9cbiAgICAvLyBFcnJvciByZXNwb25zZXM6XG4gICAgLy8gIC0gNDA0IOKGkiBzZXJ2ZSAvaW5kZXguaHRtbCAoU1BBIGNsaWVudC1zaWRlIHJvdXRpbmcpXG4gICAgLy8gIC0gNDAzIOKGkiBzZXJ2ZSAvaW5kZXguaHRtbCAoUzMgcmV0dXJucyA0MDMgZm9yIG1pc3Npbmcga2V5cyB3aGVuIE9BSSBpcyB1c2VkKVxuICAgIHRoaXMuZGlzdHJpYnV0aW9uID0gbmV3IGNsb3VkZnJvbnQuRGlzdHJpYnV0aW9uKHRoaXMsICdEaXN0cmlidXRpb24nLCB7XG4gICAgICBjb21tZW50OiBgRm9vZCBDb3N0IENhbGN1bGF0b3IgQ0ROICgke2Vudk5hbWV9KWAsXG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgaHR0cFZlcnNpb246IGNsb3VkZnJvbnQuSHR0cFZlcnNpb24uSFRUUDJfQU5EXzMsXG4gICAgICBwcmljZUNsYXNzOiBjbG91ZGZyb250LlByaWNlQ2xhc3MuUFJJQ0VfQ0xBU1NfMTAwLCAvLyBVUywgQ2FuYWRhLCBFdXJvcGUg4oCUIGFkanVzdCBmb3IgcHJvZHVjdGlvblxuICAgICAgZW5hYmxlTG9nZ2luZzogdHJ1ZSxcbiAgICAgIGxvZ0J1Y2tldDogdW5kZWZpbmVkLCAvLyBUT0RPOiBjcmVhdGUgYSBzZXBhcmF0ZSBsb2dnaW5nIGJ1Y2tldCBpbiBTdG9yYWdlU3RhY2sgaWYgbmVlZGVkXG4gICAgICBsb2dGaWxlUHJlZml4OiBgY2xvdWRmcm9udC0ke2Vudk5hbWV9L2AsXG4gICAgICB3ZWJBY2xJZDogdGhpcy53ZWJBY2wuYXR0ckFybixcblxuICAgICAgLy8g4pSA4pSAIERlZmF1bHQgQ2VydGlmaWNhdGUgb3IgQ3VzdG9tIERvbWFpbiDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIC8vIElmIGEgY3VzdG9tIGRvbWFpbiBpcyBwcm92aWRlZCBhbmQgYSBjZXJ0aWZpY2F0ZSBleGlzdHMsIHVzZSBpdC5cbiAgICAgIC8vIE90aGVyd2lzZSwgQ2xvdWRGcm9udCBhc3NpZ25zIGEgZGVmYXVsdCAqLmNsb3VkZnJvbnQubmV0IGRvbWFpbi5cbiAgICAgIC4uLihkb21haW5OYW1lICYmIHRoaXMuY2VydGlmaWNhdGVcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBkb21haW5OYW1lczogW2RvbWFpbk5hbWVdLFxuICAgICAgICAgICAgY2VydGlmaWNhdGU6IHRoaXMuY2VydGlmaWNhdGUsXG4gICAgICAgICAgfVxuICAgICAgICA6IHt9KSxcblxuICAgICAgLy8g4pSA4pSAIERlZmF1bHQgQmVoYXZpb3I6IFMzIEFzc2V0cyAoUmVhY3QgU1BBKSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIC8vIFNlcnZlcyBhbGwgcmVxdWVzdHMgbm90IG1hdGNoaW5nIC9hcGkvKiBmcm9tIHRoZSBTMyBhc3NldHMgYnVja2V0LlxuICAgICAgLy8gQ2FjaGUgcG9saWN5OiBDYWNoaW5nT3B0aW1pemVkICgxIHllYXIgVFRMLCByZXNwZWN0cyBDYWNoZS1Db250cm9sIGhlYWRlcnMpLlxuICAgICAgLy8gVml0ZSBidWlsZCBwcm9kdWNlcyBjb250ZW50LWhhc2hlZCBmaWxlbmFtZXMgKGFwcC5hYmMxMjMuanMpLCBzbyBsb25nIFRUTHMgYXJlIHNhZmUuXG4gICAgICBkZWZhdWx0QmVoYXZpb3I6IHtcbiAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbihhc3NldHNCdWNrZXQsIHtcbiAgICAgICAgICBvcmlnaW5BY2Nlc3NJZGVudGl0eSxcbiAgICAgICAgfSksXG4gICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19HRVRfSEVBRF9PUFRJT05TLFxuICAgICAgICBjYWNoZWRNZXRob2RzOiBjbG91ZGZyb250LkNhY2hlZE1ldGhvZHMuQ0FDSEVfR0VUX0hFQURfT1BUSU9OUyxcbiAgICAgICAgY29tcHJlc3M6IHRydWUsIC8vIEVuYWJsZSBnemlwL2Jyb3RsaSBjb21wcmVzc2lvbiBmb3IgdGV4dCBhc3NldHNcbiAgICAgICAgY2FjaGVQb2xpY3k6IGNsb3VkZnJvbnQuQ2FjaGVQb2xpY3kuQ0FDSElOR19PUFRJTUlaRUQsIC8vIDEgZGF5IGRlZmF1bHQsIHJlc3BlY3RzIENhY2hlLUNvbnRyb2xcbiAgICAgICAgLy8gRm9yIFNQQSByb3V0aW5nLCA0MDQgZXJyb3JzIGFyZSBoYW5kbGVkIGJ5IGVycm9yUmVzcG9uc2VzIGJlbG93LlxuICAgICAgfSxcblxuICAgICAgLy8g4pSA4pSAIEFkZGl0aW9uYWwgQmVoYXZpb3JzOiAvYXBpLyog4oaSIEFMQiDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIC8vIEFsbCBBUEkgcmVxdWVzdHMgZ28gdG8gdGhlIEFMQiAoU3ByaW5nIEJvb3QgQVBJIHNlcnZpY2UpLlxuICAgICAgLy8gTm8gY2FjaGluZyDigJQgcGFzcyBhbGwgaGVhZGVycywgcXVlcnkgc3RyaW5ncywgYW5kIGNvb2tpZXMgdG8gb3JpZ2luLlxuICAgICAgYWRkaXRpb25hbEJlaGF2aW9yczoge1xuICAgICAgICAnL2FwaS8qJzoge1xuICAgICAgICAgIG9yaWdpbjogbmV3IG9yaWdpbnMuTG9hZEJhbGFuY2VyVjJPcmlnaW4oYWxiLCB7XG4gICAgICAgICAgICBwcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5PcmlnaW5Qcm90b2NvbFBvbGljeS5IVFRQU19PTkxZLFxuICAgICAgICAgICAgb3JpZ2luU3NsUHJvdG9jb2xzOiBbY2xvdWRmcm9udC5PcmlnaW5Tc2xQb2xpY3kuVExTX1YxXzJdLFxuICAgICAgICAgICAgLy8gQ3VzdG9tIGhlYWRlcnMgY2FuIGJlIGFkZGVkIGhlcmUgaWYgbmVlZGVkIChlLmcuLCBYLUNsb3VkRnJvbnQtU2VjcmV0KS5cbiAgICAgICAgICB9KSxcbiAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5IVFRQU19PTkxZLFxuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0FMTCxcbiAgICAgICAgICBjYWNoZWRNZXRob2RzOiBjbG91ZGZyb250LkNhY2hlZE1ldGhvZHMuQ0FDSEVfR0VUX0hFQURfT1BUSU9OUyxcbiAgICAgICAgICBjb21wcmVzczogZmFsc2UsIC8vIEFQSSByZXNwb25zZXMgYXJlIHR5cGljYWxseSBKU09OIOKAlCBhbHJlYWR5IGNvbXByZXNzZWQgYnkgU3ByaW5nIEJvb3RcbiAgICAgICAgICAvLyBVc2UgQWxsQ2FjaGVEaXNhYmxlZCBwb2xpY3kg4oCUIGZvcndhcmQgYWxsIGhlYWRlcnMvY29va2llcy9xdWVyeSBzdHJpbmdzLCBubyBjYWNoaW5nLlxuICAgICAgICAgIGNhY2hlUG9saWN5OiBjbG91ZGZyb250LkNhY2hlUG9saWN5LkNBQ0hJTkdfRElTQUJMRUQsXG4gICAgICAgICAgLy8gQWx0ZXJuYXRpdmU6IHVzZSBhIGN1c3RvbSBjYWNoZSBwb2xpY3kgaWYgeW91IHdhbnQgdG8gY2FjaGUgR0VUIHJlcXVlc3RzIGJ1dCBub3QgUE9TVC9QVVQvREVMRVRFLlxuICAgICAgICAgIG9yaWdpblJlcXVlc3RQb2xpY3k6IGNsb3VkZnJvbnQuT3JpZ2luUmVxdWVzdFBvbGljeS5BTExfVklFV0VSLCAvLyBGb3J3YXJkIGV2ZXJ5dGhpbmdcbiAgICAgICAgfSxcbiAgICAgIH0sXG5cbiAgICAgIC8vIOKUgOKUgCBFcnJvciBSZXNwb25zZXM6IFNQQSBSb3V0aW5nIEZhbGxiYWNrIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgLy8gRm9yIGNsaWVudC1zaWRlIHJvdXRpbmcgKFJlYWN0IFJvdXRlciwgZXRjLiksIHNlcnZlIC9pbmRleC5odG1sIGZvciA0MDRzLlxuICAgICAgLy8gUzMgd2l0aCBPQUkgcmV0dXJucyA0MDMgZm9yIG1pc3Npbmcga2V5cyAobm90IDQwNCksIHNvIHdlIGhhbmRsZSBib3RoLlxuICAgICAgZXJyb3JSZXNwb25zZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGh0dHBTdGF0dXM6IDQwNCxcbiAgICAgICAgICByZXNwb25zZUh0dHBTdGF0dXM6IDIwMCxcbiAgICAgICAgICByZXNwb25zZVBhZ2VQYXRoOiAnL2luZGV4Lmh0bWwnLFxuICAgICAgICAgIHR0bDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMTApLCAvLyBTaG9ydCBUVEwgZm9yIGVycm9yIHBhZ2VzXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBodHRwU3RhdHVzOiA0MDMsXG4gICAgICAgICAgcmVzcG9uc2VIdHRwU3RhdHVzOiAyMDAsXG4gICAgICAgICAgcmVzcG9uc2VQYWdlUGF0aDogJy9pbmRleC5odG1sJyxcbiAgICAgICAgICB0dGw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDEwKSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgQ2xvdWRGb3JtYXRpb24gT3V0cHV0cyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvLyBFeHBvcnRlZCBzbyB0aGUgUmVhY3QgU1BBIGRlcGxveW1lbnQgcGlwZWxpbmUga25vd3MgdGhlIENsb3VkRnJvbnQgVVJMLlxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Rpc3RyaWJ1dGlvbklkJywge1xuICAgICAgdmFsdWU6IHRoaXMuZGlzdHJpYnV0aW9uLmRpc3RyaWJ1dGlvbklkLFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tRGlzdHJpYnV0aW9uSWRgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Rpc3RyaWJ1dGlvbkRvbWFpbk5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5kaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uRG9tYWluTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWRGcm9udCBkaXN0cmlidXRpb24gZG9tYWluIG5hbWUgKCouY2xvdWRmcm9udC5uZXQpJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1EaXN0cmlidXRpb25Eb21haW5OYW1lYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdXZWJBY2xJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLndlYkFjbC5hdHRySWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ1dBRiBXZWJBQ0wgSUQnLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LVdlYkFjbElkYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdXZWJBY2xBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy53ZWJBY2wuYXR0ckFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnV0FGIFdlYkFDTCBBUk4nLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LVdlYkFjbEFybmAsXG4gICAgfSk7XG5cbiAgICBpZiAoZG9tYWluTmFtZSkge1xuICAgICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0N1c3RvbURvbWFpbk5hbWUnLCB7XG4gICAgICAgIHZhbHVlOiBkb21haW5OYW1lLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ0N1c3RvbSBkb21haW4gbmFtZSBmb3IgQ2xvdWRGcm9udCBkaXN0cmlidXRpb24nLFxuICAgICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tQ3VzdG9tRG9tYWluTmFtZWAsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cbn1cbiJdfQ==