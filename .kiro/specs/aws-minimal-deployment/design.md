# Design Document: AWS Minimal Deployment

## Overview

This document specifies the architecture and design for deploying the Food Cost Calculator application to AWS using a cost-optimized, modular CDK infrastructure. The deployment targets approximately $137-200 per month for the minimal production environment supporting 2 initial venues, while maintaining security, reliability, and scalability for future growth.

### Key Design Goals

- **Cost Optimization** — Minimize monthly AWS spend through careful service selection (ECS Fargate over EKS, single-AZ RDS, single NAT gateway) while maintaining production readiness
- **Modular Infrastructure** — Organize CDK code into seven independent stacks (Network, Compute, Database, Cache, Auth, Storage, Observability) that can be deployed, updated, and debugged separately
- **Security by Default** — Enforce encryption at rest and in transit, apply least-privilege IAM policies, isolate data in private subnets, and enable comprehensive audit logging
- **Deployment Automation** — Enable single-command deployment with automatic dependency resolution, health verification, and rollback on failure
- **Simplicity** — Single environment deployment without complex environment switching logic

---

## Architecture

### High-Level System Diagram

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
│  • Secrets Manager (database credentials, API keys)              │
│  • CloudWatch (logs, metrics, alarms → SNS email)                │
│  • ECR (Docker image registry)                                   │
│  • AWS Budgets ($200 limit with 80%/100% alerts)                 │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```


### Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Infrastructure as Code** | AWS CDK (TypeScript) | Type-safe infrastructure definitions, reusable constructs, deterministic deployment |
| **Compute** | ECS Fargate | Eliminates $72/month EKS control plane fee; pay only for running tasks; automatic capacity management |
| **Container Registry** | Amazon ECR | Native ECS integration; automatic image scanning; lifecycle management |
| **Load Balancer** | Application Load Balancer | Layer-7 routing; health checks; SSL termination; cross-AZ distribution |
| **Database** | RDS PostgreSQL 15 (t4g.micro) | $50-60/month vs $250-400/month for Aurora Serverless v2; ARM-based Graviton2 saves 20% vs Intel |
| **Cache** | ElastiCache Redis 7 (t4g.micro) | Single-node for cost optimization; sub-millisecond latency; TLS encryption |
| **Authentication** | Amazon Cognito | Managed user pools; Google and Apple OAuth federation; JWT issuance; free tier up to 50K MAU |
| **Storage** | Amazon S3 | Static site hosting; invoice file storage; lifecycle policies for Glacier transition |
| **Secrets** | AWS Secrets Manager | Rotation-enabled credential storage; automatic RDS integration |
| **Observability** | CloudWatch + SNS | Centralized logs; metrics and alarms; email notifications |
| **Networking** | VPC with 1 NAT Gateway | Single NAT saves $35/month; Multi-AZ for HA; private subnets for data isolation |

### Cost Breakdown (Minimal Deployment)

| Service | Configuration | Monthly Cost |
|---------|--------------|--------------|
| ECS Fargate | 1-2 tasks × 1 vCPU × 2 GB × 730 hours | $45-60 |
| RDS PostgreSQL | db.t4g.micro single-AZ + 20 GB gp3 storage | $25-30 |
| ElastiCache Redis | cache.t4g.micro single-node | $12-15 |
| ALB | Application Load Balancer + LCU charges | $16-20 |
| NAT Gateway | 1 gateway + data transfer | $35-40 |
| S3 + CloudFront | Static assets + edge delivery (low traffic) | $5-10 |
| Secrets Manager | Credential storage | $1-2 |
| CloudWatch | Logs (7-day retention) + metrics + alarms | $5-10 |
| **Total** | | **$144-187/month** |

---

## CDK Stack Architecture

### Stack Dependency Graph

```
NetworkStackOptimized (foundation)
    ├─→ DatabaseStack (RDS PostgreSQL)
    ├─→ CacheStack (ElastiCache Redis)
    ├─→ AuthStack (Cognito User Pool)
    │
    ├─→ DatabaseStack + CacheStack + AuthStack
    │       ↓
    │   ComputeStack (ECS Fargate + ALB + ECR)
    │
    ├─→ StorageStack (S3 buckets)
    │
    └─→ ObservabilityStack (CloudWatch logs, metrics, alarms)
```


### Stack Descriptions

#### 1. NetworkStackOptimized

**Purpose:** Foundational networking infrastructure spanning 2 Availability Zones

**Resources Created:**
- VPC with CIDR 10.0.0.0/16
- 2 public subnets (/24 masks) for ALB
- 2 private subnets with NAT egress (/24 masks) for ECS tasks
- 2 private isolated subnets (/24 masks) for RDS and Redis
- 1 NAT Gateway (cost optimization: single gateway instead of 2)
- 4 security groups:
  - ALB security group (ports 80/443 from internet → 8080 to ECS)
  - ECS security group (port 8080 from ALB)
  - RDS security group (port 5432 from ECS only)
  - Redis security group (port 6379 from ECS only)

**CloudFormation Exports:**
- `FoodCostCalculator-VpcId`
- `FoodCostCalculator-AlbSecurityGroupId`
- `FoodCostCalculator-EcsSecurityGroupId`
- `FoodCostCalculator-RdsSecurityGroupId`
- `FoodCostCalculator-RedisSecurityGroupId`
- `FoodCostCalculator-PublicSubnetIds`
- `FoodCostCalculator-PrivateSubnetIds`
- `FoodCostCalculator-IsolatedSubnetIds`

**Cost Optimization Trade-off:**
Single NAT Gateway creates a single point of failure for internet egress. If the NAT gateway fails, ECS tasks in both AZs lose internet connectivity (cannot pull Docker images, reach AWS APIs). For higher availability requirements, consider VPC endpoints for critical AWS services or a second NAT gateway.


#### 2. DatabaseStack (RdsStack)

**Purpose:** Cost-optimized PostgreSQL database

**Resources Created:**
- RDS PostgreSQL 15.4 instance (db.t4g.micro: 2 vCPU, 1 GB RAM)
- Secrets Manager secret (username: postgres, 32-character random password)
- Parameter group with `rds.force_ssl=1` (SSL enforcement)
- Subnet group spanning private isolated subnets
- 20 GB gp3 storage with auto-scaling to 100 GB
- Automated backups (7-day retention, window: 03:00-04:00 UTC)
- Single-AZ deployment for cost optimization

**CloudFormation Exports:**
- `FoodCostCalculator-DatabaseEndpoint` (hostname)
- `FoodCostCalculator-DatabasePort` (5432)
- `FoodCostCalculator-DatabaseName` (foodcost)
- `FoodCostCalculator-DatabaseSecretArn`

**Security:**
- Storage encryption at rest (AWS-managed KMS keys)
- SSL/TLS enforcement via parameter group
- Deployed in private isolated subnets (no internet access)
- Security group allows connections only from ECS security group

#### 3. CacheStack

**Purpose:** Redis cache for session storage and query caching

**Resources Created:**
- ElastiCache Redis 7.x cluster (cache.t4g.micro)
- Single cache node (no replication for cost optimization)
- Subnet group spanning both private isolated subnets (ready for multi-AZ expansion)

**CloudFormation Exports:**
- `FoodCostCalculator-RedisEndpoint` (primary endpoint hostname)

**Security:**
- Encryption at rest (AWS-managed KMS keys)
- Encryption in transit (TLS required for all connections)
- Deployed in private isolated subnets
- Security group allows connections only from ECS security group


#### 4. AuthStack

**Purpose:** Managed authentication and OAuth integration

**Resources Created:**
- Cognito User Pool with email username attribute
- Password policy: min 8 characters, requires uppercase, lowercase, number
- User Pool client with OAuth authorization code grant
- Identity providers: Google OAuth, Apple Sign In
- Custom attributes: `custom:org_id`, `custom:venue_roles`, `custom:tier`

**Token Configuration:**
- Access tokens: 1-hour expiration
- Refresh tokens: 30-day expiration

**CloudFormation Exports:**
- `FoodCostCalculator-UserPoolId`
- `FoodCostCalculator-UserPoolArn`
- `FoodCostCalculator-UserPoolClientId`

#### 5. ComputeStack (EcsStack)

**Purpose:** Containerized API backend with auto-scaling

**Resources Created:**
- ECS cluster with Fargate capacity provider (Container Insights enabled)
- ECR repository with image scanning and lifecycle policy (keep last 10 images)
- Fargate task definition:
  - CPU: 1024 (1 vCPU)
  - Memory: 2048 MB (2 GB)
  - Container image: ECR repository tagged `latest`
  - Port: 8080
- IAM task execution role (ECR pull, CloudWatch logs, Secrets Manager read)
- IAM task role (S3 access, Cognito access)
- Fargate service:
  - Desired count: 1 task
  - Deployed in private subnets with NAT egress
  - Health check grace period: 60 seconds
- Auto-scaling policy:
  - Min: 1 task
  - Max: 4 tasks
  - CPU target: 70%
  - Memory target: 80%
- Application Load Balancer (internet-facing, public subnets)
- ALB target group with health check (`/actuator/health`, 30-second interval)
- HTTP listener on port 80 (TODO: add HTTPS with ACM certificate)

**Environment Variables:**
- `SPRING_PROFILES_ACTIVE`: production
- `DATABASE_URL`: jdbc:postgresql://{rds-endpoint}/foodcost
- `DATABASE_USERNAME`: postgres
- `REDIS_HOST`: {redis-endpoint}
- `REDIS_PORT`: 6379
- `AWS_REGION`: {deployment-region}
- `COGNITO_USER_POOL_ID`: {user-pool-id}
- `COGNITO_CLIENT_ID`: {client-id}

**Secrets (from Secrets Manager):**
- `DATABASE_PASSWORD`: Retrieved from RDS credentials secret


**CloudFormation Exports:**
- `FoodCostCalculator-RepositoryUri` (ECR image URI)
- `FoodCostCalculator-EcsClusterName`
- `FoodCostCalculator-EcsServiceName`
- `FoodCostCalculator-AlbDns` (Load balancer DNS name)

**Deployment Strategy:**
- Rolling update with `minHealthyPercent: 50`, `maxHealthyPercent: 200`
- Zero-downtime deployments: new tasks start before old tasks stop
- Automatic rollback if health checks fail after update

#### 6. StorageStack

**Purpose:** Object storage for static assets and invoice files

**Resources Created:**
- S3 bucket for React frontend (`fcc-frontend`)
  - Block all public access (served via CloudFront)
  - Server-side encryption (AWS-managed keys)
- S3 bucket for invoice uploads (`fcc-invoices`)
  - Block all public access (signed URLs for application access)
  - Server-side encryption (AWS-managed keys)
  - Lifecycle policy: transition to Glacier after 90 days

**CloudFormation Exports:**
- `FoodCostCalculator-FrontendBucketName`
- `FoodCostCalculator-FrontendBucketArn`
- `FoodCostCalculator-InvoiceBucketName`
- `FoodCostCalculator-InvoiceBucketArn`

#### 7. ObservabilityStack

**Purpose:** Centralized logging, monitoring, and alerting

**Resources Created:**
- CloudWatch log group: `/ecs/foodcost-api`
  - Retention: 7 days
  - JSON structured logging from Spring Boot
- SNS topic for alarm notifications (email subscription)
- CloudWatch alarms:
  - **ECS CPU Utilization:** Alert if > 85% for 2 consecutive 5-minute periods
  - **ECS Memory Utilization:** Alert if > 90% for 2 consecutive 5-minute periods
  - **RDS CPU Utilization:** Alert if > 80% for 2 consecutive 5-minute periods
  - **RDS Free Storage Space:** Alert if < 2 GB
  - **ALB Unhealthy Host Count:** Alert if > 0 for 2 consecutive 1-minute periods
  - **ALB HTTP 5xx Error Rate:** Alert if > 5% over 5-minute period

**CloudFormation Exports:**
- `FoodCostCalculator-LogGroupName`
- `FoodCostCalculator-AlarmTopicArn`

---


## Data Flow and Integration Patterns

### Application Startup Flow

```
1. ECS Task Launch
   ↓
2. Pull container image from ECR
   ↓
3. Retrieve DATABASE_PASSWORD from Secrets Manager
   ↓
4. Inject environment variables + secrets into container
   ↓
5. Spring Boot application starts
   ↓
6. Connect to RDS PostgreSQL (SSL enforced)
   ↓
7. Connect to ElastiCache Redis (TLS enforced)
   ↓
8. Register with ALB target group
   ↓
9. ALB health check to /actuator/health
   ↓
10. Task marked healthy, receives traffic
```

### Request Flow (User → API → Database)

```
Internet
  ↓ HTTPS
CloudFront (React SPA)
  ↓ HTTP/HTTPS
ALB (public subnet)
  ↓ HTTP:8080 (within VPC)
ECS Task (private subnet)
  ↓ PostgreSQL:5432 (SSL)
RDS Instance (private isolated subnet)
```

### Authentication Flow

```
User → React App
  ↓ Redirect to Cognito Hosted UI
Cognito → Google/Apple OAuth
  ↓ OAuth callback with authorization code
Cognito → Issue JWT access token + refresh token
  ↓ Return to React App
React App → API with Authorization: Bearer {JWT}
  ↓ Verify JWT signature using Cognito JWKS endpoint
API Service → Extract custom claims (org_id, venue_roles, tier)
  ↓ Authorize request
API Service → Execute business logic
```

---


## Security Architecture

### Network Security Layers

**Layer 1: Internet-Facing (Public Subnets)**
- ALB accepts traffic on ports 80 (HTTP) and 443 (HTTPS)
- CloudFront serves static assets from S3
- Security groups enforce source IP filtering (0.0.0.0/0 for public web traffic)

**Layer 2: Application Tier (Private Subnets with NAT Egress)**
- ECS Fargate tasks in private subnets
- Outbound internet access via single NAT gateway (for Docker Hub, AWS APIs)
- Security group allows inbound only from ALB security group on port 8080
- All outbound traffic allowed (application needs AWS service access)

**Layer 3: Data Tier (Private Isolated Subnets)**
- RDS and ElastiCache in isolated subnets with no internet routing
- Security groups allow inbound only from ECS security group on specific ports (5432, 6379)
- No outbound traffic allowed (database and cache do not initiate connections)

### Encryption Strategy

**At Rest:**
- RDS storage: AWS-managed KMS encryption
- ElastiCache: AWS-managed KMS encryption
- S3 buckets: AWS-managed KMS encryption (SSE-S3)
- EBS volumes (Fargate tasks): Default AWS encryption

**In Transit:**
- ALB → ECS: HTTP within VPC (TLS termination at ALB for HTTPS)
- ECS → RDS: SSL/TLS enforced by parameter group `rds.force_ssl=1`
- ECS → Redis: TLS enforced by ElastiCache configuration
- All external API calls: HTTPS (AWS services, OAuth providers)


### IAM Least-Privilege Policies

**ECS Task Execution Role** (used by ECS agent):
```typescript
// Permissions for Fargate to run tasks
{
  Effect: 'Allow',
  Action: [
    'ecr:GetAuthorizationToken',
    'ecr:BatchCheckLayerAvailability',
    'ecr:GetDownloadUrlForLayer',
    'ecr:BatchGetImage',
    'logs:CreateLogStream',
    'logs:PutLogEvents',
  ],
  Resource: '*'
},
{
  Effect: 'Allow',
  Action: ['secretsmanager:GetSecretValue'],
  Resource: ['{rds-secret-arn}']
}
```

**ECS Task Role** (used by application code):
```typescript
// Permissions for application logic
{
  Effect: 'Allow',
  Action: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
  Resource: [
    'arn:aws:s3:::fcc-invoices/*',
    'arn:aws:s3:::fcc-invoices'
  ]
},
{
  Effect: 'Allow',
  Action: [
    'cognito-idp:AdminGetUser',
    'cognito-idp:AdminUpdateUserAttributes',
    'cognito-idp:ListUsers'
  ],
  Resource: ['{user-pool-arn}']
}
```

### Audit and Compliance

**CloudTrail:** All API calls logged (enabled at account level, not stack-specific)

**VPC Flow Logs:** Network traffic metadata captured for security analysis (enabled on VPC)

**ALB Access Logs:** HTTP request logs stored in S3 for troubleshooting and compliance

**CloudWatch Logs:** Application logs with JSON structured format for centralized analysis

---


## Resource Naming and Configuration

### Resource Naming Convention

**Pattern:** `foodcost-{component}` or `fcc-{component}`

**Examples:**
- VPC: `foodcost`
- RDS Instance: `foodcost-db`
- ECS Cluster: `foodcost`
- ALB: `foodcost-alb`
- S3 Buckets: `fcc-frontend`, `fcc-invoices`

### CloudFormation Stack Naming

**Pattern:** `FoodCostCalculator-{Component}`

**Examples:**
- `FoodCostCalculator-Network`
- `FoodCostCalculator-Database`
- `FoodCostCalculator-ECS`
- `FoodCostCalculator-Cache`
- `FoodCostCalculator-Auth`
- `FoodCostCalculator-Storage`
- `FoodCostCalculator-Observability`

---

## Deployment Workflow

### Prerequisites

1. AWS account with admin IAM user
2. AWS CLI configured with credentials
3. Node.js 18+ installed
4. AWS CDK CLI installed globally: `npm install -g aws-cdk`
5. Docker installed (for building Spring Boot image)

### Initial Deployment Steps

**Step 1: Bootstrap CDK** (one-time per account/region)
```bash
cd infra
npm install
cdk bootstrap aws://{account-id}/{region}
```

**Step 2: Build and Push Container Image**
```bash
cd food-cost-calculator

# Build Spring Boot JAR
./gradlew :modules:api:bootJar

# Authenticate Docker to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin {account-id}.dkr.ecr.us-east-1.amazonaws.com

# Build Docker image
docker build -t food-cost-calculator-api:latest -f Dockerfile.api .

# Tag and push to ECR
docker tag food-cost-calculator-api:latest \
  {account-id}.dkr.ecr.us-east-1.amazonaws.com/food-cost-calculator:latest

docker push {account-id}.dkr.ecr.us-east-1.amazonaws.com/food-cost-calculator:latest
```


**Step 3: Deploy Infrastructure**
```bash
cd infra

# Preview changes
cdk diff --all

# Deploy all stacks
cdk deploy --all --require-approval never

# Note: Deployment takes ~15-20 minutes (RDS creation is slowest)
```

**Step 4: Verify Deployment**
```bash
# Get ALB URL from CloudFormation outputs
aws cloudformation describe-stacks \
  --stack-name FoodCostCalculator-ECS \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerUrl`].OutputValue' \
  --output text

# Test health endpoint
curl http://{alb-dns-name}/actuator/health

# Expected response: {"status":"UP"}
```

### Update Workflow

**Application Code Changes:**
```bash
# Rebuild JAR and Docker image
./gradlew :modules:api:bootJar
docker build -t food-cost-calculator-api:latest -f Dockerfile.api .
docker tag food-cost-calculator-api:latest {ecr-uri}:latest
docker push {ecr-uri}:latest

# Force ECS service to pull new image
aws ecs update-service \
  --cluster foodcost \
  --service foodcost-api \
  --force-new-deployment
```

**Infrastructure Changes:**
```bash
cd infra

# Preview changes
cdk diff {StackName}

# Deploy specific stack
cdk deploy FoodCostCalculator-ECS

# Deploy all stacks (respects dependencies)
cdk deploy --all
```

### Rollback Procedure

**Automatic Rollback:**
CDK/CloudFormation automatically rolls back if:
- Health checks fail after ECS task update
- Resource creation fails during stack deployment
- Stack update violates constraints

**Manual Rollback:**
```bash
# Rollback last stack update
aws cloudformation rollback-stack --stack-name FoodCostCalculator-ECS

# Or revert to previous Docker image
aws ecs update-service \
  --cluster foodcost \
  --service foodcost-api \
  --task-definition foodcost-api:{previous-revision}
```

### Teardown

```bash
cd infra

# Destroy all stacks (order matters: dependent stacks first)
cdk destroy --all

# Note: Stateful resources with RETAIN policy must be manually deleted
```

---


## Monitoring and Operations

### CloudWatch Dashboard

**Recommended Metrics to Monitor:**
- ECS service: CPU utilization, memory utilization, running task count
- RDS: CPU utilization, free storage space, database connections, read/write IOPS
- ElastiCache: CPU utilization, cache hit rate, evictions, connections
- ALB: request count, target response time, HTTP 4xx/5xx errors, healthy host count
- NAT Gateway: bytes in/out (monitor for unexpected traffic spikes)

### Alarm Response Playbook

| Alarm | Threshold | Action |
|-------|-----------|--------|
| **ECS CPU > 85%** | 2 periods of 5 min | Verify auto-scaling is functioning; consider increasing max task count or task CPU allocation |
| **ECS Memory > 90%** | 2 periods of 5 min | Check for memory leaks in application logs; consider increasing task memory allocation |
| **RDS CPU > 80%** | 2 periods of 5 min | Identify slow queries using CloudWatch Insights; add database indexes; consider larger instance type |
| **RDS Storage < 2 GB** | Single breach | Verify auto-scaling is enabled; manually increase allocated storage if needed |
| **ALB Unhealthy Hosts > 0** | 2 periods of 1 min | Check ECS task logs for application errors; verify health endpoint `/actuator/health` is responding |
| **ALB 5xx Errors > 5%** | 5 min window | Check application logs for exceptions; verify database connectivity; check for downstream service failures |

### Log Analysis

**View ECS Task Logs:**
```bash
aws logs tail /ecs/foodcost-api --follow

# Filter for errors
aws logs tail /ecs/foodcost-api --follow --filter-pattern ERROR
```

**Query Structured Logs:**
```bash
# Using CloudWatch Logs Insights
aws logs start-query \
  --log-group-name /ecs/foodcost-api \
  --start-time $(date -u -d '1 hour ago' +%s) \
  --end-time $(date -u +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 20'
```

---


## Cost Optimization Strategies

### Implemented Optimizations

1. **ECS Fargate over EKS:** Saves $72/month (no control plane fee)
2. **RDS t4g.micro over Aurora Serverless v2:** Saves $200-350/month
3. **Single-AZ RDS:** Saves ~$25-30/month vs Multi-AZ
4. **Single NAT Gateway:** Saves $35/month vs 2 gateways
5. **ARM-based Graviton2 instances (t4g):** 20% cheaper than Intel (t3)
6. **7-day log retention:** Reduces CloudWatch storage costs
7. **S3 Glacier lifecycle policy:** Reduces storage costs for old invoices
8. **ECR lifecycle policy:** Keeps only last 10 images, deletes old layers

### Future Optimizations (When Scaling)

1. **Reserved Instances (1-year commitment):** 30-40% discount on RDS and ElastiCache
2. **Savings Plans (1-year commitment):** Flexible compute discount for ECS Fargate
3. **VPC Endpoints:** Replace NAT Gateway for AWS service access (saves $35/month)
4. **Aurora Serverless v2:** Auto-scales during peak times, pauses when idle (for higher traffic)
5. **CloudFront free tier:** First 1 TB data transfer/month is free
6. **Spot Instances for workers:** 70-90% discount for async job processing

### Cost Monitoring

**AWS Budget Configuration:**
```typescript
// Deployed via ObservabilityStack or separate BudgetStack
new budgets.CfnBudget(this, 'MonthlyBudget', {
  budget: {
    budgetName: 'foodcost-monthly',
    budgetType: 'COST',
    timeUnit: 'MONTHLY',
    budgetLimit: {
      amount: 200,
      unit: 'USD',
    },
  },
  notificationsWithSubscribers: [
    {
      notification: {
        notificationType: 'ACTUAL',
        comparisonOperator: 'GREATER_THAN',
        threshold: 80, // Alert at $160 (80% of $200)
      },
      subscribers: [{ subscriptionType: 'EMAIL', address: 'devops@example.com' }],
    },
    {
      notification: {
        notificationType: 'ACTUAL',
        comparisonOperator: 'GREATER_THAN',
        threshold: 100, // Alert at $200 (100% of $200)
      },
      subscribers: [{ subscriptionType: 'EMAIL', address: 'devops@example.com' }],
    },
  ],
});
```

---


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property Reflection

After analyzing all acceptance criteria, I've identified the following properties that represent universal invariants for the deployment system. Several criteria were consolidated to eliminate redundancy:

- Stack export requirements (1.3) subsume the individual stack export verification requirements
- Resource tagging (1.7) covers all resources universally
- Cross-stack references (1.4) apply to all dependent stacks
- Removal policies (1.6) apply to all stateful resources

The following properties represent unique, testable invariants:

### Property 1: Stack organization completeness

*For any* deployment of the Deployment_System, the CDK application SHALL instantiate exactly 7 stacks: NetworkStackOptimized, DatabaseStack, CacheStack, AuthStack, ComputeStack, StorageStack, and ObservabilityStack.

**Validates: Requirements 1.1**

### Property 2: Cross-stack reference integrity

*For any* CloudFormation export value produced by a stack, when that export is consumed by a dependent stack, the consuming stack SHALL reference it via `Fn::ImportValue` rather than hardcoded strings or inline values.

**Validates: Requirements 1.4**

### Property 3: Stateful resource protection

*For any* stateful resource (RDS instance, S3 bucket) created by the Deployment_System, the resource SHALL have a removal policy of RETAIN or SNAPSHOT to prevent accidental data loss during stack deletion.

**Validates: Requirements 1.6**

### Property 4: Resource tagging completeness

*For any* AWS resource created by the Deployment_System, the resource SHALL have both `Component` and `CostCenter` tags for cost allocation and filtering.

**Validates: Requirements 1.7**


### Property 5: Stack export availability

*For any* CDK stack deployed by the Deployment_System, if the stack creates resources that dependent stacks need to reference, the stack SHALL export those resource identifiers as CloudFormation outputs with the naming pattern `FoodCostCalculator-{ResourceType}`.

**Validates: Requirements 1.3**

### Property 6: Network encryption enforcement

*For any* network connection path between system components (ALB to ECS, ECS to RDS, ECS to Redis), the connection SHALL be configured to use TLS/SSL encryption or be within the VPC trust boundary.

**Validates: Requirements 11.1**

### Property 7: Data encryption at rest

*For any* stateful data storage service (RDS, ElastiCache, S3, EBS), the service SHALL have encryption at rest enabled using AWS-managed or customer-managed KMS keys.

**Validates: Requirements 11.2**

### Property 8: IAM least-privilege enforcement

*For any* IAM role created by the Deployment_System, the role's policy SHALL grant access only to the specific resources required for the component's function, not wildcard access to all resources of a type.

**Validates: Requirements 11.3**

### Property 9: Data tier isolation

*For any* data service (RDS, ElastiCache) deployed by the Deployment_System, the service SHALL be deployed in private isolated subnets with security groups that allow ingress only from the ECS security group.

**Validates: Requirements 11.4**

### Property 10: Public access prevention

*For any* S3 bucket created by the Storage_Stack, the bucket SHALL have the `BlockPublicAccess` configuration set to block all public access.

**Validates: Requirements 11.5**

---


## Component Interfaces

### NetworkStackOptimized Interface

**Inputs:**
- `scope`: CDK construct scope
- `id`: Stack identifier
- `props`: Stack properties

**Outputs (CloudFormation Exports):**
```typescript
{
  vpcId: string;
  publicSubnetIds: string[];
  privateSubnetIds: string[];
  isolatedSubnetIds: string[];
  albSecurityGroupId: string;
  ecsSecurityGroupId: string;
  rdsSecurityGroupId: string;
  redisSecurityGroupId: string;
}
```

### DatabaseStack Interface

**Inputs:**
- `scope`: CDK construct scope
- `id`: Stack identifier
- `props`: Stack properties including VPC and security group imports

**Outputs (CloudFormation Exports):**
```typescript
{
  databaseEndpoint: string;
  databasePort: string;
  databaseName: string;
  databaseSecretArn: string;
}
```

### CacheStack Interface

**Inputs:**
- `scope`: CDK construct scope
- `id`: Stack identifier
- `props`: Stack properties including VPC and security group imports

**Outputs (CloudFormation Exports):**
```typescript
{
  redisEndpoint: string;
}
```

### AuthStack Interface

**Inputs:**
- `scope`: CDK construct scope
- `id`: Stack identifier
- `props`: Stack properties

**Outputs (CloudFormation Exports):**
```typescript
{
  userPoolId: string;
  userPoolArn: string;
  userPoolClientId: string;
}
```


### ComputeStack Interface

**Inputs:**
- `scope`: CDK construct scope
- `id`: Stack identifier
- `props`: Stack properties including VPC, security groups, database, cache, and auth imports

**Outputs (CloudFormation Exports):**
```typescript
{
  repositoryUri: string;
  ecsClusterName: string;
  ecsServiceName: string;
  albDns: string;
}
```

### StorageStack Interface

**Inputs:**
- `scope`: CDK construct scope
- `id`: Stack identifier
- `props`: Stack properties

**Outputs (CloudFormation Exports):**
```typescript
{
  frontendBucketName: string;
  frontendBucketArn: string;
  invoiceBucketName: string;
  invoiceBucketArn: string;
}
```

### ObservabilityStack Interface

**Inputs:**
- `scope`: CDK construct scope
- `id`: Stack identifier
- `props`: Stack properties including ECS cluster and RDS instance imports

**Outputs (CloudFormation Exports):**
```typescript
{
  logGroupName: string;
  alarmTopicArn: string;
}
```

---

## Error Handling and Resilience

### ECS Task Failures

**Health Check Failures:**
- ALB marks task as unhealthy after 3 consecutive failed health checks
- ECS starts replacement task automatically
- Traffic routes only to healthy tasks

**Task Crashes:**
- ECS detects stopped tasks and starts replacements
- Auto-scaling maintains desired task count
- CloudWatch alarms notify operations team


### Database Connection Failures

**Connection Pool Exhaustion:**
- Spring Boot connection pool configuration (HikariCP)
- Max connections: 20 (adjustable)
- Connection timeout: 30 seconds
- Health check queries connection availability

**Database Unavailability:**
- Application retries with exponential backoff
- Health endpoint returns degraded status
- CloudWatch alarms trigger on connection errors

### Cache Failures

**Redis Unavailability:**
- Application degrades gracefully (cache-aside pattern)
- Read-through to database on cache miss
- Session data may be lost (requires re-authentication)

### NAT Gateway Failures

**Single Point of Failure:**
- ECS tasks lose internet connectivity
- Cannot pull new Docker images from ECR (use VPC endpoint as mitigation)
- Cannot reach AWS APIs (use VPC endpoints as mitigation)
- Manual intervention required to restore service

**Mitigation Strategies:**
1. VPC endpoints for ECR, S3, Secrets Manager, CloudWatch Logs
2. Second NAT Gateway in second AZ (adds $35/month)
3. CloudWatch alarms for NAT Gateway connectivity issues

---

## Testing Strategy

### Infrastructure Testing

**CDK Snapshot Tests:**
- Verify CloudFormation templates match expected structure
- Detect unintended infrastructure changes
- Run as part of CI/CD pipeline

**CDK Assertions:**
- Verify security group rules are configured correctly
- Verify IAM policies grant least-privilege access
- Verify encryption is enabled for all stateful resources


### Integration Testing

**Post-Deployment Validation:**
- Health endpoint returns HTTP 200
- Database connection successful
- Redis connection successful
- Cognito authentication flow works end-to-end
- S3 bucket access with signed URLs

**Load Testing:**
- Verify auto-scaling triggers at 70% CPU
- Verify ALB distributes traffic evenly
- Verify database connection pool handles concurrent requests

### Monitoring and Alerting Tests

**Alarm Validation:**
- Trigger test alarms to verify SNS notifications
- Verify CloudWatch logs are capturing application events
- Verify metrics are flowing to CloudWatch

---

## Migration and Upgrade Path

### From Development to Production

**Current State:** Single-AZ, minimal resources for cost optimization

**Upgrade Path for Production:**
1. Enable Multi-AZ for RDS (adds $25-30/month)
2. Add second NAT Gateway (adds $35/month)
3. Increase ECS desired count to 2-3 tasks (adds $20-40/month)
4. Increase log retention to 30 days (adds $5-10/month)
5. Enable ElastiCache replication (adds $12-15/month)

**Total Production Cost:** $240-310/month

### From Existing Infrastructure

**Migration Strategy:**
1. Deploy new CDK-managed infrastructure in parallel
2. Export data from existing database
3. Import data to new RDS instance
4. Update DNS to point to new ALB
5. Monitor new infrastructure for 24-48 hours
6. Decommission old infrastructure

---


## Appendix: Technology Alternatives Considered

### Infrastructure as Code

**Terraform:**
- Pros: Multi-cloud support, mature ecosystem
- Cons: Requires HCL learning, less type-safe than CDK
- Decision: CDK chosen for TypeScript type safety and AWS-native constructs

**CloudFormation (YAML/JSON):**
- Pros: Native AWS support, no additional tooling
- Cons: Verbose, lacks reusability, difficult to maintain
- Decision: CDK abstracts CloudFormation complexity while maintaining compatibility

### Compute Platform

**AWS EKS:**
- Pros: Full Kubernetes compatibility, rich ecosystem
- Cons: $72/month control plane fee, operational complexity
- Decision: ECS Fargate chosen for cost savings and simplicity

**AWS App Runner:**
- Pros: Simplest deployment, auto-scaling, managed load balancing
- Cons: Limited VPC integration, cannot connect to RDS in private subnets
- Decision: ECS Fargate chosen for VPC integration requirements

**EC2 Instances:**
- Pros: Full control, predictable pricing with Reserved Instances
- Cons: Requires OS patching, capacity management, higher baseline cost
- Decision: Fargate chosen for serverless scaling and operational simplicity

### Database

**Amazon Aurora Serverless v2:**
- Pros: Auto-scaling, pay-per-use, multi-AZ by default
- Cons: $250-400/month minimum cost for minimal capacity
- Decision: RDS PostgreSQL t4g.micro chosen for cost optimization

**Amazon RDS Multi-AZ:**
- Pros: Automatic failover, high availability
- Cons: Doubles database cost (~$50/month additional)
- Decision: Single-AZ for minimal deployment, Multi-AZ upgrade path documented

---

## Summary

This design document specifies a cost-optimized AWS deployment for the Food Cost Calculator using modular CDK stacks, ECS Fargate compute, single-AZ RDS PostgreSQL, single-node ElastiCache Redis, Amazon Cognito authentication, and supporting services for storage and observability. The deployment targets a cost ceiling of $144-187/month while maintaining security, automated deployment, and readiness for future scaling.

Key design decisions prioritize cost optimization without sacrificing security or reliability:
- ECS Fargate eliminates EKS control plane fees
- Single-AZ RDS reduces database costs by 50%
- Single NAT Gateway saves $35/month with documented HA upgrade path
- ARM-based Graviton2 instances save 20% on compute costs
- Modular stack architecture enables incremental updates and independent debugging
