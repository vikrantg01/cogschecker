# Task 30.2: Deploy Workflow Implementation

**Status:** ✅ Complete

## Overview

Implemented GitHub Actions workflow `deploy.yml` that creates a complete deployment pipeline with staging → E2E testing → production promotion flow.

## Implementation

### Workflow File Created

**File:** `.github/workflows/deploy.yml`

### Pipeline Flow

```
Merge to main
    ↓
Deploy to Staging (CDK)
    ↓
Health Check
    ↓
Run Playwright E2E Tests
    ↓
E2E Tests Pass?
    ├─ YES → Deploy to Production (CDK)
    └─ NO  → Stop (production not deployed)
    ↓
Production Health Check
    ↓
Deployment Summary
```

## Job Details

### Job 1: `deploy-staging`

**Purpose:** Deploy infrastructure and application to staging environment

**Steps:**
1. Checkout code
2. Set up Node.js 20 with npm caching
3. Install CDK dependencies
4. Configure AWS credentials using OIDC
5. **Deploy to staging:** `cdk deploy --app "npx ts-node bin/app.ts" --context env=staging --require-approval never --all`
6. Get staging URL from CloudFormation stack outputs (EKS stack)
7. Wait for staging health (polls `/api/v1/health` endpoint, max 5 minutes)

**Outputs:**
- `staging-url`: The staging environment URL for E2E tests

### Job 2: `e2e-tests`

**Purpose:** Run Playwright E2E tests against staging environment

**Dependencies:** `deploy-staging` (runs after staging is deployed)

**Steps:**
1. Checkout code
2. Set up Node.js 20 with npm caching
3. Install frontend dependencies (`npm ci`)
4. Install Playwright browsers (chromium with dependencies)
5. Configure AWS credentials
6. Get Cognito configuration from CloudFormation (User Pool ID, Client ID)
7. **Run E2E tests:** `npm run test:e2e` with environment variables:
   - `BASE_URL`: Staging URL
   - `VITE_API_BASE_URL`: Staging API URL
   - `VITE_COGNITO_USER_POOL_ID`: From CloudFormation
   - `VITE_COGNITO_CLIENT_ID`: From CloudFormation
   - `CI=true`: Enables CI-specific Playwright settings
8. Upload Playwright HTML report (always, even on failure)
9. Upload test results artifacts (always, even on failure)

**Artifacts:**
- `playwright-report`: HTML report (7 days retention)
- `playwright-test-results`: Raw test results (7 days retention)

### Job 3: `deploy-production`

**Purpose:** Deploy to production environment after E2E tests pass

**Dependencies:** `deploy-staging` and `e2e-tests` (runs only if both succeed)

**Environment:** Uses GitHub environment `production` (allows for manual approval if configured)

**Steps:**
1. Checkout code
2. Set up Node.js 20 with npm caching
3. Install CDK dependencies
4. Configure AWS credentials using OIDC
5. **Deploy to production:** `cdk deploy --app "npx ts-node bin/app.ts" --context env=prod --require-approval never --all`
6. Get production URL from CloudFormation stack outputs
7. Verify production health (polls `/api/v1/health`, max 5 minutes, fails if unhealthy)
8. Post deployment summary to GitHub Actions summary page

**Outputs:**
- Deployment summary with production URL, commit SHA, deployer, and timestamp

## Key Features

### 1. Sequential Deployment Gates

Production deployment only happens if:
- ✅ Staging deployment succeeds
- ✅ E2E tests pass on staging

### 2. Health Checks

Both staging and production deployments include health verification:
- 30-second stabilization period
- Up to 30 health check attempts (10-second intervals = 5 minutes max)
- Staging: Warns but continues if health check times out
- Production: **Fails the deployment** if health check times out

### 3. Dynamic Configuration

The workflow dynamically retrieves:
- Application URLs from CloudFormation stack outputs
- Cognito configuration from CloudFormation Auth stack
- All environment-specific values are resolved at runtime

### 4. Artifact Collection

E2E test artifacts are always uploaded:
- HTML reports for visual inspection
- Test results for CI integration
- 7-day retention for debugging failed deployments

### 5. Environment Protection

Production deployment uses GitHub environment feature:
- Can be configured for manual approval
- Can restrict which users/teams can approve
- Environment URL is linked in deployment status

### 6. Deployment Summary

GitHub Actions summary provides at-a-glance status:
- Staging deployment ✅
- E2E test results ✅
- Production deployment ✅
- Production URL
- Deployment metadata (commit, actor, timestamp)

## CDK Deployment Command

As specified in the task requirements:

```bash
cdk deploy --app "npx ts-node bin/app.ts" --require-approval never
```

**Parameters:**
- `--app "npx ts-node bin/app.ts"`: Specifies the CDK app entry point
- `--context env=staging|prod`: Sets the deployment environment
- `--require-approval never`: Auto-approves security and IAM changes
- `--all`: Deploys all stacks in the CDK app

## Environment Variables

The workflow uses:

### AWS Configuration
- `AWS_REGION`: ap-southeast-2 (Sydney)
- `ECR_REGISTRY`: ECR registry URL (from secrets)
- `API_IMAGE_NAME`: food-cost-calculator-api
- `WORKERS_IMAGE_NAME`: food-cost-calculator-workers

### Required Secrets
- `AWS_ACCOUNT_ID`: AWS account for ECR registry
- `AWS_ROLE_ARN`: IAM role for OIDC authentication

## Integration with Existing CI

The `deploy.yml` workflow is separate from the existing `ci.yml`:

**ci.yml (PR and Branch Builds):**
- Runs tests (backend + frontend)
- Builds and pushes Docker images
- Runs CDK diff
- Comments on PRs

**deploy.yml (Main Branch Only):**
- Deploys to staging
- Runs E2E tests
- Deploys to production
- Production-ready, gated deployment

## Playwright E2E Tests

The workflow runs the existing E2E tests:

**Location:** `food-cost-calculator/frontend/e2e/`

**Test Files:**
- `critical-user-journey.spec.ts`: Core user flows
- `social-login-venue-subscription.spec.ts`: OAuth and subscription flows

**Configuration:** `playwright.config.ts`
- Runs in Chromium only (CI optimized)
- 2 retries on failure
- Captures screenshots/videos on failure
- Generates HTML report

## CloudFormation Stack Outputs

The workflow expects these outputs:

### EKS Stack (`FoodCostCalculator-EKS-{env}`)
- `LoadBalancerDNS`: ALB DNS name for the application

### Auth Stack (`FoodCostCalculator-Auth-{env}`)
- `UserPoolId`: Cognito User Pool ID
- `UserPoolClientId`: Cognito App Client ID

## Error Handling

### Staging Health Check Failure
- Logs warning
- Continues to E2E tests (test failures will block production)
- Rationale: Let E2E tests validate actual functionality

### E2E Test Failure
- Uploads artifacts for debugging
- **Blocks production deployment**
- Workflow fails, no production changes

### Production Health Check Failure
- **Fails the deployment**
- Exits with error code 1
- Production deployment is marked as failed

## Manual Approval (Optional)

To add manual approval for production:

1. Go to GitHub repository Settings → Environments
2. Configure `production` environment
3. Add required reviewers
4. Enable "Wait for approval"

The workflow will pause at `deploy-production` job and wait for approval.

## Testing the Workflow

### Local Testing (Not Possible)

GitHub Actions workflows can't be fully tested locally, but you can:

1. Validate YAML syntax:
   ```bash
   yamllint .github/workflows/deploy.yml
   ```

2. Test CDK commands locally:
   ```bash
   cd infra
   npx cdk deploy --app "npx ts-node bin/app.ts" --context env=staging --all
   ```

3. Test E2E tests locally:
   ```bash
   cd food-cost-calculator/frontend
   BASE_URL=http://localhost:5173 npm run test:e2e
   ```

### First Deployment

On the first merge to `main` after this implementation:

1. Workflow triggers automatically
2. Deploys staging infrastructure and application
3. Waits for staging health
4. Runs E2E tests against staging
5. If E2E tests pass, deploys to production
6. Verifies production health
7. Posts summary

## Monitoring Deployments

### GitHub Actions UI

- View workflow runs: Repository → Actions → Deploy
- See job logs, artifacts, and summaries
- Download Playwright reports for debugging

### AWS Console

- CloudFormation: View stack status and outputs
- ECS/EKS: View service status and logs
- CloudWatch: View application logs and metrics

## Troubleshooting

### "Could not retrieve ALB DNS"

**Cause:** CloudFormation output not found

**Fix:** Ensure EKS stack exports `LoadBalancerDNS` output

### E2E Tests Timeout

**Cause:** Staging environment not accessible or slow

**Solutions:**
- Check security groups allow GitHub Actions IPs
- Increase health check timeout
- Review staging environment logs

### Cognito Configuration Missing

**Cause:** Auth stack outputs not found

**Fix:** Ensure Auth stack exports `UserPoolId` and `UserPoolClientId`

### Production Health Check Fails

**Cause:** Production deployment took longer than expected

**Solutions:**
- Increase MAX_ATTEMPTS in health check
- Review production CloudWatch logs
- Check ECS/EKS service health

## Future Enhancements

### Potential Improvements

1. **Blue/Green Deployment**
   - Deploy to blue/green slots
   - Switch traffic after validation

2. **Smoke Tests on Production**
   - Run subset of E2E tests on production
   - Validate critical paths immediately

3. **Rollback Capability**
   - Detect failures and auto-rollback
   - Keep previous version for instant rollback

4. **Performance Testing**
   - Load test staging before production
   - Gate on performance thresholds

5. **Database Migration Safety**
   - Run migrations separately
   - Validate migrations before deployment

6. **Slack/Email Notifications**
   - Notify on deployment success/failure
   - Include deployment summary

7. **Deployment Metrics**
   - Track deployment frequency
   - Track lead time and MTTR

## Files Modified

### Created
- `.github/workflows/deploy.yml` - Main deployment pipeline workflow

### No Changes Required To
- `.github/workflows/ci.yml` - Existing CI workflow (unchanged)
- `infra/bin/app.ts` - CDK app entry point (already supports env context)
- `food-cost-calculator/frontend/playwright.config.ts` - Already CI-ready

## Compliance with Requirements

✅ **Trigger:** On merge to `main` branch
✅ **Staging Deployment:** CDK deploy with `--require-approval never` to staging
✅ **E2E Tests:** Playwright tests run against staging
✅ **Production Deployment:** CDK deploy to production if tests pass
✅ **Health Checks:** Validates both staging and production deployments
✅ **Gated Flow:** Production deployment blocked if E2E tests fail

## Summary

Task 30.2 is complete. The `deploy.yml` workflow implements a production-ready deployment pipeline with:

- **Staging First:** All changes deploy to staging first
- **E2E Validation:** Playwright tests validate functionality
- **Automated Promotion:** Production deploys automatically on success
- **Safety Gates:** Multiple health checks and test validation
- **Observability:** Artifacts, summaries, and deployment tracking
- **Flexibility:** Supports manual approval for production if needed

The workflow is ready to use immediately on the next merge to `main`.
