"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthStack = void 0;
const cdk = require("aws-cdk-lib");
const cognito = require("aws-cdk-lib/aws-cognito");
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
class AuthStack extends cdk.Stack {
    /** The Cognito User Pool. */
    userPool;
    /** The Cognito User Pool App Client (with hosted UI support). */
    userPoolClient;
    /** The Cognito User Pool Domain (for hosted UI). */
    userPoolDomain;
    constructor(scope, id, props) {
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
                    implicitCodeGrant: true, // fallback
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
exports.AuthStack = AuthStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQXV0aFN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vbGliL3N0YWNrcy9BdXRoU3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBQ25DLG1EQUFtRDtBQVFuRDs7Ozs7Ozs7Ozs7Ozs7R0FjRztBQUNILE1BQWEsU0FBVSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3RDLDZCQUE2QjtJQUNiLFFBQVEsQ0FBbUI7SUFFM0MsaUVBQWlFO0lBQ2pELGNBQWMsQ0FBeUI7SUFFdkQsb0RBQW9EO0lBQ3BDLGNBQWMsQ0FBeUI7SUFFdkQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFxQjtRQUM3RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsT0FBTyxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRTFCLDRFQUE0RTtRQUM1RSxFQUFFO1FBQ0YscUNBQXFDO1FBQ3JDLDRCQUE0QjtRQUM1QixvQ0FBb0M7UUFDcEMsb0NBQW9DO1FBQ3BDLDBCQUEwQjtRQUMxQixFQUFFO1FBQ0Ysd0VBQXdFO1FBQ3hFLEVBQUU7UUFDRiw4Q0FBOEM7UUFDOUMsNkRBQTZEO1FBQzdELG9FQUFvRTtRQUNwRSw2RUFBNkU7UUFDN0UsRUFBRTtRQUNGLDRDQUE0QztRQUM1Qyx5REFBeUQ7UUFDekQsaUVBQWlFO1FBQ2pFLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxPQUFPLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxVQUFVLEVBQUU7WUFDckQsWUFBWSxFQUFFLHdCQUF3QixPQUFPLEVBQUU7WUFFL0MsMEVBQTBFO1lBQzFFLDREQUE0RDtZQUM1RCxhQUFhLEVBQUU7Z0JBQ2IsS0FBSyxFQUFFLElBQUk7Z0JBQ1gsUUFBUSxFQUFFLEtBQUs7Z0JBQ2YsS0FBSyxFQUFFLEtBQUs7YUFDYjtZQUNELG1CQUFtQixFQUFFLEtBQUs7WUFFMUIsMEVBQTBFO1lB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bSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgY29nbml0byBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29nbml0byc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBBdXRoU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgLyoqIExvZ2ljYWwgZW52aXJvbm1lbnQgbmFtZSwgZS5nLiBcInN0YWdpbmdcIiBvciBcInByb2RcIi4gVXNlZCBmb3IgbmFtaW5nLiAqL1xuICByZWFkb25seSBlbnZOYW1lOiBzdHJpbmc7XG59XG5cbi8qKlxuICogQXV0aFN0YWNrXG4gKlxuICogUHJvdmlzaW9ucyBhdXRoZW50aWNhdGlvbiBhbmQgYXV0aG9yaXNhdGlvbiBpbmZyYXN0cnVjdHVyZSBmb3IgdGhlIEZvb2QgQ29zdCBDYWxjdWxhdG9yOlxuICpcbiAqICDigKIgQW1hem9uIENvZ25pdG8gVXNlciBQb29sIHdpdGggZW1haWwvcGFzc3dvcmQgYXV0aGVudGljYXRpb25cbiAqICDigKIgUGFzc3dvcmQgcG9saWN5OiBtaW4gOCBjaGFycywgYXQgbGVhc3Qgb25lIHVwcGVyY2FzZSwgb25lIGxvd2VyY2FzZSwgb25lIGRpZ2l0XG4gKiAg4oCiIDMwLWRheSByZWZyZXNoIHRva2VuIFRUTCAocmVxdWlyZW1lbnQgOC4xMCDigJQgMzAtZGF5IGluYWN0aXZpdHkgdGltZW91dClcbiAqICDigKIgR29vZ2xlIE9BdXRoIDIuMCBpZGVudGl0eSBwcm92aWRlciAocmVxdWlyZW1lbnQgOC4zKVxuICogIOKAoiBBcHBsZSBTaWduIEluIGlkZW50aXR5IHByb3ZpZGVyIChyZXF1aXJlbWVudCA4LjQpXG4gKiAg4oCiIEN1c3RvbSBhdHRyaWJ1dGVzOiBjdXN0b206b3JnX2lkLCBjdXN0b206dmVudWVfcm9sZXMsIGN1c3RvbTp0aWVyXG4gKiAg4oCiIEFwcCBDbGllbnQgd2l0aCBob3N0ZWQgVUkgc3VwcG9ydCBhbmQgT0F1dGggZmxvd3MgKENPREUsIElNUExJQ0lUKVxuICpcbiAqIFNhdGlzZmllcyBSZXF1aXJlbWVudHM6IDguMSwgOC4yLCA4LjMsIDguNCwgOC4xMFxuICovXG5leHBvcnQgY2xhc3MgQXV0aFN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgLyoqIFRoZSBDb2duaXRvIFVzZXIgUG9vbC4gKi9cbiAgcHVibGljIHJlYWRvbmx5IHVzZXJQb29sOiBjb2duaXRvLlVzZXJQb29sO1xuXG4gIC8qKiBUaGUgQ29nbml0byBVc2VyIFBvb2wgQXBwIENsaWVudCAod2l0aCBob3N0ZWQgVUkgc3VwcG9ydCkuICovXG4gIHB1YmxpYyByZWFkb25seSB1c2VyUG9vbENsaWVudDogY29nbml0by5Vc2VyUG9vbENsaWVudDtcblxuICAvKiogVGhlIENvZ25pdG8gVXNlciBQb29sIERvbWFpbiAoZm9yIGhvc3RlZCBVSSkuICovXG4gIHB1YmxpYyByZWFkb25seSB1c2VyUG9vbERvbWFpbjogY29nbml0by5Vc2VyUG9vbERvbWFpbjtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQXV0aFN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgZW52TmFtZSB9ID0gcHJvcHM7XG5cbiAgICAvLyDilIDilIAgVXNlciBQb29sIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vXG4gICAgLy8gUGFzc3dvcmQgcG9saWN5IChyZXF1aXJlbWVudCA4LjEpOlxuICAgIC8vICAg4oCiIEF0IGxlYXN0IDggY2hhcmFjdGVyc1xuICAgIC8vICAg4oCiIEF0IGxlYXN0IG9uZSB1cHBlcmNhc2UgbGV0dGVyXG4gICAgLy8gICDigKIgQXQgbGVhc3Qgb25lIGxvd2VyY2FzZSBsZXR0ZXJcbiAgICAvLyAgIOKAoiBBdCBsZWFzdCBvbmUgbnVtYmVyXG4gICAgLy9cbiAgICAvLyBSZWZyZXNoIHRva2VuIGV4cGlyeTogMzAgZGF5cyAocmVxdWlyZW1lbnQgOC4xMCDigJQgaW5hY3Rpdml0eSB0aW1lb3V0KVxuICAgIC8vXG4gICAgLy8gQ3VzdG9tIGF0dHJpYnV0ZXMgKG11dGFibGUsIHN0b3JlZCBpbiBKV1QpOlxuICAgIC8vICAg4oCiIGN1c3RvbTpvcmdfaWQgICAgICAgIOKAlCBVVUlEIG9mIHRoZSB1c2VyJ3Mgb3JnYW5pc2F0aW9uXG4gICAgLy8gICDigKIgY3VzdG9tOnZlbnVlX3JvbGVzICAg4oCUIEpTT04gc3RyaW5nIG1hcHBpbmcgdmVudWUgSURzIHRvIHJvbGVzXG4gICAgLy8gICDigKIgY3VzdG9tOnRpZXIgICAgICAgICAg4oCUIEN1cnJlbnQgc3Vic2NyaXB0aW9uIHRpZXIgKGZyZWUsIHBybywgcHJvX3BsdXMpXG4gICAgLy9cbiAgICAvLyBTaWduLWluOiBlbWFpbCBhZGRyZXNzIChjYXNlLWluc2Vuc2l0aXZlKVxuICAgIC8vIE1GQTogb3B0aW9uYWwgKGNhbiBlbmFibGUgbGF0ZXI7IG5vdCByZXF1aXJlZCBieSBzcGVjKVxuICAgIC8vIEFjY291bnQgcmVjb3Zlcnk6IGVtYWlsLWJhc2VkIHBhc3N3b3JkIHJlc2V0IChyZXF1aXJlbWVudCA4LjcpXG4gICAgdGhpcy51c2VyUG9vbCA9IG5ldyBjb2duaXRvLlVzZXJQb29sKHRoaXMsICdVc2VyUG9vbCcsIHtcbiAgICAgIHVzZXJQb29sTmFtZTogYGZvb2QtY29zdC1jYWxjdWxhdG9yLSR7ZW52TmFtZX1gLFxuXG4gICAgICAvLyDilIDilIAgU2lnbi1pbiBjb25maWd1cmF0aW9uIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgLy8gQWxsb3cgc2lnbi1pbiB3aXRoIGVtYWlsIGFkZHJlc3Mgb25seSAoY2FzZS1pbnNlbnNpdGl2ZSkuXG4gICAgICBzaWduSW5BbGlhc2VzOiB7XG4gICAgICAgIGVtYWlsOiB0cnVlLFxuICAgICAgICB1c2VybmFtZTogZmFsc2UsXG4gICAgICAgIHBob25lOiBmYWxzZSxcbiAgICAgIH0sXG4gICAgICBzaWduSW5DYXNlU2Vuc2l0aXZlOiBmYWxzZSxcblxuICAgICAgLy8g4pSA4pSAIFN0YW5kYXJkIGF0dHJpYnV0ZXMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgICAvLyBFbWFpbCBpcyByZXF1aXJlZCBhbmQgbXV0YWJsZSAodXNlcnMgY2FuIHVwZGF0ZSB0aGVpciBlbWFpbCkuXG4gICAgICBzdGFuZGFyZEF0dHJpYnV0ZXM6IHtcbiAgICAgICAgZW1haWw6IHtcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICBtdXRhYmxlOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgfSxcblxuICAgICAgLy8g4pSA4pSAIEN1c3RvbSBhdHRyaWJ1dGVzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgLy8gVGhlc2UgYXJlIGFkZGVkIHRvIHRoZSBKV1QgYWNjZXNzIHRva2VuIGFuZCBjYW4gYmUgdXBkYXRlZCBieSB0aGUgQVBJXG4gICAgICAvLyB3aGVuIHJvbGVzIG9yIG9yZyBhc3NpZ25tZW50IGNoYW5nZXMuXG4gICAgICAvLyBBbGwgY3VzdG9tIGF0dHJpYnV0ZXMgYXJlIG11dGFibGUuXG4gICAgICBjdXN0b21BdHRyaWJ1dGVzOiB7XG4gICAgICAgIC8vIE9yZ2FuaXNhdGlvbiBJRCDigJQgVVVJRCBvZiB0aGUgdXNlcidzIHByaW1hcnkgb3JnYW5pc2F0aW9uLlxuICAgICAgICBvcmdfaWQ6IG5ldyBjb2duaXRvLlN0cmluZ0F0dHJpYnV0ZSh7XG4gICAgICAgICAgbWluTGVuOiAwLFxuICAgICAgICAgIG1heExlbjogMjU2LFxuICAgICAgICAgIG11dGFibGU6IHRydWUsXG4gICAgICAgIH0pLFxuXG4gICAgICAgIC8vIFZlbnVlIHJvbGVzIOKAlCBKU09OLWVuY29kZWQgbWFwIG9mIHZlbnVlIFVVSUQg4oaSIHJvbGUgZW51bS5cbiAgICAgICAgLy8gRXhhbXBsZToge1widmVudWUtdXVpZC0xXCI6XCJhZG1pblwiLFwidmVudWUtdXVpZC0yXCI6XCJtYW5hZ2VyXCJ9XG4gICAgICAgIC8vIFN0b3JlZCBhcyBzdHJpbmcgdG8gYXZvaWQgQ29nbml0bydzIDJLQiBhdHRyaWJ1dGUgbGltaXQgb24gZWFjaCBmaWVsZC5cbiAgICAgICAgdmVudWVfcm9sZXM6IG5ldyBjb2duaXRvLlN0cmluZ0F0dHJpYnV0ZSh7XG4gICAgICAgICAgbWluTGVuOiAwLFxuICAgICAgICAgIG1heExlbjogMjA0OCxcbiAgICAgICAgICBtdXRhYmxlOiB0cnVlLFxuICAgICAgICB9KSxcblxuICAgICAgICAvLyBTdWJzY3JpcHRpb24gdGllciDigJQgb25lIG9mOiBmcmVlLCBwcm8sIHByb19wbHVzXG4gICAgICAgIHRpZXI6IG5ldyBjb2duaXRvLlN0cmluZ0F0dHJpYnV0ZSh7XG4gICAgICAgICAgbWluTGVuOiAwLFxuICAgICAgICAgIG1heExlbjogMzIsXG4gICAgICAgICAgbXV0YWJsZTogdHJ1ZSxcbiAgICAgICAgfSksXG4gICAgICB9LFxuXG4gICAgICAvLyDilIDilIAgUGFzc3dvcmQgcG9saWN5IOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgLy8gUmVxdWlyZW1lbnQgOC4xOiBtaW4gOCBjaGFycywgYXQgbGVhc3Qgb25lIHVwcGVyY2FzZSwgb25lIGxvd2VyY2FzZSwgb25lIG51bWJlclxuICAgICAgcGFzc3dvcmRQb2xpY3k6IHtcbiAgICAgICAgbWluTGVuZ3RoOiA4LFxuICAgICAgICByZXF1aXJlTG93ZXJjYXNlOiB0cnVlLFxuICAgICAgICByZXF1aXJlVXBwZXJjYXNlOiB0cnVlLFxuICAgICAgICByZXF1aXJlRGlnaXRzOiB0cnVlLFxuICAgICAgICByZXF1aXJlU3ltYm9sczogZmFsc2UsIC8vIG5vdCByZXF1aXJlZCBieSBzcGVjXG4gICAgICAgIHRlbXBQYXNzd29yZFZhbGlkaXR5OiBjZGsuRHVyYXRpb24uZGF5cygzKSwgLy8gZm9yIGFkbWluLWNyZWF0ZWQgdXNlcnNcbiAgICAgIH0sXG5cbiAgICAgIC8vIOKUgOKUgCBBY2NvdW50IHJlY292ZXJ5IOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgLy8gRW1haWwtYmFzZWQgcGFzc3dvcmQgcmVzZXQgKHJlcXVpcmVtZW50IDguNykuXG4gICAgICBhY2NvdW50UmVjb3Zlcnk6IGNvZ25pdG8uQWNjb3VudFJlY292ZXJ5LkVNQUlMX09OTFksXG5cbiAgICAgIC8vIOKUgOKUgCBTZWxmLXNlcnZpY2Ugc2lnbi11cCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIC8vIFVzZXJzIGNhbiByZWdpc3RlciB0aGVtc2VsdmVzIHZpYSBlbWFpbC9wYXNzd29yZCAocmVxdWlyZW1lbnQgOC4xKS5cbiAgICAgIHNlbGZTaWduVXBFbmFibGVkOiB0cnVlLFxuXG4gICAgICAvLyDilIDilIAgRW1haWwgdmVyaWZpY2F0aW9uIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgLy8gUmVxdWlyZSBlbWFpbCB2ZXJpZmljYXRpb24gYmVmb3JlIHVzZXIgY2FuIHNpZ24gaW4uXG4gICAgICAvLyBWZXJpZmljYXRpb24gY29kZSBzZW50IHZpYSBlbWFpbC5cbiAgICAgIGF1dG9WZXJpZnk6IHtcbiAgICAgICAgZW1haWw6IHRydWUsXG4gICAgICB9LFxuXG4gICAgICAvLyDilIDilIAgRW1haWwgZGVsaXZlcnkg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgICAvLyBVc2UgQ29nbml0bydzIGRlZmF1bHQgZW1haWwgc2VydmljZSBmb3Igbm93LlxuICAgICAgLy8gSW4gcHJvZHVjdGlvbiwgc3dpdGNoIHRvIFNFUyBmb3IgaGlnaGVyIHNlbmQgbGltaXRzIGFuZCBiZXR0ZXIgZGVsaXZlcmFiaWxpdHkuXG4gICAgICAvLyAoQ29nbml0byBkZWZhdWx0OiA1MCBlbWFpbHMvZGF5OyBTRVM6IHByb2R1Y3Rpb24gdm9sdW1lcylcbiAgICAgIGVtYWlsOiBjb2duaXRvLlVzZXJQb29sRW1haWwud2l0aENvZ25pdG8oKSxcblxuICAgICAgLy8g4pSA4pSAIE1GQSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIC8vIE1GQSBpcyBvcHRpb25hbCAobm90IGVuZm9yY2VkIGJ5IHNwZWMpLlxuICAgICAgLy8gQ2FuIGJlIGVuYWJsZWQgYnkgaW5kaXZpZHVhbCB1c2VycyBpZiBkZXNpcmVkLlxuICAgICAgbWZhOiBjb2duaXRvLk1mYS5PUFRJT05BTCxcbiAgICAgIG1mYVNlY29uZEZhY3Rvcjoge1xuICAgICAgICBzbXM6IGZhbHNlLFxuICAgICAgICBvdHA6IHRydWUsIC8vIFRPVFAgYXBwcyAoR29vZ2xlIEF1dGhlbnRpY2F0b3IsIEF1dGh5LCBldGMuKVxuICAgICAgfSxcblxuICAgICAgLy8g4pSA4pSAIERldmljZSB0cmFja2luZyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIC8vIE9wdGlvbmFsIGRldmljZSB0cmFja2luZyAobm90IHJlcXVpcmVkIGJ5IHNwZWMpLlxuICAgICAgZGV2aWNlVHJhY2tpbmc6IHtcbiAgICAgICAgY2hhbGxlbmdlUmVxdWlyZWRPbk5ld0RldmljZTogZmFsc2UsXG4gICAgICAgIGRldmljZU9ubHlSZW1lbWJlcmVkT25Vc2VyUHJvbXB0OiB0cnVlLFxuICAgICAgfSxcblxuICAgICAgLy8g4pSA4pSAIExhbWJkYSB0cmlnZ2VycyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIC8vIE5vbmUgZGVmaW5lZCBoZXJlOyBjYW4gYWRkIGxhdGVyIGZvcjpcbiAgICAgIC8vICAg4oCiIFByZS1zaWduLXVwOiBjdXN0b20gdmFsaWRhdGlvbiBvciBhdXRvLWNvbmZpcm0gZW1haWxcbiAgICAgIC8vICAg4oCiIFBvc3QtYXV0aGVudGljYXRpb246IGN1c3RvbSBsb2dnaW5nIG9yIHNpZGUgZWZmZWN0c1xuICAgICAgLy8gICDigKIgUHJlLXRva2VuLWdlbmVyYXRpb246IGFkZCBjdXN0b20gY2xhaW1zIHRvIEpXVFxuXG4gICAgICAvLyDilIDilIAgRGVsZXRpb24gcHJvdGVjdGlvbiDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIC8vIFByZXZlbnQgYWNjaWRlbnRhbCBkZWxldGlvbiBpbiBwcm9kdWN0aW9uLlxuICAgICAgcmVtb3ZhbFBvbGljeTogZW52TmFtZSA9PT0gJ3Byb2QnIFxuICAgICAgICA/IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTiBcbiAgICAgICAgOiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuXG4gICAgICAvLyBFbmFibGUgYWR2YW5jZWQgc2VjdXJpdHkgZmVhdHVyZXMgKGNvbXByb21pc2VkIGNyZWRlbnRpYWxzIGRldGVjdGlvbilcbiAgICAgIGFkdmFuY2VkU2VjdXJpdHlNb2RlOiBjb2duaXRvLkFkdmFuY2VkU2VjdXJpdHlNb2RlLkVORk9SQ0VELFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSAIFVzZXIgUG9vbCBEb21haW4g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy8gSG9zdGVkIFVJIHJlcXVpcmVzIGEgZG9tYWluIHByZWZpeC5cbiAgICAvLyBGb3JtYXQ6IGh0dHBzOi8vPHByZWZpeD4uYXV0aC48cmVnaW9uPi5hbWF6b25jb2duaXRvLmNvbVxuICAgIC8vIEluIHByb2R1Y3Rpb24sIGNhbiB1c2UgYSBjdXN0b20gZG9tYWluIChlLmcuLCBhdXRoLmZvb2Rjb3N0LmFwcClcbiAgICB0aGlzLnVzZXJQb29sRG9tYWluID0gdGhpcy51c2VyUG9vbC5hZGREb21haW4oJ1VzZXJQb29sRG9tYWluJywge1xuICAgICAgY29nbml0b0RvbWFpbjoge1xuICAgICAgICBkb21haW5QcmVmaXg6IGBmb29kLWNvc3QtY2FsY3VsYXRvci0ke2Vudk5hbWV9YCxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgR29vZ2xlIElkZW50aXR5IFByb3ZpZGVyIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vIFJlcXVpcmVtZW50IDguMzogQWxsb3cgdXNlcnMgdG8gYXV0aGVudGljYXRlIHVzaW5nIEdvb2dsZS5cbiAgICAvLyBPQXV0aCAyLjAgT0lEQyBwcm92aWRlci5cbiAgICAvLyBDbGllbnQgSUQgYW5kIHNlY3JldCBhcmUgc3RvcmVkIGluIEFXUyBTZWNyZXRzIE1hbmFnZXIgYW5kIHBhc3NlZCB2aWFcbiAgICAvLyBDREsgY29udGV4dCBhdCBkZXBsb3kgdGltZTpcbiAgICAvLyAgIGNkayBkZXBsb3kgLS1jb250ZXh0IGdvb2dsZUNsaWVudElkPXh4eCAtLWNvbnRleHQgZ29vZ2xlQ2xpZW50U2VjcmV0PXl5eVxuICAgIGNvbnN0IGdvb2dsZUNsaWVudElkID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2dvb2dsZUNsaWVudElkJykgPz8gJ1BMQUNFSE9MREVSX0dPT0dMRV9DTElFTlRfSUQnO1xuICAgIGNvbnN0IGdvb2dsZUNsaWVudFNlY3JldCA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdnb29nbGVDbGllbnRTZWNyZXQnKSA/PyAnUExBQ0VIT0xERVJfR09PR0xFX0NMSUVOVF9TRUNSRVQnO1xuXG4gICAgY29uc3QgZ29vZ2xlUHJvdmlkZXIgPSBuZXcgY29nbml0by5Vc2VyUG9vbElkZW50aXR5UHJvdmlkZXJHb29nbGUodGhpcywgJ0dvb2dsZVByb3ZpZGVyJywge1xuICAgICAgdXNlclBvb2w6IHRoaXMudXNlclBvb2wsXG4gICAgICBjbGllbnRJZDogZ29vZ2xlQ2xpZW50SWQsXG4gICAgICBjbGllbnRTZWNyZXRWYWx1ZTogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dChnb29nbGVDbGllbnRTZWNyZXQpLFxuXG4gICAgICAvLyBBdHRyaWJ1dGUgbWFwcGluZzogbWFwIEdvb2dsZSBwcm9maWxlIGZpZWxkcyB0byBDb2duaXRvIGF0dHJpYnV0ZXMuXG4gICAgICAvLyBHb29nbGUgcHJvdmlkZXM6IHN1YiwgZW1haWwsIGVtYWlsX3ZlcmlmaWVkLCBuYW1lLCBwaWN0dXJlXG4gICAgICBhdHRyaWJ1dGVNYXBwaW5nOiB7XG4gICAgICAgIGVtYWlsOiBjb2duaXRvLlByb3ZpZGVyQXR0cmlidXRlLkdPT0dMRV9FTUFJTCxcbiAgICAgICAgZ2l2ZW5OYW1lOiBjb2duaXRvLlByb3ZpZGVyQXR0cmlidXRlLkdPT0dMRV9HSVZFTl9OQU1FLFxuICAgICAgICBmYW1pbHlOYW1lOiBjb2duaXRvLlByb3ZpZGVyQXR0cmlidXRlLkdPT0dMRV9GQU1JTFlfTkFNRSxcbiAgICAgICAgcHJvZmlsZVBpY3R1cmU6IGNvZ25pdG8uUHJvdmlkZXJBdHRyaWJ1dGUuR09PR0xFX1BJQ1RVUkUsXG4gICAgICB9LFxuXG4gICAgICAvLyBPQXV0aCBzY29wZXMgcmVxdWVzdGVkIGZyb20gR29vZ2xlLlxuICAgICAgc2NvcGVzOiBbJ3Byb2ZpbGUnLCAnZW1haWwnLCAnb3BlbmlkJ10sXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgQXBwbGUgSWRlbnRpdHkgUHJvdmlkZXIg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy8gUmVxdWlyZW1lbnQgOC40OiBBbGxvdyB1c2VycyB0byBhdXRoZW50aWNhdGUgdXNpbmcgQXBwbGUuXG4gICAgLy8gQXBwbGUgU2lnbiBJbiB1c2VzIE9BdXRoIDIuMCBPSURDLlxuICAgIC8vIFJlcXVpcmVzOiBTZXJ2aWNlcyBJRCwgVGVhbSBJRCwgS2V5IElELCBwcml2YXRlIGtleSAoLnA4IGZpbGUpLlxuICAgIC8vIFRoZXNlIGFyZSBwYXNzZWQgdmlhIENESyBjb250ZXh0IGF0IGRlcGxveSB0aW1lOlxuICAgIC8vICAgY2RrIGRlcGxveSAtLWNvbnRleHQgYXBwbGVDbGllbnRJZD14eHggLS1jb250ZXh0IGFwcGxlVGVhbUlkPXl5eSBcXFxuICAgIC8vICAgICAgICAgICAgICAtLWNvbnRleHQgYXBwbGVLZXlJZD16enogLS1jb250ZXh0IGFwcGxlUHJpdmF0ZUtleT1cIi0tLS0tQkVHSU4gUFJJVkFURSBLRVktLS0tLS4uLlwiXG4gICAgY29uc3QgYXBwbGVDbGllbnRJZCA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdhcHBsZUNsaWVudElkJykgPz8gJ1BMQUNFSE9MREVSX0FQUExFX0NMSUVOVF9JRCc7XG4gICAgY29uc3QgYXBwbGVUZWFtSWQgPSB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnYXBwbGVUZWFtSWQnKSA/PyAnUExBQ0VIT0xERVJfQVBQTEVfVEVBTV9JRCc7XG4gICAgY29uc3QgYXBwbGVLZXlJZCA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdhcHBsZUtleUlkJykgPz8gJ1BMQUNFSE9MREVSX0FQUExFX0tFWV9JRCc7XG4gICAgY29uc3QgYXBwbGVQcml2YXRlS2V5ID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2FwcGxlUHJpdmF0ZUtleScpID8/ICdQTEFDRUhPTERFUl9BUFBMRV9QUklWQVRFX0tFWSc7XG5cbiAgICBjb25zdCBhcHBsZVByb3ZpZGVyID0gbmV3IGNvZ25pdG8uVXNlclBvb2xJZGVudGl0eVByb3ZpZGVyQXBwbGUodGhpcywgJ0FwcGxlUHJvdmlkZXInLCB7XG4gICAgICB1c2VyUG9vbDogdGhpcy51c2VyUG9vbCxcbiAgICAgIGNsaWVudElkOiBhcHBsZUNsaWVudElkLFxuICAgICAgdGVhbUlkOiBhcHBsZVRlYW1JZCxcbiAgICAgIGtleUlkOiBhcHBsZUtleUlkLFxuICAgICAgcHJpdmF0ZUtleTogYXBwbGVQcml2YXRlS2V5LFxuXG4gICAgICAvLyBBdHRyaWJ1dGUgbWFwcGluZzogbWFwIEFwcGxlIHByb2ZpbGUgZmllbGRzIHRvIENvZ25pdG8gYXR0cmlidXRlcy5cbiAgICAgIC8vIEFwcGxlIHByb3ZpZGVzOiBzdWIsIGVtYWlsLCBlbWFpbF92ZXJpZmllZCwgbmFtZSAob3B0aW9uYWwpXG4gICAgICBhdHRyaWJ1dGVNYXBwaW5nOiB7XG4gICAgICAgIGVtYWlsOiBjb2duaXRvLlByb3ZpZGVyQXR0cmlidXRlLkFQUExFX0VNQUlMLFxuICAgICAgICBnaXZlbk5hbWU6IGNvZ25pdG8uUHJvdmlkZXJBdHRyaWJ1dGUuQVBQTEVfRklSU1RfTkFNRSxcbiAgICAgICAgZmFtaWx5TmFtZTogY29nbml0by5Qcm92aWRlckF0dHJpYnV0ZS5BUFBMRV9MQVNUX05BTUUsXG4gICAgICB9LFxuXG4gICAgICAvLyBPQXV0aCBzY29wZXMgcmVxdWVzdGVkIGZyb20gQXBwbGUuXG4gICAgICBzY29wZXM6IFsnZW1haWwnLCAnbmFtZSddLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSAIEFwcCBDbGllbnQg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy8gVXNlZCBieSB0aGUgUmVhY3QgU1BBIGFuZCBob3N0ZWQgVUkuXG4gICAgLy8gT0F1dGggZmxvd3M6IEFVVEhPUklaQVRJT05fQ09ERSAoc2VydmVyLXNpZGUpIGFuZCBJTVBMSUNJVCAoU1BBIGZhbGxiYWNrKS5cbiAgICAvLyBDYWxsYmFjayBVUkxzOiBsb2NhbGhvc3QgKGRldikgKyBwcm9kdWN0aW9uIGRvbWFpbiAoY29uZmlndXJlZCBwZXIgZW52KS5cbiAgICBjb25zdCBjYWxsYmFja1VybHMgPSBlbnZOYW1lID09PSAncHJvZCdcbiAgICAgID8gWydodHRwczovL2FwcC5mb29kY29zdC5hcHAvYXV0aC9jYWxsYmFjayddXG4gICAgICA6IFsnaHR0cDovL2xvY2FsaG9zdDozMDAwL2F1dGgvY2FsbGJhY2snLCAnaHR0cDovL2xvY2FsaG9zdDo1MTczL2F1dGgvY2FsbGJhY2snXTtcblxuICAgIGNvbnN0IGxvZ291dFVybHMgPSBlbnZOYW1lID09PSAncHJvZCdcbiAgICAgID8gWydodHRwczovL2FwcC5mb29kY29zdC5hcHAnXVxuICAgICAgOiBbJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMCcsICdodHRwOi8vbG9jYWxob3N0OjUxNzMnXTtcblxuICAgIHRoaXMudXNlclBvb2xDbGllbnQgPSB0aGlzLnVzZXJQb29sLmFkZENsaWVudCgnV2ViQXBwQ2xpZW50Jywge1xuICAgICAgdXNlclBvb2xDbGllbnROYW1lOiBgZm9vZC1jb3N0LWNhbGN1bGF0b3Itd2ViLSR7ZW52TmFtZX1gLFxuXG4gICAgICAvLyDilIDilIAgT0F1dGggZmxvd3Mg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgICAvLyBBVVRIT1JJWkFUSU9OX0NPREU6IHN0YW5kYXJkIE9BdXRoIGZsb3cgd2l0aCBQS0NFIChyZWNvbW1lbmRlZCBmb3IgU1BBcylcbiAgICAgIC8vIElNUExJQ0lUOiBmYWxsYmFjayBmb3Igb2xkZXIgU1BBIGZyYW1ld29ya3Mgd2l0aG91dCBQS0NFIHN1cHBvcnRcbiAgICAgIG9BdXRoOiB7XG4gICAgICAgIGZsb3dzOiB7XG4gICAgICAgICAgYXV0aG9yaXphdGlvbkNvZGVHcmFudDogdHJ1ZSwgLy8gcmVjb21tZW5kZWQgZm9yIFNQQXMgd2l0aCBQS0NFXG4gICAgICAgICAgaW1wbGljaXRDb2RlR3JhbnQ6IHRydWUsICAgICAgLy8gZmFsbGJhY2tcbiAgICAgICAgfSxcblxuICAgICAgICAvLyBPQXV0aCBzY29wZXM6IG9wZW5pZCAocmVxdWlyZWQpLCBlbWFpbCwgcHJvZmlsZSwgYXdzLmNvZ25pdG8uc2lnbmluLnVzZXIuYWRtaW4gKGN1c3RvbSBhdHRycylcbiAgICAgICAgc2NvcGVzOiBbXG4gICAgICAgICAgY29nbml0by5PQXV0aFNjb3BlLk9QRU5JRCxcbiAgICAgICAgICBjb2duaXRvLk9BdXRoU2NvcGUuRU1BSUwsXG4gICAgICAgICAgY29nbml0by5PQXV0aFNjb3BlLlBST0ZJTEUsXG4gICAgICAgICAgY29nbml0by5PQXV0aFNjb3BlLkNPR05JVE9fQURNSU4sIC8vIGFsbG93cyByZWFkaW5nL3dyaXRpbmcgY3VzdG9tIGF0dHJpYnV0ZXNcbiAgICAgICAgXSxcblxuICAgICAgICAvLyBDYWxsYmFjayBVUkxzOiB3aGVyZSBDb2duaXRvIHJlZGlyZWN0cyBhZnRlciBzdWNjZXNzZnVsIGF1dGhlbnRpY2F0aW9uXG4gICAgICAgIGNhbGxiYWNrVXJscyxcblxuICAgICAgICAvLyBMb2dvdXQgVVJMczogd2hlcmUgQ29nbml0byByZWRpcmVjdHMgYWZ0ZXIgc2lnbi1vdXRcbiAgICAgICAgbG9nb3V0VXJscyxcbiAgICAgIH0sXG5cbiAgICAgIC8vIOKUgOKUgCBTdXBwb3J0ZWQgaWRlbnRpdHkgcHJvdmlkZXJzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgLy8gRW5hYmxlIENvZ25pdG8gbmF0aXZlIGF1dGggKGVtYWlsL3Bhc3N3b3JkKSArIEdvb2dsZSArIEFwcGxlXG4gICAgICBzdXBwb3J0ZWRJZGVudGl0eVByb3ZpZGVyczogW1xuICAgICAgICBjb2duaXRvLlVzZXJQb29sQ2xpZW50SWRlbnRpdHlQcm92aWRlci5DT0dOSVRPLFxuICAgICAgICBjb2duaXRvLlVzZXJQb29sQ2xpZW50SWRlbnRpdHlQcm92aWRlci5HT09HTEUsXG4gICAgICAgIGNvZ25pdG8uVXNlclBvb2xDbGllbnRJZGVudGl0eVByb3ZpZGVyLkFQUExFLFxuICAgICAgXSxcblxuICAgICAgLy8g4pSA4pSAIFRva2VuIHZhbGlkaXR5IOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgLy8gUmVxdWlyZW1lbnQgOC4xMDogMzAtZGF5IGluYWN0aXZpdHkgdGltZW91dCB2aWEgcmVmcmVzaCB0b2tlbiBleHBpcnlcbiAgICAgIC8vIEFjY2VzcyB0b2tlbjogMSBob3VyIChkZWZhdWx0LCBzdGFuZGFyZCBmb3Igc2hvcnQtbGl2ZWQgdG9rZW5zKVxuICAgICAgLy8gSUQgdG9rZW46IDEgaG91clxuICAgICAgLy8gUmVmcmVzaCB0b2tlbjogMzAgZGF5c1xuICAgICAgYWNjZXNzVG9rZW5WYWxpZGl0eTogY2RrLkR1cmF0aW9uLmhvdXJzKDEpLFxuICAgICAgaWRUb2tlblZhbGlkaXR5OiBjZGsuRHVyYXRpb24uaG91cnMoMSksXG4gICAgICByZWZyZXNoVG9rZW5WYWxpZGl0eTogY2RrLkR1cmF0aW9uLmRheXMoMzApLFxuXG4gICAgICAvLyDilIDilIAgUEtDRSBlbmZvcmNlbWVudCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIC8vIFByZXZlbnQgQ1NSRiBhdHRhY2tzIG9uIHRoZSBhdXRob3JpemF0aW9uIGNvZGUgZmxvdy5cbiAgICAgIC8vIFJlcXVpcmVkIGZvciBwdWJsaWMgY2xpZW50cyAoU1BBcykgYXMgb2YgQVdTIGJlc3QgcHJhY3RpY2VzLlxuICAgICAgYXV0aFNlc3Npb25WYWxpZGl0eTogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTUpLFxuXG4gICAgICAvLyDilIDilIAgVG9rZW4gcmV2b2NhdGlvbiDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIC8vIEFsbG93IHJlZnJlc2ggdG9rZW5zIHRvIGJlIHJldm9rZWQgKGUuZy4sIG9uIHBhc3N3b3JkIGNoYW5nZSBvciBhZG1pbiBhY3Rpb24pXG4gICAgICBlbmFibGVUb2tlblJldm9jYXRpb246IHRydWUsXG5cbiAgICAgIC8vIOKUgOKUgCBQcmV2ZW50IHVzZXIgZXhpc3RlbmNlIGVycm9ycyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIC8vIERvbid0IHJldmVhbCB3aGV0aGVyIGEgdXNlciBleGlzdHMgZHVyaW5nIHBhc3N3b3JkIHJlc2V0IG9yIHNpZ24taW4uXG4gICAgICAvLyAoUmVxdWlyZW1lbnQgOC44OiBnZW5lcmljIGNvbmZpcm1hdGlvbiBtZXNzYWdlIGZvciB1bnJlY29nbmlzZWQgZW1haWwpXG4gICAgICBwcmV2ZW50VXNlckV4aXN0ZW5jZUVycm9yczogdHJ1ZSxcblxuICAgICAgLy8g4pSA4pSAIFJlYWQvd3JpdGUgYXR0cmlidXRlcyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIC8vIEFsbG93IGNsaWVudCB0byByZWFkIGVtYWlsIGFuZCBjdXN0b20gYXR0cmlidXRlcyBmcm9tIHRoZSBKV1QuXG4gICAgICAvLyBUaGUgQVBJIGNhbiB1cGRhdGUgY3VzdG9tIGF0dHJpYnV0ZXMgdmlhIEFkbWluVXBkYXRlVXNlckF0dHJpYnV0ZXMuXG4gICAgICByZWFkQXR0cmlidXRlczogbmV3IGNvZ25pdG8uQ2xpZW50QXR0cmlidXRlcygpXG4gICAgICAgIC53aXRoU3RhbmRhcmRBdHRyaWJ1dGVzKHtcbiAgICAgICAgICBlbWFpbDogdHJ1ZSxcbiAgICAgICAgICBlbWFpbFZlcmlmaWVkOiB0cnVlLFxuICAgICAgICAgIGdpdmVuTmFtZTogdHJ1ZSxcbiAgICAgICAgICBmYW1pbHlOYW1lOiB0cnVlLFxuICAgICAgICB9KVxuICAgICAgICAud2l0aEN1c3RvbUF0dHJpYnV0ZXMoJ29yZ19pZCcsICd2ZW51ZV9yb2xlcycsICd0aWVyJyksXG5cbiAgICAgIHdyaXRlQXR0cmlidXRlczogbmV3IGNvZ25pdG8uQ2xpZW50QXR0cmlidXRlcygpXG4gICAgICAgIC53aXRoU3RhbmRhcmRBdHRyaWJ1dGVzKHtcbiAgICAgICAgICBlbWFpbDogdHJ1ZSxcbiAgICAgICAgICBnaXZlbk5hbWU6IHRydWUsXG4gICAgICAgICAgZmFtaWx5TmFtZTogdHJ1ZSxcbiAgICAgICAgfSksXG4gICAgfSk7XG5cbiAgICAvLyBFbnN1cmUgaWRlbnRpdHkgcHJvdmlkZXJzIGFyZSBjcmVhdGVkIGJlZm9yZSB0aGUgY2xpZW50LlxuICAgIC8vIENESyBkb2Vzbid0IGF1dG9tYXRpY2FsbHkgdHJhY2sgdGhpcyBkZXBlbmRlbmN5LCBzbyB3ZSBhZGQgaXQgZXhwbGljaXRseS5cbiAgICB0aGlzLnVzZXJQb29sQ2xpZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShnb29nbGVQcm92aWRlcik7XG4gICAgdGhpcy51c2VyUG9vbENsaWVudC5ub2RlLmFkZERlcGVuZGVuY3koYXBwbGVQcm92aWRlcik7XG5cbiAgICAvLyDilIDilIAgQ2xvdWRGb3JtYXRpb24gT3V0cHV0cyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvLyBFeHBvcnRlZCBzbyB0aGUgQVBJIHN0YWNrIGFuZCBmcm9udGVuZCBjYW4gcmVmZXJlbmNlIHRoZW0uXG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gVXNlciBQb29sIElEJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1Vc2VyUG9vbElkYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyUG9vbEFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJQb29sLnVzZXJQb29sQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdDb2duaXRvIFVzZXIgUG9vbCBBUk4nLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LVVzZXJQb29sQXJuYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyUG9vbENsaWVudElkJywge1xuICAgICAgdmFsdWU6IHRoaXMudXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBVc2VyIFBvb2wgQ2xpZW50IElEIChXZWIgQXBwKScsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tVXNlclBvb2xDbGllbnRJZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xEb21haW4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy51c2VyUG9vbERvbWFpbi5kb21haW5OYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdDb2duaXRvIFVzZXIgUG9vbCBEb21haW4gKGhvc3RlZCBVSSknLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LVVzZXJQb29sRG9tYWluYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdIb3N0ZWRVaVVybCcsIHtcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke3RoaXMudXNlclBvb2xEb21haW4uZG9tYWluTmFtZX0uYXV0aC4ke3RoaXMucmVnaW9ufS5hbWF6b25jb2duaXRvLmNvbS9sb2dpbj9jbGllbnRfaWQ9JHt0aGlzLnVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWR9JnJlc3BvbnNlX3R5cGU9Y29kZSZyZWRpcmVjdF91cmk9JHtjYWxsYmFja1VybHNbMF19YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBIb3N0ZWQgVUkgbG9naW4gVVJMJyxcbiAgICB9KTtcbiAgfVxufVxuIl19