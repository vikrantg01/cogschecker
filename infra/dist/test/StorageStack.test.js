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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiU3RvcmFnZVN0YWNrLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi90ZXN0L1N0b3JhZ2VTdGFjay50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsbUNBQW1DO0FBQ25DLHVEQUF5RDtBQUN6RCw2REFBMEQ7QUFFMUQ7Ozs7O0dBS0c7QUFFSCxTQUFTLGFBQWE7SUFDcEIsTUFBTSxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUM7SUFDMUIsTUFBTSxLQUFLLEdBQUcsSUFBSSwyQkFBWSxDQUFDLEdBQUcsRUFBRSxrQkFBa0IsRUFBRTtRQUN0RCxHQUFHLEVBQUUsRUFBRSxPQUFPLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxnQkFBZ0IsRUFBRTtLQUMzRCxDQUFDLENBQUM7SUFDSCxNQUFNLFFBQVEsR0FBRyxxQkFBUSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUMzQyxPQUFPLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxDQUFDO0FBQzdCLENBQUM7QUFFRCxRQUFRLENBQUMsMkJBQTJCLEVBQUUsR0FBRyxFQUFFO0lBQ3pDLElBQUksQ0FBQyxvREFBb0QsRUFBRSxHQUFHLEVBQUU7UUFDOUQsTUFBTSxFQUFFLFFBQVEsRUFBRSxHQUFHLGFBQWEsRUFBRSxDQUFDO1FBQ3JDLFFBQVEsQ0FBQyxlQUFlLENBQUMsaUJBQWlCLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDakQsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFJLENBQUMsd0NBQXdDLEVBQUUsR0FBRyxFQUFFO1FBQ2xELE1BQU0sRUFBRSxRQUFRLEVBQUUsR0FBRyxhQUFhLEVBQUUsQ0FBQztRQUNyQyxNQUFNLE9BQU8sR0FBRyxRQUFRLENBQUMsYUFBYSxDQUFDLGlCQUFpQixFQUFFO1lBQ3hELFVBQVUsRUFBRTtnQkFDVixVQUFVLEVBQUUsa0JBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxtQkFBbUIsQ0FBQztnQkFDdkQs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QUN0RCxNQUFNLEVBQUUsUUFBUSxFQUFFLEdBQUcsYUFBYSxFQUFFLENBQUM7UUFDckMsTUFBTSxPQUFPLEdBQUcsUUFBUSxDQUFDLGFBQWEsQ0FBQyxpQkFBaUIsRUFBRTtZQUN4RCxVQUFVLEVBQUU7Z0JBQ1YsVUFBVSxFQUFFLGtCQUFLLENBQUMsZ0JBQWdCLENBQUMsbUJBQW1CLENBQUM7YUFDeEQ7WUFDRCxjQUFjLEVBQUUsUUFBUTtTQUN6QixDQUFDLENBQUM7UUFDSCxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUMvQyxDQUFDLENBQUMsQ0FBQztJQUVILElBQUksQ0FBQyxvQ0FBb0MsRUFBRSxHQUFHLEVBQUU7UUFDOUMsTUFBTSxFQUFFLFFBQVEsRUFBRSxHQUFHLGFBQWEsRUFBRSxDQUFDO1FBQ3JDLE1BQU0sSUFBSSxHQUFHLFFBQVEsQ0FBQyxhQUFhLENBQUMsZUFBZSxFQUFFO1lBQ25ELGNBQWMsRUFBRSxRQUFRO1NBQ3pCLENBQUMsQ0FBQztRQUNILE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQzVDLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgVGVtcGxhdGUsIE1hdGNoIH0gZnJvbSAnYXdzLWNkay1saWIvYXNzZXJ0aW9ucyc7XG5pbXBvcnQgeyBTdG9yYWdlU3RhY2sgfSBmcm9tICcuLi9saWIvc3RhY2tzL1N0b3JhZ2VTdGFjayc7XG5cbi8qKlxuICogVW5pdCB0ZXN0cyBmb3IgU3RvcmFnZVN0YWNrLlxuICpcbiAqIFVzZXMgdGhlIENESyBhc3NlcnRpb25zIGxpYnJhcnkgdG8gdmFsaWRhdGUgQ2xvdWRGb3JtYXRpb24gdGVtcGxhdGUgb3V0cHV0XG4gKiB3aXRob3V0IGRlcGxveWluZyB0byBBV1MuXG4gKi9cblxuZnVuY3Rpb24gYnVpbGRUZW1wbGF0ZSgpOiB7IHN0YWNrOiBTdG9yYWdlU3RhY2s7IHRlbXBsYXRlOiBUZW1wbGF0ZSB9IHtcbiAgY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcbiAgY29uc3Qgc3RhY2sgPSBuZXcgU3RvcmFnZVN0YWNrKGFwcCwgJ1Rlc3RTdG9yYWdlU3RhY2snLCB7XG4gICAgZW52OiB7IGFjY291bnQ6ICcxMjM0NTY3ODkwMTInLCByZWdpb246ICdhcC1zb3V0aGVhc3QtMicgfSxcbiAgfSk7XG4gIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgcmV0dXJuIHsgc3RhY2ssIHRlbXBsYXRlIH07XG59XG5cbmRlc2NyaWJlKCdTdG9yYWdlU3RhY2sg4oCUIFMzIEJ1Y2tldHMnLCAoKSA9PiB7XG4gIHRlc3QoJ2NyZWF0ZXMgZXhhY3RseSB0d28gUzMgYnVja2V0cyAoaW52b2ljZXMgKyBhc3NldHMpJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6UzM6OkJ1Y2tldCcsIDIpO1xuICB9KTtcblxuICB0ZXN0KCdpbnZvaWNlcyBidWNrZXQgaGFzIHZlcnNpb25pbmcgZW5hYmxlZCcsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgY29uc3QgYnVja2V0cyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6UzM6OkJ1Y2tldCcsIHtcbiAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgQnVja2V0TmFtZTogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnZmNjLWludm9pY2VzLXRlc3QnKSxcbiAgICAgICAgVmVyc2lvbmluZ0NvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICBTdGF0dXM6ICdFbmFibGVkJyxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgZXhwZWN0KE9iamVjdC5rZXlzKGJ1Y2tldHMpKS50b0hhdmVMZW5ndGgoMSk7XG4gIH0pO1xuXG4gIHRlc3QoJ2ludm9pY2VzIGJ1Y2tldCBoYXMgS01TIGVuY3J5cHRpb24nLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpTMzo6QnVja2V0Jywge1xuICAgICAgQnVja2V0TmFtZTogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnZmNjLWludm9pY2VzLXRlc3QnKSxcbiAgICAgIEJ1Y2tldEVuY3J5cHRpb246IHtcbiAgICAgICAgU2VydmVyU2lkZUVuY3J5cHRpb25Db25maWd1cmF0aW9uOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgU2VydmVyU2lkZUVuY3J5cHRpb25CeURlZmF1bHQ6IHtcbiAgICAgICAgICAgICAgU1NFQWxnb3JpdGhtOiAnYXdzOmttcycsXG4gICAgICAgICAgICAgIEtNU01hc3RlcktleUlEOiBNYXRjaC5hbnlWYWx1ZSgpLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnaW52b2ljZXMgYnVja2V0IGhhcyBibG9jayBwdWJsaWMgYWNjZXNzIGVuYWJsZWQnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpTMzo6QnVja2V0Jywge1xuICAgICAgQnVja2V0TmFtZTogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnZmNjLWludm9pY2VzLXRlc3QnKSxcbiAgICAgIFB1YmxpY0FjY2Vzc0Jsb2NrQ29uZmlndXJhdGlvbjoge1xuICAgICAgICBCbG9ja1B1YmxpY0FjbHM6IHRydWUsXG4gICAgICAgIEJsb2NrUHVibGljUG9saWN5OiB0cnVlLFxuICAgICAgICBJZ25vcmVQdWJsaWNBY2xzOiB0cnVlLFxuICAgICAgICBSZXN0cmljdFB1YmxpY0J1Y2tldHM6IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdpbnZvaWNlcyBidWNrZXQgaGFzIDkwLWRheSBHbGFjaWVyIGxpZmVjeWNsZSB0cmFuc2l0aW9uJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6UzM6OkJ1Y2tldCcsIHtcbiAgICAgIEJ1Y2tldE5hbWU6IE1hdGNoLnN0cmluZ0xpa2VSZWdleHAoJ2ZjYy1pbnZvaWNlcy10ZXN0JyksXG4gICAgICBMaWZlY3ljbGVDb25maWd1cmF0aW9uOiB7XG4gICAgICAgIFJ1bGVzOiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgU3RhdHVzOiAnRW5hYmxlZCcsXG4gICAgICAgICAgICBUcmFuc2l0aW9uczogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgU3RvcmFnZUNsYXNzOiAnR0xBQ0lFUicsXG4gICAgICAgICAgICAgICAgVHJhbnNpdGlvbkluRGF5czogOTAsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdKSxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ2Fzc2V0cyBidWNrZXQgaGFzIHN0YXRpYyB3ZWJzaXRlIGhvc3RpbmcgZW5hYmxlZCcsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlMzOjpCdWNrZXQnLCB7XG4gICAgICBCdWNrZXROYW1lOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCdmY2MtYXNzZXRzLXRlc3QnKSxcbiAgICAgIFdlYnNpdGVDb25maWd1cmF0aW9uOiB7XG4gICAgICAgIEluZGV4RG9jdW1lbnQ6ICdpbmRleC5odG1sJyxcbiAgICAgICAgRXJyb3JEb2N1bWVudDogJ2luZGV4Lmh0bWwnLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnYXNzZXRzIGJ1Y2tldCBoYXMgUzMtbWFuYWdlZCBlbmNyeXB0aW9uIChub3QgS01TKScsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlMzOjpCdWNrZXQnLCB7XG4gICAgICBCdWNrZXROYW1lOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCdmY2MtYXNzZXRzLXRlc3QnKSxcbiAgICAgIEJ1Y2tldEVuY3J5cHRpb246IHtcbiAgICAgICAgU2VydmVyU2lkZUVuY3J5cHRpb25Db25maWd1cmF0aW9uOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgU2VydmVyU2lkZUVuY3J5cHRpb25CeURlZmF1bHQ6IHtcbiAgICAgICAgICAgICAgU1NFQWxnb3JpdGhtOiAnQUVTMjU2JyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ2Fzc2V0cyBidWNrZXQgaGFzIGJsb2NrIHB1YmxpYyBhY2Nlc3MgZW5hYmxlZCAoQ2xvdWRGcm9udCBPQUkgd2lsbCBncmFudCByZWFkKScsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlMzOjpCdWNrZXQnLCB7XG4gICAgICBCdWNrZXROYW1lOiBNYXRjaC5zdHJpbmdMaWtlUmVnZXhwKCdmY2MtYXNzZXRzLXRlc3QnKSxcbiAgICAgIFB1YmxpY0FjY2Vzc0Jsb2NrQ29uZmlndXJhdGlvbjoge1xuICAgICAgICBCbG9ja1B1YmxpY0FjbHM6IHRydWUsXG4gICAgICAgIEJsb2NrUHVibGljUG9saWN5OiB0cnVlLFxuICAgICAgICBJZ25vcmVQdWJsaWNBY2xzOiB0cnVlLFxuICAgICAgICBSZXN0cmljdFB1YmxpY0J1Y2tldHM6IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcbn0pO1xuXG5kZXNjcmliZSgnU3RvcmFnZVN0YWNrIOKAlCBLTVMgS2V5JywgKCkgPT4ge1xuICB0ZXN0KCdjcmVhdGVzIGV4YWN0bHkgb25lIEtNUyBrZXkgZm9yIGludm9pY2UgZW5jcnlwdGlvbicsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OktNUzo6S2V5JywgMSk7XG4gIH0pO1xuXG4gIHRlc3QoJ0tNUyBrZXkgaGFzIGtleSByb3RhdGlvbiBlbmFibGVkJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6S01TOjpLZXknLCB7XG4gICAgICBFbmFibGVLZXlSb3RhdGlvbjogdHJ1ZSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnS01TIGtleSBoYXMgYW4gYWxpYXMgZm9yIGVhc3kgaWRlbnRpZmljYXRpb24nLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IGFsaWFzZXMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OktNUzo6QWxpYXMnLCB7XG4gICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgIEFsaWFzTmFtZTogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnZmNjLWludm9pY2VzLXRlc3QnKSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgZXhwZWN0KE9iamVjdC5rZXlzKGFsaWFzZXMpKS50b0hhdmVMZW5ndGgoMSk7XG4gIH0pO1xufSk7XG5cbmRlc2NyaWJlKCdTdG9yYWdlU3RhY2sg4oCUIENsb3VkRm9ybWF0aW9uIE91dHB1dHMnLCAoKSA9PiB7XG4gIGNvbnN0IGV4cGVjdGVkT3V0cHV0cyA9IFtcbiAgICAnSW52b2ljZXNCdWNrZXROYW1lJyxcbiAgICAnSW52b2ljZXNCdWNrZXRBcm4nLFxuICAgICdJbnZvaWNlc0ttc0tleUlkJyxcbiAgICAnSW52b2ljZXNLbXNLZXlBcm4nLFxuICAgICdBc3NldHNCdWNrZXROYW1lJyxcbiAgICAnQXNzZXRzQnVja2V0QXJuJyxcbiAgICAnQXNzZXRzQnVja2V0V2Vic2l0ZVVybCcsXG4gIF07XG5cbiAgdGVzdC5lYWNoKGV4cGVjdGVkT3V0cHV0cykoJ2V4cG9ydHMgJXMnLCAob3V0cHV0S2V5KSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IG91dHB1dHMgPSB0ZW1wbGF0ZS5maW5kT3V0cHV0cyhvdXRwdXRLZXkpO1xuICAgIGV4cGVjdChPYmplY3Qua2V5cyhvdXRwdXRzKSkudG9IYXZlTGVuZ3RoKDEpO1xuICB9KTtcblxuICB0ZXN0KCdhbGwgb3V0cHV0cyBoYXZlIGV4cG9ydCBuYW1lcyBmb3IgY3Jvc3Mtc3RhY2sgcmVmZXJlbmNpbmcnLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IGNmblRlbXBsYXRlID0gdGVtcGxhdGUudG9KU09OKCk7XG4gICAgY29uc3Qgb3V0cHV0cyA9IGNmblRlbXBsYXRlLk91dHB1dHMgPz8ge307XG4gICAgZm9yIChjb25zdCBba2V5LCBvdXRwdXRdIG9mIE9iamVjdC5lbnRyaWVzPGFueT4ob3V0cHV0cykpIHtcbiAgICAgIGV4cGVjdChvdXRwdXQuRXhwb3J0Py5OYW1lKS50b0JlRGVmaW5lZCgpO1xuICAgICAgLy8gRXhwb3J0IG5hbWUgc2hvdWxkIGluY2x1ZGUgdGhlIGVudmlyb25tZW50IG5hbWUuXG4gICAgICBleHBlY3Qob3V0cHV0LkV4cG9ydC5OYW1lKS50b01hdGNoKC90ZXN0Lyk7XG4gICAgfVxuICB9KTtcbn0pO1xuXG5kZXNjcmliZSgnU3RvcmFnZVN0YWNrIOKAlCBTZWN1cml0eSBhbmQgQ29tcGxpYW5jZScsICgpID0+IHtcbiAgdGVzdCgnaW52b2ljZXMgYnVja2V0IGVuZm9yY2VzIFNTTC9UTFMgKEhUVFBTLW9ubHkpJywgKCkgPT4ge1xuICAgIGNvbnN0IHsgdGVtcGxhdGUgfSA9IGJ1aWxkVGVtcGxhdGUoKTtcbiAgICAvLyBDREsgZW5mb3JjZXMgU1NMIGJ5IGFkZGluZyBhIGJ1Y2tldCBwb2xpY3kgd2l0aCBhd3M6U2VjdXJlVHJhbnNwb3J0IGNvbmRpdGlvbi5cbiAgICBjb25zdCBidWNrZXRQb2xpY2llcyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6UzM6OkJ1Y2tldFBvbGljeScsIHtcbiAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgQnVja2V0OiBNYXRjaC5hbnlWYWx1ZSgpLFxuICAgICAgICBQb2xpY3lEb2N1bWVudDoge1xuICAgICAgICAgIFN0YXRlbWVudDogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgICBFZmZlY3Q6ICdEZW55JyxcbiAgICAgICAgICAgICAgUHJpbmNpcGFsOiBNYXRjaC5hbnlWYWx1ZSgpLFxuICAgICAgICAgICAgICBBY3Rpb246ICdzMzoqJyxcbiAgICAgICAgICAgICAgQ29uZGl0aW9uOiB7XG4gICAgICAgICAgICAgICAgQm9vbDoge1xuICAgICAgICAgICAgICAgICAgJ2F3czpTZWN1cmVUcmFuc3BvcnQnOiAnZmFsc2UnLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICBdKSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgZXhwZWN0KE9iamVjdC5rZXlzKGJ1Y2tldFBvbGljaWVzKS5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMSk7XG4gIH0pO1xuXG4gIHRlc3QoJ2ludm9pY2VzIGJ1Y2tldCBoYXMgZGVsZXRpb24gcG9saWN5IFJFVEFJTicsICgpID0+IHtcbiAgICBjb25zdCB7IHRlbXBsYXRlIH0gPSBidWlsZFRlbXBsYXRlKCk7XG4gICAgY29uc3QgYnVja2V0cyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6UzM6OkJ1Y2tldCcsIHtcbiAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgQnVja2V0TmFtZTogTWF0Y2guc3RyaW5nTGlrZVJlZ2V4cCgnZmNjLWludm9pY2VzLXRlc3QnKSxcbiAgICAgIH0sXG4gICAgICBEZWxldGlvblBvbGljeTogJ1JldGFpbicsXG4gICAgfSk7XG4gICAgZXhwZWN0KE9iamVjdC5rZXlzKGJ1Y2tldHMpKS50b0hhdmVMZW5ndGgoMSk7XG4gIH0pO1xuXG4gIHRlc3QoJ0tNUyBrZXkgaGFzIGRlbGV0aW9uIHBvbGljeSBSRVRBSU4nLCAoKSA9PiB7XG4gICAgY29uc3QgeyB0ZW1wbGF0ZSB9ID0gYnVpbGRUZW1wbGF0ZSgpO1xuICAgIGNvbnN0IGtleXMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OktNUzo6S2V5Jywge1xuICAgICAgRGVsZXRpb25Qb2xpY3k6ICdSZXRhaW4nLFxuICAgIH0pO1xuICAgIGV4cGVjdChPYmplY3Qua2V5cyhrZXlzKSkudG9IYXZlTGVuZ3RoKDEpO1xuICB9KTtcbn0pO1xuIl19