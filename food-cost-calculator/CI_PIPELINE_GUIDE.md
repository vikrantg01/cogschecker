# CI/CD Pipeline Usage Guide

## Overview
This document describes how to use the GitHub Actions CI/CD pipeline for the Food Cost Calculator application.

## Pipeline Triggers

### Automatic Triggers
The pipeline automatically runs on:
- **Push** to `main` or `develop` branches
- **Pull Request** to `main` or `develop` branches

### Manual Triggers
Currently not configured, but can be added by including:
```yaml
on:
  workflow_dispatch:
```

## Pipeline Jobs

### 1. Backend Tests (Always Runs)
- **Duration**: ~5-10 minutes
- **What it does**: Runs all Gradle tests for api, workers, and shared modules
- **Output**: Test results published as GitHub Actions artifacts
- **Failure**: Pipeline stops if tests fail

### 2. Frontend Tests (Always Runs)
- **Duration**: ~2-5 minutes
- **What it does**: Runs Vitest tests for the React frontend
- **Output**: Test results in workflow logs
- **Current Status**: Continues even if tests don't exist yet

### 3. Docker Image Build (Push Only)
- **Duration**: ~10-15 minutes
- **When**: Only runs on push events (not PRs)
- **What it does**:
  1. Builds API and Workers JAR files
  2. Creates optimized Docker images
  3. Pushes images to Amazon ECR
- **Output**: Two images with tags:
  - `food-cost-calculator-api:<commit-sha>`
  - `food-cost-calculator-api:latest`
  - `food-cost-calculator-workers:<commit-sha>`
  - `food-cost-calculator-workers:latest`

### 4. CDK Diff (Always Runs)
- **Duration**: ~3-5 minutes
- **What it does**: Compares current infrastructure with deployed state
- **Output**: 
  - Logs show infrastructure changes
  - PRs get a comment with diff notification
- **Note**: Continues even if there are differences

## Total Pipeline Duration
- **Pull Request**: ~10-15 minutes (tests + CDK diff)
- **Push to main/develop**: ~20-30 minutes (all jobs)

## Setup Requirements

### GitHub Repository Secrets
Before the pipeline can run successfully, configure these secrets:

1. **AWS_ACCOUNT_ID**
   - Your AWS account ID (12-digit number)
   - Used to construct ECR registry URL
   - Example: `123456789012`

2. **AWS_ROLE_ARN**
   - IAM role ARN for OIDC authentication
   - Used for secure AWS access without credentials
   - Example: `arn:aws:iam::123456789012:role/GitHubActionsRole`

### AWS Setup Required

#### 1. Create ECR Repositories
```bash
aws ecr create-repository --repository-name food-cost-calculator-api --region ap-southeast-2
aws ecr create-repository --repository-name food-cost-calculator-workers --region ap-southeast-2
```

#### 2. Configure OIDC Provider
Create an OIDC provider in AWS IAM:
- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

#### 3. Create IAM Role
Create a role with trust policy:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:OWNER/REPO:*"
        }
      }
    }
  ]
}
```

Attach policies:
- `AmazonEC2ContainerRegistryPowerUser` - For ECR push
- Custom policy for CDK (CloudFormation, S3, etc.)

## Monitoring Pipeline Runs

### GitHub Actions UI
1. Go to repository → **Actions** tab
2. Select a workflow run to view details
3. Click on a job to see detailed logs
4. Download test results from artifacts

### Pull Request Comments
On PRs, the pipeline automatically comments with:
- CDK diff notification
- Links to full workflow logs

## Common Issues and Solutions

### Issue: Docker Build Fails
**Symptoms**: `build-images` job fails with "No JAR found"
**Solution**: Ensure Gradle build completed successfully in previous steps

### Issue: ECR Push Permission Denied
**Symptoms**: Authentication error when pushing to ECR
**Solution**: 
1. Verify `AWS_ROLE_ARN` secret is correct
2. Check IAM role has ECR permissions
3. Ensure OIDC provider is configured

### Issue: CDK Diff Shows Unexpected Changes
**Symptoms**: Infrastructure changes you didn't make
**Solution**: 
1. Someone else may have deployed changes
2. CDK context may have updated
3. Review the diff logs carefully

### Issue: Tests Fail Intermittently
**Symptoms**: Tests pass locally but fail in CI
**Solution**:
1. Check for timezone dependencies (CI uses UTC)
2. Verify test isolation (no shared state)
3. Check for network/filesystem dependencies

## Skipping CI

### Skip Entire Pipeline
Add to commit message:
```
[skip ci]
or
[ci skip]
```

### Skip Specific Jobs
Not currently supported, but can be added using path filters:
```yaml
on:
  push:
    paths-ignore:
      - 'docs/**'
      - '*.md'
```

## Local Testing

### Test Backend Locally
```bash
cd food-cost-calculator
./gradlew test
```

### Test Frontend Locally
```bash
cd food-cost-calculator/frontend
npm test
```

### Build Docker Images Locally
```bash
cd food-cost-calculator

# Build API image
docker build -t food-cost-calculator-api:local -f modules/api/Dockerfile modules/api

# Build Workers image
docker build -t food-cost-calculator-workers:local -f modules/workers/Dockerfile modules/workers
```

### Test CDK Diff Locally
```bash
cd infra
npm install
npx cdk diff --all
```

## Pipeline Optimization

### Current Optimizations
- ✅ Gradle dependency caching
- ✅ npm dependency caching
- ✅ Docker layer caching via GitHub Actions cache
- ✅ Parallel test execution (backend + frontend)
- ✅ Multi-stage Docker builds
- ✅ Conditional job execution (images only on push)

### Future Improvements
- Add matrix testing for multiple Java versions
- Add frontend test coverage reporting
- Add security scanning (Trivy, Snyk)
- Add deployment jobs after merge
- Add performance benchmarking

## Troubleshooting Commands

### View Recent Workflow Runs
```bash
gh run list --workflow=ci.yml --limit 10
```

### View Specific Run Logs
```bash
gh run view RUN_ID --log
```

### Re-run Failed Jobs
```bash
gh run rerun RUN_ID --failed
```

### Cancel Running Workflow
```bash
gh run cancel RUN_ID
```

## Best Practices

### For Developers
1. Run tests locally before pushing
2. Review CI logs when failures occur
3. Don't ignore intermittent test failures
4. Keep dependencies up to date
5. Monitor pipeline duration trends

### For Reviewers
1. Check CI status before approving PRs
2. Review CDK diff comments carefully
3. Ensure test coverage is adequate
4. Verify Docker images build successfully

### For Maintainers
1. Monitor pipeline success rate
2. Optimize slow jobs
3. Update actions to latest versions
4. Review and rotate AWS credentials
5. Clean up old ECR images periodically

## Support

For issues with the CI/CD pipeline:
1. Check GitHub Actions logs
2. Review this guide
3. Consult AWS documentation for ECR/IAM issues
4. Contact DevOps team for infrastructure changes
