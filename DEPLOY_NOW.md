# 🚀 Deploy to AWS - Let's Go!

You're ready to deploy! Follow these steps in order.

---

## Step 1: Configure AWS CLI (5 minutes)

You need AWS credentials to deploy. Here's how to get them:

### Option A: If you already have an AWS account

1. **Log into AWS Console:** https://console.aws.amazon.com
2. **Go to IAM (Identity and Access Management)**
3. **Create Access Key:**
   - Click your username (top right)
   - Select "Security credentials"
   - Scroll to "Access keys"
   - Click "Create access key"
   - Select "CLI" use case
   - Download the CSV file (keep it safe!)

4. **Configure AWS CLI:**
```bash
aws configure

# When prompted, enter:
AWS Access Key ID: [paste from CSV]
AWS Secret Access Key: [paste from CSV]
Default region name: us-east-1
Default output format: json
```

5. **Test it works:**
```bash
aws sts get-caller-identity
```

You should see your account details!

### Option B: If you need to create an AWS account

1. **Go to:** https://aws.amazon.com
2. **Click "Create an AWS Account"**
3. **Follow the signup process:**
   - Email address
   - Password
   - Account name (e.g., "FoodCost Calculator")
   - Contact information
   - **Credit card** (required, but free tier covers most costs)
   - Phone verification
   - Support plan (choose "Basic - Free")

4. **Wait for account activation** (usually instant, can take up to 24 hours)

5. **Then follow Option A above** to create access keys

---

## Step 2: Build Docker Image (5 minutes)

Once AWS CLI is configured:

```bash
cd /Users/vicky/cogschecker/food-cost-calculator

# Build and test Docker image
./build-and-test-docker.sh
```

**Expected output:**
```
✅ Health check passed!
✅ Docker image is ready for AWS deployment!
```

---

## Step 3: Deploy Infrastructure (25-30 minutes)

```bash
cd /Users/vicky/cogschecker/infra

# Install CDK dependencies
npm install

# Get your AWS account ID
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Your AWS Account ID: $AWS_ACCOUNT_ID"

# Bootstrap CDK (first time only)
npx cdk bootstrap aws://$AWS_ACCOUNT_ID/us-east-1

# Deploy all infrastructure
npx cdk deploy --all \
  --app "npx ts-node --prefer-ts-exts bin/app-optimized.ts" \
  --require-approval never
```

**What's happening:**
- Creating VPC, subnets, NAT gateway (5 min)
- Creating RDS PostgreSQL database (10-15 min)
- Creating ElastiCache Redis (5-10 min)
- Creating Cognito, S3, SQS (2-3 min)
- Creating ECS cluster, ALB, ECR (5 min)

**Total: ~25-35 minutes**

⏳ **Grab a coffee while it deploys!**

---

## Step 4: Save Deployment Info (1 minute)

After deployment completes:

```bash
# Save all stack outputs
cd /Users/vicky/cogschecker

aws cloudformation describe-stacks \
  --query 'Stacks[].{StackName:StackName,Outputs:Outputs}' \
  > aws-deployment-outputs.json

# View the important values
cat aws-deployment-outputs.json | grep -A 2 "RepositoryUri\|LoadBalancerDNS\|UserPoolId\|ClientId"
```

---

## Step 5: Push Docker Image to AWS (5 minutes)

```bash
cd /Users/vicky/cogschecker/food-cost-calculator

# Get ECR repository URI
export ECR_URI=$(aws cloudformation describe-stacks \
  --stack-name FoodCost-ECS-staging \
  --query 'Stacks[0].Outputs[?OutputKey==`RepositoryUri`].OutputValue' \
  --output text)

echo "Pushing to: $ECR_URI"

# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin $ECR_URI

# Tag and push image
docker tag food-cost-calculator-api:latest $ECR_URI:latest
docker push $ECR_URI:latest

# Deploy to ECS
aws ecs update-service \
  --cluster foodcost-staging \
  --service foodcost-api-staging \
  --force-new-deployment \
  --region us-east-1

echo "✅ Docker image deployed! Waiting for ECS to start tasks..."

# Wait for deployment to complete
aws ecs wait services-stable \
  --cluster foodcost-staging \
  --services foodcost-api-staging \
  --region us-east-1

echo "✅ ECS service is stable!"
```

---

## Step 6: Test Backend API (2 minutes)

```bash
# Get ALB DNS name
export ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name FoodCost-ECS-staging \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
  --output text)

echo "API URL: http://$ALB_DNS"

# Test health endpoint
echo "Testing health endpoint..."
curl -f "http://$ALB_DNS/actuator/health"

# Should return: {"status":"UP"}
```

---

## Step 7: Deploy Frontend (10 minutes)

```bash
cd /Users/vicky/cogschecker/food-cost-calculator/frontend

# Get Cognito details
export COGNITO_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name FoodCost-Auth-staging \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
  --output text)

export COGNITO_CLIENT_ID=$(aws cloudformation describe-stacks \
  --stack-name FoodCost-Auth-staging \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolClientId`].OutputValue' \
  --output text)

# Create production environment file
cat > .env.production << EOF
VITE_API_BASE_URL=http://$ALB_DNS
VITE_COGNITO_USER_POOL_ID=$COGNITO_POOL_ID
VITE_COGNITO_CLIENT_ID=$COGNITO_CLIENT_ID
EOF

echo "Environment file created:"
cat .env.production

# Build frontend
npm run build

# Get S3 bucket name
export S3_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name FoodCost-Storage-staging \
  --query 'Stacks[0].Outputs[?OutputKey==`AssetsBucketName`].OutputValue' \
  --output text)

# Upload to S3
aws s3 sync dist/ s3://$S3_BUCKET/ --delete

# Configure S3 for static website hosting
aws s3 website s3://$S3_BUCKET/ \
  --index-document index.html \
  --error-document index.html

# Get website URL
export S3_URL="http://$S3_BUCKET.s3-website-us-east-1.amazonaws.com"

echo ""
echo "✅ Frontend deployed!"
echo "🌐 Open in browser: $S3_URL"
```

---

## Step 8: Test Your Application! 🎉

### Open Frontend
```bash
# Open the app
open "http://$S3_BUCKET.s3-website-us-east-1.amazonaws.com"

# Or print the URL to copy/paste
echo "Frontend URL: http://$S3_BUCKET.s3-website-us-east-1.amazonaws.com"
echo "API URL: http://$ALB_DNS"
```

### Test the Full Flow:
1. **Register a new account**
   - Email: your-email@example.com
   - Password: Test1234 (needs uppercase, lowercase, number)

2. **Login** with your credentials

3. **Create an ingredient**
   - Go to Ingredients page
   - Click "Add Ingredient"
   - Fill in details and save

4. **Create a recipe**
   - Go to Recipes page
   - Create a recipe using your ingredient
   - See real-time cost calculation

5. **View reports**
   - Check the costing report
   - Export to CSV

---

## 🎊 SUCCESS!

Your Food Cost Calculator is now live on AWS!

### Save These URLs:
```bash
# Save to a file
cat > ~/foodcost-aws-urls.txt << EOF
Food Cost Calculator - AWS Deployment

Frontend: http://$S3_BUCKET.s3-website-us-east-1.amazonaws.com
API: http://$ALB_DNS
Health Check: http://$ALB_DNS/actuator/health

Deployed: $(date)
AWS Account: $AWS_ACCOUNT_ID
Region: us-east-1
EOF

cat ~/foodcost-aws-urls.txt
```

---

## 💰 Monitor Your Costs

### Set up billing alert (recommended!):
```bash
# Create SNS topic for billing alerts
aws sns create-topic --name billing-alerts --region us-east-1

# Subscribe your email
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:$AWS_ACCOUNT_ID:billing-alerts \
  --protocol email \
  --notification-endpoint YOUR-EMAIL@example.com \
  --region us-east-1

# Check your email and confirm subscription

# Create $200 budget alert
aws cloudwatch put-metric-alarm \
  --alarm-name monthly-billing-alert \
  --alarm-description "Alert when monthly charges exceed $200" \
  --metric-name EstimatedCharges \
  --namespace AWS/Billing \
  --statistic Maximum \
  --period 21600 \
  --evaluation-periods 1 \
  --threshold 200 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:$AWS_ACCOUNT_ID:billing-alerts \
  --dimensions Name=Currency,Value=USD \
  --region us-east-1
```

---

## 📊 View Your Resources

### AWS Console Links:
- **ECS Service:** https://console.aws.amazon.com/ecs/v2/clusters/foodcost-staging/services
- **RDS Database:** https://console.aws.amazon.com/rds/home#databases:
- **Load Balancer:** https://console.aws.amazon.com/ec2/v2/home#LoadBalancers:
- **Cognito Users:** https://console.aws.amazon.com/cognito/v2/idp/user-pools
- **CloudWatch Logs:** https://console.aws.amazon.com/cloudwatch/home#logsV2:log-groups

---

## 🔄 Update Your Deployment

When you make code changes:

```bash
cd /Users/vicky/cogschecker/food-cost-calculator

# 1. Rebuild JAR
./gradlew clean :modules:api:bootJar

# 2. Rebuild Docker
docker build -t food-cost-calculator-api:latest -f Dockerfile.api .

# 3. Push to ECR
docker tag food-cost-calculator-api:latest $ECR_URI:latest
docker push $ECR_URI:latest

# 4. Deploy
aws ecs update-service \
  --cluster foodcost-staging \
  --service foodcost-api-staging \
  --force-new-deployment \
  --region us-east-1
```

---

## 🆘 Troubleshooting

### Backend not responding?
```bash
# Check ECS task logs
aws logs tail /ecs/foodcost-api-staging --follow --region us-east-1
```

### Can't reach database?
```bash
# Check RDS status
aws rds describe-db-instances \
  --db-instance-identifier foodcost-db-staging \
  --region us-east-1
```

### Frontend can't reach backend?
1. Check CORS settings in Spring Boot
2. Verify ALB DNS in .env.production
3. Test API directly: `curl http://$ALB_DNS/actuator/health`

---

## 📞 Need Help?

- Check CloudWatch logs for errors
- Review security group rules
- Verify environment variables in ECS task definition
- Check this file: `DEPLOYMENT_CHECKLIST.md` for detailed troubleshooting

---

**Estimated Total Time:** 45-60 minutes
**Estimated Monthly Cost:** $180-250

🎉 **You're now running on AWS!** 🎉
