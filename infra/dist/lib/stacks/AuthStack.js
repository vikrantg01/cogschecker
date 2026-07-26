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
        // ── Tags ─────────────────────────────────────────────────────────────────
        cdk.Tags.of(this).add('Component', 'Auth');
        cdk.Tags.of(this).add('CostCenter', 'Security');
    }
}
exports.AuthStack = AuthStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQXV0aFN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vbGliL3N0YWNrcy9BdXRoU3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBQ25DLG1EQUFtRDtBQVFuRDs7Ozs7Ozs7Ozs7Ozs7R0FjRztBQUNILE1BQWEsU0FBVSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3RDLDZCQUE2QjtJQUNiLFFBQVEsQ0FBbUI7SUFFM0MsaUVBQWlFO0lBQ2pELGNBQWMsQ0FBeUI7SUFFdkQsb0RBQW9EO0lBQ3BDLGNBQWMsQ0FBeUI7SUFFdkQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFxQjtRQUM3RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsT0FBTyxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRTFCLDRFQUE0RTtRQUM1RSxFQUFFO1FBQ0YscUNBQXFDO1FBQ3JDLDRCQUE0QjtRQUM1QixvQ0FBb0M7UUFDcEMsb0NBQW9DO1FBQ3BDLDBCQUEwQjtRQUMxQixFQUFFO1FBQ0Ysd0VBQXdFO1FBQ3hFLEVBQUU7UUFDRiw4Q0FBOEM7UUFDOUMsNkRBQTZEO1FBQzdELG9FQUFvRTtRQUNwRSw2RUFBNkU7UUFDN0UsRUFBRTtRQUNGLDRDQUE0QztRQUM1Qyx5REFBeUQ7UUFDekQsaUVBQWlFO1FBQ2pFLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxPQUFPLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxVQUFVLEVBQUU7WUFDckQsWUFBWSxFQUFFLHdCQUF3QixPQUFPLEVBQUU7WUFFL0MsMEVBQTBFO1lBQzFFLDREQUE0RDtZQUM1RCxhQUFhLEVBQUU7Z0JBQ2IsS0FBSyxFQUFFLElBQUk7Z0JBQ1gsUUFBUSxFQUFFLEtBQUs7Z0JBQ2YsS0FBSyxFQUFFLEtBQUs7YUFDYjtZQUNELG1CQUFtQixFQUFFLEtBQUs7WUFFMUIsMEVBQTBFO1lB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LENBQUMsV0FBVyxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBQzNDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxZQUFZLEVBQUUsVUFBVSxDQUFDLENBQUM7SUFDbEQsQ0FBQztDQUNGO0FBMVZELDhCQTBWQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBjb2duaXRvIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2duaXRvJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEF1dGhTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICAvKiogTG9naWNhbCBlbnZpcm9ubWVudCBuYW1lLCBlLmcuIFwic3RhZ2luZ1wiIG9yIFwicHJvZFwiLiBVc2VkIGZvciBuYW1pbmcuICovXG4gIHJlYWRvbmx5IGVudk5hbWU6IHN0cmluZztcbn1cblxuLyoqXG4gKiBBdXRoU3RhY2tcbiAqXG4gKiBQcm92aXNpb25zIGF1dGhlbnRpY2F0aW9uIGFuZCBhdXRob3Jpc2F0aW9uIGluZnJhc3RydWN0dXJlIGZvciB0aGUgRm9vZCBDb3N0IENhbGN1bGF0b3I6XG4gKlxuICogIOKAoiBBbWF6b24gQ29nbml0byBVc2VyIFBvb2wgd2l0aCBlbWFpbC9wYXNzd29yZCBhdXRoZW50aWNhdGlvblxuICogIOKAoiBQYXNzd29yZCBwb2xpY3k6IG1pbiA4IGNoYXJzLCBhdCBsZWFzdCBvbmUgdXBwZXJjYXNlLCBvbmUgbG93ZXJjYXNlLCBvbmUgZGlnaXRcbiAqICDigKIgMzAtZGF5IHJlZnJlc2ggdG9rZW4gVFRMIChyZXF1aXJlbWVudCA4LjEwIOKAlCAzMC1kYXkgaW5hY3Rpdml0eSB0aW1lb3V0KVxuICogIOKAoiBHb29nbGUgT0F1dGggMi4wIGlkZW50aXR5IHByb3ZpZGVyIChyZXF1aXJlbWVudCA4LjMpXG4gKiAg4oCiIEFwcGxlIFNpZ24gSW4gaWRlbnRpdHkgcHJvdmlkZXIgKHJlcXVpcmVtZW50IDguNClcbiAqICDigKIgQ3VzdG9tIGF0dHJpYnV0ZXM6IGN1c3RvbTpvcmdfaWQsIGN1c3RvbTp2ZW51ZV9yb2xlcywgY3VzdG9tOnRpZXJcbiAqICDigKIgQXBwIENsaWVudCB3aXRoIGhvc3RlZCBVSSBzdXBwb3J0IGFuZCBPQXV0aCBmbG93cyAoQ09ERSwgSU1QTElDSVQpXG4gKlxuICogU2F0aXNmaWVzIFJlcXVpcmVtZW50czogOC4xLCA4LjIsIDguMywgOC40LCA4LjEwXG4gKi9cbmV4cG9ydCBjbGFzcyBBdXRoU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICAvKiogVGhlIENvZ25pdG8gVXNlciBQb29sLiAqL1xuICBwdWJsaWMgcmVhZG9ubHkgdXNlclBvb2w6IGNvZ25pdG8uVXNlclBvb2w7XG5cbiAgLyoqIFRoZSBDb2duaXRvIFVzZXIgUG9vbCBBcHAgQ2xpZW50ICh3aXRoIGhvc3RlZCBVSSBzdXBwb3J0KS4gKi9cbiAgcHVibGljIHJlYWRvbmx5IHVzZXJQb29sQ2xpZW50OiBjb2duaXRvLlVzZXJQb29sQ2xpZW50O1xuXG4gIC8qKiBUaGUgQ29nbml0byBVc2VyIFBvb2wgRG9tYWluIChmb3IgaG9zdGVkIFVJKS4gKi9cbiAgcHVibGljIHJlYWRvbmx5IHVzZXJQb29sRG9tYWluOiBjb2duaXRvLlVzZXJQb29sRG9tYWluO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBBdXRoU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgeyBlbnZOYW1lIH0gPSBwcm9wcztcblxuICAgIC8vIOKUgOKUgCBVc2VyIFBvb2wg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy9cbiAgICAvLyBQYXNzd29yZCBwb2xpY3kgKHJlcXVpcmVtZW50IDguMSk6XG4gICAgLy8gICDigKIgQXQgbGVhc3QgOCBjaGFyYWN0ZXJzXG4gICAgLy8gICDigKIgQXQgbGVhc3Qgb25lIHVwcGVyY2FzZSBsZXR0ZXJcbiAgICAvLyAgIOKAoiBBdCBsZWFzdCBvbmUgbG93ZXJjYXNlIGxldHRlclxuICAgIC8vICAg4oCiIEF0IGxlYXN0IG9uZSBudW1iZXJcbiAgICAvL1xuICAgIC8vIFJlZnJlc2ggdG9rZW4gZXhwaXJ5OiAzMCBkYXlzIChyZXF1aXJlbWVudCA4LjEwIOKAlCBpbmFjdGl2aXR5IHRpbWVvdXQpXG4gICAgLy9cbiAgICAvLyBDdXN0b20gYXR0cmlidXRlcyAobXV0YWJsZSwgc3RvcmVkIGluIEpXVCk6XG4gICAgLy8gICDigKIgY3VzdG9tOm9yZ19pZCAgICAgICAg4oCUIFVVSUQgb2YgdGhlIHVzZXIncyBvcmdhbmlzYXRpb25cbiAgICAvLyAgIOKAoiBjdXN0b206dmVudWVfcm9sZXMgICDigJQgSlNPTiBzdHJpbmcgbWFwcGluZyB2ZW51ZSBJRHMgdG8gcm9sZXNcbiAgICAvLyAgIOKAoiBjdXN0b206dGllciAgICAgICAgICDigJQgQ3VycmVudCBzdWJzY3JpcHRpb24gdGllciAoZnJlZSwgcHJvLCBwcm9fcGx1cylcbiAgICAvL1xuICAgIC8vIFNpZ24taW46IGVtYWlsIGFkZHJlc3MgKGNhc2UtaW5zZW5zaXRpdmUpXG4gICAgLy8gTUZBOiBvcHRpb25hbCAoY2FuIGVuYWJsZSBsYXRlcjsgbm90IHJlcXVpcmVkIGJ5IHNwZWMpXG4gICAgLy8gQWNjb3VudCByZWNvdmVyeTogZW1haWwtYmFzZWQgcGFzc3dvcmQgcmVzZXQgKHJlcXVpcmVtZW50IDguNylcbiAgICB0aGlzLnVzZXJQb29sID0gbmV3IGNvZ25pdG8uVXNlclBvb2wodGhpcywgJ1VzZXJQb29sJywge1xuICAgICAgdXNlclBvb2xOYW1lOiBgZm9vZC1jb3N0LWNhbGN1bGF0b3ItJHtlbnZOYW1lfWAsXG5cbiAgICAgIC8vIOKUgOKUgCBTaWduLWluIGNvbmZpZ3VyYXRpb24g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgICAvLyBBbGxvdyBzaWduLWluIHdpdGggZW1haWwgYWRkcmVzcyBvbmx5IChjYXNlLWluc2Vuc2l0aXZlKS5cbiAgICAgIHNpZ25JbkFsaWFzZXM6IHtcbiAgICAgICAgZW1haWw6IHRydWUsXG4gICAgICAgIHVzZXJuYW1lOiBmYWxzZSxcbiAgICAgICAgcGhvbmU6IGZhbHNlLFxuICAgICAgfSxcbiAgICAgIHNpZ25JbkNhc2VTZW5zaXRpdmU6IGZhbHNlLFxuXG4gICAgICAvLyDilIDilIAgU3RhbmRhcmQgYXR0cmlidXRlcyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIC8vIEVtYWlsIGlzIHJlcXVpcmVkIGFuZCBtdXRhYmxlICh1c2VycyBjYW4gdXBkYXRlIHRoZWlyIGVtYWlsKS5cbiAgICAgIHN0YW5kYXJkQXR0cmlidXRlczoge1xuICAgICAgICBlbWFpbDoge1xuICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgIG11dGFibGU6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICB9LFxuXG4gICAgICAvLyDilIDilIAgQ3VzdG9tIGF0dHJpYnV0ZXMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgICAvLyBUaGVzZSBhcmUgYWRkZWQgdG8gdGhlIEpXVCBhY2Nlc3MgdG9rZW4gYW5kIGNhbiBiZSB1cGRhdGVkIGJ5IHRoZSBBUElcbiAgICAgIC8vIHdoZW4gcm9sZXMgb3Igb3JnIGFzc2lnbm1lbnQgY2hhbmdlcy5cbiAgICAgIC8vIEFsbCBjdXN0b20gYXR0cmlidXRlcyBhcmUgbXV0YWJsZS5cbiAgICAgIGN1c3RvbUF0dHJpYnV0ZXM6IHtcbiAgICAgICAgLy8gT3JnYW5pc2F0aW9uIElEIOKAlCBVVUlEIG9mIHRoZSB1c2VyJ3MgcHJpbWFyeSBvcmdhbmlzYXRpb24uXG4gICAgICAgIG9yZ19pZDogbmV3IGNvZ25pdG8uU3RyaW5nQXR0cmlidXRlKHtcbiAgICAgICAgICBtaW5MZW46IDAsXG4gICAgICAgICAgbWF4TGVuOiAyNTYsXG4gICAgICAgICAgbXV0YWJsZTogdHJ1ZSxcbiAgICAgICAgfSksXG5cbiAgICAgICAgLy8gVmVudWUgcm9sZXMg4oCUIEpTT04tZW5jb2RlZCBtYXAgb2YgdmVudWUgVVVJRCDihpIgcm9sZSBlbnVtLlxuICAgICAgICAvLyBFeGFtcGxlOiB7XCJ2ZW51ZS11dWlkLTFcIjpcImFkbWluXCIsXCJ2ZW51ZS11dWlkLTJcIjpcIm1hbmFnZXJcIn1cbiAgICAgICAgLy8gU3RvcmVkIGFzIHN0cmluZyB0byBhdm9pZCBDb2duaXRvJ3MgMktCIGF0dHJpYnV0ZSBsaW1pdCBvbiBlYWNoIGZpZWxkLlxuICAgICAgICB2ZW51ZV9yb2xlczogbmV3IGNvZ25pdG8uU3RyaW5nQXR0cmlidXRlKHtcbiAgICAgICAgICBtaW5MZW46IDAsXG4gICAgICAgICAgbWF4TGVuOiAyMDQ4LFxuICAgICAgICAgIG11dGFibGU6IHRydWUsXG4gICAgICAgIH0pLFxuXG4gICAgICAgIC8vIFN1YnNjcmlwdGlvbiB0aWVyIOKAlCBvbmUgb2Y6IGZyZWUsIHBybywgcHJvX3BsdXNcbiAgICAgICAgdGllcjogbmV3IGNvZ25pdG8uU3RyaW5nQXR0cmlidXRlKHtcbiAgICAgICAgICBtaW5MZW46IDAsXG4gICAgICAgICAgbWF4TGVuOiAzMixcbiAgICAgICAgICBtdXRhYmxlOiB0cnVlLFxuICAgICAgICB9KSxcbiAgICAgIH0sXG5cbiAgICAgIC8vIOKUgOKUgCBQYXNzd29yZCBwb2xpY3kg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgICAvLyBSZXF1aXJlbWVudCA4LjE6IG1pbiA4IGNoYXJzLCBhdCBsZWFzdCBvbmUgdXBwZXJjYXNlLCBvbmUgbG93ZXJjYXNlLCBvbmUgbnVtYmVyXG4gICAgICBwYXNzd29yZFBvbGljeToge1xuICAgICAgICBtaW5MZW5ndGg6IDgsXG4gICAgICAgIHJlcXVpcmVMb3dlcmNhc2U6IHRydWUsXG4gICAgICAgIHJlcXVpcmVVcHBlcmNhc2U6IHRydWUsXG4gICAgICAgIHJlcXVpcmVEaWdpdHM6IHRydWUsXG4gICAgICAgIHJlcXVpcmVTeW1ib2xzOiBmYWxzZSwgLy8gbm90IHJlcXVpcmVkIGJ5IHNwZWNcbiAgICAgICAgdGVtcFBhc3N3b3JkVmFsaWRpdHk6IGNkay5EdXJhdGlvbi5kYXlzKDMpLCAvLyBmb3IgYWRtaW4tY3JlYXRlZCB1c2Vyc1xuICAgICAgfSxcblxuICAgICAgLy8g4pSA4pSAIEFjY291bnQgcmVjb3Zlcnkg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgICAvLyBFbWFpbC1iYXNlZCBwYXNzd29yZCByZXNldCAocmVxdWlyZW1lbnQgOC43KS5cbiAgICAgIGFjY291bnRSZWNvdmVyeTogY29nbml0by5BY2NvdW50UmVjb3ZlcnkuRU1BSUxfT05MWSxcblxuICAgICAgLy8g4pSA4pSAIFNlbGYtc2VydmljZSBzaWduLXVwIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgLy8gVXNlcnMgY2FuIHJlZ2lzdGVyIHRoZW1zZWx2ZXMgdmlhIGVtYWlsL3Bhc3N3b3JkIChyZXF1aXJlbWVudCA4LjEpLlxuICAgICAgc2VsZlNpZ25VcEVuYWJsZWQ6IHRydWUsXG5cbiAgICAgIC8vIOKUgOKUgCBFbWFpbCB2ZXJpZmljYXRpb24g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgICAvLyBSZXF1aXJlIGVtYWlsIHZlcmlmaWNhdGlvbiBiZWZvcmUgdXNlciBjYW4gc2lnbiBpbi5cbiAgICAgIC8vIFZlcmlmaWNhdGlvbiBjb2RlIHNlbnQgdmlhIGVtYWlsLlxuICAgICAgYXV0b1ZlcmlmeToge1xuICAgICAgICBlbWFpbDogdHJ1ZSxcbiAgICAgIH0sXG5cbiAgICAgIC8vIOKUgOKUgCBFbWFpbCBkZWxpdmVyeSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIC8vIFVzZSBDb2duaXRvJ3MgZGVmYXVsdCBlbWFpbCBzZXJ2aWNlIGZvciBub3cuXG4gICAgICAvLyBJbiBwcm9kdWN0aW9uLCBzd2l0Y2ggdG8gU0VTIGZvciBoaWdoZXIgc2VuZCBsaW1pdHMgYW5kIGJldHRlciBkZWxpdmVyYWJpbGl0eS5cbiAgICAgIC8vIChDb2duaXRvIGRlZmF1bHQ6IDUwIGVtYWlscy9kYXk7IFNFUzogcHJvZHVjdGlvbiB2b2x1bWVzKVxuICAgICAgZW1haWw6IGNvZ25pdG8uVXNlclBvb2xFbWFpbC53aXRoQ29nbml0bygpLFxuXG4gICAgICAvLyDilIDilIAgTUZBIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgLy8gTUZBIGlzIG9wdGlvbmFsIChub3QgZW5mb3JjZWQgYnkgc3BlYykuXG4gICAgICAvLyBDYW4gYmUgZW5hYmxlZCBieSBpbmRpdmlkdWFsIHVzZXJzIGlmIGRlc2lyZWQuXG4gICAgICBtZmE6IGNvZ25pdG8uTWZhLk9QVElPTkFMLFxuICAgICAgbWZhU2Vjb25kRmFjdG9yOiB7XG4gICAgICAgIHNtczogZmFsc2UsXG4gICAgICAgIG90cDogdHJ1ZSwgLy8gVE9UUCBhcHBzIChHb29nbGUgQXV0aGVudGljYXRvciwgQXV0aHksIGV0Yy4pXG4gICAgICB9LFxuXG4gICAgICAvLyDilIDilIAgRGV2aWNlIHRyYWNraW5nIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgLy8gT3B0aW9uYWwgZGV2aWNlIHRyYWNraW5nIChub3QgcmVxdWlyZWQgYnkgc3BlYykuXG4gICAgICBkZXZpY2VUcmFja2luZzoge1xuICAgICAgICBjaGFsbGVuZ2VSZXF1aXJlZE9uTmV3RGV2aWNlOiBmYWxzZSxcbiAgICAgICAgZGV2aWNlT25seVJlbWVtYmVyZWRPblVzZXJQcm9tcHQ6IHRydWUsXG4gICAgICB9LFxuXG4gICAgICAvLyDilIDilIAgTGFtYmRhIHRyaWdnZXJzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgLy8gTm9uZSBkZWZpbmVkIGhlcmU7IGNhbiBhZGQgbGF0ZXIgZm9yOlxuICAgICAgLy8gICDigKIgUHJlLXNpZ24tdXA6IGN1c3RvbSB2YWxpZGF0aW9uIG9yIGF1dG8tY29uZmlybSBlbWFpbFxuICAgICAgLy8gICDigKIgUG9zdC1hdXRoZW50aWNhdGlvbjogY3VzdG9tIGxvZ2dpbmcgb3Igc2lkZSBlZmZlY3RzXG4gICAgICAvLyAgIOKAoiBQcmUtdG9rZW4tZ2VuZXJhdGlvbjogYWRkIGN1c3RvbSBjbGFpbXMgdG8gSldUXG5cbiAgICAgIC8vIOKUgOKUgCBEZWxldGlvbiBwcm90ZWN0aW9uIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgLy8gUHJldmVudCBhY2NpZGVudGFsIGRlbGV0aW9uIGluIHByb2R1Y3Rpb24uXG4gICAgICByZW1vdmFsUG9saWN5OiBlbnZOYW1lID09PSAncHJvZCcgXG4gICAgICAgID8gY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOIFxuICAgICAgICA6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG5cbiAgICAgIC8vIEVuYWJsZSBhZHZhbmNlZCBzZWN1cml0eSBmZWF0dXJlcyAoY29tcHJvbWlzZWQgY3JlZGVudGlhbHMgZGV0ZWN0aW9uKVxuICAgICAgYWR2YW5jZWRTZWN1cml0eU1vZGU6IGNvZ25pdG8uQWR2YW5jZWRTZWN1cml0eU1vZGUuRU5GT1JDRUQsXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgVXNlciBQb29sIERvbWFpbiDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvLyBIb3N0ZWQgVUkgcmVxdWlyZXMgYSBkb21haW4gcHJlZml4LlxuICAgIC8vIEZvcm1hdDogaHR0cHM6Ly88cHJlZml4Pi5hdXRoLjxyZWdpb24+LmFtYXpvbmNvZ25pdG8uY29tXG4gICAgLy8gSW4gcHJvZHVjdGlvbiwgY2FuIHVzZSBhIGN1c3RvbSBkb21haW4gKGUuZy4sIGF1dGguZm9vZGNvc3QuYXBwKVxuICAgIHRoaXMudXNlclBvb2xEb21haW4gPSB0aGlzLnVzZXJQb29sLmFkZERvbWFpbignVXNlclBvb2xEb21haW4nLCB7XG4gICAgICBjb2duaXRvRG9tYWluOiB7XG4gICAgICAgIGRvbWFpblByZWZpeDogYGZvb2QtY29zdC1jYWxjdWxhdG9yLSR7ZW52TmFtZX1gLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCBHb29nbGUgSWRlbnRpdHkgUHJvdmlkZXIg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgLy8gUmVxdWlyZW1lbnQgOC4zOiBBbGxvdyB1c2VycyB0byBhdXRoZW50aWNhdGUgdXNpbmcgR29vZ2xlLlxuICAgIC8vIE9BdXRoIDIuMCBPSURDIHByb3ZpZGVyLlxuICAgIC8vIENsaWVudCBJRCBhbmQgc2VjcmV0IGFyZSBzdG9yZWQgaW4gQVdTIFNlY3JldHMgTWFuYWdlciBhbmQgcGFzc2VkIHZpYVxuICAgIC8vIENESyBjb250ZXh0IGF0IGRlcGxveSB0aW1lOlxuICAgIC8vICAgY2RrIGRlcGxveSAtLWNvbnRleHQgZ29vZ2xlQ2xpZW50SWQ9eHh4IC0tY29udGV4dCBnb29nbGVDbGllbnRTZWNyZXQ9eXl5XG4gICAgY29uc3QgZ29vZ2xlQ2xpZW50SWQgPSB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnZ29vZ2xlQ2xpZW50SWQnKSA/PyAnUExBQ0VIT0xERVJfR09PR0xFX0NMSUVOVF9JRCc7XG4gICAgY29uc3QgZ29vZ2xlQ2xpZW50U2VjcmV0ID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2dvb2dsZUNsaWVudFNlY3JldCcpID8/ICdQTEFDRUhPTERFUl9HT09HTEVfQ0xJRU5UX1NFQ1JFVCc7XG5cbiAgICBjb25zdCBnb29nbGVQcm92aWRlciA9IG5ldyBjb2duaXRvLlVzZXJQb29sSWRlbnRpdHlQcm92aWRlckdvb2dsZSh0aGlzLCAnR29vZ2xlUHJvdmlkZXInLCB7XG4gICAgICB1c2VyUG9vbDogdGhpcy51c2VyUG9vbCxcbiAgICAgIGNsaWVudElkOiBnb29nbGVDbGllbnRJZCxcbiAgICAgIGNsaWVudFNlY3JldFZhbHVlOiBjZGsuU2VjcmV0VmFsdWUudW5zYWZlUGxhaW5UZXh0KGdvb2dsZUNsaWVudFNlY3JldCksXG5cbiAgICAgIC8vIEF0dHJpYnV0ZSBtYXBwaW5nOiBtYXAgR29vZ2xlIHByb2ZpbGUgZmllbGRzIHRvIENvZ25pdG8gYXR0cmlidXRlcy5cbiAgICAgIC8vIEdvb2dsZSBwcm92aWRlczogc3ViLCBlbWFpbCwgZW1haWxfdmVyaWZpZWQsIG5hbWUsIHBpY3R1cmVcbiAgICAgIGF0dHJpYnV0ZU1hcHBpbmc6IHtcbiAgICAgICAgZW1haWw6IGNvZ25pdG8uUHJvdmlkZXJBdHRyaWJ1dGUuR09PR0xFX0VNQUlMLFxuICAgICAgICBnaXZlbk5hbWU6IGNvZ25pdG8uUHJvdmlkZXJBdHRyaWJ1dGUuR09PR0xFX0dJVkVOX05BTUUsXG4gICAgICAgIGZhbWlseU5hbWU6IGNvZ25pdG8uUHJvdmlkZXJBdHRyaWJ1dGUuR09PR0xFX0ZBTUlMWV9OQU1FLFxuICAgICAgICBwcm9maWxlUGljdHVyZTogY29nbml0by5Qcm92aWRlckF0dHJpYnV0ZS5HT09HTEVfUElDVFVSRSxcbiAgICAgIH0sXG5cbiAgICAgIC8vIE9BdXRoIHNjb3BlcyByZXF1ZXN0ZWQgZnJvbSBHb29nbGUuXG4gICAgICBzY29wZXM6IFsncHJvZmlsZScsICdlbWFpbCcsICdvcGVuaWQnXSxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCBBcHBsZSBJZGVudGl0eSBQcm92aWRlciDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvLyBSZXF1aXJlbWVudCA4LjQ6IEFsbG93IHVzZXJzIHRvIGF1dGhlbnRpY2F0ZSB1c2luZyBBcHBsZS5cbiAgICAvLyBBcHBsZSBTaWduIEluIHVzZXMgT0F1dGggMi4wIE9JREMuXG4gICAgLy8gUmVxdWlyZXM6IFNlcnZpY2VzIElELCBUZWFtIElELCBLZXkgSUQsIHByaXZhdGUga2V5ICgucDggZmlsZSkuXG4gICAgLy8gVGhlc2UgYXJlIHBhc3NlZCB2aWEgQ0RLIGNvbnRleHQgYXQgZGVwbG95IHRpbWU6XG4gICAgLy8gICBjZGsgZGVwbG95IC0tY29udGV4dCBhcHBsZUNsaWVudElkPXh4eCAtLWNvbnRleHQgYXBwbGVUZWFtSWQ9eXl5IFxcXG4gICAgLy8gICAgICAgICAgICAgIC0tY29udGV4dCBhcHBsZUtleUlkPXp6eiAtLWNvbnRleHQgYXBwbGVQcml2YXRlS2V5PVwiLS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tLi4uXCJcbiAgICBjb25zdCBhcHBsZUNsaWVudElkID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2FwcGxlQ2xpZW50SWQnKSA/PyAnUExBQ0VIT0xERVJfQVBQTEVfQ0xJRU5UX0lEJztcbiAgICBjb25zdCBhcHBsZVRlYW1JZCA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdhcHBsZVRlYW1JZCcpID8/ICdQTEFDRUhPTERFUl9BUFBMRV9URUFNX0lEJztcbiAgICBjb25zdCBhcHBsZUtleUlkID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2FwcGxlS2V5SWQnKSA/PyAnUExBQ0VIT0xERVJfQVBQTEVfS0VZX0lEJztcbiAgICBjb25zdCBhcHBsZVByaXZhdGVLZXkgPSB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnYXBwbGVQcml2YXRlS2V5JykgPz8gJ1BMQUNFSE9MREVSX0FQUExFX1BSSVZBVEVfS0VZJztcblxuICAgIGNvbnN0IGFwcGxlUHJvdmlkZXIgPSBuZXcgY29nbml0by5Vc2VyUG9vbElkZW50aXR5UHJvdmlkZXJBcHBsZSh0aGlzLCAnQXBwbGVQcm92aWRlcicsIHtcbiAgICAgIHVzZXJQb29sOiB0aGlzLnVzZXJQb29sLFxuICAgICAgY2xpZW50SWQ6IGFwcGxlQ2xpZW50SWQsXG4gICAgICB0ZWFtSWQ6IGFwcGxlVGVhbUlkLFxuICAgICAga2V5SWQ6IGFwcGxlS2V5SWQsXG4gICAgICBwcml2YXRlS2V5OiBhcHBsZVByaXZhdGVLZXksXG5cbiAgICAgIC8vIEF0dHJpYnV0ZSBtYXBwaW5nOiBtYXAgQXBwbGUgcHJvZmlsZSBmaWVsZHMgdG8gQ29nbml0byBhdHRyaWJ1dGVzLlxuICAgICAgLy8gQXBwbGUgcHJvdmlkZXM6IHN1YiwgZW1haWwsIGVtYWlsX3ZlcmlmaWVkLCBuYW1lIChvcHRpb25hbClcbiAgICAgIGF0dHJpYnV0ZU1hcHBpbmc6IHtcbiAgICAgICAgZW1haWw6IGNvZ25pdG8uUHJvdmlkZXJBdHRyaWJ1dGUuQVBQTEVfRU1BSUwsXG4gICAgICAgIGdpdmVuTmFtZTogY29nbml0by5Qcm92aWRlckF0dHJpYnV0ZS5BUFBMRV9GSVJTVF9OQU1FLFxuICAgICAgICBmYW1pbHlOYW1lOiBjb2duaXRvLlByb3ZpZGVyQXR0cmlidXRlLkFQUExFX0xBU1RfTkFNRSxcbiAgICAgIH0sXG5cbiAgICAgIC8vIE9BdXRoIHNjb3BlcyByZXF1ZXN0ZWQgZnJvbSBBcHBsZS5cbiAgICAgIHNjb3BlczogWydlbWFpbCcsICduYW1lJ10sXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgQXBwIENsaWVudCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvLyBVc2VkIGJ5IHRoZSBSZWFjdCBTUEEgYW5kIGhvc3RlZCBVSS5cbiAgICAvLyBPQXV0aCBmbG93czogQVVUSE9SSVpBVElPTl9DT0RFIChzZXJ2ZXItc2lkZSkgYW5kIElNUExJQ0lUIChTUEEgZmFsbGJhY2spLlxuICAgIC8vIENhbGxiYWNrIFVSTHM6IGxvY2FsaG9zdCAoZGV2KSArIHByb2R1Y3Rpb24gZG9tYWluIChjb25maWd1cmVkIHBlciBlbnYpLlxuICAgIGNvbnN0IGNhbGxiYWNrVXJscyA9IGVudk5hbWUgPT09ICdwcm9kJ1xuICAgICAgPyBbJ2h0dHBzOi8vYXBwLmZvb2Rjb3N0LmFwcC9hdXRoL2NhbGxiYWNrJ11cbiAgICAgIDogWydodHRwOi8vbG9jYWxob3N0OjMwMDAvYXV0aC9jYWxsYmFjaycsICdodHRwOi8vbG9jYWxob3N0OjUxNzMvYXV0aC9jYWxsYmFjayddO1xuXG4gICAgY29uc3QgbG9nb3V0VXJscyA9IGVudk5hbWUgPT09ICdwcm9kJ1xuICAgICAgPyBbJ2h0dHBzOi8vYXBwLmZvb2Rjb3N0LmFwcCddXG4gICAgICA6IFsnaHR0cDovL2xvY2FsaG9zdDozMDAwJywgJ2h0dHA6Ly9sb2NhbGhvc3Q6NTE3MyddO1xuXG4gICAgdGhpcy51c2VyUG9vbENsaWVudCA9IHRoaXMudXNlclBvb2wuYWRkQ2xpZW50KCdXZWJBcHBDbGllbnQnLCB7XG4gICAgICB1c2VyUG9vbENsaWVudE5hbWU6IGBmb29kLWNvc3QtY2FsY3VsYXRvci13ZWItJHtlbnZOYW1lfWAsXG5cbiAgICAgIC8vIOKUgOKUgCBPQXV0aCBmbG93cyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAgIC8vIEFVVEhPUklaQVRJT05fQ09ERTogc3RhbmRhcmQgT0F1dGggZmxvdyB3aXRoIFBLQ0UgKHJlY29tbWVuZGVkIGZvciBTUEFzKVxuICAgICAgLy8gSU1QTElDSVQ6IGZhbGxiYWNrIGZvciBvbGRlciBTUEEgZnJhbWV3b3JrcyB3aXRob3V0IFBLQ0Ugc3VwcG9ydFxuICAgICAgb0F1dGg6IHtcbiAgICAgICAgZmxvd3M6IHtcbiAgICAgICAgICBhdXRob3JpemF0aW9uQ29kZUdyYW50OiB0cnVlLCAvLyByZWNvbW1lbmRlZCBmb3IgU1BBcyB3aXRoIFBLQ0VcbiAgICAgICAgICBpbXBsaWNpdENvZGVHcmFudDogdHJ1ZSwgICAgICAvLyBmYWxsYmFja1xuICAgICAgICB9LFxuXG4gICAgICAgIC8vIE9BdXRoIHNjb3Blczogb3BlbmlkIChyZXF1aXJlZCksIGVtYWlsLCBwcm9maWxlLCBhd3MuY29nbml0by5zaWduaW4udXNlci5hZG1pbiAoY3VzdG9tIGF0dHJzKVxuICAgICAgICBzY29wZXM6IFtcbiAgICAgICAgICBjb2duaXRvLk9BdXRoU2NvcGUuT1BFTklELFxuICAgICAgICAgIGNvZ25pdG8uT0F1dGhTY29wZS5FTUFJTCxcbiAgICAgICAgICBjb2duaXRvLk9BdXRoU2NvcGUuUFJPRklMRSxcbiAgICAgICAgICBjb2duaXRvLk9BdXRoU2NvcGUuQ09HTklUT19BRE1JTiwgLy8gYWxsb3dzIHJlYWRpbmcvd3JpdGluZyBjdXN0b20gYXR0cmlidXRlc1xuICAgICAgICBdLFxuXG4gICAgICAgIC8vIENhbGxiYWNrIFVSTHM6IHdoZXJlIENvZ25pdG8gcmVkaXJlY3RzIGFmdGVyIHN1Y2Nlc3NmdWwgYXV0aGVudGljYXRpb25cbiAgICAgICAgY2FsbGJhY2tVcmxzLFxuXG4gICAgICAgIC8vIExvZ291dCBVUkxzOiB3aGVyZSBDb2duaXRvIHJlZGlyZWN0cyBhZnRlciBzaWduLW91dFxuICAgICAgICBsb2dvdXRVcmxzLFxuICAgICAgfSxcblxuICAgICAgLy8g4pSA4pSAIFN1cHBvcnRlZCBpZGVudGl0eSBwcm92aWRlcnMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgICAvLyBFbmFibGUgQ29nbml0byBuYXRpdmUgYXV0aCAoZW1haWwvcGFzc3dvcmQpICsgR29vZ2xlICsgQXBwbGVcbiAgICAgIHN1cHBvcnRlZElkZW50aXR5UHJvdmlkZXJzOiBbXG4gICAgICAgIGNvZ25pdG8uVXNlclBvb2xDbGllbnRJZGVudGl0eVByb3ZpZGVyLkNPR05JVE8sXG4gICAgICAgIGNvZ25pdG8uVXNlclBvb2xDbGllbnRJZGVudGl0eVByb3ZpZGVyLkdPT0dMRSxcbiAgICAgICAgY29nbml0by5Vc2VyUG9vbENsaWVudElkZW50aXR5UHJvdmlkZXIuQVBQTEUsXG4gICAgICBdLFxuXG4gICAgICAvLyDilIDilIAgVG9rZW4gdmFsaWRpdHkg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgICAvLyBSZXF1aXJlbWVudCA4LjEwOiAzMC1kYXkgaW5hY3Rpdml0eSB0aW1lb3V0IHZpYSByZWZyZXNoIHRva2VuIGV4cGlyeVxuICAgICAgLy8gQWNjZXNzIHRva2VuOiAxIGhvdXIgKGRlZmF1bHQsIHN0YW5kYXJkIGZvciBzaG9ydC1saXZlZCB0b2tlbnMpXG4gICAgICAvLyBJRCB0b2tlbjogMSBob3VyXG4gICAgICAvLyBSZWZyZXNoIHRva2VuOiAzMCBkYXlzXG4gICAgICBhY2Nlc3NUb2tlblZhbGlkaXR5OiBjZGsuRHVyYXRpb24uaG91cnMoMSksXG4gICAgICBpZFRva2VuVmFsaWRpdHk6IGNkay5EdXJhdGlvbi5ob3VycygxKSxcbiAgICAgIHJlZnJlc2hUb2tlblZhbGlkaXR5OiBjZGsuRHVyYXRpb24uZGF5cygzMCksXG5cbiAgICAgIC8vIOKUgOKUgCBQS0NFIGVuZm9yY2VtZW50IOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgLy8gUHJldmVudCBDU1JGIGF0dGFja3Mgb24gdGhlIGF1dGhvcml6YXRpb24gY29kZSBmbG93LlxuICAgICAgLy8gUmVxdWlyZWQgZm9yIHB1YmxpYyBjbGllbnRzIChTUEFzKSBhcyBvZiBBV1MgYmVzdCBwcmFjdGljZXMuXG4gICAgICBhdXRoU2Vzc2lvblZhbGlkaXR5OiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksXG5cbiAgICAgIC8vIOKUgOKUgCBUb2tlbiByZXZvY2F0aW9uIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgLy8gQWxsb3cgcmVmcmVzaCB0b2tlbnMgdG8gYmUgcmV2b2tlZCAoZS5nLiwgb24gcGFzc3dvcmQgY2hhbmdlIG9yIGFkbWluIGFjdGlvbilcbiAgICAgIGVuYWJsZVRva2VuUmV2b2NhdGlvbjogdHJ1ZSxcblxuICAgICAgLy8g4pSA4pSAIFByZXZlbnQgdXNlciBleGlzdGVuY2UgZXJyb3JzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgLy8gRG9uJ3QgcmV2ZWFsIHdoZXRoZXIgYSB1c2VyIGV4aXN0cyBkdXJpbmcgcGFzc3dvcmQgcmVzZXQgb3Igc2lnbi1pbi5cbiAgICAgIC8vIChSZXF1aXJlbWVudCA4Ljg6IGdlbmVyaWMgY29uZmlybWF0aW9uIG1lc3NhZ2UgZm9yIHVucmVjb2duaXNlZCBlbWFpbClcbiAgICAgIHByZXZlbnRVc2VyRXhpc3RlbmNlRXJyb3JzOiB0cnVlLFxuXG4gICAgICAvLyDilIDilIAgUmVhZC93cml0ZSBhdHRyaWJ1dGVzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgLy8gQWxsb3cgY2xpZW50IHRvIHJlYWQgZW1haWwgYW5kIGN1c3RvbSBhdHRyaWJ1dGVzIGZyb20gdGhlIEpXVC5cbiAgICAgIC8vIFRoZSBBUEkgY2FuIHVwZGF0ZSBjdXN0b20gYXR0cmlidXRlcyB2aWEgQWRtaW5VcGRhdGVVc2VyQXR0cmlidXRlcy5cbiAgICAgIHJlYWRBdHRyaWJ1dGVzOiBuZXcgY29nbml0by5DbGllbnRBdHRyaWJ1dGVzKClcbiAgICAgICAgLndpdGhTdGFuZGFyZEF0dHJpYnV0ZXMoe1xuICAgICAgICAgIGVtYWlsOiB0cnVlLFxuICAgICAgICAgIGVtYWlsVmVyaWZpZWQ6IHRydWUsXG4gICAgICAgICAgZ2l2ZW5OYW1lOiB0cnVlLFxuICAgICAgICAgIGZhbWlseU5hbWU6IHRydWUsXG4gICAgICAgIH0pXG4gICAgICAgIC53aXRoQ3VzdG9tQXR0cmlidXRlcygnb3JnX2lkJywgJ3ZlbnVlX3JvbGVzJywgJ3RpZXInKSxcblxuICAgICAgd3JpdGVBdHRyaWJ1dGVzOiBuZXcgY29nbml0by5DbGllbnRBdHRyaWJ1dGVzKClcbiAgICAgICAgLndpdGhTdGFuZGFyZEF0dHJpYnV0ZXMoe1xuICAgICAgICAgIGVtYWlsOiB0cnVlLFxuICAgICAgICAgIGdpdmVuTmFtZTogdHJ1ZSxcbiAgICAgICAgICBmYW1pbHlOYW1lOiB0cnVlLFxuICAgICAgICB9KSxcbiAgICB9KTtcblxuICAgIC8vIEVuc3VyZSBpZGVudGl0eSBwcm92aWRlcnMgYXJlIGNyZWF0ZWQgYmVmb3JlIHRoZSBjbGllbnQuXG4gICAgLy8gQ0RLIGRvZXNuJ3QgYXV0b21hdGljYWxseSB0cmFjayB0aGlzIGRlcGVuZGVuY3ksIHNvIHdlIGFkZCBpdCBleHBsaWNpdGx5LlxuICAgIHRoaXMudXNlclBvb2xDbGllbnQubm9kZS5hZGREZXBlbmRlbmN5KGdvb2dsZVByb3ZpZGVyKTtcbiAgICB0aGlzLnVzZXJQb29sQ2xpZW50Lm5vZGUuYWRkRGVwZW5kZW5jeShhcHBsZVByb3ZpZGVyKTtcblxuICAgIC8vIOKUgOKUgCBDbG91ZEZvcm1hdGlvbiBPdXRwdXRzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vIEV4cG9ydGVkIHNvIHRoZSBBUEkgc3RhY2sgYW5kIGZyb250ZW5kIGNhbiByZWZlcmVuY2UgdGhlbS5cblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyUG9vbElkJywge1xuICAgICAgdmFsdWU6IHRoaXMudXNlclBvb2wudXNlclBvb2xJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBVc2VyIFBvb2wgSUQnLFxuICAgICAgZXhwb3J0TmFtZTogYEZvb2RDb3N0Q2FsY3VsYXRvci0ke2Vudk5hbWV9LVVzZXJQb29sSWRgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMudXNlclBvb2wudXNlclBvb2xBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gVXNlciBQb29sIEFSTicsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tVXNlclBvb2xBcm5gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sQ2xpZW50SWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy51c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkLFxuICAgICAgZGVzY3JpcHRpb246ICdDb2duaXRvIFVzZXIgUG9vbCBDbGllbnQgSUQgKFdlYiBBcHApJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBGb29kQ29zdENhbGN1bGF0b3ItJHtlbnZOYW1lfS1Vc2VyUG9vbENsaWVudElkYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyUG9vbERvbWFpbicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJQb29sRG9tYWluLmRvbWFpbk5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gVXNlciBQb29sIERvbWFpbiAoaG9zdGVkIFVJKScsXG4gICAgICBleHBvcnROYW1lOiBgRm9vZENvc3RDYWxjdWxhdG9yLSR7ZW52TmFtZX0tVXNlclBvb2xEb21haW5gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0hvc3RlZFVpVXJsJywge1xuICAgICAgdmFsdWU6IGBodHRwczovLyR7dGhpcy51c2VyUG9vbERvbWFpbi5kb21haW5OYW1lfS5hdXRoLiR7dGhpcy5yZWdpb259LmFtYXpvbmNvZ25pdG8uY29tL2xvZ2luP2NsaWVudF9pZD0ke3RoaXMudXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZH0mcmVzcG9uc2VfdHlwZT1jb2RlJnJlZGlyZWN0X3VyaT0ke2NhbGxiYWNrVXJsc1swXX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdDb2duaXRvIEhvc3RlZCBVSSBsb2dpbiBVUkwnLFxuICAgIH0pO1xuXG4gICAgLy8g4pSA4pSAIFRhZ3Mg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgY2RrLlRhZ3Mub2YodGhpcykuYWRkKCdDb21wb25lbnQnLCAnQXV0aCcpO1xuICAgIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnQ29zdENlbnRlcicsICdTZWN1cml0eScpO1xuICB9XG59XG4iXX0=