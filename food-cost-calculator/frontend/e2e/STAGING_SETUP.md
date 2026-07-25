# Staging Environment Setup for E2E Tests

## Getting the Staging URL

Before running E2E tests against the staging environment, you need to get the staging application URL from AWS.

### Option 1: Get URL from CloudFormation (Recommended)

```bash
# Get the Application Load Balancer DNS name
ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name FoodCost-ECS-staging \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
  --output text)

echo "Staging URL: https://${ALB_DNS}"

# Export for use in tests
export BASE_URL="https://${ALB_DNS}"
```

### Option 2: Get URL from AWS Console

1. Go to [AWS CloudFormation Console](https://console.aws.amazon.com/cloudformation)
2. Select region: **us-east-1**
3. Find stack: **FoodCost-ECS-staging**
4. Click on the **Outputs** tab
5. Find output key: **LoadBalancerDNS**
6. Copy the value

### Option 3: Get URL from ECS Service

```bash
# Get the ECS service details
aws ecs describe-services \
  --cluster foodcost-staging \
  --services foodcost-api-staging \
  --region us-east-1 \
  --query 'services[0].loadBalancers[0]' \
  --output json
```

Then look up the load balancer in the EC2 console to get its DNS name.

## Configuring the Environment

### Create Local Configuration File

Create `.env.staging.local` (gitignored) with your staging details:

```bash
# Staging Environment Configuration
BASE_URL=https://foodcost-staging-XXXXXXXXXX.us-east-1.elb.amazonaws.com

# API URL (usually BASE_URL + /api/v1)
VITE_API_BASE_URL=https://foodcost-staging-XXXXXXXXXX.us-east-1.elb.amazonaws.com/api/v1

# Cognito Configuration (from Auth stack outputs)
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_COGNITO_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_COGNITO_DOMAIN=foodcost-staging.auth.us-east-1.amazoncognito.com
```

### Get Cognito Configuration

```bash
# Get Cognito User Pool ID
COGNITO_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name FoodCost-Auth-staging \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
  --output text)

# Get Cognito Client ID
COGNITO_CLIENT_ID=$(aws cloudformation describe-stacks \
  --stack-name FoodCost-Auth-staging \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolClientId`].OutputValue' \
  --output text)

# Get Cognito Domain
COGNITO_DOMAIN=$(aws cloudformation describe-stacks \
  --stack-name FoodCost-Auth-staging \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolDomain`].OutputValue' \
  --output text)

echo "VITE_COGNITO_USER_POOL_ID=${COGNITO_POOL_ID}"
echo "VITE_COGNITO_CLIENT_ID=${COGNITO_CLIENT_ID}"
echo "VITE_COGNITO_DOMAIN=${COGNITO_DOMAIN}"
```

## Verifying Staging Environment

Before running E2E tests, verify the staging environment is healthy:

### Check API Health

```bash
# Test the health endpoint
curl -i https://your-staging-url.com/api/v1/health

# Expected response:
# HTTP/1.1 200 OK
# {"status":"UP"}
```

### Check Frontend Deployment

```bash
# Test the frontend
curl -i https://your-staging-url.com/

# Expected response:
# HTTP/1.1 200 OK
# Content-Type: text/html
# (HTML content)
```

### Check Database Connectivity

```bash
# Get RDS endpoint
aws rds describe-db-instances \
  --db-instance-identifier foodcost-db-staging \
  --region us-east-1 \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text

# Check if RDS is available
aws rds describe-db-instances \
  --db-instance-identifier foodcost-db-staging \
  --region us-east-1 \
  --query 'DBInstances[0].DBInstanceStatus' \
  --output text
# Should return: available
```

### Check Redis Connectivity

```bash
# Get Redis endpoint
aws elasticache describe-cache-clusters \
  --cache-cluster-id foodcost-redis-staging \
  --region us-east-1 \
  --show-cache-node-info \
  --query 'CacheClusters[0].CacheNodes[0].Endpoint.Address' \
  --output text

# Check cluster status
aws elasticache describe-cache-clusters \
  --cache-cluster-id foodcost-redis-staging \
  --region us-east-1 \
  --query 'CacheClusters[0].CacheClusterStatus' \
  --output text
# Should return: available
```

## Running E2E Tests Against Staging

### Method 1: Environment Variable

```bash
BASE_URL=https://your-staging-url.com npm run test:e2e
```

### Method 2: Using .env File

```bash
# Load environment variables from .env.staging.local
export $(cat .env.staging.local | xargs)

# Run tests
npm run test:e2e
```

### Method 3: Direct Configuration

```bash
# Set all variables inline
VITE_API_BASE_URL=https://staging.com/api/v1 \
BASE_URL=https://staging.com \
npm run test:e2e
```

## Troubleshooting

### Tests Timeout on Staging

**Issue:** Tests fail with timeout errors

**Possible causes:**
1. Staging environment is not running
2. Security group rules blocking access
3. SSL/TLS certificate issues
4. WAF rules blocking test requests

**Solutions:**
```bash
# Check ECS service status
aws ecs describe-services \
  --cluster foodcost-staging \
  --services foodcost-api-staging \
  --query 'services[0].runningCount'

# Check ALB target health
aws elbv2 describe-target-health \
  --target-group-arn <target-group-arn>

# Check CloudWatch logs
aws logs tail /ecs/foodcost-api-staging --follow
```

### Authentication Failures

**Issue:** Tests fail at login/register step

**Possible causes:**
1. Cognito not configured correctly
2. OAuth redirect URLs not whitelisted
3. User pool settings incorrect

**Solutions:**
```bash
# Verify Cognito User Pool exists
aws cognito-idp describe-user-pool \
  --user-pool-id <your-pool-id>

# Check app client settings
aws cognito-idp describe-user-pool-client \
  --user-pool-id <your-pool-id> \
  --client-id <your-client-id>
```

### CORS Errors

**Issue:** Browser console shows CORS errors

**Possible causes:**
1. API CORS configuration missing frontend URL
2. ALB not forwarding CORS headers
3. CloudFront not configured correctly

**Solutions:**
- Check `CorsConfig.java` in the API
- Verify ALB listener rules
- Check CloudFront cache behaviors

### SSL/TLS Certificate Errors

**Issue:** Certificate validation errors

**Possible causes:**
1. Using self-signed certificate
2. Certificate not trusted
3. Certificate expired

**Solutions:**
```bash
# For testing only, disable SSL verification (NOT for production!)
NODE_TLS_REJECT_UNAUTHORIZED=0 npm run test:e2e

# Better: Add certificate to system trust store
# Or: Use ACM certificate with custom domain
```

## Security Considerations

### Test User Accounts

- E2E tests create real user accounts in staging
- Use unique timestamps to avoid conflicts
- Consider implementing cleanup jobs

### Test Data

- Tests create real ingredients, recipes, etc.
- Consider periodic database cleanup
- Use separate test database for E2E if possible

### API Rate Limiting

- Multiple test runs may hit rate limits
- Configure WAF to allow test IPs
- Consider using a dedicated test user pool

## CI/CD Integration

When running in CI/CD (GitHub Actions), the workflow should:

1. Deploy to staging
2. Wait for deployment to complete
3. Run health checks
4. Execute E2E tests
5. Upload test artifacts
6. Gate production deployment on test results

Example workflow step:

```yaml
- name: Get Staging URL
  id: staging-url
  run: |
    ALB_DNS=$(aws cloudformation describe-stacks \
      --stack-name FoodCost-ECS-staging \
      --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
      --output text)
    echo "url=https://${ALB_DNS}" >> $GITHUB_OUTPUT

- name: Wait for Staging Health
  run: |
    for i in {1..30}; do
      if curl -sf "${{ steps.staging-url.outputs.url }}/api/v1/health"; then
        echo "Staging is healthy"
        exit 0
      fi
      echo "Waiting for staging... attempt $i/30"
      sleep 10
    done
    exit 1

- name: Run E2E Tests
  run: BASE_URL="${{ steps.staging-url.outputs.url }}" npm run test:e2e
  working-directory: frontend
```

## Additional Resources

- [AWS CloudFormation Outputs Documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/outputs-section-structure.html)
- [ECS Service Discovery](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-discovery.html)
- [Playwright CI Documentation](https://playwright.dev/docs/ci)
- [AWS CLI Configuration](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-configure.html)
