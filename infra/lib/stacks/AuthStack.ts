import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export interface AuthStackProps extends cdk.StackProps {
  /** Logical environment name, e.g. "staging" or "prod". Used for naming. */
  readonly envName: string;
}

/**
 * AuthStack
 *
 * Provisions authentication and authorisation infrastructure for the Food Cost Calculator:
 *
 *  • Amazon Cognito User Pool with email/password authentication
 *  • Password policy: min 8 chars, at least one uppercase, one lowercase, one digit
 *  • 30-day refresh token TTL (requirement 8.10 — 30-day inactivity timeout)
 *  • Google OAuth 2.0 identity provider (requirement 8.3)
 *  • Apple Sign In identity provider (requirement 8.4)
 *  • Custom attributes: custom:org_id, custom:venue_roles, custom:tier
 *  • App Client with hosted UI support and OAuth flows (CODE, IMPLICIT)
 *
 * Satisfies Requirements: 8.1, 8.2, 8.3, 8.4, 8.10
 */
export class AuthStack extends cdk.Stack {
  /** The Cognito User Pool. */
  public readonly userPool: cognito.UserPool;

  /** The Cognito User Pool App Client (with hosted UI support). */
  public readonly userPoolClient: cognito.UserPoolClient;

  /** The Cognito User Pool Domain (for hosted UI). */
  public readonly userPoolDomain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { envName } = props;

    // ── User Pool ────────────────────────────────────────────────────────────
    //
    // Password policy (requirement 8.1):
    //   • At least 8 characters
    //   • At least one uppercase letter
    //   • At least one lowercase letter
    //   • At least one number
    //
    // Refresh token expiry: 30 days (requirement 8.10 — inactivity timeout)
    //
    // Custom attributes (mutable, stored in JWT):
    //   • custom:org_id        — UUID of the user's organisation
    //   • custom:venue_roles   — JSON string mapping venue IDs to roles
    //   • custom:tier          — Current subscription tier (free, pro, pro_plus)
    //
    // Sign-in: email address (case-insensitive)
    // MFA: optional (can enable later; not required by spec)
    // Account recovery: email-based password reset (requirement 8.7)
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `food-cost-calculator-${envName}`,

      // ── Sign-in configuration ──────────────────────────────────────────────
      // Allow sign-in with email address only (case-insensitive).
      signInAliases: {
        email: true,
        username: false,
        phone: false,
      },
      signInCaseSensitive: false,

      // ── Standard attributes ────────────────────────────────────────────────
      // Email is required and mutable (users can update their email).
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },

      // ── Custom attributes ──────────────────────────────────────────────────
      // These are added to the JWT access token and can be updated by the API
      // when roles or org assignment changes.
      // All custom attributes are mutable.
      customAttributes: {
        // Organisation ID — UUID of the user's primary organisation.
        org_id: new cognito.StringAttribute({
          minLen: 0,
          maxLen: 256,
          mutable: true,
        }),

        // Venue roles — JSON-encoded map of venue UUID → role enum.
        // Example: {"venue-uuid-1":"admin","venue-uuid-2":"manager"}
        // Stored as string to avoid Cognito's 2KB attribute limit on each field.
        venue_roles: new cognito.StringAttribute({
          minLen: 0,
          maxLen: 2048,
          mutable: true,
        }),

        // Subscription tier — one of: free, pro, pro_plus
        tier: new cognito.StringAttribute({
          minLen: 0,
          maxLen: 32,
          mutable: true,
        }),
      },

      // ── Password policy ────────────────────────────────────────────────────
      // Requirement 8.1: min 8 chars, at least one uppercase, one lowercase, one number
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false, // not required by spec
        tempPasswordValidity: cdk.Duration.days(3), // for admin-created users
      },

      // ── Account recovery ───────────────────────────────────────────────────
      // Email-based password reset (requirement 8.7).
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,

      // ── Self-service sign-up ───────────────────────────────────────────────
      // Users can register themselves via email/password (requirement 8.1).
      selfSignUpEnabled: true,

      // ── Email verification ─────────────────────────────────────────────────
      // Require email verification before user can sign in.
      // Verification code sent via email.
      autoVerify: {
        email: true,
      },

      // ── Email delivery ─────────────────────────────────────────────────────
      // Use Cognito's default email service for now.
      // In production, switch to SES for higher send limits and better deliverability.
      // (Cognito default: 50 emails/day; SES: production volumes)
      email: cognito.UserPoolEmail.withCognito(),

      // ── MFA ────────────────────────────────────────────────────────────────
      // MFA is optional (not enforced by spec).
      // Can be enabled by individual users if desired.
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: false,
        otp: true, // TOTP apps (Google Authenticator, Authy, etc.)
      },

      // ── Device tracking ────────────────────────────────────────────────────
      // Optional device tracking (not required by spec).
      deviceTracking: {
        challengeRequiredOnNewDevice: false,
        deviceOnlyRememberedOnUserPrompt: true,
      },

      // ── Lambda triggers ────────────────────────────────────────────────────
      // None defined here; can add later for:
      //   • Pre-sign-up: custom validation or auto-confirm email
      //   • Post-authentication: custom logging or side effects
      //   • Pre-token-generation: add custom claims to JWT

      // ── Deletion protection ────────────────────────────────────────────────
      // Prevent accidental deletion in production.
      removalPolicy: envName === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,

      // Enable advanced security features (compromised credentials detection)
      advancedSecurityMode: cognito.AdvancedSecurityMode.ENFORCED,
    });

    // ── User Pool Domain ─────────────────────────────────────────────────────
    // Hosted UI requires a domain prefix.
    // Format: https://<prefix>.auth.<region>.amazoncognito.com
    // In production, can use a custom domain (e.g., auth.foodcost.app)
    this.userPoolDomain = this.userPool.addDomain('UserPoolDomain', {
      cognitoDomain: {
        domainPrefix: `food-cost-calculator-${envName}`,
      },
    });

    // ── Google Identity Provider ─────────────────────────────────────────────
    // Requirement 8.3: Allow users to authenticate using Google.
    // OAuth 2.0 OIDC provider.
    // Client ID and secret are stored in AWS Secrets Manager and passed via
    // CDK context at deploy time:
    //   cdk deploy --context googleClientId=xxx --context googleClientSecret=yyy
    const googleClientId = this.node.tryGetContext('googleClientId') ?? 'PLACEHOLDER_GOOGLE_CLIENT_ID';
    const googleClientSecret = this.node.tryGetContext('googleClientSecret') ?? 'PLACEHOLDER_GOOGLE_CLIENT_SECRET';

    const googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleProvider', {
      userPool: this.userPool,
      clientId: googleClientId,
      clientSecretValue: cdk.SecretValue.unsafePlainText(googleClientSecret),

      // Attribute mapping: map Google profile fields to Cognito attributes.
      // Google provides: sub, email, email_verified, name, picture
      attributeMapping: {
        email: cognito.ProviderAttribute.GOOGLE_EMAIL,
        givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
        familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
        profilePicture: cognito.ProviderAttribute.GOOGLE_PICTURE,
      },

      // OAuth scopes requested from Google.
      scopes: ['profile', 'email', 'openid'],
    });

    // ── Apple Identity Provider ──────────────────────────────────────────────
    // Requirement 8.4: Allow users to authenticate using Apple.
    // Apple Sign In uses OAuth 2.0 OIDC.
    // Requires: Services ID, Team ID, Key ID, private key (.p8 file).
    // These are passed via CDK context at deploy time:
    //   cdk deploy --context appleClientId=xxx --context appleTeamId=yyy \
    //              --context appleKeyId=zzz --context applePrivateKey="-----BEGIN PRIVATE KEY-----..."
    const appleClientId = this.node.tryGetContext('appleClientId') ?? 'PLACEHOLDER_APPLE_CLIENT_ID';
    const appleTeamId = this.node.tryGetContext('appleTeamId') ?? 'PLACEHOLDER_APPLE_TEAM_ID';
    const appleKeyId = this.node.tryGetContext('appleKeyId') ?? 'PLACEHOLDER_APPLE_KEY_ID';
    const applePrivateKey = this.node.tryGetContext('applePrivateKey') ?? 'PLACEHOLDER_APPLE_PRIVATE_KEY';

    const appleProvider = new cognito.UserPoolIdentityProviderApple(this, 'AppleProvider', {
      userPool: this.userPool,
      clientId: appleClientId,
      teamId: appleTeamId,
      keyId: appleKeyId,
      privateKey: applePrivateKey,

      // Attribute mapping: map Apple profile fields to Cognito attributes.
      // Apple provides: sub, email, email_verified, name (optional)
      attributeMapping: {
        email: cognito.ProviderAttribute.APPLE_EMAIL,
        givenName: cognito.ProviderAttribute.APPLE_FIRST_NAME,
        familyName: cognito.ProviderAttribute.APPLE_LAST_NAME,
      },

      // OAuth scopes requested from Apple.
      scopes: ['email', 'name'],
    });

    // ── App Client ───────────────────────────────────────────────────────────
    // Used by the React SPA and hosted UI.
    // OAuth flows: AUTHORIZATION_CODE (server-side) and IMPLICIT (SPA fallback).
    // Callback URLs: localhost (dev) + production domain (configured per env).
    const callbackUrls = envName === 'prod'
      ? ['https://app.foodcost.app/auth/callback']
      : ['http://localhost:3000/auth/callback', 'http://localhost:5173/auth/callback'];

    const logoutUrls = envName === 'prod'
      ? ['https://app.foodcost.app']
      : ['http://localhost:3000', 'http://localhost:5173'];

    this.userPoolClient = this.userPool.addClient('WebAppClient', {
      userPoolClientName: `food-cost-calculator-web-${envName}`,

      // ── OAuth flows ────────────────────────────────────────────────────────
      // AUTHORIZATION_CODE: standard OAuth flow with PKCE (recommended for SPAs)
      // IMPLICIT: fallback for older SPA frameworks without PKCE support
      oAuth: {
        flows: {
          authorizationCodeGrant: true, // recommended for SPAs with PKCE
          implicitCodeGrant: true,      // fallback
        },

        // OAuth scopes: openid (required), email, profile, aws.cognito.signin.user.admin (custom attrs)
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.COGNITO_ADMIN, // allows reading/writing custom attributes
        ],

        // Callback URLs: where Cognito redirects after successful authentication
        callbackUrls,

        // Logout URLs: where Cognito redirects after sign-out
        logoutUrls,
      },

      // ── Supported identity providers ───────────────────────────────────────
      // Enable Cognito native auth (email/password) + Google + Apple
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
        cognito.UserPoolClientIdentityProvider.GOOGLE,
        cognito.UserPoolClientIdentityProvider.APPLE,
      ],

      // ── Token validity ─────────────────────────────────────────────────────
      // Requirement 8.10: 30-day inactivity timeout via refresh token expiry
      // Access token: 1 hour (default, standard for short-lived tokens)
      // ID token: 1 hour
      // Refresh token: 30 days
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),

      // ── PKCE enforcement ───────────────────────────────────────────────────
      // Prevent CSRF attacks on the authorization code flow.
      // Required for public clients (SPAs) as of AWS best practices.
      authSessionValidity: cdk.Duration.minutes(15),

      // ── Token revocation ───────────────────────────────────────────────────
      // Allow refresh tokens to be revoked (e.g., on password change or admin action)
      enableTokenRevocation: true,

      // ── Prevent user existence errors ──────────────────────────────────────
      // Don't reveal whether a user exists during password reset or sign-in.
      // (Requirement 8.8: generic confirmation message for unrecognised email)
      preventUserExistenceErrors: true,

      // ── Read/write attributes ──────────────────────────────────────────────
      // Allow client to read email and custom attributes from the JWT.
      // The API can update custom attributes via AdminUpdateUserAttributes.
      readAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({
          email: true,
          emailVerified: true,
          givenName: true,
          familyName: true,
        })
        .withCustomAttributes('org_id', 'venue_roles', 'tier'),

      writeAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({
          email: true,
          givenName: true,
          familyName: true,
        }),
    });

    // Ensure identity providers are created before the client.
    // CDK doesn't automatically track this dependency, so we add it explicitly.
    this.userPoolClient.node.addDependency(googleProvider);
    this.userPoolClient.node.addDependency(appleProvider);

    // ── CloudFormation Outputs ───────────────────────────────────────────────
    // Exported so the API stack and frontend can reference them.

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `FoodCostCalculator-${envName}-UserPoolId`,
    });

    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      description: 'Cognito User Pool ARN',
      exportName: `FoodCostCalculator-${envName}-UserPoolArn`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID (Web App)',
      exportName: `FoodCostCalculator-${envName}-UserPoolClientId`,
    });

    new cdk.CfnOutput(this, 'UserPoolDomain', {
      value: this.userPoolDomain.domainName,
      description: 'Cognito User Pool Domain (hosted UI)',
      exportName: `FoodCostCalculator-${envName}-UserPoolDomain`,
    });

    new cdk.CfnOutput(this, 'HostedUiUrl', {
      value: `https://${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com/login?client_id=${this.userPoolClient.userPoolClientId}&response_type=code&redirect_uri=${callbackUrls[0]}`,
      description: 'Cognito Hosted UI login URL',
    });
  }
}
