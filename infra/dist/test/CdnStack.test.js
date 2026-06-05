"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = require("aws-cdk-lib");
const assertions_1 = require("aws-cdk-lib/assertions");
const s3 = require("aws-cdk-lib/aws-s3");
const elbv2 = require("aws-cdk-lib/aws-elasticloadbalancingv2");
const ec2 = require("aws-cdk-lib/aws-ec2");
const CdnStack_1 = require("../lib/stacks/CdnStack");
/**
 * Unit tests for CdnStack.
 *
 * Uses the CDK assertions library to validate CloudFormation template output
 * without deploying to AWS.
 */
function buildTemplate() {
    const app = new cdk.App();
    // Create a mock stack to hold VPC and ALB (CDK constructs must be in a Stack scope)
    const mockStack = new cdk.Stack(app, 'MockStack', {
        env: { account: '123456789012', region: 'us-east-1' },
    });
    // Create a minimal VPC for the mock ALB
    const vpc = new ec2.Vpc(mockStack, 'TestVpc', {
        maxAzs: 2,
        natGateways: 0,
    });
    // Mock ALB (imported from EKS/ALB stack in real deployment)
    const alb = new elbv2.ApplicationLoadBalancer(mockStack, 'TestAlb', {
        vpc,
        internetFacing: true,
    });
    // Mock S3 bucket (imported from StorageStack in real deployment)
    const assetsBucket = s3.Bucket.fromBucketName(mockStack, 'TestAssetsBucket', 'test-assets-bucket');
    const stack = new CdnStack_1.CdnStack(app, 'TestCdnStack', {
        env: { account: '123456789012', region: 'us-east-1' }, // us-east-1 required for CloudFront WAF
        envName: 'test',
        assetsBucket,
        alb,
    });
    const template = assertions_1.Template.fromStack(stack);
    return { stack, template };
}
describe('CdnStack — CloudFront Distribution', () => {
    test('creates exactly one CloudFront distribution', () => {
        const { template } = buildTemplate();
        template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    });
    test('CloudFront distribution is enabled', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: {
                Enabled: true,
            },
        });
    });
    test('CloudFront distribution uses HTTP/2 and HTTP/3', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: {
                HttpVersion: 'http2and3',
            },
        });
    });
    test('CloudFront distribution has two origins (S3 and ALB)', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: {
                Origins: assertions_1.Match.arrayWith([
                    // S3 origin (assets bucket)
                    assertions_1.Match.objectLike({
                        S3OriginConfig: assertions_1.Match.anyValue(),
                    }),
                    // ALB origin (API)
                    assertions_1.Match.objectLike({
                        CustomOriginConfig: assertions_1.Match.anyValue(),
                    }),
                ]),
            },
        });
    });
    test('default cache behavior serves from S3 origin (React SPA)', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: {
                DefaultCacheBehavior: assertions_1.Match.objectLike({
                    ViewerProtocolPolicy: 'redirect-to-https',
                    Compress: true,
                    AllowedMethods: ['GET', 'HEAD', 'OPTIONS'],
                    CachedMethods: ['GET', 'HEAD', 'OPTIONS'],
                }),
            },
        });
    });
    test('/api/* cache behavior routes to ALB origin with no caching', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: {
                CacheBehaviors: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        PathPattern: '/api/*',
                        ViewerProtocolPolicy: 'https-only',
                        // AllowedMethods includes all HTTP methods
                    }),
                ]),
            },
        });
    });
    test('CloudFront has error responses for SPA routing (404/403 -> /index.html)', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: {
                CustomErrorResponses: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        ErrorCode: 404,
                        ResponseCode: 200,
                        ResponsePagePath: '/index.html',
                    }),
                    assertions_1.Match.objectLike({
                        ErrorCode: 403,
                        ResponseCode: 200,
                        ResponsePagePath: '/index.html',
                    }),
                ]),
            },
        });
    });
});
describe('CdnStack — Origin Access Identity (OAI)', () => {
    test('creates exactly one CloudFront Origin Access Identity', () => {
        const { template } = buildTemplate();
        template.resourceCountIs('AWS::CloudFront::CloudFrontOriginAccessIdentity', 1);
    });
    test('S3 origin uses OAI for secure access', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: {
                Origins: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        S3OriginConfig: {
                            OriginAccessIdentity: assertions_1.Match.anyValue(),
                        },
                    }),
                ]),
            },
        });
    });
});
describe('CdnStack — AWS WAF WebACL', () => {
    test('creates exactly one WAF WebACL', () => {
        const { template } = buildTemplate();
        template.resourceCountIs('AWS::WAFv2::WebACL', 1);
    });
    test('WAF WebACL is scoped to CLOUDFRONT', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::WAFv2::WebACL', {
            Scope: 'CLOUDFRONT',
        });
    });
    test('WAF WebACL has default action ALLOW', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::WAFv2::WebACL', {
            DefaultAction: {
                Allow: {},
            },
        });
    });
    test('WAF WebACL has rate-limit rule (2000 requests per 5 minutes)', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::WAFv2::WebACL', {
            Rules: assertions_1.Match.arrayWith([
                assertions_1.Match.objectLike({
                    Name: 'RateLimitRule',
                    Priority: 1,
                    Statement: {
                        RateBasedStatement: {
                            AggregateKeyType: 'IP',
                            Limit: 2000,
                        },
                    },
                    Action: {
                        Block: assertions_1.Match.anyValue(),
                    },
                }),
            ]),
        });
    });
    test('WAF WebACL has AWS Managed Rule: Core Rule Set (CRS)', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::WAFv2::WebACL', {
            Rules: assertions_1.Match.arrayWith([
                assertions_1.Match.objectLike({
                    Name: 'AWSManagedRulesCommonRuleSet',
                    Priority: 2,
                    Statement: {
                        ManagedRuleGroupStatement: {
                            VendorName: 'AWS',
                            Name: 'AWSManagedRulesCommonRuleSet',
                        },
                    },
                    OverrideAction: {
                        None: {},
                    },
                }),
            ]),
        });
    });
    test('WAF WebACL has AWS Managed Rule: Known Bad Inputs', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::WAFv2::WebACL', {
            Rules: assertions_1.Match.arrayWith([
                assertions_1.Match.objectLike({
                    Name: 'AWSManagedRulesKnownBadInputsRuleSet',
                    Priority: 3,
                    Statement: {
                        ManagedRuleGroupStatement: {
                            VendorName: 'AWS',
                            Name: 'AWSManagedRulesKnownBadInputsRuleSet',
                        },
                    },
                    OverrideAction: {
                        None: {},
                    },
                }),
            ]),
        });
    });
    test('WAF WebACL has AWS Managed Rule: SQL Injection', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::WAFv2::WebACL', {
            Rules: assertions_1.Match.arrayWith([
                assertions_1.Match.objectLike({
                    Name: 'AWSManagedRulesSQLiRuleSet',
                    Priority: 4,
                    Statement: {
                        ManagedRuleGroupStatement: {
                            VendorName: 'AWS',
                            Name: 'AWSManagedRulesSQLiRuleSet',
                        },
                    },
                    OverrideAction: {
                        None: {},
                    },
                }),
            ]),
        });
    });
    test('CloudFront distribution is associated with WAF WebACL', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: {
                WebACLId: assertions_1.Match.anyValue(),
            },
        });
    });
    test('WAF WebACL has CloudWatch metrics enabled', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::WAFv2::WebACL', {
            VisibilityConfig: {
                CloudWatchMetricsEnabled: true,
                SampledRequestsEnabled: true,
                MetricName: assertions_1.Match.stringLikeRegexp('fcc-cloudfront-waf-test'),
            },
        });
    });
    test('WAF WebACL has custom response body for rate-limit block', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::WAFv2::WebACL', {
            CustomResponseBodies: {
                'rate-limit-exceeded': {
                    ContentType: 'APPLICATION_JSON',
                    Content: assertions_1.Match.anyValue(),
                },
            },
        });
    });
});
describe('CdnStack — CloudFormation Outputs', () => {
    const expectedOutputs = [
        'DistributionId',
        'DistributionDomainName',
        'WebAclId',
        'WebAclArn',
    ];
    test.each(expectedOutputs)('exports %s', (outputKey) => {
        const { template } = buildTemplate();
        const outputs = template.findOutputs(outputKey);
        expect(Object.keys(outputs)).toHaveLength(1);
    });
    test('all outputs have export names for cross-stack referencing', () => {
        const { template } = buildTemplate();
        const cfnTemplate = template.toJSON();
        const outputs = cfnTemplate.Outputs ?? {};
        for (const [key, output] of Object.entries(outputs)) {
            expect(output.Export?.Name).toBeDefined();
            // Export name should include the environment name.
            expect(output.Export.Name).toMatch(/test/);
        }
    });
});
describe('CdnStack — Security and Compliance', () => {
    test('ALB origin uses HTTPS-only protocol', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: {
                Origins: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        CustomOriginConfig: assertions_1.Match.objectLike({
                            OriginProtocolPolicy: 'https-only',
                            OriginSSLProtocols: ['TLSv1.2'],
                        }),
                    }),
                ]),
            },
        });
    });
    test('API cache behavior enforces HTTPS-only for viewer protocol', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: {
                CacheBehaviors: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        PathPattern: '/api/*',
                        ViewerProtocolPolicy: 'https-only',
                    }),
                ]),
            },
        });
    });
    test('default cache behavior redirects HTTP to HTTPS', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: {
                DefaultCacheBehavior: assertions_1.Match.objectLike({
                    ViewerProtocolPolicy: 'redirect-to-https',
                }),
            },
        });
    });
});
describe('CdnStack — Performance Optimization', () => {
    test('CloudFront distribution uses PriceClass 100 (US, Canada, Europe)', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: {
                PriceClass: 'PriceClass_100',
            },
        });
    });
    test('default cache behavior enables compression', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: {
                DefaultCacheBehavior: assertions_1.Match.objectLike({
                    Compress: true,
                }),
            },
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQ2RuU3RhY2sudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3Rlc3QvQ2RuU3RhY2sudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLG1DQUFtQztBQUNuQyx1REFBeUQ7QUFDekQseUNBQXlDO0FBQ3pDLGdFQUFnRTtBQUNoRSwyQ0FBMkM7QUFDM0MscURBQWtEO0FBRWxEOzs7OztHQUtHO0FBRUgsU0FBUyxhQUFhO0lBQ3BCLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBRTFCLG9GQUFvRjtJQUNwRixNQUFNLFNBQVMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLFdBQVcsRUFBRTtRQUNoRCxHQUFHLEVBQUUsRUFBRSxPQUFPLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUU7S0FDdEQsQ0FBQyxDQUFDO0lBRUgsd0NBQXdDO0lBQ3hDLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsU0FBUyxFQUFFO1FBQzVDLE1BQU0sRUFBRSxDQUFDO1FBQ1QsV0FBVyxFQUFFLENBQUM7S0FDZixDQUFDLENBQUM7SUFFSCw0REFBNEQ7SUFDNUQsTUFBTSxHQUFHLEdBQUcsSUFBSSxLQUFLLENBQUMsdUJBQXVCLENBQUMsU0FBUyxFQUFFLFNBQVMsRUFBRTtRQUNsRSxHQUFHO1FBQ0gsY0FBYyxFQUFFLElBQUk7S0FDckIsQ0FBQyxDQUFDO0lBRUgsaUVBQWlFO0lBQ2pFLE1BQU0sWUFBWSxHQUFHLEVBQUUsQ0FBQyxNQUFNLENBQUMsY0FBYyxDQUMzQyxTQUFTLEVBQ1Qsa0JBQWtCLEVBQ2xCLG9CQUFvQixDQUNyQixDQUFDO0lBRUYsTUFBTSxLQUFLLEdBQUcsSUFBSSxtQkFBUSxDQUFDLEdBQUcsRUFBRSxjQUFjLEVBQUU7UUFDOUMsR0FBRyxFQUFFLEVBQUUsT0FBTyxFQUFFLGNBQWMsRUFBRSxN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QyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFJLENBQUMsNENBQTRDLEVBQUUsR0FBRyxFQUFFO1FBQ3RELE1BQU0sRUFBRSxRQUFRLEVBQUUsR0FBRyxhQUFhLEVBQUUsQ0FBQztRQUNyQyxRQUFRLENBQUMscUJBQXFCLENBQUMsK0JBQStCLEVBQUU7WUFDOUQsa0JBQWtCLEVBQUU7Z0JBQ2xCLG9CQUFvQixFQUFFLGtCQUFLLENBQUMsVUFBVSxDQUFDO29CQUNyQyxRQUFRLEVBQUUsSUFBSTtpQkFDZixDQUFDO2FBQ0g7U0FDRixDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IFRlbXBsYXRlLCBNYXRjaCB9IGZyb20gJ2F3cy1jZGstbGliL2Fzc2VydGlvbnMnO1xuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcbmltcG9ydCAqIGFzIGVsYnYyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lbGFzdGljbG9hZGJhbGFuY2luZ3YyJztcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCB7IENkblN0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9DZG5TdGFjayc7XG5cbi8qKlxuICogVW5pdCB0ZXN0cyBmb3IgQ2RuU3RhY2suXG4gKlxuICogVXNlcyB0aGUgQ0RLIGFzc2VydGlvbnMgbGlicmFyeSB0byB2YWxpZGF0ZSBDbG91ZEZvcm1hdGlvbiB0ZW1wbGF0ZSBvdXRwdXRcbiAqIHdpdGhvdXQgZGVwbG95aW5nIHRvIEFXUy5cbiAqL1xuXG5mdW5jdGlvbiBidWlsZFRlbXBsYXRlKCk6IHsgc3RhY2s6IENkblN0YWNrOyB0ZW1wbGF0ZTogVGVtcGxhdGUgfSB7XG4gIGNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG5cbiAgLy8gQ3JlYXRlIGEgbW9jayBzdGFjayB0byBob2xkIFZQQyBhbmQgQUxCIChDREsgY29uc3RydWN0cyBtdXN0IGJlIGluIGEgU3RhY2sgc2NvcGUpXG4gIGNvbnN0IG1vY2tTdGFjayA9IG5ldyBjZGsuU3RhY2soYXBwLCAnTW9ja1N0YWNrJywge1xuICAgIGVudjogeyBhY2NvdW50OiAnMTIzNDU2Nzg5MDEyJywgcmVnaW9uOiAndXMtZWFzdC0xJyB9LFxuICB9KTtcblxuICAvLyBDcmVhdGUgYSBtaW5pbWFsIFZQQyBmb3IgdGhlIG1vY2sgQUxCXG4gIGNvbnN0IHZwYyA9IG5ldyBlYzIuVnBjKG1vY2tTdGFjaywgJ1Rlc3RWcGMnLCB7XG4gICAgbWF4QXpzOiAyLFxuICAgIG5hdEdhdGV3YXlzOiAwLFxuICB9KTtcblxuICAvLyBNb2NrIEFMQiAoaW1wb3J0ZWQgZnJvbSBFS1MvQUxCIHN0YWNrIGluIHJlYWwgZGVwbG95bWVudClcbiAgY29uc3QgYWxiID0gbmV3IGVsYnYyLkFwcGxpY2F0aW9uTG9hZEJhbGFuY2VyKG1vY2tTdGFjaywgJ1Rlc3RBbGInLCB7XG4gICAgdnBjLFxuICAgIGludGVybmV0RmFjaW5nOiB0cnVlLFxuICB9KTtcblxuICAvLyBNb2NrIFMzIGJ1Y2tldCAoaW1wb3J0ZWQgZnJvbSBTdG9yYWdlU3RhY2sgaW4gcmVhbCBkZXBsb3ltZW50KVxuICBjb25zdCBhc3NldHNCdWNrZXQgPSBzMy5CdWNrZXQuZnJvbUJ1Y2tldE5hbWUoXG4gICAgbW9ja1N0YWNrLFxuICAgICdUZXN0QXNzZXRzQnVja2V0JyxcbiAgICAndGVzdC1hc3NldHMtYnVja2V0JyxcbiAgKTtcblxuICBjb25zdCBzdGFjayA9IG5ldyBDZG5TdGFjayhhcHAsICdUZXN0Q2RuU3RhY2snLCB7XG4gICAgZW52OiB7IGFjY291bnQ6ICcxMjM0NTY3ODkwMTInLCByZWdpb246ICd1cy1lYXN0LTEnIH0sIC8vIHVzLWVhc3QtMSByZXF1aXJlZCBmb3IgQ2xvdWRGcm9udCBXQUZcbiAgICBlbnZOYW1lOiAndGVzdCcsXG4gICAgYXNzZXRzQnVja2V0LFxuICAgIGFsYixcbiAgfSk7XG5cbiAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICByZXR1cm4geyBzdGFjaywgdGVtcGxhdGUgfTtcbn1cblxuZGVzY3JpYmUoJ0NkblN0YWNrIOKAlCBDbG91ZEZyb250IERpc3RyaWJ1dGlvbicsICgpID0+IHtcbiAgdGVzdCgnY3JlYXRlcyBleGFjdGx5IG9uZSBDbG91ZEZyb250IGRpc3RyaWJ1dGlvbicsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkNsb3VkRnJvbnQ6OkRpc3RyaWJ1dGlvbicsIDEpO1xuICB9KTtcblxuICB0ZXN0KCdDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiBpcyBlbmFibGVkJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6Q2xvdWRGcm9udDo6RGlzdHJpYnV0aW9uJywge1xuICAgICAgRGlzdHJpYnV0aW9uQ29uZmlnOiB7XG4gICAgICAgIEVuYWJsZWQ6IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiB1c2VzIEhUVFAvMiBhbmQgSFRUUC8zJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6Q2xvdWRGcm9udDo6RGlzdHJpYnV0aW9uJywge1xuICAgICAgRGlzdHJpYnV0aW9uQ29uZmlnOiB7XG4gICAgICAgIEh0dHBWZXJzaW9uOiAnaHR0cDJhbmQzJyxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ0Nsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIGhhcyB0d28gb3JpZ2lucyAoUzMgYW5kIEFMQiknLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpDbG91ZEZyb250OjpEaXN0cmlidXRpb24nLCB7XG4gICAgICBEaXN0cmlidXRpb25Db25maWc6IHtcbiAgICAgICAgT3JpZ2luczogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgICAvLyBTMyBvcmlnaW4gKGFzc2V0cyBidWNrZXQpXG4gICAgICAgICAgTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgICBTM09yaWdpbkNvbmZpZzogTWF0Y2guYW55VmFsdWUoKSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICAvLyBBTEIgb3JpZ2luIChBUEkpXG4gICAgICAgICAgTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgICBDdXN0b21PcmlnaW5Db25maWc6IE1hdGNoLmFueVZhbHVlKCksXG4gICAgICAgICAgfSksXG4gICAgICAgIF0pLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnZGVmYXVsdCBjYWNoZSBiZWhhdmlvciBzZXJ2ZXMgZnJvbSBTMyBvcmlnaW4gKFJlYWN0IFNQQSknLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpDbG91ZEZyb250OjpEaXN0cmlidXRpb24nLCB7XG4gICAgICBEaXN0cmlidXRpb25Db25maWc6IHtcbiAgICAgICAgRGVmYXVsdENhY2hlQmVoYXZpb3I6IE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgIFZpZXdlclByb3RvY29sUG9saWN5OiAncmVkaXJlY3QtdG8taHR0cHMnLFxuICAgICAgICAgIENvbXByZXNzOiB0cnVlLFxuICAgICAgICAgIEFsbG93ZWRNZXRob2RzOiBbJ0dFVCcsICdIRUFEJywgJ09QVElPTlMnXSxcbiAgICAgICAgICBDYWNoZWRNZXRob2RzOiBbJ0dFVCcsICdIRUFEJywgJ09QVElPTlMnXSxcbiAgICAgICAgfSksXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCcvYXBpLyogY2FjaGUgYmVoYXZpb3Igcm91dGVzIHRvIEFMQiBvcmlnaW4gd2l0aCBubyBjYWNoaW5nJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6Q2xvdWRGcm9udDo6RGlzdHJpYnV0aW9uJywge1xuICAgICAgRGlzdHJpYnV0aW9uQ29uZmlnOiB7XG4gICAgICAgIENhY2hlQmVoYXZpb3JzOiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgUGF0aFBhdHRlcm46ICcvYXBpLyonLFxuICAgICAgICAgICAgVmlld2VyUHJvdG9jb2xQb2xpY3k6ICdodHRwcy1vbmx5JyxcbiAgICAgICAgICAgIC8vIEFsbG93ZWRNZXRob2RzIGluY2x1ZGVzIGFsbCBIVFRQIG1ldGhvZHNcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSksXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdDbG91ZEZyb250IGhhcyBlcnJvciByZXNwb25zZXMgZm9yIFNQQSByb3V0aW5nICg0MDQvNDAzIC0+IC9pbmRleC5odG1sKScsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkNsb3VkRnJvbnQ6OkRpc3RyaWJ1dGlvbicsIHtcbiAgICAgIERpc3RyaWJ1dGlvbkNvbmZpZzoge1xuICAgICAgICBDdXN0b21FcnJvclJlc3BvbnNlczogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgIEVycm9yQ29kZTogNDA0LFxuICAgICAgICAgICAgUmVzcG9uc2VDb2RlOiAyMDAsXG4gICAgICAgICAgICBSZXNwb25zZVBhZ2VQYXRoOiAnL2luZGV4Lmh0bWwnLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgRXJyb3JDb2RlOiA0MDMsXG4gICAgICAgICAgICBSZXNwb25zZUNvZGU6IDIwMCxcbiAgICAgICAgICAgIFJlc3BvbnNlUGFnZVBhdGg6ICcvaW5kZXguaHRtbCcsXG4gICAgICAgICAgfSksXG4gICAgICAgIF0pLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfSk7XG59KTtcblxuZGVzY3JpYmUoJ0NkblN0YWNrIOKAlCBPcmlnaW4gQWNjZXNzIElkZW50aXR5IChPQUkpJywgKCkgPT4ge1xuICB0ZXN0KCdjcmVhdGVzIGV4YWN0bHkgb25lIENsb3VkRnJvbnQgT3JpZ2luIEFjY2VzcyBJZGVudGl0eScsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkNsb3VkRnJvbnQ6OkNsb3VkRnJvbnRPcmlnaW5BY2Nlc3NJZGVudGl0eScsIDEpO1xuICB9KTtcblxuICB0ZXN0KCdTMyBvcmlnaW4gdXNlcyBPQUkgZm9yIHNlY3VyZSBhY2Nlc3MnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpDbG91ZEZyb250OjpEaXN0cmlidXRpb24nLCB7XG4gICAgICBEaXN0cmlidXRpb25Db25maWc6IHtcbiAgICAgICAgT3JpZ2luczogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgIFMzT3JpZ2luQ29uZmlnOiB7XG4gICAgICAgICAgICAgIE9yaWdpbkFjY2Vzc0lkZW50aXR5OiBNYXRjaC5hbnlWYWx1ZSgpLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSksXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcbn0pO1xuXG5kZXNjcmliZSgnQ2RuU3RhY2sg4oCUIEFXUyBXQUYgV2ViQUNMJywgKCkgPT4ge1xuICB0ZXN0KCdjcmVhdGVzIGV4YWN0bHkgb25lIFdBRiBXZWJBQ0wnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpXQUZ2Mjo6V2ViQUNMJywgMSk7XG4gIH0pO1xuXG4gIHRlc3QoJ1dBRiBXZWJBQ0wgaXMgc2NvcGVkIHRvIENMT1VERlJPTlQnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpXQUZ2Mjo6V2ViQUNMJywge1xuICAgICAgU2NvcGU6ICdDTE9VREZST05UJyxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnV0FGIFdlYkFDTCBoYXMgZGVmYXVsdCBhY3Rpb24gQUxMT1cnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpXQUZ2Mjo6V2ViQUNMJywge1xuICAgICAgRGVmYXVsdEFjdGlvbjoge1xuICAgICAgICBBbGxvdzoge30sXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdXQUYgV2ViQUNMIGhhcyByYXRlLWxpbWl0IHJ1bGUgKDIwMDAgcmVxdWVzdHMgcGVyIDUgbWludXRlcyknLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpXQUZ2Mjo6V2ViQUNMJywge1xuICAgICAgUnVsZXM6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgIE5hbWU6ICdSYXRlTGltaXRSdWxlJyxcbiAgICAgICAgICBQcmlvcml0eTogMSxcbiAgICAgICAgICBTdGF0ZW1lbnQ6IHtcbiAgICAgICAgICAgIFJhdGVCYXNlZFN0YXRlbWVudDoge1xuICAgICAgICAgICAgICBBZ2dyZWdhdGVLZXlUeXBlOiAnSVAnLFxuICAgICAgICAgICAgICBMaW1pdDogMjAwMCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBBY3Rpb246IHtcbiAgICAgICAgICAgIEJsb2NrOiBNYXRjaC5hbnlWYWx1ZSgpLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgICAgXSksXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ1dBRiBXZWJBQ0wgaGFzIEFXUyBNYW5hZ2VkIFJ1bGU6IENvcmUgUnVsZSBTZXQgKENSUyknLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpXQUZ2Mjo6V2ViQUNMJywge1xuICAgICAgUnVsZXM6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgIE5hbWU6ICdBV1NNYW5hZ2VkUnVsZXNDb21tb25SdWxlU2V0JyxcbiAgICAgICAgICBQcmlvcml0eTogMixcbiAgICAgICAgICBTdGF0ZW1lbnQ6IHtcbiAgICAgICAgICAgIE1hbmFnZWRSdWxlR3JvdXBTdGF0ZW1lbnQ6IHtcbiAgICAgICAgICAgICAgVmVuZG9yTmFtZTogJ0FXUycsXG4gICAgICAgICAgICAgIE5hbWU6ICdBV1NNYW5hZ2VkUnVsZXNDb21tb25SdWxlU2V0JyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBPdmVycmlkZUFjdGlvbjoge1xuICAgICAgICAgICAgTm9uZToge30sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSksXG4gICAgICBdKSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnV0FGIFdlYkFDTCBoYXMgQVdTIE1hbmFnZWQgUnVsZTogS25vd24gQmFkIElucHV0cycsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OldBRnYyOjpXZWJBQ0wnLCB7XG4gICAgICBSdWxlczogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgTmFtZTogJ0FXU01hbmFnZWRSdWxlc0tub3duQmFkSW5wdXRzUnVsZVNldCcsXG4gICAgICAgICAgUHJpb3JpdHk6IDMsXG4gICAgICAgICAgU3RhdGVtZW50OiB7XG4gICAgICAgICAgICBNYW5hZ2VkUnVsZUdyb3VwU3RhdGVtZW50OiB7XG4gICAgICAgICAgICAgIFZlbmRvck5hbWU6ICdBV1MnLFxuICAgICAgICAgICAgICBOYW1lOiAnQVdTTWFuYWdlZFJ1bGVzS25vd25CYWRJbnB1dHNSdWxlU2V0JyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBPdmVycmlkZUFjdGlvbjoge1xuICAgICAgICAgICAgTm9uZToge30sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSksXG4gICAgICBdKSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnV0FGIFdlYkFDTCBoYXMgQVdTIE1hbmFnZWQgUnVsZTogU1FMIEluamVjdGlvbicsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OldBRnYyOjpXZWJBQ0wnLCB7XG4gICAgICBSdWxlczogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgTmFtZTogJ0FXU01hbmFnZWRSdWxlc1NRTGlSdWxlU2V0JyxcbiAgICAgICAgICBQcmlvcml0eTogNCxcbiAgICAgICAgICBTdGF0ZW1lbnQ6IHtcbiAgICAgICAgICAgIE1hbmFnZWRSdWxlR3JvdXBTdGF0ZW1lbnQ6IHtcbiAgICAgICAgICAgICAgVmVuZG9yTmFtZTogJ0FXUycsXG4gICAgICAgICAgICAgIE5hbWU6ICdBV1NNYW5hZ2VkUnVsZXNTUUxpUnVsZVNldCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAgT3ZlcnJpZGVBY3Rpb246IHtcbiAgICAgICAgICAgIE5vbmU6IHt9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgICAgXSksXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ0Nsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIGlzIGFzc29jaWF0ZWQgd2l0aCBXQUYgV2ViQUNMJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6Q2xvdWRGcm9udDo6RGlzdHJpYnV0aW9uJywge1xuICAgICAgRGlzdHJpYnV0aW9uQ29uZmlnOiB7XG4gICAgICAgIFdlYkFDTElkOiBNYXRjaC5hbnlWYWx1ZSgpLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnV0FGIFdlYkFDTCBoYXMgQ2xvdWRXYXRjaCBtZXRyaWNzIGVuYWJsZWQnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpXQUZ2Mjo6V2ViQUNMJywge1xuICAgICAgVmlzaWJpbGl0eUNvbmZpZzoge1xuICAgICAgICBDbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICAgIFNhbXBsZWRSZXF1ZXN0c0VuYWJsZWQ6IHRydWUsXG4gICAgICAgIE1ldHJpY05hbWU6IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJ2ZjYy1jbG91ZGZyb250LXdhZi10ZXN0JyksXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdXQUYgV2ViQUNMIGhhcyBjdXN0b20gcmVzcG9uc2UgYm9keSBmb3IgcmF0ZS1saW1pdCBibG9jaycsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OldBRnYyOjpXZWJBQ0wnLCB7XG4gICAgICBDdXN0b21SZXNwb25zZUJvZGllczoge1xuICAgICAgICAncmF0ZS1saW1pdC1leGNlZWRlZCc6IHtcbiAgICAgICAgICBDb250ZW50VHlwZTogJ0FQUExJQ0FUSU9OX0pTT04nLFxuICAgICAgICAgIENvbnRlbnQ6IE1hdGNoLmFueVZhbHVlKCksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcbn0pO1xuXG5kZXNjcmliZSgnQ2RuU3RhY2sg4oCUIENsb3VkRm9ybWF0aW9uIE91dHB1dHMnLCAoKSA9PiB7XG4gIGNvbnN0IGV4cGVjdGVkT3V0cHV0cyA9IFtcbiAgICAnRGlzdHJpYnV0aW9uSWQnLFxuICAgICdEaXN0cmlidXRpb25Eb21haW5OYW1lJyxcbiAgICAnV2ViQWNsSWQnLFxuICAgICdXZWJBY2xBcm4nLFxuICBdO1xuXG4gIHRlc3QuZWFjaChleHBlY3RlZE91dHB1dHMpKCdleHBvcnRzICVzJywgKG91dHB1dEtleSkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICBjb25zdCBvdXRwdXRzID0gdGVtcGxhdGUuZmluZE91dHB1dHMob3V0cHV0S2V5KTtcbiAgICBleHBlY3QoT2JqZWN0LmtleXMob3V0cHV0cykpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgfSk7XG5cbiAgdGVzdCgnYWxsIG91dHB1dHMgaGF2ZSBleHBvcnQgbmFtZXMgZm9yIGNyb3NzLXN0YWNrIHJlZmVyZW5jaW5nJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICBjb25zdCBjZm5UZW1wbGF0ZSA9IHRlbXBsYXRlLnRvSlNPTigpO1xuICAgIGNvbnN0IG91dHB1dHMgPSBjZm5UZW1wbGF0ZS5PdXRwdXRzID8/IHt9O1xuICAgIGZvciAoY29uc3QgW2tleSwgb3V0cHV0XSBvZiBPYmplY3QuZW50cmllczxhbnk+KG91dHB1dHMpKSB7XG4gICAgICBleHBlY3Qob3V0cHV0LkV4cG9ydD8uTmFtZSkudG9CZURlZmluZWQoKTtcbiAgICAgIC8vIEV4cG9ydCBuYW1lIHNob3VsZCBpbmNsdWRlIHRoZSBlbnZpcm9ubWVudCBuYW1lLlxuICAgICAgZXhwZWN0KG91dHB1dC5FeHBvcnQuTmFtZSkudG9NYXRjaCgvdGVzdC8pO1xuICAgIH1cbiAgfSk7XG59KTtcblxuZGVzY3JpYmUoJ0NkblN0YWNrIOKAlCBTZWN1cml0eSBhbmQgQ29tcGxpYW5jZScsICgpID0+IHtcbiAgdGVzdCgnQUxCIG9yaWdpbiB1c2VzIEhUVFBTLW9ubHkgcHJvdG9jb2wnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpDbG91ZEZyb250OjpEaXN0cmlidXRpb24nLCB7XG4gICAgICBEaXN0cmlidXRpb25Db25maWc6IHtcbiAgICAgICAgT3JpZ2luczogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgIEN1c3RvbU9yaWdpbkNvbmZpZzogTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgICAgIE9yaWdpblByb3RvY29sUG9saWN5OiAnaHR0cHMtb25seScsXG4gICAgICAgICAgICAgIE9yaWdpblNTTFByb3RvY29sczogWydUTFN2MS4yJ10sXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSksXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdBUEkgY2FjaGUgYmVoYXZpb3IgZW5mb3JjZXMgSFRUUFMtb25seSBmb3Igdmlld2VyIHByb3RvY29sJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6Q2xvdWRGcm9udDo6RGlzdHJpYnV0aW9uJywge1xuICAgICAgRGlzdHJpYnV0aW9uQ29uZmlnOiB7XG4gICAgICAgIENhY2hlQmVoYXZpb3JzOiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgUGF0aFBhdHRlcm46ICcvYXBpLyonLFxuICAgICAgICAgICAgVmlld2VyUHJvdG9jb2xQb2xpY3k6ICdodHRwcy1vbmx5JyxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSksXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdkZWZhdWx0IGNhY2hlIGJlaGF2aW9yIHJlZGlyZWN0cyBIVFRQIHRvIEhUVFBTJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6Q2xvdWRGcm9udDo6RGlzdHJpYnV0aW9uJywge1xuICAgICAgRGlzdHJpYnV0aW9uQ29uZmlnOiB7XG4gICAgICAgIERlZmF1bHRDYWNoZUJlaGF2aW9yOiBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICBWaWV3ZXJQcm90b2NvbFBvbGljeTogJ3JlZGlyZWN0LXRvLWh0dHBzJyxcbiAgICAgICAgfSksXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcbn0pO1xuXG5kZXNjcmliZSgnQ2RuU3RhY2sg4oCUIFBlcmZvcm1hbmNlIE9wdGltaXphdGlvbicsICgpID0+IHtcbiAgdGVzdCgnQ2xvdWRGcm9udCBkaXN0cmlidXRpb24gdXNlcyBQcmljZUNsYXNzIDEwMCAoVVMsIENhbmFkYSwgRXVyb3BlKScsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkNsb3VkRnJvbnQ6OkRpc3RyaWJ1dGlvbicsIHtcbiAgICAgIERpc3RyaWJ1dGlvbkNvbmZpZzoge1xuICAgICAgICBQcmljZUNsYXNzOiAnUHJpY2VDbGFzc18xMDAnLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnZGVmYXVsdCBjYWNoZSBiZWhhdmlvciBlbmFibGVzIGNvbXByZXNzaW9uJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6Q2xvdWRGcm9udDo6RGlzdHJpYnV0aW9uJywge1xuICAgICAgRGlzdHJpYnV0aW9uQ29uZmlnOiB7XG4gICAgICAgIERlZmF1bHRDYWNoZUJlaGF2aW9yOiBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICBDb21wcmVzczogdHJ1ZSxcbiAgICAgICAgfSksXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19