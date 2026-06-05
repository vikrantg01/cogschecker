"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = require("aws-cdk-lib");
const assertions_1 = require("aws-cdk-lib/assertions");
const AuthStack_1 = require("../lib/stacks/AuthStack");
describe('AuthStack', () => {
    let app;
    let stack;
    let template;
    beforeEach(() => {
        app = new cdk.App();
        stack = new AuthStack_1.AuthStack(app, 'TestAuthStack', {
            envName: 'test',
            env: {
                account: '123456789012',
                region: 'ap-southeast-2',
            },
        });
        template = assertions_1.Template.fromStack(stack);
    });
    describe('Cognito User Pool', () => {
        it('should create a User Pool with correct configuration', () => {
            template.resourceCountIs('AWS::Cognito::UserPool', 1);
            template.hasResourceProperties('AWS::Cognito::UserPool', {
                UserPoolName: 'food-cost-calculator-test',
                AutoVerifiedAttributes: ['email'],
                UsernameAttributes: ['email'],
                EmailConfiguration: {
                    EmailSendingAccount: 'COGNITO_DEFAULT',
                },
                MfaConfiguration: 'OPTIONAL',
                EnabledMfas: ['SOFTWARE_TOKEN_MFA'],
                AccountRecoverySetting: {
                    RecoveryMechanisms: [
                        {
                            Name: 'verified_email',
                            Priority: 1,
                        },
                    ],
                },
            });
        });
        it('should configure password policy correctly', () => {
            template.hasResourceProperties('AWS::Cognito::UserPool', {
                Policies: {
                    PasswordPolicy: {
                        MinimumLength: 8,
                        RequireLowercase: true,
                        RequireUppercase: true,
                        RequireNumbers: true,
                        RequireSymbols: false,
                    },
                },
            });
        });
        it('should define custom attributes: org_id, venue_roles, tier', () => {
            template.hasResourceProperties('AWS::Cognito::UserPool', {
                Schema: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        Name: 'org_id',
                        Mutable: true,
                        AttributeDataType: 'String',
                        StringAttributeConstraints: {
                            MinLength: '0',
                            MaxLength: '256',
                        },
                    }),
                    assertions_1.Match.objectLike({
                        Name: 'venue_roles',
                        Mutable: true,
                        AttributeDataType: 'String',
                        StringAttributeConstraints: {
                            MinLength: '0',
                            MaxLength: '2048',
                        },
                    }),
                    assertions_1.Match.objectLike({
                        Name: 'tier',
                        Mutable: true,
                        AttributeDataType: 'String',
                        StringAttributeConstraints: {
                            MinLength: '0',
                            MaxLength: '32',
                        },
                    }),
                ]),
            });
        });
        it('should enable advanced security mode', () => {
            template.hasResourceProperties('AWS::Cognito::UserPool', {
                UserPoolAddOns: {
                    AdvancedSecurityMode: 'ENFORCED',
                },
            });
        });
    });
    describe('User Pool Domain', () => {
        it('should create a User Pool Domain for hosted UI', () => {
            template.resourceCountIs('AWS::Cognito::UserPoolDomain', 1);
            template.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
                Domain: 'food-cost-calculator-test',
            });
        });
    });
    describe('Identity Providers', () => {
        it('should create a Google identity provider', () => {
            template.resourceCountIs('AWS::Cognito::UserPoolIdentityProvider', 2);
            template.hasResourceProperties('AWS::Cognito::UserPoolIdentityProvider', {
                ProviderName: 'Google',
                ProviderType: 'Google',
                ProviderDetails: assertions_1.Match.objectLike({
                    authorize_scopes: 'profile email openid',
                }),
                AttributeMapping: {
                    email: 'email',
                    given_name: 'given_name',
                    family_name: 'family_name',
                    picture: 'picture',
                },
            });
        });
        it('should create an Apple identity provider', () => {
            template.hasResourceProperties('AWS::Cognito::UserPoolIdentityProvider', {
                ProviderName: 'SignInWithApple',
                ProviderType: 'SignInWithApple',
                ProviderDetails: assertions_1.Match.objectLike({
                    authorize_scopes: 'email name',
                }),
                AttributeMapping: {
                    email: 'email',
                    given_name: 'firstName',
                    family_name: 'lastName',
                },
            });
        });
    });
    describe('User Pool Client', () => {
        it('should create an App Client with OAuth flows', () => {
            template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
            const client = template.findResources('AWS::Cognito::UserPoolClient');
            const clientProps = Object.values(client)[0].Properties;
            expect(clientProps.ClientName).toBe('food-cost-calculator-web-test');
            expect(clientProps.AllowedOAuthFlows).toContain('code');
            expect(clientProps.AllowedOAuthFlows).toContain('implicit');
            expect(clientProps.AllowedOAuthFlowsUserPoolClient).toBe(true);
            expect(clientProps.AllowedOAuthScopes).toEqual(expect.arrayContaining(['openid', 'email', 'profile', 'aws.cognito.signin.user.admin']));
            expect(clientProps.SupportedIdentityProviders).toEqual(expect.arrayContaining(['COGNITO', 'Google', 'SignInWithApple']));
            expect(clientProps.PreventUserExistenceErrors).toBe('ENABLED');
            expect(clientProps.EnableTokenRevocation).toBe(true);
        });
        it('should configure token validity with 30-day refresh token', () => {
            template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
                AccessTokenValidity: 60, // 1 hour in minutes
                IdTokenValidity: 60, // 1 hour in minutes  
                RefreshTokenValidity: 43200, // 30 days in minutes (30 * 24 * 60)
                TokenValidityUnits: {
                    AccessToken: 'minutes',
                    IdToken: 'minutes',
                    RefreshToken: 'minutes',
                },
            });
        });
        it('should configure read/write attributes including custom attributes', () => {
            const client = template.findResources('AWS::Cognito::UserPoolClient');
            const clientProps = Object.values(client)[0].Properties;
            // Check that custom attributes are in read attributes
            expect(clientProps.ReadAttributes).toEqual(expect.arrayContaining([
                'custom:org_id',
                'custom:venue_roles',
                'custom:tier',
            ]));
            // Check that standard writable attributes are in write attributes
            expect(clientProps.WriteAttributes).toEqual(expect.arrayContaining([
                'email',
                'given_name',
                'family_name',
            ]));
        });
    });
    describe('CloudFormation Outputs', () => {
        it('should export User Pool ID', () => {
            template.hasOutput('UserPoolId', {
                Export: {
                    Name: 'FoodCostCalculator-test-UserPoolId',
                },
            });
        });
        it('should export User Pool ARN', () => {
            template.hasOutput('UserPoolArn', {
                Export: {
                    Name: 'FoodCostCalculator-test-UserPoolArn',
                },
            });
        });
        it('should export User Pool Client ID', () => {
            template.hasOutput('UserPoolClientId', {
                Export: {
                    Name: 'FoodCostCalculator-test-UserPoolClientId',
                },
            });
        });
        it('should export User Pool Domain', () => {
            template.hasOutput('UserPoolDomain', {
                Export: {
                    Name: 'FoodCostCalculator-test-UserPoolDomain',
                },
            });
        });
        it('should output Hosted UI URL', () => {
            const outputs = template.toJSON().Outputs;
            expect(outputs.HostedUiUrl).toBeDefined();
            // The value is a CloudFormation Fn::Join intrinsic, so we can't test the exact string
            expect(outputs.HostedUiUrl.Value).toBeDefined();
        });
    });
    describe('Requirements Validation', () => {
        it('should satisfy requirement 8.1 - password policy (min 8 chars, upper, lower, digit)', () => {
            template.hasResourceProperties('AWS::Cognito::UserPool', {
                Policies: {
                    PasswordPolicy: {
                        MinimumLength: 8,
                        RequireLowercase: true,
                        RequireUppercase: true,
                        RequireNumbers: true,
                    },
                },
            });
        });
        it('should satisfy requirement 8.2 - email/password sign-in', () => {
            template.hasResourceProperties('AWS::Cognito::UserPool', {
                UsernameAttributes: ['email'],
            });
        });
        it('should satisfy requirement 8.3 - Google authentication', () => {
            template.hasResourceProperties('AWS::Cognito::UserPoolIdentityProvider', {
                ProviderType: 'Google',
            });
        });
        it('should satisfy requirement 8.4 - Apple authentication', () => {
            template.hasResourceProperties('AWS::Cognito::UserPoolIdentityProvider', {
                ProviderType: 'SignInWithApple',
            });
        });
        it('should satisfy requirement 8.10 - 30-day refresh token TTL', () => {
            template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
                RefreshTokenValidity: 43200, // 30 days in minutes (30 * 24 * 60)
            });
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQXV0aFN0YWNrLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi90ZXN0L0F1dGhTdGFjay50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsbUNBQW1DO0FBQ25DLHVEQUF5RDtBQUN6RCx1REFBb0Q7QUFFcEQsUUFBUSxDQUFDLFdBQVcsRUFBRSxHQUFHLEVBQUU7SUFDekIsSUFBSSxHQUFZLENBQUM7SUFDakIsSUFBSSxLQUFnQixDQUFDO0lBQ3JCLElBQUksUUFBa0IsQ0FBQztJQUV2QixVQUFVLENBQUMsR0FBRyxFQUFFO1FBQ2QsR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQ3BCLEtBQUssR0FBRyxJQUFJLHFCQUFTLENBQUMsR0FBRyxFQUFFLGVBQWUsRUFBRTtZQUMxQyxPQUFPLEVBQUUsTUFBTTtZQUNmLEdBQUcsRUFBRTtnQkFDSCxPQUFPLEVBQUUsY0FBYztnQkFDdkIsTUFBTSxFQUFFLGdCQUFnQjthQUN6QjtTQUNGLENBQUMsQ0FBQztRQUNILFFBQVEsR0FBRyxxQkFBUSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUN2QyxDQUFDLENBQUMsQ0FBQztJQUVILFFBQVEsQ0FBQyxtQkFBbUIsRUFBRSxHQUFHLEVBQUU7UUFDakMsRUFBRSxDQUFDLHNEQUFzRCxFQUFFLEdBQUcsRUFBRTtZQUM5RCxRQUFRLENBQUMsZUFBZSxDQUFDLHdCQUF3QixFQUFFLENBQUMsQ0FBQyxDQUFDO1lBRXRELFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQyx3QkFBd0IsRUFBRTtnQkFDdkQsWUFBWSxFQUFFLDJCQUEyQjtnQkFDekMsc0JBQXNCLEVBQUUsQ0FBQyxPQUFPLENBQUM7Z0JBQ2pDLGtCQUFrQixFQUFFLENBQUMsT0FBTyxDQUFDO2dCQUM3QixrQkFBa0IsRUFBRTtvQkFDbEIsbUJBQW1CLEVBQUUsaUJBQWlCO2lCQUN2QztnQkFDRCxnQkFBZ0IsRUFBRSxVQUFVO2dCQUM1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RSxDQUFDLE9BQU8sQ0FBQzthQUM5QixDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQyx3REFBd0QsRUFBRSxHQUFHLEVBQUU7WUFDaEUsUUFBUSxDQUFDLHFCQUFxQixDQUFDLHdDQUF3QyxFQUFFO2dCQUN2RSxZQUFZLEVBQUUsUUFBUTthQUN2QixDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQyx1REFBdUQsRUFBRSxHQUFHLEVBQUU7WUFDL0QsUUFBUSxDQUFDLHFCQUFxQixDQUFDLHdDQUF3QyxFQUFFO2dCQUN2RSxZQUFZLEVBQUUsaUJBQWlCO2FBQ2hDLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLDREQUE0RCxFQUFFLEdBQUcsRUFBRTtZQUNwRSxRQUFRLENBQUMscUJBQXFCLENBQUMsOEJBQThCLEVBQUU7Z0JBQzdELG9CQUFvQixFQUFFLEtBQUssRUFBRSxvQ0FBb0M7YUFDbEUsQ0FBQyxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IFRlbXBsYXRlLCBNYXRjaCB9IGZyb20gJ2F3cy1jZGstbGliL2Fzc2VydGlvbnMnO1xuaW1wb3J0IHsgQXV0aFN0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9BdXRoU3RhY2snO1xuXG5kZXNjcmliZSgnQXV0aFN0YWNrJywgKCkgPT4ge1xuICBsZXQgYXBwOiBjZGsuQXBwO1xuICBsZXQgc3RhY2s6IEF1dGhTdGFjaztcbiAgbGV0IHRlbXBsYXRlOiBUZW1wbGF0ZTtcblxuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICBhcHAgPSBuZXcgY2RrLkFwcCgpO1xuICAgIHN0YWNrID0gbmV3IEF1dGhTdGFjayhhcHAsICdUZXN0QXV0aFN0YWNrJywge1xuICAgICAgZW52TmFtZTogJ3Rlc3QnLFxuICAgICAgZW52OiB7XG4gICAgICAgIGFjY291bnQ6ICcxMjM0NTY3ODkwMTInLFxuICAgICAgICByZWdpb246ICdhcC1zb3V0aGVhc3QtMicsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0NvZ25pdG8gVXNlciBQb29sJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgY3JlYXRlIGEgVXNlciBQb29sIHdpdGggY29ycmVjdCBjb25maWd1cmF0aW9uJywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkNvZ25pdG86OlVzZXJQb29sJywgMSk7XG5cbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpDb2duaXRvOjpVc2VyUG9vbCcsIHtcbiAgICAgICAgVXNlclBvb2xOYW1lOiAnZm9vZC1jb3N0LWNhbGN1bGF0b3ItdGVzdCcsXG4gICAgICAgIEF1dG9WZXJpZmllZEF0dHJpYnV0ZXM6IFsnZW1haWwnXSxcbiAgICAgICAgVXNlcm5hbWVBdHRyaWJ1dGVzOiBbJ2VtYWlsJ10sXG4gICAgICAgIEVtYWlsQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIEVtYWlsU2VuZGluZ0FjY291bnQ6ICdDT0dOSVRPX0RFRkFVTFQnLFxuICAgICAgICB9LFxuICAgICAgICBNZmFDb25maWd1cmF0aW9uOiAnT1BUSU9OQUwnLFxuICAgICAgICBFbmFibGVkTWZhczogWydTT0ZUV0FSRV9UT0tFTl9NRkEnXSxcbiAgICAgICAgQWNjb3VudFJlY292ZXJ5U2V0dGluZzoge1xuICAgICAgICAgIFJlY292ZXJ5TWVjaGFuaXNtczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBOYW1lOiAndmVyaWZpZWRfZW1haWwnLFxuICAgICAgICAgICAgICBQcmlvcml0eTogMSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjb25maWd1cmUgcGFzc3dvcmQgcG9saWN5IGNvcnJlY3RseScsICgpID0+IHtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpDb2duaXRvOjpVc2VyUG9vbCcsIHtcbiAgICAgICAgUG9saWNpZXM6IHtcbiAgICAgICAgICBQYXNzd29yZFBvbGljeToge1xuICAgICAgICAgICAgTWluaW11bUxlbmd0aDogOCxcbiAgICAgICAgICAgIFJlcXVpcmVMb3dlcmNhc2U6IHRydWUsXG4gICAgICAgICAgICBSZXF1aXJlVXBwZXJjYXNlOiB0cnVlLFxuICAgICAgICAgICAgUmVxdWlyZU51bWJlcnM6IHRydWUsXG4gICAgICAgICAgICBSZXF1aXJlU3ltYm9sczogZmFsc2UsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBkZWZpbmUgY3VzdG9tIGF0dHJpYnV0ZXM6IG9yZ19pZCwgdmVudWVfcm9sZXMsIHRpZXInLCAoKSA9PiB7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6Q29nbml0bzo6VXNlclBvb2wnLCB7XG4gICAgICAgIFNjaGVtYTogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgIE5hbWU6ICdvcmdfaWQnLFxuICAgICAgICAgICAgTXV0YWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIEF0dHJpYnV0ZURhdGFUeXBlOiAnU3RyaW5nJyxcbiAgICAgICAgICAgIFN0cmluZ0F0dHJpYnV0ZUNvbnN0cmFpbnRzOiB7XG4gICAgICAgICAgICAgIE1pbkxlbmd0aDogJzAnLFxuICAgICAgICAgICAgICBNYXhMZW5ndGg6ICcyNTYnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgIE5hbWU6ICd2ZW51ZV9yb2xlcycsXG4gICAgICAgICAgICBNdXRhYmxlOiB0cnVlLFxuICAgICAgICAgICAgQXR0cmlidXRlRGF0YVR5cGU6ICdTdHJpbmcnLFxuICAgICAgICAgICAgU3RyaW5nQXR0cmlidXRlQ29uc3RyYWludHM6IHtcbiAgICAgICAgICAgICAgTWluTGVuZ3RoOiAnMCcsXG4gICAgICAgICAgICAgIE1heExlbmd0aDogJzIwNDgnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgIE5hbWU6ICd0aWVyJyxcbiAgICAgICAgICAgIE11dGFibGU6IHRydWUsXG4gICAgICAgICAgICBBdHRyaWJ1dGVEYXRhVHlwZTogJ1N0cmluZycsXG4gICAgICAgICAgICBTdHJpbmdBdHRyaWJ1dGVDb25zdHJhaW50czoge1xuICAgICAgICAgICAgICBNaW5MZW5ndGg6ICcwJyxcbiAgICAgICAgICAgICAgTWF4TGVuZ3RoOiAnMzInLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSksXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZW5hYmxlIGFkdmFuY2VkIHNlY3VyaXR5IG1vZGUnLCAoKSA9PiB7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6Q29nbml0bzo6VXNlclBvb2wnLCB7XG4gICAgICAgIFVzZXJQb29sQWRkT25zOiB7XG4gICAgICAgICAgQWR2YW5jZWRTZWN1cml0eU1vZGU6ICdFTkZPUkNFRCcsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1VzZXIgUG9vbCBEb21haW4nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgYSBVc2VyIFBvb2wgRG9tYWluIGZvciBob3N0ZWQgVUknLCAoKSA9PiB7XG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6Q29nbml0bzo6VXNlclBvb2xEb21haW4nLCAxKTtcblxuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkNvZ25pdG86OlVzZXJQb29sRG9tYWluJywge1xuICAgICAgICBEb21haW46ICdmb29kLWNvc3QtY2FsY3VsYXRvci10ZXN0JyxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnSWRlbnRpdHkgUHJvdmlkZXJzJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgY3JlYXRlIGEgR29vZ2xlIGlkZW50aXR5IHByb3ZpZGVyJywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkNvZ25pdG86OlVzZXJQb29sSWRlbnRpdHlQcm92aWRlcicsIDIpO1xuXG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6Q29nbml0bzo6VXNlclBvb2xJZGVudGl0eVByb3ZpZGVyJywge1xuICAgICAgICBQcm92aWRlck5hbWU6ICdHb29nbGUnLFxuICAgICAgICBQcm92aWRlclR5cGU6ICdHb29nbGUnLFxuICAgICAgICBQcm92aWRlckRldGFpbHM6IE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgIGF1dGhvcml6ZV9zY29wZXM6ICdwcm9maWxlIGVtYWlsIG9wZW5pZCcsXG4gICAgICAgIH0pLFxuICAgICAgICBBdHRyaWJ1dGVNYXBwaW5nOiB7XG4gICAgICAgICAgZW1haWw6ICdlbWFpbCcsXG4gICAgICAgICAgZ2l2ZW5fbmFtZTogJ2dpdmVuX25hbWUnLFxuICAgICAgICAgIGZhbWlseV9uYW1lOiAnZmFtaWx5X25hbWUnLFxuICAgICAgICAgIHBpY3R1cmU6ICdwaWN0dXJlJyxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgYW4gQXBwbGUgaWRlbnRpdHkgcHJvdmlkZXInLCAoKSA9PiB7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6Q29nbml0bzo6VXNlclBvb2xJZGVudGl0eVByb3ZpZGVyJywge1xuICAgICAgICBQcm92aWRlck5hbWU6ICdTaWduSW5XaXRoQXBwbGUnLFxuICAgICAgICBQcm92aWRlclR5cGU6ICdTaWduSW5XaXRoQXBwbGUnLFxuICAgICAgICBQcm92aWRlckRldGFpbHM6IE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgIGF1dGhvcml6ZV9zY29wZXM6ICdlbWFpbCBuYW1lJyxcbiAgICAgICAgfSksXG4gICAgICAgIEF0dHJpYnV0ZU1hcHBpbmc6IHtcbiAgICAgICAgICBlbWFpbDogJ2VtYWlsJyxcbiAgICAgICAgICBnaXZlbl9uYW1lOiAnZmlyc3ROYW1lJyxcbiAgICAgICAgICBmYW1pbHlfbmFtZTogJ2xhc3ROYW1lJyxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnVXNlciBQb29sIENsaWVudCcsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSBhbiBBcHAgQ2xpZW50IHdpdGggT0F1dGggZmxvd3MnLCAoKSA9PiB7XG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6Q29nbml0bzo6VXNlclBvb2xDbGllbnQnLCAxKTtcblxuICAgICAgY29uc3QgY2xpZW50ID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpDb2duaXRvOjpVc2VyUG9vbENsaWVudCcpO1xuICAgICAgY29uc3QgY2xpZW50UHJvcHMgPSBPYmplY3QudmFsdWVzKGNsaWVudClbMF0uUHJvcGVydGllcztcblxuICAgICAgZXhwZWN0KGNsaWVudFByb3BzLkNsaWVudE5hbWUpLnRvQmUoJ2Zvb2QtY29zdC1jYWxjdWxhdG9yLXdlYi10ZXN0Jyk7XG4gICAgICBleHBlY3QoY2xpZW50UHJvcHMuQWxsb3dlZE9BdXRoRmxvd3MpLnRvQ29udGFpbignY29kZScpO1xuICAgICAgZXhwZWN0KGNsaWVudFByb3BzLkFsbG93ZWRPQXV0aEZsb3dzKS50b0NvbnRhaW4oJ2ltcGxpY2l0Jyk7XG4gICAgICBleHBlY3QoY2xpZW50UHJvcHMuQWxsb3dlZE9BdXRoRmxvd3NVc2VyUG9vbENsaWVudCkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChjbGllbnRQcm9wcy5BbGxvd2VkT0F1dGhTY29wZXMpLnRvRXF1YWwoZXhwZWN0LmFycmF5Q29udGFpbmluZyhbJ29wZW5pZCcsICdlbWFpbCcsICdwcm9maWxlJywgJ2F3cy5jb2duaXRvLnNpZ25pbi51c2VyLmFkbWluJ10pKTtcbiAgICAgIGV4cGVjdChjbGllbnRQcm9wcy5TdXBwb3J0ZWRJZGVudGl0eVByb3ZpZGVycykudG9FcXVhbChleHBlY3QuYXJyYXlDb250YWluaW5nKFsnQ09HTklUTycsICdHb29nbGUnLCAnU2lnbkluV2l0aEFwcGxlJ10pKTtcbiAgICAgIGV4cGVjdChjbGllbnRQcm9wcy5QcmV2ZW50VXNlckV4aXN0ZW5jZUVycm9ycykudG9CZSgnRU5BQkxFRCcpO1xuICAgICAgZXhwZWN0KGNsaWVudFByb3BzLkVuYWJsZVRva2VuUmV2b2NhdGlvbikudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY29uZmlndXJlIHRva2VuIHZhbGlkaXR5IHdpdGggMzAtZGF5IHJlZnJlc2ggdG9rZW4nLCAoKSA9PiB7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6Q29nbml0bzo6VXNlclBvb2xDbGllbnQnLCB7XG4gICAgICAgIEFjY2Vzc1Rva2VuVmFsaWRpdHk6IDYwLCAvLyAxIGhvdXIgaW4gbWludXRlc1xuICAgICAgICBJZFRva2VuVmFsaWRpdHk6IDYwLCAgICAgIC8vIDEgaG91ciBpbiBtaW51dGVzICBcbiAgICAgICAgUmVmcmVzaFRva2VuVmFsaWRpdHk6IDQzMjAwLCAvLyAzMCBkYXlzIGluIG1pbnV0ZXMgKDMwICogMjQgKiA2MClcbiAgICAgICAgVG9rZW5WYWxpZGl0eVVuaXRzOiB7XG4gICAgICAgICAgQWNjZXNzVG9rZW46ICdtaW51dGVzJyxcbiAgICAgICAgICBJZFRva2VuOiAnbWludXRlcycsXG4gICAgICAgICAgUmVmcmVzaFRva2VuOiAnbWludXRlcycsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY29uZmlndXJlIHJlYWQvd3JpdGUgYXR0cmlidXRlcyBpbmNsdWRpbmcgY3VzdG9tIGF0dHJpYnV0ZXMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjbGllbnQgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OkNvZ25pdG86OlVzZXJQb29sQ2xpZW50Jyk7XG4gICAgICBjb25zdCBjbGllbnRQcm9wcyA9IE9iamVjdC52YWx1ZXMoY2xpZW50KVswXS5Qcm9wZXJ0aWVzO1xuXG4gICAgICAvLyBDaGVjayB0aGF0IGN1c3RvbSBhdHRyaWJ1dGVzIGFyZSBpbiByZWFkIGF0dHJpYnV0ZXNcbiAgICAgIGV4cGVjdChjbGllbnRQcm9wcy5SZWFkQXR0cmlidXRlcykudG9FcXVhbChleHBlY3QuYXJyYXlDb250YWluaW5nKFtcbiAgICAgICAgJ2N1c3RvbTpvcmdfaWQnLFxuICAgICAgICAnY3VzdG9tOnZlbnVlX3JvbGVzJyxcbiAgICAgICAgJ2N1c3RvbTp0aWVyJyxcbiAgICAgIF0pKTtcblxuICAgICAgLy8gQ2hlY2sgdGhhdCBzdGFuZGFyZCB3cml0YWJsZSBhdHRyaWJ1dGVzIGFyZSBpbiB3cml0ZSBhdHRyaWJ1dGVzXG4gICAgICBleHBlY3QoY2xpZW50UHJvcHMuV3JpdGVBdHRyaWJ1dGVzKS50b0VxdWFsKGV4cGVjdC5hcnJheUNvbnRhaW5pbmcoW1xuICAgICAgICAnZW1haWwnLFxuICAgICAgICAnZ2l2ZW5fbmFtZScsXG4gICAgICAgICdmYW1pbHlfbmFtZScsXG4gICAgICBdKSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdDbG91ZEZvcm1hdGlvbiBPdXRwdXRzJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgZXhwb3J0IFVzZXIgUG9vbCBJRCcsICgpID0+IHtcbiAgICAgIHRlbXBsYXRlLmhhc091dHB1dCgnVXNlclBvb2xJZCcsIHtcbiAgICAgICAgRXhwb3J0OiB7XG4gICAgICAgICAgTmFtZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvci10ZXN0LVVzZXJQb29sSWQnLFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGV4cG9ydCBVc2VyIFBvb2wgQVJOJywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUuaGFzT3V0cHV0KCdVc2VyUG9vbEFybicsIHtcbiAgICAgICAgRXhwb3J0OiB7XG4gICAgICAgICAgTmFtZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvci10ZXN0LVVzZXJQb29sQXJuJyxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBleHBvcnQgVXNlciBQb29sIENsaWVudCBJRCcsICgpID0+IHtcbiAgICAgIHRlbXBsYXRlLmhhc091dHB1dCgnVXNlclBvb2xDbGllbnRJZCcsIHtcbiAgICAgICAgRXhwb3J0OiB7XG4gICAgICAgICAgTmFtZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvci10ZXN0LVVzZXJQb29sQ2xpZW50SWQnLFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGV4cG9ydCBVc2VyIFBvb2wgRG9tYWluJywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUuaGFzT3V0cHV0KCdVc2VyUG9vbERvbWFpbicsIHtcbiAgICAgICAgRXhwb3J0OiB7XG4gICAgICAgICAgTmFtZTogJ0Zvb2RDb3N0Q2FsY3VsYXRvci10ZXN0LVVzZXJQb29sRG9tYWluJyxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBvdXRwdXQgSG9zdGVkIFVJIFVSTCcsICgpID0+IHtcbiAgICAgIGNvbnN0IG91dHB1dHMgPSB0ZW1wbGF0ZS50b0pTT04oKS5PdXRwdXRzO1xuICAgICAgZXhwZWN0KG91dHB1dHMuSG9zdGVkVWlVcmwpLnRvQmVEZWZpbmVkKCk7XG4gICAgICAvLyBUaGUgdmFsdWUgaXMgYSBDbG91ZEZvcm1hdGlvbiBGbjo6Sm9pbiBpbnRyaW5zaWMsIHNvIHdlIGNhbid0IHRlc3QgdGhlIGV4YWN0IHN0cmluZ1xuICAgICAgZXhwZWN0KG91dHB1dHMuSG9zdGVkVWlVcmwuVmFsdWUpLnRvQmVEZWZpbmVkKCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdSZXF1aXJlbWVudHMgVmFsaWRhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHNhdGlzZnkgcmVxdWlyZW1lbnQgOC4xIC0gcGFzc3dvcmQgcG9saWN5IChtaW4gOCBjaGFycywgdXBwZXIsIGxvd2VyLCBkaWdpdCknLCAoKSA9PiB7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6Q29nbml0bzo6VXNlclBvb2wnLCB7XG4gICAgICAgIFBvbGljaWVzOiB7XG4gICAgICAgICAgUGFzc3dvcmRQb2xpY3k6IHtcbiAgICAgICAgICAgIE1pbmltdW1MZW5ndGg6IDgsXG4gICAgICAgICAgICBSZXF1aXJlTG93ZXJjYXNlOiB0cnVlLFxuICAgICAgICAgICAgUmVxdWlyZVVwcGVyY2FzZTogdHJ1ZSxcbiAgICAgICAgICAgIFJlcXVpcmVOdW1iZXJzOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgc2F0aXNmeSByZXF1aXJlbWVudCA4LjIgLSBlbWFpbC9wYXNzd29yZCBzaWduLWluJywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkNvZ25pdG86OlVzZXJQb29sJywge1xuICAgICAgICBVc2VybmFtZUF0dHJpYnV0ZXM6IFsnZW1haWwnXSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBzYXRpc2Z5IHJlcXVpcmVtZW50IDguMyAtIEdvb2dsZSBhdXRoZW50aWNhdGlvbicsICgpID0+IHtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpDb2duaXRvOjpVc2VyUG9vbElkZW50aXR5UHJvdmlkZXInLCB7XG4gICAgICAgIFByb3ZpZGVyVHlwZTogJ0dvb2dsZScsXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgc2F0aXNmeSByZXF1aXJlbWVudCA4LjQgLSBBcHBsZSBhdXRoZW50aWNhdGlvbicsICgpID0+IHtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpDb2duaXRvOjpVc2VyUG9vbElkZW50aXR5UHJvdmlkZXInLCB7XG4gICAgICAgIFByb3ZpZGVyVHlwZTogJ1NpZ25JbldpdGhBcHBsZScsXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgc2F0aXNmeSByZXF1aXJlbWVudCA4LjEwIC0gMzAtZGF5IHJlZnJlc2ggdG9rZW4gVFRMJywgKCkgPT4ge1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkNvZ25pdG86OlVzZXJQb29sQ2xpZW50Jywge1xuICAgICAgICBSZWZyZXNoVG9rZW5WYWxpZGl0eTogNDMyMDAsIC8vIDMwIGRheXMgaW4gbWludXRlcyAoMzAgKiAyNCAqIDYwKVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xufSk7XG4iXX0=