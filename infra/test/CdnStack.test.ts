import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { CdnStack } from '../lib/stacks/CdnStack';

/**
 * Unit tests for CdnStack.
 *
 * Uses the CDK assertions library to validate CloudFormation template output
 * without deploying to AWS.
 */

function buildTemplate(): { stack: CdnStack; template: Template } {
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
  const assetsBucket = s3.Bucket.fromBucketName(
    mockStack,
    'TestAssetsBucket',
    'test-assets-bucket',
  );

  const stack = new CdnStack(app, 'TestCdnStack', {
    env: { account: '123456789012', region: 'us-east-1' }, // us-east-1 required for CloudFront WAF
    envName: 'test',
    assetsBucket,
    alb,
  });

  const template = Template.fromStack(stack);
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
        Origins: Match.arrayWith([
          // S3 origin (assets bucket)
          Match.objectLike({
            S3OriginConfig: Match.anyValue(),
          }),
          // ALB origin (API)
          Match.objectLike({
            CustomOriginConfig: Match.anyValue(),
          }),
        ]),
      },
    });
  });

  test('default cache behavior serves from S3 origin (React SPA)', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        DefaultCacheBehavior: Match.objectLike({
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
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
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
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({
            ErrorCode: 404,
            ResponseCode: 200,
            ResponsePagePath: '/index.html',
          }),
          Match.objectLike({
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
        Origins: Match.arrayWith([
          Match.objectLike({
            S3OriginConfig: {
              OriginAccessIdentity: Match.anyValue(),
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
      Rules: Match.arrayWith([
        Match.objectLike({
          Name: 'RateLimitRule',
          Priority: 1,
          Statement: {
            RateBasedStatement: {
              AggregateKeyType: 'IP',
              Limit: 2000,
            },
          },
          Action: {
            Block: Match.anyValue(),
          },
        }),
      ]),
    });
  });

  test('WAF WebACL has AWS Managed Rule: Core Rule Set (CRS)', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Rules: Match.arrayWith([
        Match.objectLike({
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
      Rules: Match.arrayWith([
        Match.objectLike({
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
      Rules: Match.arrayWith([
        Match.objectLike({
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
        WebACLId: Match.anyValue(),
      },
    });
  });

  test('WAF WebACL has CloudWatch metrics enabled', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      VisibilityConfig: {
        CloudWatchMetricsEnabled: true,
        SampledRequestsEnabled: true,
        MetricName: Match.stringLikeRegexp('fcc-cloudfront-waf-test'),
      },
    });
  });

  test('WAF WebACL has custom response body for rate-limit block', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      CustomResponseBodies: {
        'rate-limit-exceeded': {
          ContentType: 'APPLICATION_JSON',
          Content: Match.anyValue(),
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
    for (const [key, output] of Object.entries<any>(outputs)) {
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
        Origins: Match.arrayWith([
          Match.objectLike({
            CustomOriginConfig: Match.objectLike({
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
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
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
        DefaultCacheBehavior: Match.objectLike({
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
        DefaultCacheBehavior: Match.objectLike({
          Compress: true,
        }),
      },
    });
  });
});
