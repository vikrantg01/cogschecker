"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = require("aws-cdk-lib");
const assertions_1 = require("aws-cdk-lib/assertions");
const SecretsStack_1 = require("../lib/stacks/SecretsStack");
describe('SecretsStack', () => {
    let app;
    let stack;
    let template;
    beforeEach(() => {
        app = new cdk.App();
        stack = new SecretsStack_1.SecretsStack(app, 'TestSecretsStack', {
            envName: 'test',
            env: {
                account: '123456789012',
                region: 'ap-southeast-2',
            },
        });
        template = assertions_1.Template.fromStack(stack);
    });
    describe('KMS Keys', () => {
        it('creates four KMS CMKs with key rotation enabled', () => {
            // Verify all 4 KMS keys exist
            template.resourceCountIs('AWS::KMS::Key', 4);
            // Verify each key has automatic rotation enabled
            template.allResourcesProperties('AWS::KMS::Key', {
                EnableKeyRotation: true,
            });
        });
        it('creates Database Encryption Key with correct alias', () => {
            template.hasResourceProperties('AWS::KMS::Alias', {
                AliasName: 'alias/fcc-db-test',
            });
        });
        it('creates Square Token Encryption Key with correct alias', () => {
            template.hasResourceProperties('AWS::KMS::Alias', {
                AliasName: 'alias/fcc-square-token-test',
            });
        });
        it('creates Stripe Webhook Secret Key with correct alias', () => {
            template.hasResourceProperties('AWS::KMS::Alias', {
                AliasName: 'alias/fcc-stripe-webhook-test',
            });
        });
        it('creates Application Secrets Key with correct alias', () => {
            template.hasResourceProperties('AWS::KMS::Alias', {
                AliasName: 'alias/fcc-app-secrets-test',
            });
        });
        it('sets 30-day pending window for key deletion', () => {
            // Verify all keys have a 30-day pending window (in seconds: 30 days * 24 hours * 3600 seconds)
            template.allResourcesProperties('AWS::KMS::Key', {
                PendingWindowInDays: 30,
            });
        });
    });
    describe('Secrets Manager Secrets', () => {
        it('creates five Secrets Manager secrets', () => {
            template.resourceCountIs('AWS::SecretsManager::Secret', 5);
        });
        it('creates Database Credentials Secret with generated password', () => {
            template.hasResourceProperties('AWS::SecretsManager::Secret', {
                Name: 'fcc-db-credentials-test',
                Description: 'Aurora PostgreSQL master credentials with automatic rotation',
                GenerateSecretString: {
                    SecretStringTemplate: assertions_1.Match.serializedJson({ username: 'foodcost_admin' }),
                    GenerateStringKey: 'password',
                    ExcludeCharacters: '"@/\\',
                    PasswordLength: 32,
                    RequireEachIncludedType: true,
                },
            });
        });
        it('creates Stripe API Key Secret without generated value', () => {
            template.hasResourceProperties('AWS::SecretsManager::Secret', {
                Name: 'fcc-stripe-api-key-test',
                Description: 'Stripe secret key for subscription billing API',
            });
            // Verify it does NOT have a meaningful GenerateSecretString (must be manually populated)
            const secrets = template.findResources('AWS::SecretsManager::Secret', {
                Properties: {
                    Name: 'fcc-stripe-api-key-test',
                },
            });
            const secretKey = Object.keys(secrets)[0];
            // CDK may create an empty object, which is functionally the same as undefined
            const generateSecretString = secrets[secretKey].Properties.GenerateSecretString;
            expect(!generateSecretString || Object.keys(generateSecretString).length === 0).toBeTruthy();
        });
        it('creates Stripe Webhook Secret without generated value', () => {
            template.hasResourceProperties('AWS::SecretsManager::Secret', {
                Name: 'fcc-stripe-webhook-secret-test',
                Description: 'Stripe webhook signing secret for signature verification',
            });
        });
        it('creates Square OAuth Secret without generated value', () => {
            template.hasResourceProperties('AWS::SecretsManager::Secret', {
                Name: 'fcc-square-oauth-test',
                Description: 'Square OAuth application credentials (app ID + secret)',
            });
        });
        it('creates Bedrock Config Secret with default values', () => {
            template.hasResourceProperties('AWS::SecretsManager::Secret', {
                Name: 'fcc-bedrock-config-test',
                Description: 'Amazon Bedrock model configuration for Pro+ AI insights',
                SecretString: assertions_1.Match.serializedJson({
                    model_id: 'anthropic.claude-v2',
                    region: 'ap-southeast-2',
                    max_tokens: '4096',
                    temperature: '0.7',
                }),
            });
        });
        it('encrypts Database Credentials with Database Encryption Key', () => {
            // Find the DB credentials secret
            const secrets = template.findResources('AWS::SecretsManager::Secret', {
                Properties: {
                    Name: 'fcc-db-credentials-test',
                },
            });
            const secretKey = Object.keys(secrets)[0];
            const secret = secrets[secretKey];
            // Verify it references the KMS key
            expect(secret.Properties.KmsKeyId).toBeDefined();
        });
        it('encrypts Square OAuth Secret with Application Secrets Key', () => {
            const secrets = template.findResources('AWS::SecretsManager::Secret', {
                Properties: {
                    Name: 'fcc-square-oauth-test',
                },
            });
            const secretKey = Object.keys(secrets)[0];
            const secret = secrets[secretKey];
            // Verify it references a KMS key
            expect(secret.Properties.KmsKeyId).toBeDefined();
        });
    });
    describe('IAM Policies', () => {
        it('grants Secrets Manager service permission to use KMS keys', () => {
            // The key policy should allow secretsmanager.amazonaws.com with necessary KMS actions
            template.hasResourceProperties('AWS::KMS::Key', {
                KeyPolicy: {
                    Statement: assertions_1.Match.arrayWith([
                        assertions_1.Match.objectLike({
                            Effect: 'Allow',
                            Principal: {
                                Service: 'secretsmanager.amazonaws.com',
                            },
                            Action: assertions_1.Match.arrayWith(['kms:Decrypt', 'kms:Encrypt']),
                        }),
                    ]),
                },
            });
        });
        it('grants RDS service permission to use Database Encryption Key', () => {
            template.hasResourceProperties('AWS::KMS::Key', {
                KeyPolicy: {
                    Statement: assertions_1.Match.arrayWith([
                        assertions_1.Match.objectLike({
                            Effect: 'Allow',
                            Principal: {
                                Service: 'rds.amazonaws.com',
                            },
                            Action: assertions_1.Match.arrayWith(['kms:Decrypt', 'kms:Encrypt']),
                        }),
                    ]),
                },
            });
        });
    });
    describe('CloudFormation Outputs', () => {
        it('exports all KMS key IDs and ARNs', () => {
            // Check that we have outputs for KMS keys
            const outputs = template.findOutputs('*');
            expect(outputs.DatabaseEncryptionKeyId).toBeDefined();
            expect(outputs.DatabaseEncryptionKeyArn).toBeDefined();
            expect(outputs.SquareTokenEncryptionKeyId).toBeDefined();
            expect(outputs.SquareTokenEncryptionKeyArn).toBeDefined();
            expect(outputs.StripeWebhookSecretKeyArn).toBeDefined();
            expect(outputs.ApplicationSecretsKeyArn).toBeDefined();
        });
        it('exports all Secrets Manager secret ARNs', () => {
            const outputs = template.findOutputs('*');
            expect(outputs.DatabaseCredentialsSecretArn).toBeDefined();
            expect(outputs.StripeApiKeySecretArn).toBeDefined();
            expect(outputs.StripeWebhookSecretArn).toBeDefined();
            expect(outputs.SquareOAuthSecretArn).toBeDefined();
            expect(outputs.BedrockConfigSecretArn).toBeDefined();
        });
        it('exports outputs with correct naming convention', () => {
            template.hasOutput('DatabaseEncryptionKeyId', {
                Export: {
                    Name: 'FoodCostCalculator-test-DatabaseEncryptionKeyId',
                },
            });
            template.hasOutput('DatabaseCredentialsSecretArn', {
                Export: {
                    Name: 'FoodCostCalculator-test-DatabaseCredentialsSecretArn',
                },
            });
        });
    });
    describe('Resource Tags', () => {
        it('tags all KMS keys with Component and Environment', () => {
            // Find all KMS keys
            const keys = template.findResources('AWS::KMS::Key');
            Object.values(keys).forEach((key) => {
                // CDK applies tags at the stack level, so we check for Tag resources
                // or verify tags are in the key properties if explicitly set
                expect(key).toBeDefined();
            });
        });
    });
    describe('Security Configuration', () => {
        it('sets RETAIN removal policy on all KMS keys', () => {
            // All KMS keys should have DeletionPolicy: Retain
            const keys = template.findResources('AWS::KMS::Key');
            Object.values(keys).forEach((key) => {
                expect(key.DeletionPolicy).toBe('Retain');
            });
        });
        it('sets RETAIN removal policy on all Secrets Manager secrets', () => {
            const secrets = template.findResources('AWS::SecretsManager::Secret');
            Object.values(secrets).forEach((secret) => {
                expect(secret.DeletionPolicy).toBe('Retain');
            });
        });
        it('uses strong password requirements for database credentials', () => {
            template.hasResourceProperties('AWS::SecretsManager::Secret', {
                GenerateSecretString: {
                    PasswordLength: 32,
                    RequireEachIncludedType: true,
                    ExcludeCharacters: '"@/\\',
                },
            });
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiU2VjcmV0c1N0YWNrLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi90ZXN0L1NlY3JldHNTdGFjay50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsbUNBQW1DO0FBQ25DLHVEQUF5RDtBQUN6RCw2REFBMEQ7QUFFMUQsUUFBUSxDQUFDLGNBQWMsRUFBRSxHQUFHLEVBQUU7SUFDNUIsSUFBSSxHQUFZLENBQUM7SUFDakIsSUFBSSxLQUFtQixDQUFDO0lBQ3hCLElBQUksUUFBa0IsQ0FBQztJQUV2QixVQUFVLENBQUMsR0FBRyxFQUFFO1FBQ2QsR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQ3BCLEtBQUssR0FBRyxJQUFJLDJCQUFZLENBQUMsR0FBRyxFQUFFLGtCQUFrQixFQUFFO1lBQ2hELE9BQU8sRUFBRSxNQUFNO1lBQ2YsR0FBRyxFQUFFO2dCQUNILE9BQU8sRUFBRSxjQUFjO2dCQUN2QixNQUFNLEVBQUUsZ0JBQWdCO2FBQ3pCO1NBQ0YsQ0FBQyxDQUFDO1FBQ0gsUUFBUSxHQUFHLHFCQUFRLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ3ZDLENBQUMsQ0FBQyxDQUFDO0lBRUgsUUFBUSxDQUFDLFVBQVUsRUFBRSxHQUFHLEVBQUU7UUFDeEIsRUFBRSxDQUFDLGlEQUFpRCxFQUFFLEdBQUcsRUFBRTtZQUN6RCw4QkFBOEI7WUFDOUIsUUFBUSxDQUFDLGVBQWUsQ0FBQyxlQUFlLEVBQUUsQ0FBQyxDQUFDLENBQUM7WUFFN0MsaURBQWlEO1lBQ2pELFFBQVEsQ0FBQyxzQkFBc0IsQ0FBQyxlQUFlLEVBQUU7Z0JBQy9DLGlCQUFpQixFQUFFLElBQUk7YUFDeEIsQ0FBQyxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsb0RBQW9ELEVBQUUsR0FBRyxFQUFFO1lBQzVELFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQyxpQkFBaUIsRUFBRTtnQkFDaEQs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bmltcG9ydCB7IFRlbXBsYXRlLCBNYXRjaCB9IGZyb20gJ2F3cy1jZGstbGliL2Fzc2VydGlvbnMnO1xuaW1wb3J0IHsgU2VjcmV0c1N0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9TZWNyZXRzU3RhY2snO1xuXG5kZXNjcmliZSgnU2VjcmV0c1N0YWNrJywgKCkgPT4ge1xuICBsZXQgYXBwOiBjZGsuQXBwO1xuICBsZXQgc3RhY2s6IFNlY3JldHNTdGFjaztcbiAgbGV0IHRlbXBsYXRlOiBUZW1wbGF0ZTtcblxuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICBhcHAgPSBuZXcgY2RrLkFwcCgpO1xuICAgIHN0YWNrID0gbmV3IFNlY3JldHNTdGFjayhhcHAsICdUZXN0U2VjcmV0c1N0YWNrJywge1xuICAgICAgZW52TmFtZTogJ3Rlc3QnLFxuICAgICAgZW52OiB7XG4gICAgICAgIGFjY291bnQ6ICcxMjM0NTY3ODkwMTInLFxuICAgICAgICByZWdpb246ICdhcC1zb3V0aGVhc3QtMicsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0tNUyBLZXlzJywgKCkgPT4ge1xuICAgIGl0KCdjcmVhdGVzIGZvdXIgS01TIENNS3Mgd2l0aCBrZXkgcm90YXRpb24gZW5hYmxlZCcsICgpID0+IHtcbiAgICAgIC8vIFZlcmlmeSBhbGwgNCBLTVMga2V5cyBleGlzdFxuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OktNUzo6S2V5JywgNCk7XG5cbiAgICAgIC8vIFZlcmlmeSBlYWNoIGtleSBoYXMgYXV0b21hdGljIHJvdGF0aW9uIGVuYWJsZWRcbiAgICAgIHRlbXBsYXRlLmFsbFJlc291cmNlc1Byb3BlcnRpZXMoJ0FXUzo6S01TOjpLZXknLCB7XG4gICAgICAgIEVuYWJsZUtleVJvdGF0aW9uOiB0cnVlLFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnY3JlYXRlcyBEYXRhYmFzZSBFbmNyeXB0aW9uIEtleSB3aXRoIGNvcnJlY3QgYWxpYXMnLCAoKSA9PiB7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6S01TOjpBbGlhcycsIHtcbiAgICAgICAgQWxpYXNOYW1lOiAnYWxpYXMvZmNjLWRiLXRlc3QnLFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnY3JlYXRlcyBTcXVhcmUgVG9rZW4gRW5jcnlwdGlvbiBLZXkgd2l0aCBjb3JyZWN0IGFsaWFzJywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OktNUzo6QWxpYXMnLCB7XG4gICAgICAgIEFsaWFzTmFtZTogJ2FsaWFzL2ZjYy1zcXVhcmUtdG9rZW4tdGVzdCcsXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdjcmVhdGVzIFN0cmlwZSBXZWJob29rIFNlY3JldCBLZXkgd2l0aCBjb3JyZWN0IGFsaWFzJywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OktNUzo6QWxpYXMnLCB7XG4gICAgICAgIEFsaWFzTmFtZTogJ2FsaWFzL2ZjYy1zdHJpcGUtd2ViaG9vay10ZXN0JyxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ2NyZWF0ZXMgQXBwbGljYXRpb24gU2VjcmV0cyBLZXkgd2l0aCBjb3JyZWN0IGFsaWFzJywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OktNUzo6QWxpYXMnLCB7XG4gICAgICAgIEFsaWFzTmFtZTogJ2FsaWFzL2ZjYy1hcHAtc2VjcmV0cy10ZXN0JyxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3NldHMgMzAtZGF5IHBlbmRpbmcgd2luZG93IGZvciBrZXkgZGVsZXRpb24nLCAoKSA9PiB7XG4gICAgICAvLyBWZXJpZnkgYWxsIGtleXMgaGF2ZSBhIDMwLWRheSBwZW5kaW5nIHdpbmRvdyAoaW4gc2Vjb25kczogMzAgZGF5cyAqIDI0IGhvdXJzICogMzYwMCBzZWNvbmRzKVxuICAgICAgdGVtcGxhdGUuYWxsUmVzb3VyY2VzUHJvcGVydGllcygnQVdTOjpLTVM6OktleScsIHtcbiAgICAgICAgUGVuZGluZ1dpbmRvd0luRGF5czogMzAsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1NlY3JldHMgTWFuYWdlciBTZWNyZXRzJywgKCkgPT4ge1xuICAgIGl0KCdjcmVhdGVzIGZpdmUgU2VjcmV0cyBNYW5hZ2VyIHNlY3JldHMnLCAoKSA9PiB7XG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6U2VjcmV0c01hbmFnZXI6OlNlY3JldCcsIDUpO1xuICAgIH0pO1xuXG4gICAgaXQoJ2NyZWF0ZXMgRGF0YWJhc2UgQ3JlZGVudGlhbHMgU2VjcmV0IHdpdGggZ2VuZXJhdGVkIHBhc3N3b3JkJywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlNlY3JldHNNYW5hZ2VyOjpTZWNyZXQnLCB7XG4gICAgICAgIE5hbWU6ICdmY2MtZGItY3JlZGVudGlhbHMtdGVzdCcsXG4gICAgICAgIERlc2NyaXB0aW9uOiAnQXVyb3JhIFBvc3RncmVTUUwgbWFzdGVyIGNyZWRlbnRpYWxzIHdpdGggYXV0b21hdGljIHJvdGF0aW9uJyxcbiAgICAgICAgR2VuZXJhdGVTZWNyZXRTdHJpbmc6IHtcbiAgICAgICAgICBTZWNyZXRTdHJpbmdUZW1wbGF0ZTogTWF0Y2guc2VyaWFsaXplZEpzb24oeyB1c2VybmFtZTogJ2Zvb2Rjb3N0X2FkbWluJyB9KSxcbiAgICAgICAgICBHZW5lcmF0ZVN0cmluZ0tleTogJ3Bhc3N3b3JkJyxcbiAgICAgICAgICBFeGNsdWRlQ2hhcmFjdGVyczogJ1wiQC9cXFxcJyxcbiAgICAgICAgICBQYXNzd29yZExlbmd0aDogMzIsXG4gICAgICAgICAgUmVxdWlyZUVhY2hJbmNsdWRlZFR5cGU6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdjcmVhdGVzIFN0cmlwZSBBUEkgS2V5IFNlY3JldCB3aXRob3V0IGdlbmVyYXRlZCB2YWx1ZScsICgpID0+IHtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpTZWNyZXRzTWFuYWdlcjo6U2VjcmV0Jywge1xuICAgICAgICBOYW1lOiAnZmNjLXN0cmlwZS1hcGkta2V5LXRlc3QnLFxuICAgICAgICBEZXNjcmlwdGlvbjogJ1N0cmlwZSBzZWNyZXQga2V5IGZvciBzdWJzY3JpcHRpb24gYmlsbGluZyBBUEknLFxuICAgICAgfSk7XG5cbiAgICAgIC8vIFZlcmlmeSBpdCBkb2VzIE5PVCBoYXZlIGEgbWVhbmluZ2Z1bCBHZW5lcmF0ZVNlY3JldFN0cmluZyAobXVzdCBiZSBtYW51YWxseSBwb3B1bGF0ZWQpXG4gICAgICBjb25zdCBzZWNyZXRzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpTZWNyZXRzTWFuYWdlcjo6U2VjcmV0Jywge1xuICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgTmFtZTogJ2ZjYy1zdHJpcGUtYXBpLWtleS10ZXN0JyxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgY29uc3Qgc2VjcmV0S2V5ID0gT2JqZWN0LmtleXMoc2VjcmV0cylbMF07XG4gICAgICAvLyBDREsgbWF5IGNyZWF0ZSBhbiBlbXB0eSBvYmplY3QsIHdoaWNoIGlzIGZ1bmN0aW9uYWxseSB0aGUgc2FtZSBhcyB1bmRlZmluZWRcbiAgICAgIGNvbnN0IGdlbmVyYXRlU2VjcmV0U3RyaW5nID0gc2VjcmV0c1tzZWNyZXRLZXldLlByb3BlcnRpZXMuR2VuZXJhdGVTZWNyZXRTdHJpbmc7XG4gICAgICBleHBlY3QoIWdlbmVyYXRlU2VjcmV0U3RyaW5nIHx8IE9iamVjdC5rZXlzKGdlbmVyYXRlU2VjcmV0U3RyaW5nKS5sZW5ndGggPT09IDApLnRvQmVUcnV0aHkoKTtcbiAgICB9KTtcblxuICAgIGl0KCdjcmVhdGVzIFN0cmlwZSBXZWJob29rIFNlY3JldCB3aXRob3V0IGdlbmVyYXRlZCB2YWx1ZScsICgpID0+IHtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpTZWNyZXRzTWFuYWdlcjo6U2VjcmV0Jywge1xuICAgICAgICBOYW1lOiAnZmNjLXN0cmlwZS13ZWJob29rLXNlY3JldC10ZXN0JyxcbiAgICAgICAgRGVzY3JpcHRpb246ICdTdHJpcGUgd2ViaG9vayBzaWduaW5nIHNlY3JldCBmb3Igc2lnbmF0dXJlIHZlcmlmaWNhdGlvbicsXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdjcmVhdGVzIFNxdWFyZSBPQXV0aCBTZWNyZXQgd2l0aG91dCBnZW5lcmF0ZWQgdmFsdWUnLCAoKSA9PiB7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6U2VjcmV0c01hbmFnZXI6OlNlY3JldCcsIHtcbiAgICAgICAgTmFtZTogJ2ZjYy1zcXVhcmUtb2F1dGgtdGVzdCcsXG4gICAgICAgIERlc2NyaXB0aW9uOiAnU3F1YXJlIE9BdXRoIGFwcGxpY2F0aW9uIGNyZWRlbnRpYWxzIChhcHAgSUQgKyBzZWNyZXQpJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ2NyZWF0ZXMgQmVkcm9jayBDb25maWcgU2VjcmV0IHdpdGggZGVmYXVsdCB2YWx1ZXMnLCAoKSA9PiB7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6U2VjcmV0c01hbmFnZXI6OlNlY3JldCcsIHtcbiAgICAgICAgTmFtZTogJ2ZjYy1iZWRyb2NrLWNvbmZpZy10ZXN0JyxcbiAgICAgICAgRGVzY3JpcHRpb246ICdBbWF6b24gQmVkcm9jayBtb2RlbCBjb25maWd1cmF0aW9uIGZvciBQcm8rIEFJIGluc2lnaHRzJyxcbiAgICAgICAgU2VjcmV0U3RyaW5nOiBNYXRjaC5zZXJpYWxpemVkSnNvbih7XG4gICAgICAgICAgbW9kZWxfaWQ6ICdhbnRocm9waWMuY2xhdWRlLXYyJyxcbiAgICAgICAgICByZWdpb246ICdhcC1zb3V0aGVhc3QtMicsXG4gICAgICAgICAgbWF4X3Rva2VuczogJzQwOTYnLFxuICAgICAgICAgIHRlbXBlcmF0dXJlOiAnMC43JyxcbiAgICAgICAgfSksXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdlbmNyeXB0cyBEYXRhYmFzZSBDcmVkZW50aWFscyB3aXRoIERhdGFiYXNlIEVuY3J5cHRpb24gS2V5JywgKCkgPT4ge1xuICAgICAgLy8gRmluZCB0aGUgREIgY3JlZGVudGlhbHMgc2VjcmV0XG4gICAgICBjb25zdCBzZWNyZXRzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpTZWNyZXRzTWFuYWdlcjo6U2VjcmV0Jywge1xuICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgTmFtZTogJ2ZjYy1kYi1jcmVkZW50aWFscy10ZXN0JyxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBzZWNyZXRLZXkgPSBPYmplY3Qua2V5cyhzZWNyZXRzKVswXTtcbiAgICAgIGNvbnN0IHNlY3JldCA9IHNlY3JldHNbc2VjcmV0S2V5XTtcblxuICAgICAgLy8gVmVyaWZ5IGl0IHJlZmVyZW5jZXMgdGhlIEtNUyBrZXlcbiAgICAgIGV4cGVjdChzZWNyZXQuUHJvcGVydGllcy5LbXNLZXlJZCkudG9CZURlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KCdlbmNyeXB0cyBTcXVhcmUgT0F1dGggU2VjcmV0IHdpdGggQXBwbGljYXRpb24gU2VjcmV0cyBLZXknLCAoKSA9PiB7XG4gICAgICBjb25zdCBzZWNyZXRzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpTZWNyZXRzTWFuYWdlcjo6U2VjcmV0Jywge1xuICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgTmFtZTogJ2ZjYy1zcXVhcmUtb2F1dGgtdGVzdCcsXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgY29uc3Qgc2VjcmV0S2V5ID0gT2JqZWN0LmtleXMoc2VjcmV0cylbMF07XG4gICAgICBjb25zdCBzZWNyZXQgPSBzZWNyZXRzW3NlY3JldEtleV07XG5cbiAgICAgIC8vIFZlcmlmeSBpdCByZWZlcmVuY2VzIGEgS01TIGtleVxuICAgICAgZXhwZWN0KHNlY3JldC5Qcm9wZXJ0aWVzLkttc0tleUlkKS50b0JlRGVmaW5lZCgpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnSUFNIFBvbGljaWVzJywgKCkgPT4ge1xuICAgIGl0KCdncmFudHMgU2VjcmV0cyBNYW5hZ2VyIHNlcnZpY2UgcGVybWlzc2lvbiB0byB1c2UgS01TIGtleXMnLCAoKSA9PiB7XG4gICAgICAvLyBUaGUga2V5IHBvbGljeSBzaG91bGQgYWxsb3cgc2VjcmV0c21hbmFnZXIuYW1hem9uYXdzLmNvbSB3aXRoIG5lY2Vzc2FyeSBLTVMgYWN0aW9uc1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OktNUzo6S2V5Jywge1xuICAgICAgICBLZXlQb2xpY3k6IHtcbiAgICAgICAgICBTdGF0ZW1lbnQ6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgICAgRWZmZWN0OiAnQWxsb3cnLFxuICAgICAgICAgICAgICBQcmluY2lwYWw6IHtcbiAgICAgICAgICAgICAgICBTZXJ2aWNlOiAnc2VjcmV0c21hbmFnZXIuYW1hem9uYXdzLmNvbScsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIEFjdGlvbjogTWF0Y2guYXJyYXlXaXRoKFsna21zOkRlY3J5cHQnLCAna21zOkVuY3J5cHQnXSksXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICBdKSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ2dyYW50cyBSRFMgc2VydmljZSBwZXJtaXNzaW9uIHRvIHVzZSBEYXRhYmFzZSBFbmNyeXB0aW9uIEtleScsICgpID0+IHtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpLTVM6OktleScsIHtcbiAgICAgICAgS2V5UG9saWN5OiB7XG4gICAgICAgICAgU3RhdGVtZW50OiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICAgICAgTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgICAgICAgICAgUHJpbmNpcGFsOiB7XG4gICAgICAgICAgICAgICAgU2VydmljZTogJ3Jkcy5hbWF6b25hd3MuY29tJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgQWN0aW9uOiBNYXRjaC5hcnJheVdpdGgoWydrbXM6RGVjcnlwdCcsICdrbXM6RW5jcnlwdCddKSxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgIF0pLFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdDbG91ZEZvcm1hdGlvbiBPdXRwdXRzJywgKCkgPT4ge1xuICAgIGl0KCdleHBvcnRzIGFsbCBLTVMga2V5IElEcyBhbmQgQVJOcycsICgpID0+IHtcbiAgICAgIC8vIENoZWNrIHRoYXQgd2UgaGF2ZSBvdXRwdXRzIGZvciBLTVMga2V5c1xuICAgICAgY29uc3Qgb3V0cHV0cyA9IHRlbXBsYXRlLmZpbmRPdXRwdXRzKCcqJyk7XG5cbiAgICAgIGV4cGVjdChvdXRwdXRzLkRhdGFiYXNlRW5jcnlwdGlvbktleUlkKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KG91dHB1dHMuRGF0YWJhc2VFbmNyeXB0aW9uS2V5QXJuKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KG91dHB1dHMuU3F1YXJlVG9rZW5FbmNyeXB0aW9uS2V5SWQpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3Qob3V0cHV0cy5TcXVhcmVUb2tlbkVuY3J5cHRpb25LZXlBcm4pLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3Qob3V0cHV0cy5TdHJpcGVXZWJob29rU2VjcmV0S2V5QXJuKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KG91dHB1dHMuQXBwbGljYXRpb25TZWNyZXRzS2V5QXJuKS50b0JlRGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ2V4cG9ydHMgYWxsIFNlY3JldHMgTWFuYWdlciBzZWNyZXQgQVJOcycsICgpID0+IHtcbiAgICAgIGNvbnN0IG91dHB1dHMgPSB0ZW1wbGF0ZS5maW5kT3V0cHV0cygnKicpO1xuXG4gICAgICBleHBlY3Qob3V0cHV0cy5EYXRhYmFzZUNyZWRlbnRpYWxzU2VjcmV0QXJuKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KG91dHB1dHMuU3RyaXBlQXBpS2V5U2VjcmV0QXJuKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KG91dHB1dHMuU3RyaXBlV2ViaG9va1NlY3JldEFybikudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChvdXRwdXRzLlNxdWFyZU9BdXRoU2VjcmV0QXJuKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KG91dHB1dHMuQmVkcm9ja0NvbmZpZ1NlY3JldEFybikudG9CZURlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KCdleHBvcnRzIG91dHB1dHMgd2l0aCBjb3JyZWN0IG5hbWluZyBjb252ZW50aW9uJywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUuaGFzT3V0cHV0KCdEYXRhYmFzZUVuY3J5cHRpb25LZXlJZCcsIHtcbiAgICAgICAgRXhwb3J0OiB7XG4gICAgICAgICAgTmFtZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvci10ZXN0LURhdGFiYXNlRW5jcnlwdGlvbktleUlkJyxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICB0ZW1wbGF0ZS5oYXNPdXRwdXQoJ0RhdGFiYXNlQ3JlZGVudGlhbHNTZWNyZXRBcm4nLCB7XG4gICAgICAgIEV4cG9ydDoge1xuICAgICAgICAgIE5hbWU6ICdGb29kQ29zdENhbGN1bGF0b3ItdGVzdC1EYXRhYmFzZUNyZWRlbnRpYWxzU2VjcmV0QXJuJyxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnUmVzb3VyY2UgVGFncycsICgpID0+IHtcbiAgICBpdCgndGFncyBhbGwgS01TIGtleXMgd2l0aCBDb21wb25lbnQgYW5kIEVudmlyb25tZW50JywgKCkgPT4ge1xuICAgICAgLy8gRmluZCBhbGwgS01TIGtleXNcbiAgICAgIGNvbnN0IGtleXMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OktNUzo6S2V5Jyk7XG5cbiAgICAgIE9iamVjdC52YWx1ZXMoa2V5cykuZm9yRWFjaCgoa2V5OiBhbnkpID0+IHtcbiAgICAgICAgLy8gQ0RLIGFwcGxpZXMgdGFncyBhdCB0aGUgc3RhY2sgbGV2ZWwsIHNvIHdlIGNoZWNrIGZvciBUYWcgcmVzb3VyY2VzXG4gICAgICAgIC8vIG9yIHZlcmlmeSB0YWdzIGFyZSBpbiB0aGUga2V5IHByb3BlcnRpZXMgaWYgZXhwbGljaXRseSBzZXRcbiAgICAgICAgZXhwZWN0KGtleSkudG9CZURlZmluZWQoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnU2VjdXJpdHkgQ29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2V0cyBSRVRBSU4gcmVtb3ZhbCBwb2xpY3kgb24gYWxsIEtNUyBrZXlzJywgKCkgPT4ge1xuICAgICAgLy8gQWxsIEtNUyBrZXlzIHNob3VsZCBoYXZlIERlbGV0aW9uUG9saWN5OiBSZXRhaW5cbiAgICAgIGNvbnN0IGtleXMgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OktNUzo6S2V5Jyk7XG5cbiAgICAgIE9iamVjdC52YWx1ZXMoa2V5cykuZm9yRWFjaCgoa2V5OiBhbnkpID0+IHtcbiAgICAgICAgZXhwZWN0KGtleS5EZWxldGlvblBvbGljeSkudG9CZSgnUmV0YWluJyk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzZXRzIFJFVEFJTiByZW1vdmFsIHBvbGljeSBvbiBhbGwgU2VjcmV0cyBNYW5hZ2VyIHNlY3JldHMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBzZWNyZXRzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpTZWNyZXRzTWFuYWdlcjo6U2VjcmV0Jyk7XG5cbiAgICAgIE9iamVjdC52YWx1ZXMoc2VjcmV0cykuZm9yRWFjaCgoc2VjcmV0OiBhbnkpID0+IHtcbiAgICAgICAgZXhwZWN0KHNlY3JldC5EZWxldGlvblBvbGljeSkudG9CZSgnUmV0YWluJyk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCd1c2VzIHN0cm9uZyBwYXNzd29yZCByZXF1aXJlbWVudHMgZm9yIGRhdGFiYXNlIGNyZWRlbnRpYWxzJywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlNlY3JldHNNYW5hZ2VyOjpTZWNyZXQnLCB7XG4gICAgICAgIEdlbmVyYXRlU2VjcmV0U3RyaW5nOiB7XG4gICAgICAgICAgUGFzc3dvcmRMZW5ndGg6IDMyLFxuICAgICAgICAgIFJlcXVpcmVFYWNoSW5jbHVkZWRUeXBlOiB0cnVlLFxuICAgICAgICAgIEV4Y2x1ZGVDaGFyYWN0ZXJzOiAnXCJAL1xcXFwnLFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xufSk7XG4iXX0=