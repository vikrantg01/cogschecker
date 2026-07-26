# CloudTrail Setup Guide

## Overview

CloudTrail is an **account-level service** that logs all AWS API calls for auditing and compliance purposes. It is NOT deployed as part of the CDK stacks because it should be managed by account administrators and applies globally to all services across regions.

**Requirement 11.6**: CloudTrail for API audit logging (account-level)

## Why CloudTrail is Not in the CDK Stacks

CloudTrail operates at the AWS account level, not the application level:

- **Single trail per account**: One CloudTrail trail can log events for all regions and all services
- **Account-wide scope**: Captures API calls across all applications, not just Food Cost Calculator
- **Organizational management**: Typically configured once by account admins, not deployed per application
- **Cost efficiency**: A single trail avoids duplication and reduces storage costs
- **Security and compliance**: Account admins control audit logging centrally

## What CloudTrail Logs

CloudTrail captures all AWS API calls, including:

- **Management events**: API calls that create, modify, or delete AWS resources
  - Example: `CreateVpc`, `RunInstances`, `PutBucketPolicy`
- **Data events**: Resource operations on or within AWS services
  - Example: S3 object-level operations (`GetObject`, `PutObject`)
  - Example: Lambda function invocations
- **Insights events**: Unusual API call activity patterns (optional)

For the Food Cost Calculator deployment, CloudTrail will log:
- ECS task launches and terminations
- RDS database configuration changes
- Security group rule modifications
- S3 bucket access and object operations
- Secrets Manager secret retrievals
- Cognito user pool changes
- IAM role and policy changes

## Setup Instructions

### Option 1: Enable CloudTrail via AWS Console (Recommended for Quick Setup)

1. **Navigate to CloudTrail**:
   - Sign in to the AWS Console
   - Go to **CloudTrail** service

2. **Create a Trail**:
   - Click **Create trail**
   - Trail name: `foodcost-audit-trail` (or your preferred name)
   - Storage location: Create a new S3 bucket or use existing
   - Log file SSE-KMS encryption: **Enabled** (recommended)
   - Log file validation: **Enabled** (recommended)
   - SNS notification delivery: Optional (for real-time alerts)

3. **Configure Events**:
   - **Management events**: Select **All** (Read + Write)
   - **Data events** (optional but recommended for production):
     - S3 bucket: Enable for `fcc-invoices-*` buckets (log object operations)
     - Lambda: Enable if using Lambda functions
   - **Insights events**: Optional (detects unusual API activity)

4. **Enable for All Regions**:
   - Select **Yes** to apply the trail to all regions
   - This ensures API calls in any region are logged

5. **Review and Create**:
   - Verify configuration
   - Click **Create trail**

### Option 2: Enable CloudTrail via AWS CLI

```bash
# Create S3 bucket for CloudTrail logs
aws s3 mb s3://foodcost-cloudtrail-logs-<account-id> --region us-east-1

# Apply bucket policy to allow CloudTrail to write logs
aws s3api put-bucket-policy \
  --bucket foodcost-cloudtrail-logs-<account-id> \
  --policy '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Sid": "AWSCloudTrailAclCheck",
        "Effect": "Allow",
        "Principal": {
          "Service": "cloudtrail.amazonaws.com"
        },
        "Action": "s3:GetBucketAcl",
        "Resource": "arn:aws:s3:::foodcost-cloudtrail-logs-<account-id>"
      },
      {
        "Sid": "AWSCloudTrailWrite",
        "Effect": "Allow",
        "Principal": {
          "Service": "cloudtrail.amazonaws.com"
        },
        "Action": "s3:PutObject",
        "Resource": "arn:aws:s3:::foodcost-cloudtrail-logs-<account-id>/*",
        "Condition": {
          "StringEquals": {
            "s3:x-amz-acl": "bucket-owner-full-control"
          }
        }
      }
    ]
  }'

# Create CloudTrail trail
aws cloudtrail create-trail \
  --name foodcost-audit-trail \
  --s3-bucket-name foodcost-cloudtrail-logs-<account-id> \
  --is-multi-region-trail \
  --enable-log-file-validation

# Start logging
aws cloudtrail start-logging --name foodcost-audit-trail

# (Optional) Enable data events for S3 buckets
aws cloudtrail put-event-selectors \
  --trail-name foodcost-audit-trail \
  --event-selectors '[
    {
      "ReadWriteType": "All",
      "IncludeManagementEvents": true,
      "DataResources": [
        {
          "Type": "AWS::S3::Object",
          "Values": ["arn:aws:s3:::fcc-invoices-*/*"]
        }
      ]
    }
  ]'
```

### Option 3: Enable CloudTrail via Separate CDK Stack (Advanced)

If you want to manage CloudTrail as infrastructure-as-code but keep it separate from application stacks:

```typescript
// infra/lib/stacks/AuditStack.ts
import * as cdk from 'aws-cdk-lib';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export class AuditStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket for CloudTrail logs
    const trailBucket = new s3.Bucket(this, 'TrailBucket', {
      bucketName: `foodcost-cloudtrail-logs-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          id: 'DeleteOldLogs',
          enabled: true,
          expiration: cdk.Duration.days(365), // Retain logs for 1 year
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Never delete audit logs
    });

    // CloudTrail trail
    new cloudtrail.Trail(this, 'FoodCostAuditTrail', {
      trailName: 'foodcost-audit-trail',
      bucket: trailBucket,
      isMultiRegionTrail: true,
      includeGlobalServiceEvents: true,
      managementEvents: cloudtrail.ReadWriteType.ALL,
      sendToCloudWatchLogs: true, // Optional: also send to CloudWatch Logs
      cloudWatchLogGroup: new logs.LogGroup(this, 'TrailLogGroup', {
        logGroupName: '/aws/cloudtrail/foodcost-audit',
        retention: logs.RetentionDays.ONE_YEAR,
      }),
    });

    cdk.Tags.of(this).add('Component', 'Audit');
    cdk.Tags.of(this).add('CostCenter', 'Security');
  }
}
```

Deploy separately:
```bash
cdk deploy AuditStack
```

## Viewing CloudTrail Logs

### Via AWS Console

1. Go to **CloudTrail** → **Event history**
2. Filter by:
   - Event name (e.g., `RunTask`, `ModifySecurityGroup`)
   - User name (IAM user or role)
   - Resource name (e.g., specific RDS instance)
   - Time range

### Via AWS CLI

```bash
# Search recent events
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=RunTask \
  --max-results 10

# Query specific resource
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=foodcost-db \
  --start-time 2024-01-01T00:00:00Z
```

### Via CloudWatch Logs Insights (if enabled)

```bash
fields @timestamp, eventName, userIdentity.arn, sourceIPAddress
| filter eventSource = "ecs.amazonaws.com"
| sort @timestamp desc
| limit 20
```

## Cost Considerations

CloudTrail costs depend on:
- **Management events**: First trail is **free** for management events in all regions
- **Data events**: Charged per 100,000 events (e.g., S3 object-level logging)
- **S3 storage**: Standard S3 storage pricing for log files
- **CloudWatch Logs** (optional): Additional cost if sending logs to CloudWatch

**Estimated cost for Food Cost Calculator**:
- Management events: **$0/month** (first trail is free)
- Data events (if enabled for S3): ~$2-5/month (low traffic)
- S3 storage for logs: ~$1-3/month
- **Total**: ~$3-8/month (or free with management events only)

## Security Best Practices

1. **Enable log file validation**: Ensures CloudTrail logs haven't been tampered with
2. **Use KMS encryption**: Encrypt CloudTrail logs at rest
3. **Restrict S3 bucket access**: Only CloudTrail and authorized admins can read logs
4. **Enable MFA delete**: Prevent accidental deletion of CloudTrail logs
5. **Monitor CloudTrail events**: Set up CloudWatch alarms for critical API calls (e.g., `DeleteTrail`, `StopLogging`)
6. **Retain logs**: Keep logs for at least 90 days (or longer for compliance requirements)

## Verification

After enabling CloudTrail, verify it's working:

```bash
# Check trail status
aws cloudtrail get-trail-status --name foodcost-audit-trail

# Expected output:
# {
#   "IsLogging": true,
#   "LatestDeliveryTime": 1234567890.0
# }

# List recent events
aws cloudtrail lookup-events --max-results 5
```

## Summary

CloudTrail provides comprehensive audit logging for all AWS API calls. Since it operates at the account level, it should be configured once by account administrators rather than deployed per application stack. This ensures centralized security monitoring and compliance across all AWS resources.

For the Food Cost Calculator deployment, CloudTrail will automatically log all infrastructure changes, ECS deployments, database modifications, and security-related events without any application-specific configuration.
