#!/bin/bash
# AWS Deployment Script - Food Cost Calculator
# This script will guide you through deploying to AWS step by step

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_header() {
    echo -e "\n${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}\n"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

confirm() {
    read -p "$(echo -e ${YELLOW}$1 ${NC}[y/N]: )" -n 1 -r
    echo
    [[ $REPLY =~ ^[Yy]$ ]]
}

# Welcome
clear
print_header "Food Cost Calculator - AWS Deployment"
echo "This script will deploy your application to AWS."
echo "Estimated time: 45-60 minutes"
echo "Estimated cost: \$180-250/month"
echo ""

if ! confirm "Ready to start deployment?"; then
    echo "Deployment cancelled."
    exit 0
fi

# Step 1: Check Prerequisites
print_header "Step 1/8: Checking Prerequisites"

# Check AWS CLI
print_info "Checking AWS CLI..."
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI not found"
    echo "Install with: brew install awscli"
    exit 1
fi
print_success "AWS CLI installed: $(aws --version)"

# Check AWS credentials
print_info "Checking AWS credentials..."
if ! aws sts get-caller-identity &> /dev/null; then
    print_error "AWS CLI not configured"
    echo ""
    echo "Please run: aws configure"
    echo ""
    echo "You'll need:"
    echo "  - AWS Access Key ID"
    echo "  - AWS Secret Access Key"
    echo "  - Default region: us-east-1"
    echo ""
    echo "See DEPLOY_NOW.md for detailed instructions."
    exit 1
fi

export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION=$(aws configure get region || echo "us-east-1")
print_success "AWS Account: $AWS_ACCOUNT_ID"
print_success "AWS Region: $AWS_REGION"

# Check Docker
print_info "Checking Docker..."
if ! docker ps &> /dev/null; then
    print_error "Docker not running"
    echo "Please start Docker Desktop and try again"
    exit 1
fi
print_success "Docker is running"

# Check Node.js
print_info "Checking Node.js..."
if ! command -v node &> /dev/null; then
    print_error "Node.js not found"
    echo "Install with: brew install node"
    exit 1
fi
print_success "Node.js installed: $(node --version)"

# Step 2: Build Docker Image
print_header "Step 2/8: Building Docker Image"

cd /Users/vicky/cogschecker/food-cost-calculator

if confirm "Build Spring Boot JAR and Docker image?"; then
    print_info "Building Spring Boot JAR..."
    ./gradlew clean :modules:api:bootJar
    
    print_info "Building Docker image..."
    docker build -t food-cost-calculator-api:latest -f Dockerfile.api .
    
    print_success "Docker image built successfully"
else
    print_warning "Skipping Docker build"
fi

# Step 3: Deploy Infrastructure
print_header "Step 3/8: Deploying AWS Infrastructure"

cd /Users/vicky/cogschecker/infra

print_info "This will create:"
echo "  • VPC with subnets and NAT gateway"
echo "  • RDS PostgreSQL database"
echo "  • ElastiCache Redis"
echo "  • Cognito User Pool"
echo "  • S3 buckets"
echo "  • ECS cluster with ALB"
echo ""
echo "⏱️  This will take 25-35 minutes"
echo ""

if ! confirm "Deploy infrastructure to AWS?"; then
    print_warning "Deployment cancelled"
    exit 0
fi

# Install CDK dependencies
print_info "Installing CDK dependencies..."
npm install --silent

# Bootstrap CDK (if needed)
print_info "Checking CDK bootstrap..."
if ! aws cloudformation describe-stacks --stack-name CDKToolkit &> /dev/null; then
    print_info "Bootstrapping CDK..."
    npx cdk bootstrap aws://$AWS_ACCOUNT_ID/$AWS_REGION
    print_success "CDK bootstrapped"
else
    print_success "CDK already bootstrapped"
fi

# Deploy stacks
print_info "Deploying CDK stacks..."
echo "☕ Grab a coffee, this will take a while..."
npx cdk deploy --all \
    --app "npx ts-node --prefer-ts-exts bin/app-optimized.ts" \
    --require-approval never \
    --context env=staging

print_success "Infrastructure deployed!"

# Save outputs
print_info "Saving deployment outputs..."
cd /Users/vicky/cogschecker
aws cloudformation describe-stacks \
    --query 'Stacks[].{StackName:StackName,Outputs:Outputs}' \
    > aws-deployment-outputs.json
print_success "Outputs saved to aws-deployment-outputs.json"

# Step 4: Push Docker Image
print_header "Step 4/8: Pushing Docker Image to AWS"

# Get ECR URI
export ECR_URI=$(aws cloudformation describe-stacks \
    --stack-name FoodCost-ECS-staging \
    --query 'Stacks[0].Outputs[?OutputKey==`RepositoryUri`].OutputValue' \
    --output text)

if [ -z "$ECR_URI" ]; then
    print_error "Could not get ECR repository URI"
    exit 1
fi

print_info "ECR Repository: $ECR_URI"

# Login to ECR
print_info "Logging into ECR..."
aws ecr get-login-password --region $AWS_REGION | \
    docker login --username AWS --password-stdin $ECR_URI

# Tag and push
print_info "Pushing Docker image..."
docker tag food-cost-calculator-api:latest $ECR_URI:latest
docker push $ECR_URI:latest

print_success "Docker image pushed to ECR"

# Step 5: Deploy to ECS
print_header "Step 5/8: Deploying to ECS"

print_info "Triggering ECS deployment..."
aws ecs update-service \
    --cluster foodcost-staging \
    --service foodcost-api-staging \
    --force-new-deployment \
    --region $AWS_REGION \
    > /dev/null

print_info "Waiting for ECS service to stabilize (this may take 2-3 minutes)..."
aws ecs wait services-stable \
    --cluster foodcost-staging \
    --services foodcost-api-staging \
    --region $AWS_REGION

print_success "ECS service deployed and stable"

# Step 6: Test Backend
print_header "Step 6/8: Testing Backend API"

# Get ALB DNS
export ALB_DNS=$(aws cloudformation describe-stacks \
    --stack-name FoodCost-ECS-staging \
    --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
    --output text)

if [ -z "$ALB_DNS" ]; then
    print_error "Could not get ALB DNS name"
    exit 1
fi

print_info "API URL: http://$ALB_DNS"

# Test health endpoint
print_info "Testing health endpoint..."
sleep 5  # Give ALB a moment

if curl -sf "http://$ALB_DNS/actuator/health" > /dev/null; then
    print_success "Backend API is healthy!"
    curl -s "http://$ALB_DNS/actuator/health" | python3 -m json.tool
else
    print_warning "Backend health check failed (it may still be starting up)"
fi

# Step 7: Deploy Frontend
print_header "Step 7/8: Deploying Frontend"

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

# Create production env file
print_info "Creating production environment file..."
cat > .env.production << EOF
VITE_API_BASE_URL=http://$ALB_DNS
VITE_COGNITO_USER_POOL_ID=$COGNITO_POOL_ID
VITE_COGNITO_CLIENT_ID=$COGNITO_CLIENT_ID
EOF

print_success "Environment file created"

# Build frontend
print_info "Building frontend..."
npm run build

# Get S3 bucket
export S3_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name FoodCost-Storage-staging \
    --query 'Stacks[0].Outputs[?OutputKey==`AssetsBucketName`].OutputValue' \
    --output text)

# Upload to S3
print_info "Uploading to S3..."
aws s3 sync dist/ s3://$S3_BUCKET/ --delete --quiet

# Configure S3 website hosting
print_info "Configuring S3 website hosting..."
aws s3 website s3://$S3_BUCKET/ \
    --index-document index.html \
    --error-document index.html

print_success "Frontend deployed to S3"

# Step 8: Summary
print_header "Step 8/8: Deployment Complete! 🎉"

export S3_URL="http://$S3_BUCKET.s3-website-us-east-1.amazonaws.com"

echo ""
print_success "Your Food Cost Calculator is now live on AWS!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}  Frontend:${NC}     $S3_URL"
echo -e "${GREEN}  API:${NC}          http://$ALB_DNS"
echo -e "${GREEN}  Health Check:${NC} http://$ALB_DNS/actuator/health"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Deployment Details:"
echo "  • AWS Account: $AWS_ACCOUNT_ID"
echo "  • Region: $AWS_REGION"
echo "  • Environment: staging"
echo "  • Deployed: $(date)"
echo ""
echo "💰 Estimated Monthly Cost: \$180-250"
echo ""
echo "📁 Deployment info saved to:"
echo "  • aws-deployment-outputs.json"
echo "  • ~/foodcost-aws-urls.txt"
echo ""

# Save URLs to file
cat > ~/foodcost-aws-urls.txt << EOF
Food Cost Calculator - AWS Deployment

Frontend: $S3_URL
API: http://$ALB_DNS
Health Check: http://$ALB_DNS/actuator/health

AWS Account: $AWS_ACCOUNT_ID
Region: $AWS_REGION
Deployed: $(date)

Next Steps:
1. Open the frontend URL in your browser
2. Register a new account
3. Start using the app!

To update:
  cd /Users/vicky/cogschecker
  ./deploy-to-aws.sh

To destroy:
  cd /Users/vicky/cogschecker/infra
  npx cdk destroy --all
EOF

print_info "Next steps:"
echo "  1. Open frontend: $S3_URL"
echo "  2. Register a new account"
echo "  3. Create ingredients and recipes"
echo ""

if confirm "Open frontend in browser now?"; then
    open "$S3_URL" || print_info "Please open manually: $S3_URL"
fi

echo ""
print_success "Deployment script completed successfully!"
echo ""
