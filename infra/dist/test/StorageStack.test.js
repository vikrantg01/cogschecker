"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = require("aws-cdk-lib");
const assertions_1 = require("aws-cdk-lib/assertions");
const StorageStack_1 = require("../lib/stacks/StorageStack");
/**
 * Unit tests for StorageStack.
 *
 * Uses the CDK assertions library to validate CloudFormation template output
 * without deploying to AWS.
 */
function buildTemplate() {
    const app = new cdk.App();
    const stack = new StorageStack_1.StorageStack(app, 'TestStorageStack', {
        env: { account: '123456789012', region: 'ap-southeast-2' },
        envName: 'test',
    });
    const template = assertions_1.Template.fromStack(stack);
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
                BucketName: assertions_1.Match.stringLikeRegexp('fcc-invoices-test'),
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
            BucketName: assertions_1.Match.stringLikeRegexp('fcc-invoices-test'),
            BucketEncryption: {
                ServerSideEncryptionConfiguration: [
                    {
                        ServerSideEncryptionByDefault: {
                            SSEAlgorithm: 'aws:kms',
                            KMSMasterKeyID: assertions_1.Match.anyValue(),
                        },
                    },
                ],
            },
        });
    });
    test('invoices bucket has block public access enabled', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::S3::Bucket', {
            BucketName: assertions_1.Match.stringLikeRegexp('fcc-invoices-test'),
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
            BucketName: assertions_1.Match.stringLikeRegexp('fcc-invoices-test'),
            LifecycleConfiguration: {
                Rules: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
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
            BucketName: assertions_1.Match.stringLikeRegexp('fcc-assets-test'),
            WebsiteConfiguration: {
                IndexDocument: 'index.html',
                ErrorDocument: 'index.html',
            },
        });
    });
    test('assets bucket has S3-managed encryption (not KMS)', () => {
        const { template } = buildTemplate();
        template.hasResourceProperties('AWS::S3::Bucket', {
            BucketName: assertions_1.Match.stringLikeRegexp('fcc-assets-test'),
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
            BucketName: assertions_1.Match.stringLikeRegexp('fcc-assets-test'),
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
                AliasName: assertions_1.Match.stringLikeRegexp('fcc-invoices-test'),
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
        for (const [key, output] of Object.entries(outputs)) {
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
                Bucket: assertions_1.Match.anyValue(),
                PolicyDocument: {
                    Statement: assertions_1.Match.arrayWith([
                        assertions_1.Match.objectLike({
                            Effect: 'Deny',
                            Principal: assertions_1.Match.anyValue(),
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
                BucketName: assertions_1.Match.stringLikeRegexp('fcc-invoices-test'),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiU3RvcmFnZVN0YWNrLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi90ZXN0L1N0b3JhZ2VTdGFjay50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsbUNBQW1DO0FBQ25DLHVEQUF5RDtBQUN6RCw2REFBMEQ7QUFFMUQ7Ozs7O0dBS0c7QUFFSCxTQUFTLGFBQWE7SUFDcEIsTUFBTSxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUM7SUFDMUIsTUFBTSxLQUFLLEdBQUcsSUFBSSwyQkFBWSxDQUFDLEdBQUcsRUFBRSxrQkFBa0IsRUFBRTtRQUN0RCxHQUFHLEVBQUUsRUFBRSxPQUFPLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxnQkFBZ0IsRUFBRTtRQUMxRCxPQUFPLEVBQUUsTUFBTTtLQUNoQixDQUFDLENBQUM7SUFDSCxNQUFNLFFBQVEsR0FBRyxxQkFBUSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUMzQyxPQUFPLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxDQUFDO0FBQzdCLENBQUM7QUFFRCxRQUFRLENBQUMsMkJBQTJCLEVBQUUsR0FBRyxFQUFFO0lBQ3pDLElBQUksQ0FBQyxvREFBb0QsRUFBRSxHQUFHLEVBQUU7UUFDOUQsTUFBTSxFQUFFLFFBQVEsRUFBRSxHQUFHLGFBQWEsRUFBRSxDQUFDO1FBQ3JDLFFBQVEsQ0FBQyxlQUFlLENBQUMsaUJBQWlCLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDakQsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFJLENBQUMsd0NBQXdDLEVBQUUsR0FBRyxFQUFFO1FBQ2xELE1BQU0sRUFBRSxRQUFRLEVBQUUsR0FBRyxhQUFhLEVBQUUsQ0FBQztRQUNyQyxNQUFNLE9BQU8sR0FBRyxRQUFRLENBQUMsYUFBYSxDQUFDLGlCQUFpQixFQUFFO1lBQ3hELFVBQVUsRUFBRTtnQkFDVixVQUFVLEVBQUUsa0JBQUssQ0FBQyxnQkFBZ0IsQ0FB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QUE0QyxFQUFFLEdBQUcsRUFBRTtRQUN0RCxNQUFNLEVBQUUsUUFBUSxFQUFFLEdBQUcsYUFBYSxFQUFFLENBQUM7UUFDckMsTUFBTSxPQUFPLEdBQUcsUUFBUSxDQUFDLGFBQWEsQ0FBQyxpQkFBaUIsRUFBRTtZQUN4RCxVQUFVLEVBQUU7Z0JBQ1YsVUFBVSxFQUFFLGtCQUFLLENBQUMsZ0JBQWdCLENBQUMsbUJBQW1CLENBQUM7YUFDeEQ7WUFDRCxjQUFjLEVBQUUsUUFBUTtTQUN6QixDQUFDLENBQUM7UUFDSCxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUMvQyxDQUFDLENBQUMsQ0FBQztJQUVILElBQUksQ0FBQyxvQ0FBb0MsRUFBRSxHQUFHLEVBQUU7UUFDOUMsTUFBTSxFQUFFLFFBQVEsRUFBRSxHQUFHLGFBQWEsRUFBRSxDQUFDO1FBQ3JDLE1BQU0sSUFBSSxHQUFHLFFBQVEsQ0FBQyxhQUFhLENBQUMsZUFBZSxFQUFFO1lBQ25ELGNBQWMsRUFBRSxRQUFRO1NBQ3pCLENBQUMsQ0FBQztRQUNILE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQzVDLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgVGVtcGxhdGUsIE1hdGNoIH0gZnJvbSAnYXdzLWNkay1saWIvYXNzZXJ0aW9ucyc7XG5pbXBvcnQgeyBTdG9yYWdlU3RhY2sgfSBmcm9tICcuLi9saWIvc3RhY2tzL1N0b3JhZ2VTdGFjayc7XG5cbi8qKlxuICogVW5pdCB0ZXN0cyBmb3IgU3RvcmFnZVN0YWNrLlxuICpcbiAqIFVzZXMgdGhlIENESyBhc3NlcnRpb25zIGxpYnJhcnkgdG8gdmFsaWRhdGUgQ2xvdWRGb3JtYXRpb24gdGVtcGxhdGUgb3V0cHV0XG4gKiB3aXRob3V0IGRlcGxveWluZyB0byBBV1MuXG4gKi9cblxuZnVuY3Rpb24gYnVpbGRUZW1wbGF0ZSgpOiB7IHN0YWNrOiBTdG9yYWdlU3RhY2s7IHRlbXBsYXRlOiBUZW1wbGF0ZSB9IHtcbiAgY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcbiAgY29uc3Qgc3RhY2sgPSBuZXcgU3RvcmFnZVN0YWNrKGFwcCwgJ1Rlc3RTdG9yYWdlU3RhY2snLCB7XG4gICAgZW52OiB7IGFjY291bnQ6ICcxMjM0NTY3ODkwMTInLCByZWdpb246ICdhcC1zb3V0aGVhc3QtMicgfSxcbiAgICBlbnZOYW1lOiAndGVzdCcsXG4gIH0pO1xuICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gIHJldHVybiB7IHN0YWNrLCB0ZW1wbGF0ZSB9O1xufVxuXG5kZXNjcmliZSgnU3RvcmFnZVN0YWNrIOKAlCBTMyBCdWNrZXRzJywgKCkgPT4ge1xuICB0ZXN0KCdjcmVhdGVzIGV4YWN0bHkgdHdvIFMzIGJ1Y2tldHMgKGludm9pY2VzICsgYXNzZXRzKScsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OlMzOjpCdWNrZXQnLCAyKTtcbiAgfSk7XG5cbiAgdGVzdCgnaW52b2ljZXMgYnVja2V0IGhhcyB2ZXJzaW9uaW5nIGVuYWJsZWQnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IGJ1Y2tldHMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OlMzOjpCdWNrZXQnLCB7XG4gICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgIEJ1Y2tldE5hbWU6IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJ2ZjYy1pbnZvaWNlcy10ZXN0JyksXG4gICAgICAgIFZlcnNpb25pbmdDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgU3RhdHVzOiAnRW5hYmxlZCcsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGV4cGVjdChPYmplY3Qua2V5cyhidWNrZXRzKSkudG9IYXZlTGVuZ3RoKDEpO1xuICB9KTtcblxuICB0ZXN0KCdpbnZvaWNlcyBidWNrZXQgaGFzIEtNUyBlbmNyeXB0aW9uJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6UzM6OkJ1Y2tldCcsIHtcbiAgICAgIEJ1Y2tldE5hbWU6IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJ2ZjYy1pbnZvaWNlcy10ZXN0JyksXG4gICAgICBCdWNrZXRFbmNyeXB0aW9uOiB7XG4gICAgICAgIFNlcnZlclNpZGVFbmNyeXB0aW9uQ29uZmlndXJhdGlvbjogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIFNlcnZlclNpZGVFbmNyeXB0aW9uQnlEZWZhdWx0OiB7XG4gICAgICAgICAgICAgIFNTRUFsZ29yaXRobTogJ2F3czprbXMnLFxuICAgICAgICAgICAgICBLTVNNYXN0ZXJLZXlJRDogTWF0Y2guYW55VmFsdWUoKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ2ludm9pY2VzIGJ1Y2tldCBoYXMgYmxvY2sgcHVibGljIGFjY2VzcyBlbmFibGVkJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6UzM6OkJ1Y2tldCcsIHtcbiAgICAgIEJ1Y2tldE5hbWU6IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJ2ZjYy1pbnZvaWNlcy10ZXN0JyksXG4gICAgICBQdWJsaWNBY2Nlc3NCbG9ja0NvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgQmxvY2tQdWJsaWNBY2xzOiB0cnVlLFxuICAgICAgICBCbG9ja1B1YmxpY1BvbGljeTogdHJ1ZSxcbiAgICAgICAgSWdub3JlUHVibGljQWNsczogdHJ1ZSxcbiAgICAgICAgUmVzdHJpY3RQdWJsaWNCdWNrZXRzOiB0cnVlLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnaW52b2ljZXMgYnVja2V0IGhhcyA5MC1kYXkgR2xhY2llciBsaWZlY3ljbGUgdHJhbnNpdGlvbicsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlMzOjpCdWNrZXQnLCB7XG4gICAgICBCdWNrZXROYW1lOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCdmY2MtaW52b2ljZXMtdGVzdCcpLFxuICAgICAgTGlmZWN5Y2xlQ29uZmlndXJhdGlvbjoge1xuICAgICAgICBSdWxlczogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgIFN0YXR1czogJ0VuYWJsZWQnLFxuICAgICAgICAgICAgVHJhbnNpdGlvbnM6IFtcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIFN0b3JhZ2VDbGFzczogJ0dMQUNJRVInLFxuICAgICAgICAgICAgICAgIFRyYW5zaXRpb25JbkRheXM6IDkwLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSksXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdhc3NldHMgYnVja2V0IGhhcyBzdGF0aWMgd2Vic2l0ZSBob3N0aW5nIGVuYWJsZWQnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpTMzo6QnVja2V0Jywge1xuICAgICAgQnVja2V0TmFtZTogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnZmNjLWFzc2V0cy10ZXN0JyksXG4gICAgICBXZWJzaXRlQ29uZmlndXJhdGlvbjoge1xuICAgICAgICBJbmRleERvY3VtZW50OiAnaW5kZXguaHRtbCcsXG4gICAgICAgIEVycm9yRG9jdW1lbnQ6ICdpbmRleC5odG1sJyxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ2Fzc2V0cyBidWNrZXQgaGFzIFMzLW1hbmFnZWQgZW5jcnlwdGlvbiAobm90IEtNUyknLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpTMzo6QnVja2V0Jywge1xuICAgICAgQnVja2V0TmFtZTogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnZmNjLWFzc2V0cy10ZXN0JyksXG4gICAgICBCdWNrZXRFbmNyeXB0aW9uOiB7XG4gICAgICAgIFNlcnZlclNpZGVFbmNyeXB0aW9uQ29uZmlndXJhdGlvbjogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIFNlcnZlclNpZGVFbmNyeXB0aW9uQnlEZWZhdWx0OiB7XG4gICAgICAgICAgICAgIFNTRUFsZ29yaXRobTogJ0FFUzI1NicsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdhc3NldHMgYnVja2V0IGhhcyBibG9jayBwdWJsaWMgYWNjZXNzIGVuYWJsZWQgKENsb3VkRnJvbnQgT0FJIHdpbGwgZ3JhbnQgcmVhZCknLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpTMzo6QnVja2V0Jywge1xuICAgICAgQnVja2V0TmFtZTogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnZmNjLWFzc2V0cy10ZXN0JyksXG4gICAgICBQdWJsaWNBY2Nlc3NCbG9ja0NvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgQmxvY2tQdWJsaWNBY2xzOiB0cnVlLFxuICAgICAgICBCbG9ja1B1YmxpY1BvbGljeTogdHJ1ZSxcbiAgICAgICAgSWdub3JlUHVibGljQWNsczogdHJ1ZSxcbiAgICAgICAgUmVzdHJpY3RQdWJsaWNCdWNrZXRzOiB0cnVlLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfSk7XG59KTtcblxuZGVzY3JpYmUoJ1N0b3JhZ2VTdGFjayDigJQgS01TIEtleScsICgpID0+IHtcbiAgdGVzdCgnY3JlYXRlcyBleGFjdGx5IG9uZSBLTVMga2V5IGZvciBpbnZvaWNlIGVuY3J5cHRpb24nLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpLTVM6OktleScsIDEpO1xuICB9KTtcblxuICB0ZXN0KCdLTVMga2V5IGhhcyBrZXkgcm90YXRpb24gZW5hYmxlZCcsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OktNUzo6S2V5Jywge1xuICAgICAgRW5hYmxlS2V5Um90YXRpb246IHRydWUsXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ0tNUyBrZXkgaGFzIGFuIGFsaWFzIGZvciBlYXN5IGlkZW50aWZpY2F0aW9uJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICBjb25zdCBhbGlhc2VzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpLTVM6OkFsaWFzJywge1xuICAgICAgUHJvcGVydGllczoge1xuICAgICAgICBBbGlhc05hbWU6IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJ2ZjYy1pbnZvaWNlcy10ZXN0JyksXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGV4cGVjdChPYmplY3Qua2V5cyhhbGlhc2VzKSkudG9IYXZlTGVuZ3RoKDEpO1xuICB9KTtcbn0pO1xuXG5kZXNjcmliZSgnU3RvcmFnZVN0YWNrIOKAlCBDbG91ZEZvcm1hdGlvbiBPdXRwdXRzJywgKCkgPT4ge1xuICBjb25zdCBleHBlY3RlZE91dHB1dHMgPSBbXG4gICAgJ0ludm9pY2VzQnVja2V0TmFtZScsXG4gICAgJ0ludm9pY2VzQnVja2V0QXJuJyxcbiAgICAnSW52b2ljZXNLbXNLZXlJZCcsXG4gICAgJ0ludm9pY2VzS21zS2V5QXJuJyxcbiAgICAnQXNzZXRzQnVja2V0TmFtZScsXG4gICAgJ0Fzc2V0c0J1Y2tldEFybicsXG4gICAgJ0Fzc2V0c0J1Y2tldFdlYnNpdGVVcmwnLFxuICBdO1xuXG4gIHRlc3QuZWFjaChleHBlY3RlZE91dHB1dHMpKCdleHBvcnRzICVzJywgKG91dHB1dEtleSkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICBjb25zdCBvdXRwdXRzID0gdGVtcGxhdGUuZmluZE91dHB1dHMob3V0cHV0S2V5KTtcbiAgICBleHBlY3QoT2JqZWN0LmtleXMob3V0cHV0cykpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgfSk7XG5cbiAgdGVzdCgnYWxsIG91dHB1dHMgaGF2ZSBleHBvcnQgbmFtZXMgZm9yIGNyb3NzLXN0YWNrIHJlZmVyZW5jaW5nJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICBjb25zdCBjZm5UZW1wbGF0ZSA9IHRlbXBsYXRlLnRvSlNPTigpO1xuICAgIGNvbnN0IG91dHB1dHMgPSBjZm5UZW1wbGF0ZS5PdXRwdXRzID8/IHt9O1xuICAgIGZvciAoY29uc3QgW2tleSwgb3V0cHV0XSBvZiBPYmplY3QuZW50cmllczxhbnk+KG91dHB1dHMpKSB7XG4gICAgICBleHBlY3Qob3V0cHV0LkV4cG9ydD8uTmFtZSkudG9CZURlZmluZWQoKTtcbiAgICAgIC8vIEV4cG9ydCBuYW1lIHNob3VsZCBpbmNsdWRlIHRoZSBlbnZpcm9ubWVudCBuYW1lLlxuICAgICAgZXhwZWN0KG91dHB1dC5FeHBvcnQuTmFtZSkudG9NYXRjaCgvdGVzdC8pO1xuICAgIH1cbiAgfSk7XG59KTtcblxuZGVzY3JpYmUoJ1N0b3JhZ2VTdGFjayDigJQgU2VjdXJpdHkgYW5kIENvbXBsaWFuY2UnLCAoKSA9PiB7XG4gIHRlc3QoJ2ludm9pY2VzIGJ1Y2tldCBlbmZvcmNlcyBTU0wvVExTIChIVFRQUy1vbmx5KScsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgLy8gQ0RLIGVuZm9yY2VzIFNTTCBieSBhZGRpbmcgYSBidWNrZXQgcG9saWN5IHdpdGggYXdzOlNlY3VyZVRyYW5zcG9ydCBjb25kaXRpb24uXG4gICAgY29uc3QgYnVja2V0UG9saWNpZXMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OlMzOjpCdWNrZXRQb2xpY3knLCB7XG4gICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgIEJ1Y2tldDogTWF0Y2guYW55VmFsdWUoKSxcbiAgICAgICAgUG9saWN5RG9jdW1lbnQ6IHtcbiAgICAgICAgICBTdGF0ZW1lbnQ6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgICAgRWZmZWN0OiAnRGVueScsXG4gICAgICAgICAgICAgIFByaW5jaXBhbDogTWF0Y2guYW55VmFsdWUoKSxcbiAgICAgICAgICAgICAgQWN0aW9uOiAnczM6KicsXG4gICAgICAgICAgICAgIENvbmRpdGlvbjoge1xuICAgICAgICAgICAgICAgIEJvb2w6IHtcbiAgICAgICAgICAgICAgICAgICdhd3M6U2VjdXJlVHJhbnNwb3J0JzogJ2ZhbHNlJyxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgXSksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGV4cGVjdChPYmplY3Qua2V5cyhidWNrZXRQb2xpY2llcykubGVuZ3RoKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDEpO1xuICB9KTtcblxuICB0ZXN0KCdpbnZvaWNlcyBidWNrZXQgaGFzIGRlbGV0aW9uIHBvbGljeSBSRVRBSU4nLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IGJ1Y2tldHMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OlMzOjpCdWNrZXQnLCB7XG4gICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgIEJ1Y2tldE5hbWU6IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJ2ZjYy1pbnZvaWNlcy10ZXN0JyksXG4gICAgICB9LFxuICAgICAgRGVsZXRpb25Qb2xpY3k6ICdSZXRhaW4nLFxuICAgIH0pO1xuICAgIGV4cGVjdChPYmplY3Qua2V5cyhidWNrZXRzKSkudG9IYXZlTGVuZ3RoKDEpO1xuICB9KTtcblxuICB0ZXN0KCdLTVMga2V5IGhhcyBkZWxldGlvbiBwb2xpY3kgUkVUQUlOJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICBjb25zdCBrZXlzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpLTVM6OktleScsIHtcbiAgICAgIERlbGV0aW9uUG9saWN5OiAnUmV0YWluJyxcbiAgICB9KTtcbiAgICBleHBlY3QoT2JqZWN0LmtleXMoa2V5cykpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgfSk7XG59KTtcbiJdfQ==