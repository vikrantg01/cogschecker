#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
export AWS_PROFILE=fcc-deployment
export CDK_DEFAULT_ACCOUNT=333968387413
export CDK_DEFAULT_REGION=us-east-1
ECR_REGISTRY="${CDK_DEFAULT_ACCOUNT}.dkr.ecr.${CDK_DEFAULT_REGION}.amazonaws.com"
ECR_REPO="food-cost-calculator-prod"
STACK_NAME="FoodCostCalculator-Compute"
PROJECT_ROOT="/Users/vicky/cogschecker"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Food Cost Calculator - Compute Stack Deployment          ║${NC}"
echo -e "${BLUE}║  AWS Account: ${CDK_DEFAULT_ACCOUNT}                          ║${NC}"
echo -e "${BLUE}║  Region: ${CDK_DEFAULT_REGION}                                   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Function to print step headers
print_step() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

# Function to check command success
check_success() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ $1${NC}"
    else
        echo -e "${RED}❌ $1${NC}"
        exit 1
    fi
}

# Step 1: Verify Docker image exists locally
print_step "📦 Step 1: Verifying Docker Image"
if docker images | grep -q "foodcost-api.*latest"; then
    echo -e "${GREEN}✅ Docker image 'foodcost-api:latest' found${NC}"
else
    echo -e "${RED}❌ Docker image not found. Building now...${NC}"
    cd "${PROJECT_ROOT}/food-cost-calculator"
    
    echo "Building Maven package..."
    ./mvnw clean package -Dmaven.test.skip=true -pl modules/api -am
    check_success "Maven build completed"
    
    echo "Building Docker image for linux/amd64 platform..."
    docker build --platform linux/amd64 -f Dockerfile.api -t foodcost-api:latest .
    check_success "Docker image built"
fi

# Step 2: Authenticate to ECR
print_step "🔐 Step 2: Authenticating to AWS ECR"
aws ecr get-login-password --region ${CDK_DEFAULT_REGION} | \
    docker login --username AWS --password-stdin ${ECR_REGISTRY}
check_success "ECR authentication successful"

# Step 3: Tag Docker image
print_step "🏷️  Step 3: Tagging Docker Image"
docker tag foodcost-api:latest ${ECR_REGISTRY}/${ECR_REPO}:latest
check_success "Image tagged for ECR"

# Step 4: Push to ECR
print_step "⬆️  Step 4: Pushing Image to ECR"
echo "Pushing to: ${ECR_REGISTRY}/${ECR_REPO}:latest"
docker push ${ECR_REGISTRY}/${ECR_REPO}:latest
check_success "Image pushed to ECR"

# Verify image in ECR
echo -e "\n${YELLOW}Verifying image in ECR...${NC}"
IMAGE_COUNT=$(aws ecr describe-images \
    --repository-name ${ECR_REPO} \
    --query 'length(imageDetails)' \
    --output text 2>/dev/null || echo "0")

if [ "$IMAGE_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✅ Found ${IMAGE_COUNT} image(s) in ECR${NC}"
else
    echo -e "${RED}❌ No images found in ECR! Something went wrong.${NC}"
    exit 1
fi

# Step 5: Check and clean up existing stack
print_step "🗑️  Step 5: Cleaning Up Existing Stack"
STACK_STATUS=$(aws cloudformation describe-stacks \
    --stack-name ${STACK_NAME} \
    --query 'Stacks[0].StackStatus' \
    --output text 2>/dev/null || echo "DOES_NOT_EXIST")

if [ "$STACK_STATUS" != "DOES_NOT_EXIST" ]; then
    echo -e "${YELLOW}Existing stack found with status: ${STACK_STATUS}${NC}"
    echo "Deleting stack..."
    
    aws cloudformation delete-stack --stack-name ${STACK_NAME}
    
    echo "Waiting for stack deletion (this may take 2-3 minutes)..."
    aws cloudformation wait stack-delete-complete \
        --stack-name ${STACK_NAME} 2>/dev/null || true
    
    echo -e "${GREEN}✅ Stack deleted successfully${NC}"
else
    echo -e "${GREEN}✅ No existing stack to clean up${NC}"
fi

# Step 6: Deploy Compute Stack
print_step "🚀 Step 6: Deploying Compute Stack"
cd "${PROJECT_ROOT}/infra"

echo "Starting CDK deployment..."
echo -e "${YELLOW}This will take approximately 8-10 minutes...${NC}"
echo ""

npx cdk deploy ${STACK_NAME} --require-approval never

check_success "Compute stack deployed successfully"

# Step 7: Wait for ECS service to stabilize
print_step "⏳ Step 7: Waiting for ECS Service to Stabilize"
echo "Waiting for ECS tasks to become healthy (up to 3 minutes)..."

# Get cluster and service names
CLUSTER_NAME=$(aws cloudformation describe-stacks \
    --stack-name ${STACK_NAME} \
    --query 'Stacks[0].Outputs[?OutputKey==`ClusterName`].OutputValue' \
    --output text)

SERVICE_NAME=$(aws cloudformation describe-stacks \
    --stack-name ${STACK_NAME} \
    --query 'Stacks[0].Outputs[?OutputKey==`ServiceName`].OutputValue' \
    --output text)

if [ -n "$CLUSTER_NAME" ] && [ -n "$SERVICE_NAME" ]; then
    echo "Cluster: $CLUSTER_NAME"
    echo "Service: $SERVICE_NAME"
    
    # Wait up to 3 minutes for service to stabilize
    for i in {1..36}; do
        RUNNING_COUNT=$(aws ecs describe-services \
            --cluster $CLUSTER_NAME \
            --services $SERVICE_NAME \
            --query 'services[0].runningCount' \
            --output text)
        
        if [ "$RUNNING_COUNT" -gt 0 ]; then
            echo -e "${GREEN}✅ ECS service is running with $RUNNING_COUNT task(s)${NC}"
            break
        fi
        
        echo -n "."
        sleep 5
    done
else
    echo -e "${YELLOW}⚠️  Could not get cluster/service names. Check manually.${NC}"
fi

# Step 8: Get Application URL
print_step "🌐 Step 8: Application Information"

ALB_URL=$(aws cloudformation describe-stacks \
    --stack-name ${STACK_NAME} \
    --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerUrl`].OutputValue' \
    --output text)

if [ -n "$ALB_URL" ]; then
    echo -e "${GREEN}Application URL: ${ALB_URL}${NC}"
    echo ""
    echo "Waiting 30 seconds before testing health endpoint..."
    sleep 30
    
    echo -e "\n${YELLOW}Testing health endpoint...${NC}"
    HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" "${ALB_URL}/actuator/health" 2>/dev/null || echo "ERROR")
    HTTP_CODE=$(echo "$HEALTH_RESPONSE" | tail -1)
    
    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}✅ Health check PASSED!${NC}"
        echo "$HEALTH_RESPONSE" | head -1
    else
        echo -e "${YELLOW}⚠️  Health check returned: $HTTP_CODE${NC}"
        echo -e "${YELLOW}Note: Application may still be starting. Flyway migrations can take 2-3 minutes.${NC}"
        echo -e "${YELLOW}Try again in a few minutes: curl ${ALB_URL}/actuator/health${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Could not retrieve ALB URL${NC}"
fi

# Step 9: Display Deployment Summary
print_step "📊 Deployment Summary"

echo -e "${GREEN}✅ Compute Stack Deployment Complete!${NC}\n"

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Stack Resources${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"

# Get all outputs
aws cloudformation describe-stacks \
    --stack-name ${STACK_NAME} \
    --query 'Stacks[0].Outputs[].[OutputKey, OutputValue]' \
    --output table

echo -e "\n${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Quick Access Commands${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}\n"

echo -e "${YELLOW}View ECS Service:${NC}"
echo "aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME"

echo -e "\n${YELLOW}View CloudWatch Logs:${NC}"
echo "aws logs tail /ecs/foodcost-api-prod --follow"

echo -e "\n${YELLOW}View Tasks:${NC}"
echo "aws ecs list-tasks --cluster $CLUSTER_NAME --service $SERVICE_NAME"

echo -e "\n${YELLOW}Force New Deployment:${NC}"
echo "aws ecs update-service --cluster $CLUSTER_NAME --service $SERVICE_NAME --force-new-deployment"

echo -e "\n${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Next Steps${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}\n"

echo -e "1. ${GREEN}Test the application:${NC}"
echo "   curl ${ALB_URL}/actuator/health"
echo ""
echo -e "2. ${GREEN}Deploy Observability Stack:${NC}"
echo "   cd ${PROJECT_ROOT}/infra"
echo "   ALARM_EMAIL=your-email@example.com \\"
echo "   npx cdk deploy FoodCostCalculator-Observability --require-approval never"
echo ""
echo -e "3. ${GREEN}View detailed logs:${NC}"
echo "   aws logs tail /ecs/foodcost-api-prod --follow --since 10m"

echo -e "\n${GREEN}🎉 Deployment script completed successfully!${NC}\n"
