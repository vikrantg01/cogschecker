# AWS Deployment Checklist

## ✅ Pre-Deployment Setup (30 minutes)

### AWS Account Setup
- [ ] Create AWS account (if you don't have one)
- [ ] Enable MFA on root account
- [ ] Create IAM user with admin access
- [ ] Download access keys
- [ ] Install AWS CLI: `brew install awscli` (macOS)
- [ ] Configure AWS CLI: `aws configure`
- [ ] Set default region: `us-east-1` (cheapest)

### Billing & Cost Management
- [ ] Set up billing alerts ($50, $100, $200 thresholds)
- [ ] Create budget: $200/month
- [ ] Enable Cost Explorer
- [ ] Review AWS Free Tier usage

### Domain (Optional for Phase 1)
- [ ] Purchase domain (Route 53 or external)
- [ ] Create Route 53 hosted zone (if using custom domain)
- [ ] Request SSL certificate in ACM

---

## 🏗️ Phase 1: Basic Deployment (3-5 days)

### Day 1: Docker Preparation

#### Build Spring Boot JAR
```bash
cd /Users/vicky/cogschecker/food-cost-calculator
./gradlew :modules:api:clean :modules:api:bootJar
```
- [ ] JAR file created in `modules/api/build/libs/`
- [ ] JAR size reasonable (~50-80MB)

#### Test Docker Build Locally
```bash
# Start local PostgreSQL and Redis (if not running)
./start-services.sh

# Build and test Docker image
./build-and-test-docker.sh
```
- [ ] Docker image builds successfully
- [ ] Health check passes
- [ ] Image size < 300MB

---

### Day 2: AWS Infrastructure Setup

#### 1. Create VPC (10 minutes)
```bash
# Using AWS Console or CLI
aws ec2 create-vpc --cidr-block 10.0.0.0/16 --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=foodcost-vpc}]'
```
- [ ] VPC created
- [ ] 2 public subnets (10.0.1.0/24, 10.0.2.0/24)
- [ ] 2 private subnets (10.0.11.0/24, 10.0.12.0/24)
- [ ] Internet Gateway attached
- [ ] NAT Gateway in public subnet
- [ ] Route tables configured

#### 2. Create Security Groups (5 minutes)
```bash
# ALB Security Group (allow HTTP/HTTPS from internet)
# ECS Security Group (allow traffic from ALB)
# RDS Security Group (allow traffic from ECS)
# Redis Security Group (allow traffic from ECS)
```
- [ ] ALB SG: ingress 80, 443 from 0.0.0.0/0
- [ ] ECS SG: ingress 8080 from ALB SG
- [ ] RDS SG: ingress 5432 from ECS SG
- [ ] Redis SG: ingress 6379 from ECS SG

#### 3. Create RDS PostgreSQL (15 minutes)
```bash
aws rds create-db-instance \
  --db-instance-identifier foodcost-db \
  --db-instance-class db.t4g.micro \
  --engine postgres \
  --engine-version 15.4 \
  --master-username postgres \
  --master-user-password <STRONG-PASSWORD> \
  --allocated-storage 20 \
  --vpc-security-group-ids <RDS-SG-ID> \
  --db-subnet-group-name <SUBNET-GROUP> \
  --backup-retention-period 7 \
  --multi-az \
  --storage-encrypted \
  --tags Key=Name,Value=foodcost-db
```
- [ ] RDS instance created
- [ ] Status: Available (~10 minutes)
- [ ] Endpoint hostname noted
- [ ] Password stored in Secrets Manager

#### 4. Create ElastiCache Redis (10 minutes)
```bash
aws elasticache create-cache-cluster \
  --cache-cluster-id foodcost-redis \
  --cache-node-type cache.t4g.micro \
  --engine redis \
  --engine-version 7.0 \
  --num-cache-nodes 1 \
  --cache-subnet-group-name <SUBNET-GROUP> \
  --security-group-ids <REDIS-SG-ID> \
  --tags Key=Name,Value=foodcost-redis
```
- [ ] Redis cluster created
- [ ] Status: Available
- [ ] Endpoint hostname noted

#### 5. Create Secrets Manager Secrets (5 minutes)
```bash
# Database password
aws secretsmanager create-secret \
  --name foodcost/database-password \
  --secret-string "<YOUR-DB-PASSWORD>"

# JWT secret
aws secretsmanager create-secret \
  --name foodcost/jwt-secret \
  --secret-string "<RANDOM-256-BIT-STRING>"
```
- [ ] Database password secret created
- [ ] JWT secret created
- [ ] ARNs noted for ECS task definition

---

### Day 3: Deploy Backend API

#### 1. Create ECR Repository (2 minutes)
```bash
aws ecr create-repository \
  --repository-name food-cost-calculator \
  --image-scanning-configuration scanOnPush=true \
  --encryption-configuration encryptionType=AES256
```
- [ ] Repository created
- [ ] Repository URI noted

#### 2. Push Docker Image to ECR (5 minutes)
```bash
# Authenticate Docker to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <ACCOUNT-ID>.dkr.ecr.us-east-1.amazonaws.com

# Tag image
docker tag food-cost-calculator-api:latest \
  <ACCOUNT-ID>.dkr.ecr.us-east-1.amazonaws.com/food-cost-calculator:latest

# Push image
docker push <ACCOUNT-ID>.dkr.ecr.us-east-1.amazonaws.com/food-cost-calculator:latest
```
- [ ] Docker authenticated
- [ ] Image pushed successfully
- [ ] Image visible in ECR console

#### 3. Create Application Load Balancer (10 minutes)
```bash
# Create ALB in public subnets
aws elbv2 create-load-balancer \
  --name foodcost-alb \
  --subnets <PUBLIC-SUBNET-1> <PUBLIC-SUBNET-2> \
  --security-groups <ALB-SG-ID> \
  --scheme internet-facing \
  --type application \
  --tags Key=Name,Value=foodcost-alb

# Create target group
aws elbv2 create-target-group \
  --name foodcost-api-tg \
  --protocol HTTP \
  --port 8080 \
  --vpc-id <VPC-ID> \
  --target-type ip \
  --health-check-path /actuator/health \
  --health-check-interval-seconds 30 \
  --health-check-timeout-seconds 5 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3

# Create listener
aws elbv2 create-listener \
  --load-balancer-arn <ALB-ARN> \
  --protocol HTTP \
  --port 80 \
  --default-actions Type=forward,TargetGroupArn=<TG-ARN>
```
- [ ] ALB created
- [ ] Target group created
- [ ] HTTP listener (port 80) created
- [ ] ALB DNS name noted

#### 4. Create ECS Cluster (2 minutes)
```bash
aws ecs create-cluster \
  --cluster-name foodcost-cluster \
  --capacity-providers FARGATE \
  --tags key=Name,value=foodcost-cluster
```
- [ ] Cluster created

#### 5. Create IAM Role for ECS Tasks (5 minutes)
```bash
# Task execution role (for pulling images, logs)
# Task role (for accessing AWS services from app)
```
- [ ] Execution role created with ECR, CloudWatch permissions
- [ ] Task role created with Secrets Manager, S3, SQS permissions

#### 6. Create ECS Task Definition (10 minutes)

Create file: `task-definition.json`
```json
{
  "family": "foodcost-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "<EXECUTION-ROLE-ARN>",
  "taskRoleArn": "<TASK-ROLE-ARN>",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "<ECR-URI>/food-cost-calculator:latest",
      "essential": true,
      "portMappings": [{"containerPort": 8080, "protocol": "tcp"}],
      "environment": [
        {"name": "SPRING_PROFILES_ACTIVE", "value": "production"},
        {"name": "DATABASE_URL", "value": "jdbc:postgresql://<RDS-ENDPOINT>:5432/foodcost"},
        {"name": "DATABASE_USERNAME", "value": "postgres"},
        {"name": "REDIS_HOST", "value": "<REDIS-ENDPOINT>"},
        {"name": "REDIS_PORT", "value": "6379"},
        {"name": "AWS_REGION", "value": "us-east-1"}
      ],
      "secrets": [
        {"name": "DATABASE_PASSWORD", "valueFrom": "<SECRET-ARN>:password::"},
        {"name": "JWT_SECRET", "valueFrom": "<JWT-SECRET-ARN>::"}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/foodcost-api",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:8080/actuator/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
```

Register task definition:
```bash
aws ecs register-task-definition --cli-input-json file://task-definition.json
```
- [ ] Task definition created
- [ ] Environment variables configured
- [ ] Secrets configured
- [ ] Health check configured
- [ ] CloudWatch logs group created

#### 7. Create ECS Service (5 minutes)
```bash
aws ecs create-service \
  --cluster foodcost-cluster \
  --service-name foodcost-api \
  --task-definition foodcost-api:1 \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[<PRIVATE-SUBNET-1>,<PRIVATE-SUBNET-2>],securityGroups=[<ECS-SG-ID>],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=<TG-ARN>,containerName=api,containerPort=8080" \
  --health-check-grace-period-seconds 60
```
- [ ] Service created
- [ ] Tasks starting
- [ ] Tasks registered with target group
- [ ] Health checks passing

#### 8. Test Backend API (5 minutes)
```bash
# Get ALB DNS name
ALB_DNS=$(aws elbv2 describe-load-balancers \
  --names foodcost-alb \
  --query 'LoadBalancers[0].DNSName' \
  --output text)

# Test health endpoint
curl http://${ALB_DNS}/actuator/health

# Test API endpoint
curl http://${ALB_DNS}/api/v1/auth/health
```
- [ ] Health check returns `{"status":"UP"}`
- [ ] API responds correctly
- [ ] Logs visible in CloudWatch

---

### Day 4: Configure Cognito

#### 1. Create User Pool (10 minutes)
```bash
aws cognito-idp create-user-pool \
  --pool-name foodcost-users \
  --policies "PasswordPolicy={MinimumLength=8,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=false}" \
  --auto-verified-attributes email \
  --mfa-configuration OPTIONAL \
  --account-recovery-setting "RecoveryMechanisms=[{Priority=1,Name=verified_email}]" \
  --user-pool-tags Name=foodcost-users
```
- [ ] User pool created
- [ ] User pool ID noted
- [ ] Password policy configured

#### 2. Create App Client (5 minutes)
```bash
aws cognito-idp create-user-pool-client \
  --user-pool-id <USER-POOL-ID> \
  --client-name foodcost-web-app \
  --generate-secret \
  --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --access-token-validity 1 \
  --id-token-validity 1 \
  --refresh-token-validity 30 \
  --token-validity-units "AccessToken=hours,IdToken=hours,RefreshToken=days"
```
- [ ] App client created
- [ ] Client ID noted
- [ ] Client secret noted (store in Secrets Manager)

#### 3. Create User Pool Domain (2 minutes)
```bash
aws cognito-idp create-user-pool-domain \
  --user-pool-id <USER-POOL-ID> \
  --domain foodcost-auth-<RANDOM-STRING>
```
- [ ] Domain created
- [ ] Hosted UI URL noted

#### 4. Configure OAuth Providers (10 minutes)

**Google OAuth:**
- [ ] Create Google OAuth app in Google Cloud Console
- [ ] Add Google as identity provider in Cognito
- [ ] Configure callback URLs

**Apple OAuth:**
- [ ] Create Apple Services ID in Apple Developer
- [ ] Generate private key
- [ ] Add Apple as identity provider in Cognito
- [ ] Configure callback URLs

#### 5. Update Backend Configuration (5 minutes)
- [ ] Add Cognito configuration to ECS task definition
- [ ] Update and restart ECS service
- [ ] Test authentication endpoints

---

### Day 5: Deploy Frontend

#### 1. Build Production Bundle (5 minutes)
```bash
cd frontend

# Update .env.production
cat > .env.production << EOF
VITE_API_BASE_URL=http://${ALB_DNS}
VITE_COGNITO_USER_POOL_ID=<USER-POOL-ID>
VITE_COGNITO_CLIENT_ID=<CLIENT-ID>
VITE_COGNITO_DOMAIN=foodcost-auth-<RANDOM>.auth.us-east-1.amazoncognito.com
EOF

# Build
npm run build
```
- [ ] Production build completes
- [ ] `dist/` folder contains files
- [ ] Environment variables baked in

#### 2. Create S3 Bucket (5 minutes)
```bash
aws s3 mb s3://foodcost-frontend-<ACCOUNT-ID>

# Enable static website hosting
aws s3 website s3://foodcost-frontend-<ACCOUNT-ID> \
  --index-document index.html \
  --error-document index.html

# Set bucket policy for public read
```
- [ ] S3 bucket created
- [ ] Static website hosting enabled
- [ ] Bucket policy allows CloudFront access

#### 3. Upload Files to S3 (2 minutes)
```bash
aws s3 sync dist/ s3://foodcost-frontend-<ACCOUNT-ID>/ --delete
```
- [ ] All files uploaded
- [ ] Assets accessible

#### 4. Create CloudFront Distribution (10 minutes)
```bash
aws cloudfront create-distribution \
  --origin-domain-name foodcost-frontend-<ACCOUNT-ID>.s3.us-east-1.amazonaws.com \
  --default-root-object index.html
```
- [ ] Distribution created
- [ ] Distribution deployed (~10-15 minutes)
- [ ] CloudFront domain noted

#### 5. Test Full Application (10 minutes)
```bash
# Open CloudFront URL in browser
echo "Open: https://<CLOUDFRONT-DOMAIN>.cloudfront.net"
```
- [ ] Frontend loads
- [ ] Can navigate to login page
- [ ] Can register new account
- [ ] Can login
- [ ] Can access ingredients page
- [ ] Frontend → Backend communication works
- [ ] Cognito authentication works

---

## 🎉 Post-Deployment

### Verification Checklist
- [ ] Application accessible via CloudFront URL
- [ ] Backend API responding correctly
- [ ] Database connections working
- [ ] Redis cache working
- [ ] User registration working
- [ ] Login working
- [ ] Social login working (Google/Apple)
- [ ] CRUD operations working (ingredients, recipes)
- [ ] Health checks passing
- [ ] Logs visible in CloudWatch

### Monitoring Setup
- [ ] CloudWatch alarms created
- [ ] SNS topic for alerts
- [ ] Email subscriptions configured
- [ ] Cost monitoring enabled
- [ ] Daily cost emails configured

### Documentation
- [ ] Document all ARNs, IDs, endpoints
- [ ] Save configuration files
- [ ] Create runbook for common tasks
- [ ] Document rollback procedure

### Security Review
- [ ] All resources in private subnets except ALB/CloudFront
- [ ] Security groups follow least privilege
- [ ] Secrets in Secrets Manager (not hardcoded)
- [ ] TLS/SSL enabled everywhere
- [ ] CloudTrail enabled
- [ ] IAM roles used (no access keys in code)

---

## 📊 Cost Tracking

### Week 1 Costs (Expected)
- VPC/NAT Gateway: $35-45
- RDS PostgreSQL: $25-35
- ElastiCache Redis: $12-15
- ECS Fargate: $45-60
- CloudFront: $5-10
- **Total: ~$122-165**

### Set up alerts for:
- [ ] Daily cost exceeds $10
- [ ] Monthly forecast exceeds $200
- [ ] Unusual spending patterns

---

## 🆘 Troubleshooting

### Common Issues

**ECS tasks failing to start:**
- Check CloudWatch logs
- Verify environment variables
- Check security group rules
- Verify RDS/Redis accessibility

**Frontend can't reach backend:**
- Check CORS configuration
- Verify ALB DNS in frontend env
- Check ALB security group
- Test ALB directly with curl

**Authentication not working:**
- Verify Cognito configuration
- Check JWT secret is set
- Test Cognito directly
- Check callback URLs

**Database connection errors:**
- Verify RDS security group
- Check RDS endpoint
- Test connection from ECS task
- Check credentials in Secrets Manager

---

## 🚀 Next Steps After Phase 1

- [ ] Add custom domain and SSL
- [ ] Set up CI/CD pipeline
- [ ] Enable auto-scaling
- [ ] Add CloudWatch dashboards
- [ ] Implement backup strategy
- [ ] Set up staging environment
- [ ] Add WAF for security
- [ ] Optimize costs (Reserved Instances)

---

**Estimated Total Time:** 3-5 days (with AWS experience)
**Estimated Cost:** $122-175/month

Ready to start? Let me know which day you'd like to begin!
