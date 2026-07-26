import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { StorageStack } from '../lib/stacks/StorageStack';

/**
 * Unit tests for StorageStack.
 *
 * Uses the CDK assertions library to validate CloudFormation template output
 * without deploying to AWS.
 */

function buildTemplate(): { stack: StorageStack; template: Template } {
  const app = new cdk.App();
  const stack = new StorageStack(app, 'TestStorageStack', {
    env: { account: '123456789012', region: 'ap-southeast-2' },
  });
  const template = Template.fromStack(stack);
  return { stack, template };
}

describe('StorageStack — S3 Buckets', () => {
  test('creates exactly two S3 buckets (invoices + assets)', () => {
    const { template } = buildTemplate();
    template.resourceCountIs('AWS::S3::Bucket', 2);
  });

  test('invoices bucket has versioning enabled', () => {
    const { template } = buildTemplate();
    const buckets = template.findResources('AWS::S3::Bucket', {
      Properties: {
        BucketName: Match.stringLikeRegexp('fcc-invoices-test'),
        VersioningConfiguration: {
          Status: 'Enabled',
        },
      },
    });
    expect(Object.keys(buckets)).toHaveLength(1);
  });

  test('invoices bucket has KMS encryption', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: Match.stringLikeRegexp('fcc-invoices-test'),
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'aws:kms',
              KMSMasterKeyID: Match.anyValue(),
            },
          },
        ],
      },
    });
  });

  test('invoices bucket has block public access enabled', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: Match.stringLikeRegexp('fcc-invoices-test'),
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  test('invoices bucket has 90-day Glacier lifecycle transition', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: Match.stringLikeRegexp('fcc-invoices-test'),
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            Status: 'Enabled',
            Transitions: [
              {
                StorageClass: 'GLACIER',
                TransitionInDays: 90,
              },
            ],
          }),
        ]),
      },
    });
  });

  test('assets bucket has static website hosting enabled', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: Match.stringLikeRegexp('fcc-assets-test'),
      WebsiteConfiguration: {
        IndexDocument: 'index.html',
        ErrorDocument: 'index.html',
      },
    });
  });

  test('assets bucket has S3-managed encryption (not KMS)', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: Match.stringLikeRegexp('fcc-assets-test'),
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          },
        ],
      },
    });
  });

  test('assets bucket has block public access enabled (CloudFront OAI will grant read)', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: Match.stringLikeRegexp('fcc-assets-test'),
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });
});

describe('StorageStack — KMS Key', () => {
  test('creates exactly one KMS key for invoice encryption', () => {
    const { template } = buildTemplate();
    template.resourceCountIs('AWS::KMS::Key', 1);
  });

  test('KMS key has key rotation enabled', () => {
    const { template } = buildTemplate();
    template.hasResourceProperties('AWS::KMS::Key', {
      EnableKeyRotation: true,
    });
  });

  test('KMS key has an alias for easy identification', () => {
    const { template } = buildTemplate();
    const aliases = template.findResources('AWS::KMS::Alias', {
      Properties: {
        AliasName: Match.stringLikeRegexp('fcc-invoices-test'),
      },
    });
    expect(Object.keys(aliases)).toHaveLength(1);
  });
});

describe('StorageStack — CloudFormation Outputs', () => {
  const expectedOutputs = [
    'InvoicesBucketName',
    'InvoicesBucketArn',
    'InvoicesKmsKeyId',
    'InvoicesKmsKeyArn',
    'AssetsBucketName',
    'AssetsBucketArn',
    'AssetsBucketWebsiteUrl',
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

describe('StorageStack — Security and Compliance', () => {
  test('invoices bucket enforces SSL/TLS (HTTPS-only)', () => {
    const { template } = buildTemplate();
    // CDK enforces SSL by adding a bucket policy with aws:SecureTransport condition.
    const bucketPolicies = template.findResources('AWS::S3::BucketPolicy', {
      Properties: {
        Bucket: Match.anyValue(),
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Deny',
              Principal: Match.anyValue(),
              Action: 's3:*',
              Condition: {
                Bool: {
                  'aws:SecureTransport': 'false',
                },
              },
            }),
          ]),
        },
      },
    });
    expect(Object.keys(bucketPolicies).length).toBeGreaterThanOrEqual(1);
  });

  test('invoices bucket has deletion policy RETAIN', () => {
    const { template } = buildTemplate();
    const buckets = template.findResources('AWS::S3::Bucket', {
      Properties: {
        BucketName: Match.stringLikeRegexp('fcc-invoices-test'),
      },
      DeletionPolicy: 'Retain',
    });
    expect(Object.keys(buckets)).toHaveLength(1);
  });

  test('KMS key has deletion policy RETAIN', () => {
    const { template } = buildTemplate();
    const keys = template.findResources('AWS::KMS::Key', {
      DeletionPolicy: 'Retain',
    });
    expect(Object.keys(keys)).toHaveLength(1);
  });
});
