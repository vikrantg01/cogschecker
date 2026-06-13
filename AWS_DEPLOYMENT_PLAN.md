# AWS Deployment Plan - Food Cost Calculator

## Overview
Phased deployment approach to get your working application on AWS with minimal cost while maintaining security.

**Current Status:** Running locally with Docker (PostgreSQL, Redis, Spring Boot API, React frontend)

**Target:** Cost-optimized secure AWS deployment

---

## Phase 1: Minimal Viable Deployment (Week 1)
**Cost:** $80-120/month | **Timeline:** 3-5 days

### Architecture
```
Internet → CloudFront → S3 (React SPA)
                      ↓
Internet → ALB → ECS Fargate (Spring Boot API)
                      ↓
                 RDS PostgreSQL + ElastiCache Redis
```

### Components

**1. Frontend (React)**
- **Service:** S3 + CloudFront
- **Cost:** $5-10/month
- **Steps:**
  1. Build production bundle: `npm run build`
  2. Create S3 bucket with static website hosting
  3. Upload `dist/` folder to S3
  4. Create CloudFront distribution
  5. Configure custom domain (optional)

**2. Backend API (Spring Boot)**
- **Service:** ECS Fargate (not EKS - saves $72/month)
- **Cost:** $45-60/month
- **Configuration:**
  - 1 vCPU, 2GB RAM × 2 tasks
  - Application Load Balancer
  - Auto-scaling 1-4 tasks
- **Steps:**
  1. Create Dockerfile for Spring Boot
  2. Push image to Amazon ECR
  3. Create ECS cluster + service
  4. Configure ALB with health checks

**3. Database**
- **Service:** RDS PostgreSQL (db.t4g.micro Multi-AZ)
- **Cost:** $25-35/month
- **Configuration:**
  - 2 vCPU, 1GB RAM
  - Multi-AZ for HA
  - Automated backups (7 days)
  - Private subnet only

**4. Cache**
- **Service:** ElastiCache Redis (cache.t4g.micro)
- **Cost:** $12-15/month
- **Configuration:**
  - Single node (sufficient for start)
  - Private subnet only

**5. Authentication**
- **Service:** AWS Cognito
- **Cost:** Free tier (up to 50,000 MAUs)
- **Configuration:**
  - User Pool with email/password
  - Google and Apple OAuth providers
  - JWT tokens

**6. Networking**
- **Service:** VPC with 1 NAT Gateway
- **Cost:** $35-45/month
- **Configuration:**
  - 2 AZs
  - Public subnets (ALB)
  - Private subnets (ECS, RDS, Redis)
  - 1 NAT gateway for egress

### Security Features
✅ All data in private subnets
✅ Security groups with least privilege
✅ TLS/SSL everywhere (ALB, RDS, Redis, CloudFront)
✅ Encrypted at rest (RDS, EBS, S3)
✅ IAM roles (no hardcoded credentials)
✅ AWS-managed KMS keys (free)

### Total Phase 1 Cost: **$122-175/month**

---

## Phase 2: Add Essential Features (Week 2-3)
**Additional Cost:** +$50-100/month

### Add-ons

**1. File Storage (Invoice uploads)**
- **Service:** S3 bucket
- **Cost:** $5-15/month
- **Configuration:**
  - Encrypted with AWS-managed KMS
  - Lifecycle policy (move to Glacier after 90 days)
  - Block public access

**2. Message Queue (Async processing)**
- **Service:** Amazon SQS FIFO
- **Cost:** $5-10/month
- **Configuration:**
  - Cost propagation queue
  - OCR processing queue
  - Dead-letter queues

**3. Background Workers**
- **Service:** ECS Fargate tasks
- **Cost:** $20-30/month
- **Configuration:**
  - Worker container (0.5 vCPU, 1GB RAM)
  - Processes SQS messages
  - Auto-scaling based on queue depth

**4. Monitoring**
- **Service:** CloudWatch
- **Cost:** $10-20/month
- **Configuration:**
  - Application logs
  - Metrics and alarms
  - Basic dashboards

**5. Secrets Management**
- **Service:** AWS Secrets Manager
- **Cost:** $2-5/month
- **Configuration:**
  - Database credentials
  - API keys (Stripe, Square)
  - JWT secrets

### Total Phase 2 Cost: **$172-275/month**

---

## Phase 3: Production Readiness (Week 4-5)
**Additional Cost:** +$100-200/month

### Enhancements

**1. High Availability**
- Multi-AZ ECS tasks (3 minimum)
- Aurora Serverless v2 (replace RDS)
- ElastiCache with replica
- **Cost:** +$80-120/month

**2. CI/CD Pipeline**
- **Service:** GitHub Actions + AWS CodeBuild
- **Cost:** Free tier sufficient
- **Steps:**
  - Automated testing
  - Docker image builds
  - ECS deployments
  - Rollback capabilities

**3. Domain & SSL**
- **Service:** Route 53 + ACM
- **Cost:** $1-3/month
- **Configuration:**
  - Custom domain
  - Free SSL certificates (ACM)
  - DNS routing

**4. Backup & Disaster Recovery**
- RDS automated snapshots (included)
- S3 versioning for critical data
- Cross-region replication (optional)
- **Cost:** Included in RDS/S3

**5. WAF (Web Application Firewall)**
- **Service:** AWS WAF
- **Cost:** $10-20/month
- **Configuration:**
  - Rate limiting
  - SQL injection protection
  - Bot detection

### Total Phase 3 Cost: **$272-475/month**

---

## Phase 4: Advanced Features (Month 2+)
**When you have paying customers**

### Premium Features

**1. Invoice OCR**
- **Service:** AWS Textract
- **Cost:** Usage-based ($1.50 per 1,000 pages)
- **Estimate:** $50-200/month for 50-100 cafes

**2. AI Insights**
- **Service:** Amazon Bedrock (Claude)
- **Cost:** Usage-based ($0.003 per 1K input tokens)
- **Estimate:** $100-300/month for 50-100 cafes

**3. Email Notifications**
- **Service:** Amazon SES
- **Cost:** $0.10 per 1,000 emails
- **Estimate:** $5-10/month

**4. Advanced Monitoring**
- **Service:** AWS X-Ray, CloudWatch Insights
- **Cost:** $20-50/month
- **Features:**
  - Distributed tracing
  - Performance analysis
  - Error tracking

### Total Phase 4 Cost: **$447-1,035/month** (with all features)

---

## Cost Summary by Phase

| Phase | Monthly Cost | What You Get |
|-------|-------------|--------------|
| **Phase 1** | $122-175 | Basic deployment (frontend + backend + DB) |
| **Phase 2** | $172-275 | + File storage + Async workers + Monitoring |
| **Phase 3** | $272-475 | + High availability + CI/CD + Domain + WAF |
| **Phase 4** | $447-1,035 | + OCR + AI + Email + Advanced monitoring |

---

## Implementation Checklist

### Pre-Deployment (Do First)
- [ ] Create AWS account
- [ ] Set up billing alerts ($50, $100, $200 thresholds)
- [ ] Enable MFA on root account
- [ ] Create IAM user with admin access
- [ ] Install AWS CLI and configure credentials
- [ ] Choose AWS region (us-east-1 recommended for cost)

### Phase 1 Implementation Order

#### Day 1: Create Dockerfiles
- [ ] Create `Dockerfile` for Spring Boot API
- [ ] Create `.dockerignore` file
- [ ] Test Docker build locally
- [ ] Optimize image size (multi-stage build)

#### Day 2: Set Up AWS Infrastructure
- [ ] Create VPC with public/private subnets
- [ ] Create security groups
- [ ] Create RDS PostgreSQL instance
- [ ] Create ElastiCache Redis instance
- [ ] Create NAT Gateway

#### Day 3: Deploy Backend
- [ ] Create ECR repository
- [ ] Push Docker image to ECR
- [ ] Create ECS cluster
- [ ] Create task definition
- [ ] Create ALB
- [ ] Create ECS service
- [ ] Test API health endpoint

#### Day 4: Configure Cognito
- [ ] Create User Pool
- [ ] Configure password policy
- [ ] Add Google OAuth provider
- [ ] Add Apple OAuth provider
- [ ] Create app client
- [ ] Update backend configuration

#### Day 5: Deploy Frontend
- [ ] Build React production bundle
- [ ] Create S3 bucket
- [ ] Upload files to S3
- [ ] Create CloudFront distribution
- [ ] Configure CORS
- [ ] Test frontend → backend connectivity

---

## Quick Start Commands

### 1. Create Dockerfile for Spring Boot
```dockerfile
# Multi-stage build for minimal image size
FROM eclipse-temurin:21-jre-jammy as builder
WORKDIR /app
COPY build/libs/*.jar app.jar
RUN java -Djarmode=layertools -jar app.jar extract

FROM eclipse-temurin:21-jre-jammy
WORKDIR /app
COPY --from=builder /app/dependencies/ ./
COPY --from=builder /app/spring-boot-loader/ ./
COPY --from=builder /app/snapshot-dependencies/ ./
COPY --from=builder /app/application/ ./
EXPOSE 8080
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

### 2. Build Docker Image
```bash
# Build Spring Boot JAR
./gradlew :modules:api:bootJar

# Build Docker image
docker build -t food-cost-calculator-api:latest -f Dockerfile.api .

# Test locally
docker run -p 8080:8080 \
  -e DATABASE_URL=jdbc:postgresql://host.docker.internal:5432/foodcost \
  -e REDIS_HOST=host.docker.internal \
  food-cost-calculator-api:latest
```

### 3. Push to ECR
```bash
# Authenticate Docker to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Tag image
docker tag food-cost-calculator-api:latest \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com/food-cost-calculator:latest

# Push
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/food-cost-calculator:latest
```

### 4. Build and Deploy Frontend
```bash
cd frontend

# Build production bundle
npm run build

# Upload to S3
aws s3 sync dist/ s3://your-bucket-name/ --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id YOUR_DIST_ID \
  --paths "/*"
```

---

## Environment Variables

### Backend (ECS Task Definition)
```json
{
  "environment": [
    {"name": "SPRING_PROFILES_ACTIVE", "value": "production"},
    {"name": "DATABASE_URL", "value": "jdbc:postgresql://your-rds-endpoint:5432/foodcost"},
    {"name": "REDIS_HOST", "value": "your-elasticache-endpoint"},
    {"name": "REDIS_PORT", "value": "6379"},
    {"name": "AWS_REGION", "value": "us-east-1"},
    {"name": "COGNITO_USER_POOL_ID", "value": "us-east-1_XXXXXXX"},
    {"name": "COGNITO_CLIENT_ID", "value": "xxxxxxxxxxxxx"}
  ],
  "secrets": [
    {"name": "DATABASE_PASSWORD", "valueFrom": "arn:aws:secretsmanager:..."},
    {"name": "JWT_SECRET", "valueFrom": "arn:aws:secretsmanager:..."}
  ]
}
```

### Frontend (CloudFront environment)
```javascript
// .env.production
VITE_API_BASE_URL=https://api.yourdomain.com
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXX
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxx
VITE_COGNITO_DOMAIN=your-app.auth.us-east-1.amazoncognito.com
```

---

## Security Best Practices

### Network Security
✅ All compute in private subnets
✅ Load balancer in public subnets only
✅ Security groups: least privilege
✅ No SSH keys (use Session Manager)
✅ VPC Flow Logs enabled

### Application Security
✅ TLS 1.2+ everywhere
✅ HTTPS redirect (CloudFront + ALB)
✅ Secrets in Secrets Manager (not environment variables)
✅ IAM roles (no access keys)
✅ Regular security patches

### Data Security
✅ Encryption at rest (RDS, S3, EBS)
✅ Encryption in transit (TLS)
✅ Automated backups (7-day retention)
✅ Database in private subnet
✅ S3 block public access

### Monitoring & Compliance
✅ CloudTrail enabled (API logging)
✅ CloudWatch alarms for errors
✅ Budget alerts configured
✅ Regular security audits
✅ Access logging (ALB, CloudFront, S3)

---

## Cost Optimization Tips

### Immediate Savings
1. **Use t4g instances** (ARM-based, 20% cheaper)
2. **Single NAT gateway** (save $35/month)
3. **AWS-managed KMS keys** (free vs $1/key/month)
4. **CloudFront free tier** (1TB data transfer/month free)
5. **RDS single-AZ for dev/staging** (50% cheaper)

### Medium-term Savings
6. **Reserved Instances** (1-year: 30-40% discount)
7. **Savings Plans** (flexible compute commitment)
8. **S3 Intelligent-Tiering** (automatic storage optimization)
9. **Aurora Serverless v1** (auto-pause when idle)
10. **Spot instances for workers** (70-90% discount)

### Monitoring Costs
11. **Set up AWS Budgets** (free for first 2 budgets)
12. **Cost Explorer** (analyze spending patterns)
13. **CloudWatch billing alarms**
14. **Right-size resources** (check CPU/memory utilization monthly)

---

## Rollback Plan

If deployment fails:
1. Keep local Docker environment running
2. Revert DNS to localhost
3. Database backup available in RDS snapshots
4. Previous Docker images in ECR
5. CloudFormation rollback automatic

---

## Next Steps

**Start with Phase 1:**
1. ✅ Review this deployment plan
2. ✅ Create AWS account and set up billing alerts
3. ✅ Create Dockerfiles (I'll help you with this)
4. ✅ Set up infrastructure using CDK or Terraform
5. ✅ Deploy and test

**Estimated time to Phase 1 completion:** 3-5 days

**When ready, let me know and I'll help you with:**
- Creating optimized Dockerfiles
- Writing infrastructure as code (CDK/Terraform)
- Setting up CI/CD pipeline
- Configuring Cognito for OAuth
- Database migration to RDS

---

## Support Resources

- [AWS ECS Documentation](https://docs.aws.amazon.com/ecs/)
- [AWS RDS Best Practices](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_BestPractices.html)
- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
- [Spring Boot on AWS](https://spring.io/guides/gs/spring-boot-on-aws-ec2/)

---

**Last Updated:** June 9, 2026
**Version:** 1.0
