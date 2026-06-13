# 🚀 Quick Start: Deploy to AWS (Optimized Architecture)

This guide will get your Food Cost Calculator deployed to AWS in **under 1 hour** using the cost-optimized architecture.

**Estimated Cost:** $180-250/month (vs $1,500-2,000 for EKS-based)

---

## ✅ Prerequisites (5 minutes)

### 1. AWS Account
- [ ] Create AWS account at https://aws.amazon.com
- [ ] Have credit card ready (free tier available, but card required)
- [ ] Note your AWS Account ID

### 2. Install Tools
```bash
# AWS CLI
brew install awscli

# Node.js (if not installed)
brew install node

# Verify installations
aws --version    # Should be 2.x
node --version   # Should be 18+
npm --version
```

### 3. Configure AWS CLI
```bash
# Run AWS configure
aws configure

# Enter when prompted:
AWS Access Key ID: [Your access key]
AWS Secret Access Key: [Your secret key]
Default region name: us-east-1
Default output format: json

# Test it works
aws sts get-caller-identity
```

---

## 📦 Step 1: Prepare Docker Image (15 minutes)

### Build Spring Boot JAR
```bash
cd /Users/vicky/cogschecker/food-cost-calculator

# Clean and build
./gradlew clean :modules:api:bootJar

# Verify JAR exists
ls -lh modules/api/build/libs/*.jar
```

### Test Docker Build Locally
```bash
# Build Docker image
./build-and-test-docker.sh

# This will:
# 1. Build Spring Boot JAR
# 2. Create Docker image
# 3. Test it locally
# 4. Verify health endpoint
```

**Expected output:**
```
✅ Health check passed!
✅ Docker image is ready for AWS deployment!
```

---

## 🏗️ Step 2: Deploy Infrastructure (20-30 minutes)

### Install CDK Dependencies
```bash
cd /Users/vicky/cogschecker/infra

# Install packages
npm install

# Verify CDK works
npx cdk --version
```

### Bootstrap CDK (First Time Only)
```bash
# Bootstrap your AWS account for CDK
npx cdk bootstrap aws://ACCOUNT-ID/us-east-1

# Replace ACCOUNT-ID with your AWS account ID
# Find it with: aws sts get-caller-identity --query Account --output text
```

### Deploy All Stacks
```bash
# Use the optimized configuration
npx cdk deploy --all --app "npx ts-node --prefer-ts-exts bin/app-optimized.ts" --require-approval never

# Or copy the optimized config:
cp cdk-optimized.json cdk.json
npx cdk deploy --all --require-approval never
```

**This will create:**
- ✅ VPC with subnets, NAT gateway, security groups (5 min)
- ✅ RDS PostgreSQL database (10-15 min)
- ✅ ElastiCache Redis (5-10 min)
- ✅ Cognito User Pool (2 min)
- ✅ S3 buckets (1 min)
- ✅ SQS queues (1 min)
- ✅ ECR repository, ECS cluster, ALB (5 min)

**Total time:** ~25-35 minutes

**Watch for:**
- CloudFormation stacks being created
- Green "✅" checkmarks
- Stack outputs with ARNs and endpoints

### Save Stack Outputs
```bash
# After deployment completes, save important values:
aws cloudformation describe-stacks \
  --stack-name FoodCost-ECS-staging \
  --query 'Stacks[0].Outputs' > stack-outputs.json

# View the outputs
cat stack-outputs.json
```

**Key outputs you need:**
- `LoadBalancerDNS` - Your API endpoint
- `RepositoryUri` - ECR repository for Docker images
- `ClusterName` - ECS cluster name
- `ServiceName` - ECS service name

---

## 🐳 Step 3: Push Docker Image to ECR (5 minutes)

### Get ECR Repository URI
```bash
# From stack outputs or:
ECR_URI=$(aws cloudformation describe-stacks \
  --stack-name FoodCost-ECS-staging \
  --query 'Stacks[0].Outputs[?OutputKey==`RepositoryUri`].OutputValue' \
  --output text)

echo "ECR Repository: $ECR_URI"
```

### Login to ECR
```bash
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin $ECR_URI
```

### Tag and Push Image
```bash
cd /Users/vicky/cogschecker/food-cost-calculator

# Tag the image
docker tag food-cost-calculator-api:latest $ECR_URI:latest

# Push to ECR
docker push $ECR_URI:latest
```

### Trigger ECS Deployment
```bash
# Force ECS to pull new image
aws ecs update-service \
  --cluster foodcost-staging \
  --service foodcost-api-staging \
  --force-new-deployment

# Watch deployment status
aws ecs wait services-stable \
  --cluster foodcost-staging \
  --services foodcost-api-staging
```

**Wait for:**
- Tasks to stop (old version)
- New tasks to start
- Health checks to pass
- "Service has reached a steady state"

---

## 🎨 Step 4: Deploy Frontend to S3/CloudFront (10 minutes)

### Get ALB DNS Name
```bash
ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name FoodCost-ECS-staging \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
  --output text)

echo "API URL: http://$ALB_DNS"
```

### Build Frontend with Production Config
```bash
cd /Users/vicky/cogschecker/food-cost-calculator/frontend

# Get Cognito details from stack outputs
COGNITO_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name FoodCost-Auth-staging \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
  --output text)

COGNITO_CLIENT_ID=$(aws cloudformation describe-stacks \
  --stack-name FoodCost-Auth-staging \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolClientId`].OutputValue' \
  --output text)

# Create production .env
cat > .env.production << EOF
VITE_API_BASE_URL=http://$ALB_DNS
VITE_COGNITO_USER_POOL_ID=$COGNITO_POOL_ID
VITE_COGNITO_CLIENT_ID=$COGNITO_CLIENT_ID
EOF

# Build
npm run build
```

### Upload to S3
```bash
# Get S3 bucket name
S3_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name FoodCost-Storage-staging \
  --query 'Stacks[0].Outputs[?OutputKey==`AssetsBucketName`].OutputValue' \
  --output text)

# Upload files
aws s3 sync dist/ s3://$S3_BUCKET/ --delete

# Make files public (if using S3 static website, not CloudFront)
aws s3 website s3://$S3_BUCKET/ \
  --index-document index.html \
  --error-document index.html
```

### Create CloudFront Distribution (Optional - Recommended)
```bash
# This adds HTTPS and CDN caching
# TODO: Add CloudFront stack to CDK or create manually in console
```

---

## ✅ Step 5: Test Your Deployment (5 minutes)

### Test Backend API
```bash
# Health check
curl http://$ALB_DNS/actuator/health

# Expected: {"status":"UP"}

# Test auth endpoint
curl http://$ALB_DNS/api/v1/auth/health

# Expected: {"status":"ok"}
```

### Access Frontend
```bash
# Get S3 website URL
S3_URL=$(aws s3api get-bucket-website --bucket $S3_BUCKET --query 'WebsiteURL' --output text 2>/dev/null || echo "http://$S3_BUCKET.s3-website-us-east-1.amazonaws.com")

echo "Open in browser: $S3_URL"
```

### Test Full Flow
1. **Open frontend URL** in browser
2. **Register new account**
   - Email: your-email@example.com
   - Password: Test1234 (uppercase, lowercase, number)
3. **Login** with credentials
4. **Create ingredient**
   - Navigate to Ingredients page
   - Add a new ingredient
5. **Create recipe**
   - Navigate to Recipes page
   - Create recipe with the ingredient
6. **View report**
   - Check the costing report

---

## 📊 Monitor Your Deployment

### View ECS Task Logs
```bash
# Get log stream
aws logs tail /ecs/foodcost-api-staging --follow
```

### Check ECS Service Status
```bash
aws ecs describe-services \
  --cluster foodcost-staging \
  --services foodcost-api-staging \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}'
```

### Check RDS Status
```bash
aws rds describe-db-instances \
  --db-instance-identifier foodcost-db-staging \
  --query 'DBInstances[0].{Status:DBInstanceStatus,Endpoint:Endpoint.Address}'
```

### View CloudWatch Metrics
- Go to AWS Console → CloudWatch
- Select Dashboards
- Or create custom dashboard

---

## 💰 Monitor Costs

### Set Up Billing Alerts
```bash
# Create SNS topic for alerts
aws sns create-topic --name billing-alerts

# Subscribe your email
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:ACCOUNT-ID:billing-alerts \
  --protocol email \
  --notification-endpoint your-email@example.com

# Confirm subscription in email

# Create CloudWatch alarm (in us-east-1 only)
aws cloudwatch put-metric-alarm \
  --alarm-name billing-alert-$200 \
  --alarm-description "Alert when charges exceed $200" \
  --metric-name EstimatedCharges \
  --namespace AWS/Billing \
  --statistic Maximum \
  --period 21600 \
  --evaluation-periods 1 \
  --threshold 200 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT-ID:billing-alerts \
  --dimensions Name=Currency,Value=USD
```

### Check Current Costs
```bash
# Today's estimated charges
aws ce get-cost-and-usage \
  --time-period Start=$(date -u -d '1 day ago' +%Y-%m-%d),End=$(date -u +%Y-%m-%d) \
  --granularity DAILY \
  --metrics UnblendedCost \
  --query 'ResultsByTime[*].Total.UnblendedCost.Amount'
```

---

## 🎉 Success!

Your Food Cost Calculator is now deployed to AWS!

### URLs to Save:
- **API:** http://$ALB_DNS
- **Frontend:** $S3_URL (or CloudFront URL)
- **Health:** http://$ALB_DNS/actuator/health

### Next Steps:
1. ✅ Set up custom domain (Route 53 + ACM)
2. ✅ Add HTTPS (CloudFront or ALB certificate)
3. ✅ Set up CI/CD (GitHub Actions)
4. ✅ Configure Cognito OAuth (Google, Apple)
5. ✅ Add monitoring dashboard
6. ✅ Set up automated backups

---

## 🔄 Update Deployment

### When you make code changes:
```bash
# 1. Build new JAR
cd /Users/vicky/cogschecker/food-cost-calculator
./gradlew clean :modules:api:bootJar

# 2. Build Docker image
docker build -t food-cost-calculator-api:latest -f Dockerfile.api .

# 3. Tag and push to ECR
docker tag food-cost-calculator-api:latest $ECR_URI:latest
docker push $ECR_URI:latest

# 4. Update ECS service
aws ecs update-service \
  --cluster foodcost-staging \
  --service foodcost-api-staging \
  --force-new-deployment
```

### When you change infrastructure:
```bash
cd /Users/vicky/cogschecker/infra
npx cdk deploy --all
```

---

## 🆘 Troubleshooting

### ECS Tasks Not Starting
```bash
# Check task logs
aws logs tail /ecs/foodcost-api-staging --follow

# Check task stopped reason
aws ecs describe-tasks \
  --cluster foodcost-staging \
  --tasks $(aws ecs list-tasks --cluster foodcost-staging --service foodcost-api-staging --query 'taskArns[0]' --output text)
```

### Cannot Connect to Database
```bash
# Verify RDS is running
aws rds describe-db-instances \
  --db-instance-identifier foodcost-db-staging

# Check security group rules
aws ec2 describe-security-groups \
  --filters Name=group-name,Values=foodcost-rds-staging
```

### Frontend Can't Reach Backend
1. Check CORS configuration in Spring Boot
2. Verify ALB DNS is correct in .env.production
3. Test API directly: `curl http://$ALB_DNS/actuator/health`

---

## 🗑️ Clean Up (Delete Everything)

**WARNING:** This will delete all resources and data!

```bash
cd /Users/vicky/cogschecker/infra

# Delete all stacks
npx cdk destroy --all

# Or specific stacks in order:
npx cdk destroy FoodCost-ECS-staging
npx cdk destroy FoodCost-Cache-staging
npx cdk destroy FoodCost-RDS-staging
npx cdk destroy FoodCost-Auth-staging
npx cdk destroy FoodCost-Storage-staging
npx cdk destroy FoodCost-Messaging-staging
npx cdk destroy FoodCost-Network-staging
```

---

**Estimated Total Time:** 45-60 minutes
**Estimated Monthly Cost:** $180-250

**Questions?** Check `DEPLOYMENT_CHECKLIST.md` or `AWS_DEPLOYMENT_PLAN.md`

🎉 **Congratulations! You're now running on AWS!** 🎉
