# AWS Deployment - Fixes Applied

**Date**: January 27, 2025  
**Account**: 333968387413  
**Region**: us-east-1

---

## Issues Encountered and Resolved

### Issue 1: Apple Sign In Provider - Invalid Credentials
**Error**: `Provided private key cannot be used for Sign in with Apple`

**Root Cause**: Apple Sign In requires real Apple Developer credentials (Services ID, Team ID, Key ID, and private key from .p8 file). Placeholder values don't work.

**Fix Applied**:
- ✅ Commented out Apple provider in `AuthStack.ts`
- ✅ Removed `APPLE` from `supportedIdentityProviders` array
- ✅ Removed dependency reference `appleProvider.node.addDependency`
- ✅ Google OAuth remains active
- ✅ Cognito native auth (email/password) remains active

**Status**: **RESOLVED** - Apple can be added later with real credentials

---

### Issue 2: Security Group Descriptions - Non-ASCII Characters
**Error**: `Character sets beyond ASCII are not supported`

**Root Cause**: Security group descriptions contained em dash (`—`) characters which AWS EC2 doesn't support. Only ASCII characters are allowed.

**Fix Applied**:
- ✅ Changed `ALB — internet-facing` → `ALB - internet-facing`
- ✅ Changed `ECS tasks — Spring Boot API` → `ECS tasks - Spring Boot API`
- ✅ Changed `RDS PostgreSQL — accepts connections` → `RDS PostgreSQL - accepts connections`
- ✅ Changed `ElastiCache Redis — accepts connections` → `ElastiCache Redis - accepts connections`

**Status**: **RESOLVED** - All security groups now use ASCII-only characters

---

## Deployment Status

### ✅ Completed Successfully
- **CDK Bootstrap**: us-east-1 region bootstrapped
- **Storage Stack**: S3 buckets created (fcc-frontend, fcc-invoices)

### ⏳ Ready for Deployment
- **Network Stack**: VPC, NAT Gateway, Security Groups (fixed)
- **Database Stack**: RDS PostgreSQL t4g.micro
- **Cache Stack**: ElastiCache Redis t4g.micro
- **Auth Stack**: Cognito User Pool with Google OAuth (Apple disabled)
- **Compute Stack**: ECS Fargate, ALB, ECR
- **Observability Stack**: CloudWatch, SNS, Budgets

---

## Changes Summary

### Files Modified
1. `/Users/vicky/cogschecker/infra/lib/stacks/AuthStack.ts`
   - Lines 210-242: Commented out Apple provider configuration
   - Lines 276-280: Removed APPLE from supported identity providers
   - Line 339: Removed appleProvider dependency

2. `/Users/vicky/cogschecker/infra/lib/stacks/NetworkStackOptimized.ts`
   - Line 98: Changed ALB description (em dash → regular dash)
   - Line 127: Changed ECS description (em dash → regular dash)
   - Line 144: Changed RDS description (em dash → regular dash)
   - Line 156: Changed Redis description (em dash → regular dash)

### Features Temporarily Disabled
- **Apple Sign In**: Requires Apple Developer account credentials
  - Services ID
  - Team ID
  - Key ID
  - Private key (.p8 file)
  
  **To re-enable**: Uncomment lines 221-243 in `AuthStack.ts` and provide real credentials via CDK context

### Features Active
- ✅ Cognito User Pool (email/password authentication)
- ✅ Google OAuth integration
- ✅ Email verification
- ✅ Custom attributes (org_id, venue_roles, tier)
- ✅ JWT tokens (1-hour access, 30-day refresh)

---

## Next Deployment Attempt

**Command**:
```bash
AWS_PROFILE=fcc-deployment \
CDK_DEFAULT_ACCOUNT=333968387413 \
CDK_DEFAULT_REGION=us-east-1 \
npx cdk deploy --all --require-approval never
```

**Expected Duration**: 15-20 minutes  
**Expected Result**: All 7 stacks deployed successfully

---

## Post-Deployment Tasks

After successful deployment:

1. ✅ Build Maven application
2. ✅ Push Docker image to ECR
3. ✅ Verify ECS service health
4. ✅ Test ALB endpoint
5. ✅ Configure Google OAuth credentials in Cognito (if not already done)
6. ⏳ (Optional) Add Apple Sign In when credentials available

---

**Last Updated**: January 27, 2025 10:35 PM  
**Status**: Ready for deployment retry
