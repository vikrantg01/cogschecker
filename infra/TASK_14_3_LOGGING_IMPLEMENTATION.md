# Task 14.3: VPC Flow Logs, CloudTrail, and ALB Access Logs Implementation

## Overview

Implemented comprehensive logging infrastructure for security auditing and compliance:
- **VPC Flow Logs**: Network traffic metadata capture in NetworkStackOptimized
- **CloudTrail Documentation**: Account-level audit logging setup guide
- **ALB Access Logs**: HTTP request logging to S3 in EcsStack

**Requirements Satisfied**: 11.6, 11.7, 11.8

## Changes Made

### 1. VPC Flow Logs (NetworkStackOptimized)

**File Modified**: `infra/lib/stacks/NetworkStackOptimized.ts`

**Implementation Details**:
- Created CloudWatch Log Group: `/aws/vpc/flowlogs-${envName}`
- Configured 7-day log retention for cost optimization
- Created IAM role for VPC Flow Logs service to write to CloudWatch
- Enabled VPC Flow Logs with `trafficType: 'ALL'` (captures both ACCEPT and REJECT)
- Added CloudFormation output: `VpcFlowLogsLogGroupName`

**Code Added**:
```typescript
// CloudWatch Log Group for VPC flow logs
this.flowLogsLogGroup = new logs.LogGroup(this, 'VpcFlowLogsLogGroup', {
  logGroupName: `/aws/vpc/flowlogs-${envName}`,
  retention: logs.RetentionDays.ONE_WEEK,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

// IAM role for VPC Flow Logs
const flowLogsRole = new iam.Role(this, 'VpcFlowLogsRole', {
  assumedBy: new iam.ServicePrincipal('vpc-flow-logs.amazonaws.com'),
});
this.flowLogsLogGroup.grantWrite(flowLogsRole);

// Enable VPC Flow Logs
new ec2.CfnFlowLog(this, 'VpcFlowLog', {
  resourceType: 'VPC',
  resourceId: this.vpc.vpcId,
  trafficType: 'ALL',
  logDestinationType: 'cloud-watch-logs',
  logGroupName: this.flowLogsLogGroup.logGroupName,
  deliverLogsPermissionArn: flowLogsRole.roleArn,
});
```

**What Gets Logged**:
- Source and destination IP addresses
- Source and destination ports
- Protocol (TCP, UDP, ICMP)
- Packet and byte counts
- Action (ACCEPT or REJECT)
- Timestamps

**Use Cases**:
- Security analysis: Identify unauthorized connection attempts
- Network troubleshooting: Debug connectivity issues
- Compliance: Audit network access patterns
- Anomaly detection: Identify unusual traffic patterns

### 2. CloudTrail Documentation

**File Created**: `infra/CLOUDTRAIL_SETUP.md`

**Why CloudTrail is NOT in CDK Stacks**:
CloudTrail is an **account-level service**, not application-specific:
- One trail logs events for ALL AWS services across ALL regions
- Managed by account administrators, not per-application deployments
- Avoids duplication and reduces costs
- Provides centralized audit logging for the entire AWS account

**Documentation Includes**:
1. **Overview**: Why CloudTrail is account-level
2. **What CloudTrail Logs**: Management events, data events, insights
3. **Setup Instructions**: 3 options provided
   - AWS Console (easiest)
   - AWS CLI (scriptable)
   - Separate CDK AuditStack (infrastructure-as-code)
4. **Viewing CloudTrail Logs**: Console, CLI, CloudWatch Logs Insights
5. **Cost Considerations**: $0-8/month (first trail is free for management events)
6. **Security Best Practices**: Log validation, encryption, retention
7. **Verification Steps**: How to confirm CloudTrail is working

**What CloudTrail Will Log for Food Cost Calculator**:
- ECS task launches and terminations
- RDS database configuration changes
- Security group rule modifications
- S3 bucket access and object operations
- Secrets Manager secret retrievals
- Cognito user pool changes
- IAM role and policy changes

### 3. ALB Access Logs (EcsStack)

**File Modified**: `infra/lib/stacks/EcsStack.ts`

**Implementation Details**:
- Created S3 bucket: `fcc-alb-logs-${envName}`
- Configured S3-managed encryption (SSE-S3)
- Blocked all public access
- Added lifecycle policy: Delete logs after 90 days
- Enabled ALB access logging: `this.alb.logAccessLogs(this.albLogsBucket)`
- Added CloudFormation output: `AlbLogsBucketName`

**Code Added**:
```typescript
// S3 bucket for ALB access logs
this.albLogsBucket = new s3.Bucket(this, 'AlbLogsBucket', {
  bucketName: `fcc-alb-logs-${envName}`,
  encryption: s3.BucketEncryption.S3_MANAGED,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  lifecycleRules: [
    {
      id: 'DeleteOldLogs',
      enabled: true,
      expiration: cdk.Duration.days(90),
    },
  ],
  removalPolicy: envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
  autoDeleteObjects: envName !== 'prod',
});

// Enable ALB access logs
this.alb.logAccessLogs(this.albLogsBucket);
```

**What Gets Logged**:
- Timestamp of request
- Client IP address
- Request method and URL
- HTTP status code
- Response size
- Request/response time
- User-Agent
- SSL/TLS details (when HTTPS is enabled)

**Log Format**:
ALB logs use a space-delimited format stored in S3:
```
s3://fcc-alb-logs-prod/AWSLogs/646194726437/elasticloadbalancing/us-east-1/2024/01/15/646194726437_elasticloadbalancing_us-east-1_app.foodcost-alb-prod.1234567890abcdef_20240115T0000Z_192.168.1.1_abcdefgh.log.gz
```

**Use Cases**:
- Request-level debugging: Investigate 5xx errors
- Performance analysis: Identify slow endpoints
- Security monitoring: Detect suspicious request patterns
- Compliance: Audit HTTP access logs
- Traffic analysis: Understand user behavior

## Verification

### 1. Verify VPC Flow Logs Configuration

**Check CloudFormation Template**:
```bash
cd infra
npx cdk synth FoodCostCalculator-Network | grep -A 5 "FlowLog"
```

**Expected Output**:
- `AWS::Logs::LogGroup` resource: `VpcFlowLogsLogGroup`
- `AWS::IAM::Role` resource: `VpcFlowLogsRole`
- `AWS::EC2::FlowLog` resource: `VpcFlowLog`
- CloudFormation output: `VpcFlowLogsLogGroupName`

**After Deployment** (verify logs are flowing):
```bash
# View recent flow logs
aws logs tail /aws/vpc/flowlogs-prod --follow

# Query flow logs for rejected traffic
aws logs filter-log-events \
  --log-group-name /aws/vpc/flowlogs-prod \
  --filter-pattern "[version, account, eni, source, destination, srcport, destport, protocol, packets, bytes, start, end, action=REJECT, status]" \
  --limit 10
```

### 2. Verify ALB Access Logs Configuration

**Check CloudFormation Template**:
```bash
cd infra
npx cdk synth FoodCostCalculator-Compute | grep -A 5 "AlbLogs"
```

**Expected Output**:
- `AWS::S3::Bucket` resource: `AlbLogsBucket`
- `AWS::S3::BucketPolicy` resource: `AlbLogsBucketPolicy`
- ALB `LoadBalancerAttributes`: `access_logs.s3.enabled=true`
- CloudFormation output: `AlbLogsBucketName`

**After Deployment** (verify logs are being written):
```bash
# List ALB log files
aws s3 ls s3://fcc-alb-logs-prod/AWSLogs/ --recursive

# Download and view recent log file
aws s3 cp s3://fcc-alb-logs-prod/AWSLogs/$(aws sts get-caller-identity --query Account --output text)/elasticloadbalancing/us-east-1/ . --recursive --exclude "*" --include "*$(date +%Y%m%d)*"
```

### 3. CloudTrail Setup (Manual Step)

**Verify CloudTrail is Enabled**:
```bash
aws cloudtrail describe-trails
aws cloudtrail get-trail-status --name foodcost-audit-trail
```

**If Not Enabled** (follow documentation):
```bash
# See infra/CLOUDTRAIL_SETUP.md for detailed instructions
```

## Cost Impact

### VPC Flow Logs
- CloudWatch Logs ingestion: ~$0.50-2/GB
- CloudWatch Logs storage: ~$0.03/GB/month (7-day retention)
- **Estimated**: $5-15/month (depends on traffic volume)

### CloudTrail
- Management events: **$0/month** (first trail is free)
- Data events: ~$0.10 per 100,000 events
- S3 storage for logs: ~$1-3/month
- **Estimated**: $0-8/month

### ALB Access Logs
- S3 storage: ~$0.023/GB/month (first 50 TB)
- S3 PUT requests: ~$0.005 per 1,000 requests
- **Estimated**: $2-5/month (low traffic)

**Total Additional Cost**: ~$7-28/month

## Security Benefits

1. **Comprehensive Audit Trail**:
   - VPC Flow Logs: Network-level activity
   - CloudTrail: API-level activity
   - ALB Access Logs: Application-level activity

2. **Threat Detection**:
   - Identify unauthorized access attempts
   - Detect port scanning and reconnaissance
   - Monitor for data exfiltration patterns

3. **Compliance Requirements**:
   - Meet audit logging requirements (SOC 2, PCI-DSS, HIPAA)
   - Demonstrate security controls to customers
   - Support forensic investigations

4. **Operational Troubleshooting**:
   - Debug network connectivity issues
   - Investigate application errors
   - Analyze performance bottlenecks

## Next Steps

1. **Deploy Infrastructure**:
   ```bash
   cd infra
   cdk deploy FoodCostCalculator-Network FoodCostCalculator-Compute
   ```

2. **Enable CloudTrail** (one-time setup):
   - Follow instructions in `CLOUDTRAIL_SETUP.md`
   - Use AWS Console, CLI, or separate CDK stack

3. **Set Up Log Analysis** (optional):
   - Create CloudWatch Logs Insights queries
   - Set up automated alerting for suspicious patterns
   - Integrate with SIEM tools (Splunk, Datadog, etc.)

4. **Monitor Costs**:
   - Track CloudWatch Logs ingestion in AWS Cost Explorer
   - Set up billing alarms for logging costs
   - Adjust retention periods if costs exceed budget

## Files Changed

1. **infra/lib/stacks/NetworkStackOptimized.ts**
   - Added VPC Flow Logs log group
   - Added IAM role for VPC Flow Logs
   - Enabled VPC Flow Logs with ALL traffic
   - Added CloudFormation output for log group name

2. **infra/lib/stacks/EcsStack.ts**
   - Added S3 bucket for ALB access logs
   - Enabled ALB access logging
   - Added CloudFormation output for bucket name

3. **infra/CLOUDTRAIL_SETUP.md** (new file)
   - Comprehensive CloudTrail setup guide
   - 3 setup options (Console, CLI, CDK)
   - Cost breakdown and security best practices

## Summary

Task 14.3 is **complete**. All three logging mechanisms are now implemented:

✅ **VPC Flow Logs**: Captures network traffic metadata in CloudWatch Logs  
✅ **CloudTrail Documentation**: Provides account-level audit logging setup guide  
✅ **ALB Access Logs**: Captures HTTP request logs in S3  

The infrastructure now has comprehensive logging for security auditing, compliance, and operational troubleshooting, satisfying requirements 11.6, 11.7, and 11.8.
