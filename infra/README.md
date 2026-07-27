# Food Cost Calculator — AWS Deployment Guide

> **Cost-Optimized Infrastructure for 2 Initial Venues**  
> Estimated monthly cost: **$137-200**

This guide provides step-by-step instructions for deploying the Food Cost Calculator application to AWS using a modular, cost-optimized CDK infrastructure.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [AWS Configuration](#aws-configuration)
- [CDK Bootstrap](#cdk-bootstrap)
- [Building and Pushing Docker Image](#building-and-pushing-docker-image)
- [Deployment](#deployment)
- [Post-Deployment Verification](#post-deployment-verification)
- [Environment Variables](#environment-variables)
- [Stack Descriptions](#stack-descriptions)
- [Cost Breakdown](#cost-breakdown)
- [Updating the Deployment](#updating-the-deployment)
- [Troubleshooting](#troubleshooting)
- [Rollback Procedures](#rollback-procedures)
- [Monitoring and Operations](#monitoring-and-operations)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ AWS Account (us-east-1)                                         │
│                                                                   │
│  ┌──────────── VPC 10.0.0.0/16 (2 AZs) ─────────────┐          │
│  │                                                     │          │
│  │  ┌─ Public Subnets ─────────────────────┐        │          │
│  │  │  • ALB (internet-facing)              │        │          │
│  │  │  • CloudFront → S3 (React frontend)   │        │          │
│  │  └───────────────────────────────────────┘        │          │
│  │                                                     │          │
│  │  ┌─ Private Subnets (NAT Egress) ────────┐       │          │
│  │  │  • ECS Fargate Tasks (Spring Boot)     │       │          │
│  │  │  • Auto-scaling 1-4 tasks              │       │          │
│  │  └───────────────────────────────────────┘        │          │
│  │            ↑ 1 NAT Gateway                         │          │
│  │                                                     │          │
│  │  ┌─ Private Isolated Subnets ───────────┐         │          │
│  │  │  • RDS PostgreSQL (t4g.micro)         │         │          │
│  │  │  • ElastiCache Redis (t4g.micro)      │         │          │
│  │  └───────────────────────────────────────┘         │          │
│  │                                                     │          │
│  └─────────────────────────────────────────────────────┘          │
│                                                                   │
│  AWS Managed Services:                                           │
│  • Cognito User Pool (auth + OAuth)                              │
│  • S3 (frontend assets, invoice files)                           │
│  • Secrets Manager (database credentials)                        │
│  • CloudWatch (logs, metrics, alarms → SNS email)                │
│  • ECR (Docker image registry)                                   │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Component | Technology | Cost Optimization |
|-----------|------------|-------------------|
| **Compute** | ECS Fargate | No $72/month EKS control plane fee |
| **Database** | RDS PostgreSQL t4g.micro (single-AZ) | ARM Graviton2 saves 20% vs Intel |
| **Cache** | ElastiCache Redis t4g.micro (single-node) | Single node instead of replication |
| **Networking** | VPC with 1 NAT Gateway | Single NAT saves $35/month vs 2 gateways |
| **Load Balancer** | Application Load Balancer | Layer-7 routing with health checks |
| **Auth** | Amazon Cognito | Free tier up to 50K MAU |
| **Storage** | Amazon S3 + CloudFront | Static hosting with CDN |

---

## Prerequisites

Before deploying, ensure you have the following installed and configured:

### Required Software

1. **AWS CLI** — Version 2.x or newer
   ```bash
   # Install on macOS
   brew install awscli
   
   # Install on Linux
   curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
   unzip awscliv2.zip
   sudo ./aws/install
   
   # Verify installation
   aws --version
   ```

2. **Node.js** — Version 18.x or newer
   ```bash
   # Install via nvm (recommended)
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   nvm install 18
   nvm use 18
   
   # Verify installation
   node --version  # Should show v18.x or higher
   npm --version
   ```

3. **AWS CDK CLI** — Version 2.x
   ```bash
   # Install globally
   npm install -g aws-cdk
   
   # Verify installation
   cdk --version  # Should show 2.x
   ```

4. **Docker** — For building container images
   ```bash
   # Install Docker Desktop (macOS/Windows)
   # Visit: https://www.docker.com/products/docker-desktop
   
   # Or install Docker Engine (Linux)
   # Visit: https://docs.docker.com/engine/install/
   
   # Verify installation
   docker --version
   docker ps  # Should run without errors
   ```

5. **Java Development Kit (JDK)** — Version 17 or newer (for building Spring Boot)
   ```bash
   # Install via SDKMAN (recommended)
   curl -s "https://get.sdkman.io" | bash
   sdk install java 17.0.8-tem
   
   # Verify installation
   java -version
   ```

### AWS Account Requirements

- **AWS Account** with administrator access
- **Programmatic access credentials** (Access Key ID + Secret Access Key)
- **Account limits** sufficient for:
  - 1 VPC with NAT Gateway
  - 1 RDS instance (db.t4g.micro)
  - 1 ElastiCache node (cache.t4g.micro)
  - 1 Application Load Balancer
  - ECS Fargate tasks (1-4 concurrent)

---

## Initial Setup

### 1. Clone Repository

```bash
git clone <repository-url>
cd cogschecker
```

### 2. Install Dependencies

```bash
# Install CDK dependencies
cd infra
npm install

# Verify CDK can synthesize stacks
npm run cdk synth
```

---

## AWS Configuration

### 1. Configure AWS Credentials

```bash
# Configure AWS CLI with your credentials
aws configure

# Enter when prompted:
# - AWS Access Key ID
# - AWS Secret Access Key
# - Default region name (e.g., us-east-1)
# - Default output format (json)
```

### 2. Verify Credentials

```bash
# Test AWS credentials
aws sts get-caller-identity

# Expected output:
# {
#   "UserId": "AIDAI...",
#   "Account": "123456789012",
#   "Arn": "arn:aws:iam::123456789012:user/your-username"
# }
```

### 3. Set AWS Environment Variables

```bash
# Export account and region for CDK
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=us-east-1  # Or your preferred region
```

---

## CDK Bootstrap

**One-time setup per AWS account and region.**

CDK bootstrap provisions resources needed for CDK deployments (S3 bucket for assets, IAM roles, etc.).

```bash
cd infra

# Bootstrap CDK (one-time per account/region)
cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION

# Expected output:
# ⏳  Bootstrapping environment aws://123456789012/us-east-1...
# ✅  Environment aws://123456789012/us-east-1 bootstrapped
```

---

## Building and Pushing Docker Image

The Spring Boot API must be containerized and pushed to Amazon ECR before deployment.

### 1. Build Spring Boot Application

```bash
cd ../food-cost-calculator

# Build JAR file using Maven
./mvnw clean package -DskipTests -pl modules/api -am

# Verify JAR was created
ls -lh modules/api/target/api-*.jar
```

### 2. Authenticate Docker to ECR

```bash
# Get ECR repository URI from CDK outputs (after first deployment)
# Or use this format: {account-id}.dkr.ecr.{region}.amazonaws.com/food-cost-calculator-prod

# Authenticate Docker to ECR
aws ecr get-login-password --region $CDK_DEFAULT_REGION | \
  docker login --username AWS --password-stdin \
  $CDK_DEFAULT_ACCOUNT.dkr.ecr.$CDK_DEFAULT_REGION.amazonaws.com
```

### 3. Build Docker Image

```bash
# Build Docker image
docker build -t food-cost-calculator-api:latest -f Dockerfile.api .

# Verify image was created
docker images | grep food-cost-calculator-api
```

### 4. Tag and Push to ECR

```bash
# Tag image for ECR
docker tag food-cost-calculator-api:latest \
  $CDK_DEFAULT_ACCOUNT.dkr.ecr.$CDK_DEFAULT_REGION.amazonaws.com/food-cost-calculator-prod:latest

# Push to ECR
docker push $CDK_DEFAULT_ACCOUNT.dkr.ecr.$CDK_DEFAULT_REGION.amazonaws.com/food-cost-calculator-prod:latest
```

**Note:** The first deployment will create the ECR repository. If the repository doesn't exist yet, you can either:
- Deploy the Compute stack first (which creates the ECR repository), then push the image
- Or manually create the ECR repository before pushing

---

## Deployment

### Option 1: Deploy All Stacks at Once (Recommended for First Deployment)

```bash
cd infra

# Preview all changes (optional but recommended)
cdk diff --all

# Deploy all stacks
cdk deploy --all --require-approval never

# Expected deployment time: 15-20 minutes
# (RDS instance creation is the slowest step)
```

### Option 2: Deploy Stacks Individually

Follow the correct dependency order:

```bash
# 1. Deploy Network stack (foundation)
cdk deploy FoodCostCalculator-Network

# 2. Deploy Database, Cache, and Auth stacks (can be parallel)
cdk deploy FoodCostCalculator-Database
cdk deploy FoodCostCalculator-Cache
cdk deploy FoodCostCalculator-Auth

# 3. Deploy Compute stack (depends on all above)
cdk deploy FoodCostCalculator-Compute

# 4. Deploy Storage stack (independent)
cdk deploy FoodCostCalculator-Storage

# 5. Deploy Observability stack (depends on Compute)
cdk deploy FoodCostCalculator-Observability
```

### Deployment Progress

During deployment, you'll see:
- ⏳ **Creating resources** — CloudFormation creates AWS resources
- ✅ **Stack deployment completed** — Stack is live
- 📤 **Outputs** — Important values like ALB URL, ECR repository URI

---

## Post-Deployment Verification

### 1. Retrieve ALB URL

```bash
# Get ALB DNS name from CloudFormation outputs
aws cloudformation describe-stacks \
  --stack-name FoodCostCalculator-Compute \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerUrl`].OutputValue' \
  --output text

# Example output: http://foodcost-alb-prod-123456789.us-east-1.elb.amazonaws.com
```

### 2. Test Health Check Endpoint

```bash
# Test the Spring Boot health endpoint
ALB_URL=$(aws cloudformation describe-stacks \
  --stack-name FoodCostCalculator-Compute \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerUrl`].OutputValue' \
  --output text)

curl -i $ALB_URL/actuator/health

# Expected response:
# HTTP/1.1 200 OK
# Content-Type: application/json
# 
# {"status":"UP"}
```

### 3. Verify ECS Service is Running

```bash
# Check ECS service status
aws ecs describe-services \
  --cluster foodcost-prod \
  --services foodcost-api-prod \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}' \
  --output table

# Expected output:
# --------------------------------
# |      DescribeServices        |
# +----------+----------+---------+
# | Desired  | Running  | Status  |
# +----------+----------+---------+
# |  1       |  1       | ACTIVE  |
# +----------+----------+---------+
```

### 4. Check Database Connectivity

```bash
# View ECS task logs to verify database connection
aws logs tail /ecs/foodcost-api-prod --follow --since 5m

# Look for log messages indicating successful database connection:
# - "HikariPool-1 - Starting..."
# - "HikariPool-1 - Start completed"
# - "Liquibase: Database is up to date"
```

### 5. Test API Endpoints

```bash
# Test a public API endpoint (adjust based on your API)
curl -i $ALB_URL/api/health

# Or test with authentication
curl -i -H "Authorization: Bearer <jwt-token>" $ALB_URL/api/venues
```

---

## Environment Variables

### Required Environment Variables

The following environment variables are automatically configured in the ECS task definition:

| Variable | Source | Description |
|----------|--------|-------------|
| `SPRING_PROFILES_ACTIVE` | Hardcoded | Set to `production` |
| `DATABASE_URL` | Constructed | JDBC URL for RDS PostgreSQL |
| `DATABASE_USERNAME` | Hardcoded | Database username (`postgres`) |
| `DATABASE_PASSWORD` | Secrets Manager | Retrieved securely from AWS Secrets Manager |
| `REDIS_HOST` | RDS Stack Output | ElastiCache Redis endpoint |
| `REDIS_PORT` | Hardcoded | Redis port (6379) |
| `AWS_REGION` | CDK Context | Deployment region |
| `COGNITO_USER_POOL_ID` | Auth Stack Output | Cognito User Pool ID |
| `COGNITO_CLIENT_ID` | Auth Stack Output | Cognito Client ID |

### Optional: Email Notifications

To receive CloudWatch alarm notifications via email:

```bash
# Set ALARM_EMAIL environment variable before deployment
export ALARM_EMAIL=devops@example.com

# Redeploy Observability stack
cd infra
cdk deploy FoodCostCalculator-Observability

# Confirm SNS subscription via email
# (You'll receive an email with a confirmation link)
```

---

## Stack Descriptions

### 1. NetworkStackOptimized

**Purpose:** Foundational networking infrastructure

**Resources:**
- VPC (10.0.0.0/16) spanning 2 Availability Zones
- 2 public subnets (for ALB)
- 2 private subnets with NAT egress (for ECS tasks)
- 2 private isolated subnets (for RDS and Redis)
- 1 NAT Gateway (cost optimization)
- 4 security groups (ALB, ECS, RDS, Redis)

**Exports:**
- VPC ID
- Subnet IDs
- Security Group IDs

### 2. DatabaseStack (RdsStack)

**Purpose:** PostgreSQL database

**Resources:**
- RDS PostgreSQL 15.x (db.t4g.micro, single-AZ)
- 20 GB gp3 storage with auto-scaling to 100 GB
- Secrets Manager secret (credentials)
- Automated backups (7-day retention)
- SSL/TLS enforcement

**Exports:**
- Database endpoint hostname
- Database name (`foodcost`)
- Secret ARN

### 3. CacheStack

**Purpose:** Redis cache for sessions and queries

**Resources:**
- ElastiCache Redis 7.x (cache.t4g.micro, single-node)
- TLS encryption in transit
- KMS encryption at rest

**Exports:**
- Redis primary endpoint

### 4. AuthStack

**Purpose:** User authentication and OAuth

**Resources:**
- Cognito User Pool
- User Pool Client
- Google and Apple OAuth identity providers
- Custom attributes (`org_id`, `venue_roles`, `tier`)

**Exports:**
- User Pool ID
- User Pool ARN
- Client ID

### 5. ComputeStack (EcsStack)

**Purpose:** Containerized API backend

**Resources:**
- ECS Cluster with Fargate capacity
- ECR repository (image scanning, lifecycle policy)
- Task Definition (1 vCPU, 2 GB memory)
- ECS Service (1-4 tasks with auto-scaling)
- Application Load Balancer (internet-facing)
- IAM roles (task execution, task role)
- S3 bucket for ALB access logs

**Auto-scaling:**
- Min: 1 task
- Max: 4 tasks
- CPU target: 70%
- Memory target: 80%

**Exports:**
- ECR repository URI
- ECS cluster name
- ECS service name
- ALB DNS name

### 6. StorageStack

**Purpose:** Object storage

**Resources:**
- S3 bucket for frontend assets (`fcc-frontend`)
- S3 bucket for invoice uploads (`fcc-invoices`)
- Lifecycle policy (Glacier after 90 days)

**Exports:**
- Frontend bucket name and ARN
- Invoice bucket name and ARN

### 7. ObservabilityStack

**Purpose:** Monitoring and alerting

**Resources:**
- CloudWatch log group (7-day retention)
- SNS topic for alarm notifications
- CloudWatch alarms:
  - ECS CPU > 85%
  - ECS Memory > 90%
  - RDS CPU > 80%
  - RDS Storage < 2 GB
  - ALB Unhealthy hosts > 0
  - ALB 5xx errors > 5%

**Exports:**
- Log group name
- SNS topic ARN

---

## Cost Breakdown

### Estimated Monthly Costs (2 Venues, Minimal Deployment)

| Service | Configuration | Monthly Cost |
|---------|--------------|--------------|
| **ECS Fargate** | 1-2 tasks × 1 vCPU × 2 GB × 730 hours | $45-90 |
| **Application Load Balancer** | ALB + LCU charges | $16-20 |
| **RDS PostgreSQL** | db.t4g.micro single-AZ + 20 GB gp3 | $15-25 |
| **ElastiCache Redis** | cache.t4g.micro single-node | $12-15 |
| **NAT Gateway** | 1 gateway + data transfer | $35-40 |
| **S3 + CloudFront** | Static assets + edge delivery | $5-10 |
| **CloudWatch** | Logs (7-day) + metrics + alarms | $5-10 |
| **Secrets Manager** | 1 secret | $0.40 |
| **Total** | | **$137-200/month** |

### Cost Optimization Notes

- **ECS Fargate vs EKS:** Saves $72/month (no control plane fee)
- **Single-AZ RDS:** Saves ~$25/month vs Multi-AZ
- **Single NAT Gateway:** Saves $35/month vs 2 gateways
- **ARM Graviton2 (t4g):** 20% cheaper than Intel (t3)
- **7-day log retention:** Reduces CloudWatch storage costs
- **S3 Glacier lifecycle:** Reduces storage costs for old invoices

---

## Updating the Deployment

### Updating Application Code

When you make changes to the Spring Boot application:

```bash
# 1. Rebuild JAR
cd food-cost-calculator
./mvnw clean package -DskipTests -pl modules/api -am

# 2. Rebuild and push Docker image
docker build -t food-cost-calculator-api:latest -f Dockerfile.api .
docker tag food-cost-calculator-api:latest \
  $CDK_DEFAULT_ACCOUNT.dkr.ecr.$CDK_DEFAULT_REGION.amazonaws.com/food-cost-calculator-prod:latest
docker push $CDK_DEFAULT_ACCOUNT.dkr.ecr.$CDK_DEFAULT_REGION.amazonaws.com/food-cost-calculator-prod:latest

# 3. Force ECS service to deploy new image
aws ecs update-service \
  --cluster foodcost-prod \
  --service foodcost-api-prod \
  --force-new-deployment

# 4. Monitor deployment
aws ecs describe-services \
  --cluster foodcost-prod \
  --services foodcost-api-prod \
  --query 'services[0].deployments'
```

**Note:** ECS uses a rolling deployment strategy (50% min healthy, 200% max healthy) for zero-downtime updates. The circuit breaker will automatically roll back if health checks fail.

### Updating Infrastructure

When you make changes to CDK code:

```bash
cd infra

# 1. Preview changes
cdk diff FoodCostCalculator-Compute

# 2. Deploy specific stack
cdk deploy FoodCostCalculator-Compute

# Or deploy all stacks
cdk deploy --all
```

---

## Troubleshooting

### Common Issues and Solutions

#### 1. ECR Authentication Failure

**Error:** `denied: Your authorization token has expired`

**Solution:**
```bash
# Re-authenticate Docker to ECR
aws ecr get-login-password --region $CDK_DEFAULT_REGION | \
  docker login --username AWS --password-stdin \
  $CDK_DEFAULT_ACCOUNT.dkr.ecr.$CDK_DEFAULT_REGION.amazonaws.com
```

#### 2. Health Check Timeout

**Error:** ECS tasks fail health checks and keep restarting

**Diagnostic:**
```bash
# View ECS task logs
aws logs tail /ecs/foodcost-api-prod --follow

# Check task status
aws ecs describe-tasks \
  --cluster foodcost-prod \
  --tasks $(aws ecs list-tasks --cluster foodcost-prod --service foodcost-api-prod --query 'taskArns[0]' --output text) \
  --query 'tasks[0].containers[0].healthStatus'
```

**Common Causes:**
- Application startup time exceeds 60 seconds (increase `healthCheckGracePeriod`)
- Database connection failure (check Secrets Manager permissions)
- Port mismatch (ensure container exposes port 8080)

**Solution:**
```bash
# Check database connectivity from application logs
aws logs tail /ecs/foodcost-api-prod --follow --filter-pattern "ERROR"

# Verify Secrets Manager permissions
aws iam get-role-policy \
  --role-name FoodCostCalculator-Compute-TaskExecutionRole \
  --policy-name SecretsManagerPolicy
```

#### 3. Secret Access Denied

**Error:** `AccessDeniedException: User is not authorized to perform secretsmanager:GetSecretValue`

**Solution:**
```bash
# Verify the task execution role has Secrets Manager permissions
aws iam list-attached-role-policies \
  --role-name FoodCostCalculator-Compute-TaskExecutionRole-*

# Check inline policies
aws iam list-role-policies \
  --role-name FoodCostCalculator-Compute-TaskExecutionRole-*

# If missing, redeploy the Compute stack
cd infra
cdk deploy FoodCostCalculator-Compute
```

#### 4. RDS Connection Refused

**Error:** `Connection refused` or `Connection timed out` when connecting to RDS

**Diagnostic:**
```bash
# Check security group rules
aws ec2 describe-security-groups \
  --filters "Name=tag:Name,Values=foodcost-rds-sg" \
  --query 'SecurityGroups[0].IpPermissions'

# Verify ECS task is in the correct subnet
aws ecs describe-tasks \
  --cluster foodcost-prod \
  --tasks $(aws ecs list-tasks --cluster foodcost-prod --service foodcost-api-prod --query 'taskArns[0]' --output text) \
  --query 'tasks[0].attachments[0].details[?name==`subnetId`].value'
```

**Solution:**
- Ensure RDS security group allows inbound traffic on port 5432 from ECS security group
- Verify ECS tasks are in private subnets with NAT egress
- Check RDS endpoint is correct in ECS task environment variables

#### 5. CDK Bootstrap Error

**Error:** `This stack uses assets, so the toolkit stack must be deployed`

**Solution:**
```bash
# Bootstrap CDK for your account and region
cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION
```

#### 6. Docker Push Rate Limited

**Error:** `toomanyrequests: You have reached your pull rate limit`

**Solution:**
- Use Amazon ECR instead of Docker Hub for base images
- Authenticate to Docker Hub with a free account (increases rate limit)
- Use AWS CodeBuild for image builds (no rate limits)

---

## Rollback Procedures

### Automatic Rollback

CDK/CloudFormation automatically rolls back when:
- Resource creation fails during stack deployment
- Health checks fail after ECS task update (circuit breaker enabled)
- Stack update violates constraints

### Manual Rollback: ECS Service

To revert to a previous task definition:

```bash
# 1. List task definition revisions
aws ecs list-task-definitions \
  --family-prefix foodcost-api-prod \
  --sort DESC

# 2. Update service to use previous revision
aws ecs update-service \
  --cluster foodcost-prod \
  --service foodcost-api-prod \
  --task-definition foodcost-api-prod:5  # Use previous revision number

# 3. Monitor rollback
aws ecs describe-services \
  --cluster foodcost-prod \
  --services foodcost-api-prod \
  --query 'services[0].events[:5]'
```

### Manual Rollback: CloudFormation Stack

To rollback the last stack update:

```bash
# Rollback specific stack
aws cloudformation rollback-stack \
  --stack-name FoodCostCalculator-Compute

# Or use CDK (if stack is in ROLLBACK_COMPLETE state, delete and redeploy)
cdk destroy FoodCostCalculator-Compute
cdk deploy FoodCostCalculator-Compute
```

---

## Monitoring and Operations

### View ECS Task Logs

```bash
# Tail logs in real-time
aws logs tail /ecs/foodcost-api-prod --follow

# Filter for errors
aws logs tail /ecs/foodcost-api-prod --follow --filter-pattern ERROR

# View logs from last hour
aws logs tail /ecs/foodcost-api-prod --since 1h

# Query structured logs with CloudWatch Insights
aws logs start-query \
  --log-group-name /ecs/foodcost-api-prod \
  --start-time $(date -u -d '1 hour ago' +%s) \
  --end-time $(date -u +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 20'
```

### Monitor ECS Service Metrics

```bash
# View service CPU utilization
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ServiceName,Value=foodcost-api-prod Name=ClusterName,Value=foodcost-prod \
  --start-time $(date -u -d '1 hour ago' +%s) \
  --end-time $(date -u +%s) \
  --period 300 \
  --statistics Average

# View service memory utilization
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name MemoryUtilization \
  --dimensions Name=ServiceName,Value=foodcost-api-prod Name=ClusterName,Value=foodcost-prod \
  --start-time $(date -u -d '1 hour ago' +%s) \
  --end-time $(date -u +%s) \
  --period 300 \
  --statistics Average
```

### Check CloudWatch Alarms

```bash
# List all alarms
aws cloudwatch describe-alarms \
  --alarm-name-prefix foodcost \
  --query 'MetricAlarms[*].{Name:AlarmName,State:StateValue,Reason:StateReason}' \
  --output table

# View alarm history
aws cloudwatch describe-alarm-history \
  --alarm-name foodcost-ecs-cpu-high \
  --max-records 10
```

### Access ALB Logs

ALB access logs are stored in S3 for detailed request analysis:

```bash
# List ALB log files
aws s3 ls s3://fcc-alb-logs-prod/ --recursive

# Download recent log files
aws s3 sync s3://fcc-alb-logs-prod/ ./alb-logs/ --exclude "*" --include "$(date +%Y/%m/%d)/*"

# Query logs with S3 Select or Athena for advanced analysis
```

---

## Additional Resources

### AWS CDK Documentation

- [AWS CDK Developer Guide](https://docs.aws.amazon.com/cdk/latest/guide/)
- [AWS CDK API Reference](https://docs.aws.amazon.com/cdk/api/v2/)

### AWS Service Documentation

- [Amazon ECS](https://docs.aws.amazon.com/ecs/)
- [Amazon RDS](https://docs.aws.amazon.com/rds/)
- [Amazon ElastiCache](https://docs.aws.amazon.com/elasticache/)
- [Amazon Cognito](https://docs.aws.amazon.com/cognito/)
- [CloudWatch](https://docs.aws.amazon.com/cloudwatch/)

### Cost Optimization

- [AWS Cost Calculator](https://calculator.aws/)
- [AWS Cost Explorer](https://aws.amazon.com/aws-cost-management/aws-cost-explorer/)

---

## Support and Feedback

For issues, questions, or feedback:
- Create an issue in the repository
- Contact the platform engineering team
- Review CloudWatch logs and metrics for diagnostic information

---

**Last Updated:** $(date +"%Y-%m-%d")  
**Deployment Version:** Minimal Production (2 venues)  
**Estimated Monthly Cost:** $137-200
