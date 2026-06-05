import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AuthStack } from '../lib/stacks/AuthStack';

describe('AuthStack', () => {
  let app: cdk.App;
  let stack: AuthStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
    stack = new AuthStack(app, 'TestAuthStack', {
      envName: 'test',
      env: {
        account: '123456789012',
        region: 'ap-southeast-2',
      },
    });
    template = Template.fromStack(stack);
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
        Schema: Match.arrayWith([
          Match.objectLike({
            Name: 'org_id',
            Mutable: true,
            AttributeDataType: 'String',
            StringAttributeConstraints: {
              MinLength: '0',
              MaxLength: '256',
            },
          }),
          Match.objectLike({
            Name: 'venue_roles',
            Mutable: true,
            AttributeDataType: 'String',
            StringAttributeConstraints: {
              MinLength: '0',
              MaxLength: '2048',
            },
          }),
          Match.objectLike({
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
        ProviderDetails: Match.objectLike({
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
        ProviderDetails: Match.objectLike({
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
        IdTokenValidity: 60,      // 1 hour in minutes  
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
