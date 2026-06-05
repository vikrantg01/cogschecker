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
export declare class AuthStack extends cdk.Stack {
    /** The Cognito User Pool. */
    readonly userPool: cognito.UserPool;
    /** The Cognito User Pool App Client (with hosted UI support). */
    readonly userPoolClient: cognito.UserPoolClient;
    /** The Cognito User Pool Domain (for hosted UI). */
    readonly userPoolDomain: cognito.UserPoolDomain;
    constructor(scope: Construct, id: string, props: AuthStackProps);
}
