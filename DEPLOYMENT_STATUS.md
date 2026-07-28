# AWS Deployment Status

**Account**: 333968387413  
**Region**: us-east-1  
**Date**: January 28, 2026 8:45 AM

---

## Current Status: ⏳ IN PROGRESS

### ✅ Deployed Successfully (4/7 stacks)
1. **FoodCostCalculator-Storage** - S3 buckets ✅
   - Frontend bucket: `fcc-frontend`
   - Invoice bucket: `fcc-invoices`
   - Lifecycle policy configured

2. **FoodCostCalculator-Auth** - Cognito User Pool ✅
   - User Pool ID: `us-east-1_6cpftY9WK`
   - Client ID: `6dpibdrb29ke9nckdufs09fo9v`
   - Google OAuth enabled
   - Apple Sign In temporarily disabled (needs real credentials)

3. **FoodCostCalculator-Network** - VPC Infrastructure ✅
   - VPC ID: `vpc-0f42c8b3dd0121a97`
   - 1 NAT Gateway (cost optimized)
   - 4 Security Groups configured
   - VPC Flow Logs enabled

4. **FoodCostCalculator-Database** - PostgreSQL ✅
   - RDS PostgreSQL 15.x (latest)
   - db.t4g.micro Single-AZ
   - 1-day backup retention (free tier limit)
   - Encryption enabled

### 🚨 Blocked (1/7 stacks)
5. **FoodCostCalculator-Cache** - ElastiCache Redis ❌
   - **Issue**: Repeated "null" errors from ElastiCache API
   - **Attempts**: Tried t4g.micro, t3.micro, Redis 7.1, Redis 7.0
   - **Possible Cause**: Free tier account limitations or service quota limits
   - **Workaround**: Can proceed without Redis cache (application will work slower but functional)

### ⏳ Pending (2/7 stacks)
6. **FoodCostCalculator-Compute** - ECS Fargate, ALB, ECR
7. **FoodCostCalculator-Observability** - CloudWatch, SNS, Budgets

---

## Issues Encountered & Fixes Applied

### 1. PostgreSQL Version Not Available ✅ FIXED
**Issue**: Version 15.4 not available  
**Fix**: Changed to VER_15 (uses latest 15.x version)  
**Files**: `RdsStack.ts` lines 81, 114

### 2. ElastiCache Redis Deployment Failures ❌ ONGOING
**Issue**: ReplicationGroup creation fails with "null" error message  
**Attempts**:
- Changed from cache.t4g.micro to cache.t3.micro
- Changed from Redis 7.1 to Redis 7.0
- Verified numCacheClusters: 1 configuration
- All attempts result in same "null" error

**Possible Root Causes**:
1. **Free Tier Limitation**: ElastiCache may not be available in free tier
2. **Service Quota**: New AWS accounts may have ElastiCache quotas set to 0
3. **Region Availability**: cache.t3.micro may not be available in us-east-1
4. **Account Verification**: New accounts may need verification before using ElastiCache

**Recommended Action**: 
- Continue deployment without Redis cache
- Application will fall back to direct database queries
- Can add Redis later after account is verified/upgraded

---

## Deployment Strategy - Modified

Given ElastiCache issues, we'll:

1. ✅ Complete Compute stack deployment (ECS, ALB, ECR)
2. ✅ Complete Observability stack deployment
3. ✅ Build and deploy application Docker image
4. ✅ Verify application works without Redis cache
5. ⏳ Investigate ElastiCache quota/limits with AWS Support
6. ⏳ Deploy Redis later when issue is resolved

---

## Next Steps

1. 🔄 Delete failed FoodCostCalculator-Cache stack
2. 🔄 Modify EcsStack to handle optional Redis endpoint
3. ⏳ Deploy Compute stack (ECS, ALB, ECR)
4. ⏳ Deploy Observability stack (CloudWatch, SNS)
5. ⏳ Build Maven application
6. ⏳ Build & push Docker image to ECR
7. ⏳ Verify application health at ALB endpoint
8. ⏳ Contact AWS Support about ElastiCache quota

---

## Cost Impact

**With Redis** (original plan): $116-185/month  
**Without Redis** (current): $101-165/month

**Savings**: $15-20/month (Redis cost)

**Trade-off**: 
- Slower performance (no caching layer)
- Higher database load
- Acceptable for initial 2 venues
- Can add Redis later when needed

---

## Application Configuration Changes Needed

The Spring Boot application needs to handle missing Redis gracefully:

```yaml
spring:
  cache:
    type: none  # or simple (in-memory)
  redis:
    enabled: false
```

The application should:
- Detect Redis unavailability
- Fall back to direct database queries
- Use simple in-memory caching if configured
- Log warning about missing Redis

---

**Last Updated**: January 28, 2026 8:45 AM

