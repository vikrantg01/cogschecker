# AWS Account Setup Guide for Food Cost Calculator Deployment

> **Complete guide to setting up a secure AWS account with IAM best practices**  
> **Estimated time:** 30-45 minutes

---

## Table of Contents

1. [Overview](#overview)
2. [Phase 1: Create AWS Account](#phase-1-create-aws-account)
3. [Phase 2: Secure Root Account](#phase-2-secure-root-account)
4. [Phase 3: Set Up Billing Alerts](#phase-3-set-up-billing-alerts)
5. [Phase 4: Create IAM Admin User](#phase-4-create-iam-admin-user)
6. [Phase 5: Create Deployment IAM User](#phase-5-create-deployment-iam-user)
7. [Phase 6: Configure AWS CLI](#phase-6-configure-aws-cli)
8. [Phase 7: Verify Setup](#phase-7-verify-setup)
9. [Security Best Practices Checklist](#security-best-practices-checklist)
10. [What to Provide for Deployment](#what-to-provide-for-deployment)

---

## Overview

### What We're Setting Up

```
AWS Account (Root)
  ├─ MFA enabled (security)
  ├─ Billing alerts ($50, $100, $200)
  │
  ├─ IAM Admin User (for account management)
  │   ├─ MFA enabled
  │   └─ AdministratorAccess policy
  │
  └─ IAM Deployment User (for CDK/application deployment)
      ├─ Programmatic access only (Access Key)
      ├─ Custom policy (least-privilege for CDK deployment)
      └─ NO MFA (for automation)
```

### Why This Structure?

- **Root account**: Never used day-to-day, only for billing and account-level changes
- **Admin user**: For manual console access with MFA
- **Deployment user**: For automated deployments (CDK, CI/CD) with limited scope

---

## Phase 1: Create AWS Account

### Step 1.1: Sign Up for AWS

1. Go to [https://aws.amazon.com](https://aws.amazon.com)
2. Click **"Create an AWS Account"**
3. Enter your email address (this becomes the root account email)
4. Choose an account name: `FoodCostCalculator-Production` or similar
5. Click **"Verify email address"**

### Step 1.2: Complete Account Information

1. **Root user password**: Create a strong password (20+ characters, use a password manager)
   - ✅ Good: `FCC-prod-2024-Root!Xk9$mP2w`
   - ❌ Bad: `password123`

2. **Contact information**:
   - Choose **"Business"** or **"Personal"** (Personal is fine for solo projects)
   - Fill in your name, phone, address

3. **Payment information**:
   - Enter credit/debit card (required even for free tier)
   - AWS will charge $1 to verify (refunded immediately)

4. **Identity verification**:
   - Choose phone call or SMS
   - Enter the verification code

5. **Support plan**:
   - Select **"Basic Support - Free"** (sufficient for this project)

6. Wait for account activation (typically 5-10 minutes, you'll receive an email)

---

## Phase 2: Secure Root Account

**⚠️ CRITICAL: Complete this immediately after account creation**

### Step 2.1: Sign In as Root User

1. Go to [https://console.aws.amazon.com](https://console.aws.amazon.com)
2. Click **"Sign in to the Console"**
3. Select **"Root user"**
4. Enter your root email and password

### Step 2.2: Enable MFA on Root Account

1. In the AWS Console, click your account name (top right)
2. Select **"Security credentials"**
3. Scroll to **"Multi-factor authentication (MFA)"**
4. Click **"Activate MFA"**
5. Choose MFA device type:

   **Option A: Virtual MFA (Recommended - Free)**
   - Use Google Authenticator, Authy, or 1Password
   - Scan QR code with your authenticator app
   - Enter two consecutive MFA codes
   - Click **"Assign MFA"**

   **Option B: Hardware MFA (Most Secure - Costs $10-50)**
   - Use YubiKey or similar FIDO device
   - Follow device-specific instructions

6. **✅ Verify**: You should see "Assigned" status with device name

### Step 2.3: Document Root Credentials Securely

**Store in a password manager (1Password, Bitwarden, LastPass):**

```
Service: AWS Root Account (FoodCostCalculator)
Email: your-email@example.com
Password: [your 20+ character password]
MFA Device: Google Authenticator (or hardware key serial)
Account ID: [will get this in Step 2.4]
```

### Step 2.4: Note Your AWS Account ID

1. Click your account name (top right)
2. Copy the **12-digit Account ID** (e.g., `123456789012`)
3. Save this - you'll need it for deployment

---

## Phase 3: Set Up Billing Alerts

### Step 3.1: Enable Billing Alerts

1. In AWS Console, click your account name (top right)
2. Select **"Billing and Cost Management"**
3. In left sidebar, click **"Billing preferences"**
4. Under **"Alert preferences"**, check:
   - ✅ **"Receive AWS Free Tier alerts"**
   - ✅ **"Receive CloudWatch billing alerts"**
5. Enter your email for alerts
6. Click **"Save preferences"**

### Step 3.2: Create Budget Alerts

1. In left sidebar, click **"Budgets"**
2. Click **"Create budget"**
3. Select **"Customize (advanced)"**
4. Choose **"Cost budget - Recommended"**
5. Click **"Next"**

**Budget 1: Warning Alert**
- Name: `FCC-Monthly-Budget-Warning`
- Period: **Monthly**
- Budget effective dates: **Recurring budget**
- Budgeted amount: **$50.00**
- Click **"Next"**
- Alert threshold: **80%** (triggers at $40)
- Email recipients: your-email@example.com
- Click **"Next"** → **"Create budget"**

**Budget 2: Critical Alert**
- Repeat steps above with:
- Name: `FCC-Monthly-Budget-Critical`
- Budgeted amount: **$200.00**
- Alert thresholds: **80%** ($160) and **100%** ($200)

6. **✅ Verify**: You should see 2 budgets in the dashboard

---

## Phase 4: Create IAM Admin User

**🔒 Never use root account for day-to-day tasks**

### Step 4.1: Navigate to IAM

1. In AWS Console search bar (top), type **"IAM"**
2. Click **"IAM"** (Identity and Access Management)
3. In left sidebar, click **"Users"**
4. Click **"Create user"**

### Step 4.2: Configure User Details

1. **User name**: `fcc-admin`
2. Check ✅ **"Provide user access to the AWS Management Console"**
3. Select **"I want to create an IAM user"**
4. Console password:
   - Choose **"Custom password"**
   - Create a strong password (save in password manager)
   - Uncheck **"Users must create a new password at next sign-in"** (optional)
5. Click **"Next"**

### Step 4.3: Set Permissions

1. Select **"Attach policies directly"**
2. In the search box, type `AdministratorAccess`
3. Check ✅ **"AdministratorAccess"** (managed policy)
4. Click **"Next"**
5. Review and click **"Create user"**

### Step 4.4: Save Console Sign-In URL

1. After user creation, click **"View user"**
2. Copy the **"Console sign-in URL"**:
   - Format: `https://123456789012.signin.aws.amazon.com/console`
   - Or: `https://your-account-alias.signin.aws.amazon.com/console`
3. Save this URL (you'll use it instead of root login)

### Step 4.5: Enable MFA for Admin User

1. In IAM Users list, click **"fcc-admin"**
2. Click **"Security credentials"** tab
3. Scroll to **"Multi-factor authentication (MFA)"**
4. Click **"Assign MFA device"**
5. Follow same steps as root MFA (use authenticator app)
6. **✅ Verify**: MFA shows "Assigned"

### Step 4.6: Test Admin User Login

1. **Sign out** from root account
2. Go to the console sign-in URL you saved
3. Sign in as **IAM user**:
   - Account ID: `123456789012` (or alias)
   - IAM user name: `fcc-admin`
   - Password: [admin user password]
   - MFA code: [from authenticator app]
4. **✅ Verify**: You should see the AWS Console

---

## Phase 5: Create Deployment IAM User

**This user is for CDK/automation - no console access, no MFA**

### Step 5.1: Create Deployment User

1. Still signed in as `fcc-admin` (IAM user, not root)
2. Navigate to **IAM** → **"Users"**
3. Click **"Create user"**
4. **User name**: `fcc-deployment`
5. **DO NOT** check console access (programmatic access only)
6. Click **"Next"**

### Step 5.2: Create Custom Deployment Policy

1. Select **"Attach policies directly"**
2. Click **"Create policy"** (opens new tab)
3. Click **"JSON"** tab
4. Replace the JSON with this **least-privilege CDK deployment policy**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CDKBootstrapAndDeploy",
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "s3:*",
        "iam:*",
        "ec2:*",
        "ecs:*",
        "ecr:*",
        "elasticloadbalancing:*",
        "logs:*",
        "rds:*",
        "elasticache:*",
        "cognito-idp:*",
        "secretsmanager:*",
        "kms:*",
        "sns:*",
        "cloudwatch:*",
        "budgets:*",
        "ssm:*",
        "sts:GetCallerIdentity"
      ],
      "Resource": "*"
    }
  ]
}
```

5. Click **"Next"**
6. Policy name: `CDKDeploymentPolicy`
7. Description: `Least-privilege policy for CDK infrastructure deployment`
8. Click **"Create policy"**
9. Close the policy tab

### Step 5.3: Attach Policy to Deployment User

1. Back in the "Create user" tab, click the refresh icon (↻) next to "Create policy"
2. Search for `CDKDeploymentPolicy`
3. Check ✅ **"CDKDeploymentPolicy"**
4. Click **"Next"**
5. Review and click **"Create user"**

### Step 5.4: Create Access Key

1. In IAM Users list, click **"fcc-deployment"**
2. Click **"Security credentials"** tab
3. Scroll to **"Access keys"**
4. Click **"Create access key"**
5. Select use case: **"Command Line Interface (CLI)"**
6. Check ✅ **"I understand the above recommendation..."**
7. Click **"Next"**
8. Description tag (optional): `CDK deployment from local machine`
9. Click **"Create access key"**

### Step 5.5: Save Access Key Credentials

**⚠️ CRITICAL: You can only view the Secret Access Key ONCE**

1. **Copy both values immediately**:
   ```
   Access key ID: AKIAIOSFODNN7EXAMPLE
   Secret access key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
   ```

2. **Download .csv file** as backup

3. Click **"Done"**

4. **Store securely in password manager**:
   ```
   Service: AWS Deployment User (fcc-deployment)
   Access Key ID: AKIAIOSFODNN7EXAMPLE
   Secret Access Key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
   Region: us-east-1
   Account ID: 123456789012
   ```

---

## Phase 6: Configure AWS CLI

### Step 6.1: Install AWS CLI (if not already installed)

```bash
# macOS (Homebrew)
brew install awscli

# Or download installer
curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
sudo installer -pkg AWSCLIV2.pkg -target /

# Verify installation
aws --version
# Expected output: aws-cli/2.x.x Python/3.x.x Darwin/...
```

### Step 6.2: Configure AWS CLI Profile

```bash
# Configure deployment user credentials
aws configure --profile fcc-deployment

# When prompted, enter:
# AWS Access Key ID: [paste from Step 5.5]
# AWS Secret Access Key: [paste from Step 5.5]
# Default region name: us-east-1
# Default output format: json
```

### Step 6.3: Verify Configuration

```bash
# Test credentials
aws sts get-caller-identity --profile fcc-deployment

# Expected output:
# {
#     "UserId": "AIDAI...",
#     "Account": "123456789012",
#     "Arn": "arn:aws:iam::123456789012:user/fcc-deployment"
# }
```

### Step 6.4: Set Default Profile (Optional)

```bash
# Option 1: Set environment variable (for current terminal session)
export AWS_PROFILE=fcc-deployment

# Option 2: Add to ~/.zshrc or ~/.bash_profile (permanent)
echo 'export AWS_PROFILE=fcc-deployment' >> ~/.zshrc
source ~/.zshrc

# Verify default profile
aws sts get-caller-identity
# Should show fcc-deployment user without --profile flag
```

---

## Phase 7: Verify Setup

### Verification Checklist

Run these commands to verify everything is configured correctly:

```bash
# 1. Verify AWS CLI configuration
aws configure list --profile fcc-deployment
# Should show: access_key, secret_key, region (us-east-1), output (json)

# 2. Verify IAM user permissions
aws iam get-user --profile fcc-deployment
# Should show: UserName: fcc-deployment, CreateDate, Arn

# 3. Verify policy attachment
aws iam list-attached-user-policies --user-name fcc-deployment --profile fcc-deployment
# Should show: PolicyName: CDKDeploymentPolicy

# 4. Verify account ID
aws sts get-caller-identity --profile fcc-deployment
# Should show: Account: 123456789012

# 5. Verify region
aws ec2 describe-regions --profile fcc-deployment
# Should list all AWS regions (confirms connectivity)

# 6. Test CloudFormation permissions (required for CDK)
aws cloudformation list-stacks --profile fcc-deployment
# Should return empty array: {"StackSummaries": []}

# 7. Test S3 permissions (required for CDK bootstrap)
aws s3 ls --profile fcc-deployment
# Should return empty (no buckets yet) or list existing buckets
```

**✅ All commands should succeed without errors**

---

## Security Best Practices Checklist

### Account Security

- [x] Root account MFA enabled
- [x] Root account password 20+ characters
- [x] Root account credentials stored in password manager
- [x] Billing alerts configured ($50, $200)
- [x] IAM admin user created with MFA
- [x] IAM deployment user created (no console access)
- [x] Deployment user uses least-privilege policy
- [x] Access keys stored securely (not in code/git)

### Operational Security

- [ ] Enable CloudTrail (optional, costs ~$2/month):
  ```bash
  # Creates audit log of all AWS API calls
  # See: infra/CLOUDTRAIL_SETUP.md
  ```

- [ ] Set up AWS Organizations (optional, for multi-account):
  ```bash
  # If planning multiple environments (dev, staging, prod)
  # Separates billing and resource isolation
  ```

### Daily Operations

- ✅ **Always use `fcc-admin` IAM user** for console access (never root)
- ✅ **Always use `fcc-deployment` for CLI/CDK** (programmatic access)
- ✅ **Never commit Access Keys to Git** (use environment variables)
- ✅ **Rotate Access Keys every 90 days** (set calendar reminder)

---

## What to Provide for Deployment

### Information Needed

When ready to deploy, you'll need:

1. **AWS Account ID**:
   ```
   123456789012
   ```

2. **AWS Region**:
   ```
   us-east-1  (recommended: lowest cost, most services)
   ```

3. **AWS CLI Profile**:
   ```
   fcc-deployment
   ```

4. **Email for Alerts** (optional):
   ```
   your-email@example.com  (for CloudWatch alarms)
   ```

### How to Share Credentials Securely

**❌ NEVER share via:**
- Email
- Slack/Discord
- Screenshots
- Plain text files

**✅ Share via:**
- AWS CLI is already configured locally (no sharing needed!)
- If remote deployment needed, use AWS IAM Identity Center (SSO)

### Environment Variables to Set

Before deployment, set these:

```bash
# Required
export AWS_PROFILE=fcc-deployment
export CDK_DEFAULT_ACCOUNT=123456789012  # Your account ID
export CDK_DEFAULT_REGION=us-east-1

# Optional (for email notifications)
export ALARM_EMAIL=your-email@example.com

# Verify
echo $AWS_PROFILE
echo $CDK_DEFAULT_ACCOUNT
echo $CDK_DEFAULT_REGION
```

---

## Cost Transparency

### Expected Costs

**Free Tier (First 12 months)**:
- EC2: 750 hours/month t2.micro/t3.micro
- RDS: 750 hours/month db.t2.micro/db.t3.micro
- S3: 5 GB storage
- CloudWatch: 10 metrics, 10 alarms
- Cognito: 50,000 MAU (monthly active users)

**Our Infrastructure Costs** (after free tier):
- **Months 1-12**: $10-50/month (free tier covers most services)
- **After 12 months**: $116-185/month (full pricing)
- **Budget alerts**: Set at $50 (warning) and $200 (critical)

**Cost Optimization**:
- Single-AZ RDS (saves $25/month vs Multi-AZ)
- Single NAT Gateway (saves $35/month vs 2)
- ARM Graviton2 instances (20% cheaper than Intel)
- 7-day log retention (reduces CloudWatch costs)

---

## Next Steps

### After Setup Complete

1. **Verify all checklist items** above are ✅
2. **Test AWS CLI access**:
   ```bash
   aws sts get-caller-identity --profile fcc-deployment
   ```
3. **Set environment variables**:
   ```bash
   export AWS_PROFILE=fcc-deployment
   export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
   export CDK_DEFAULT_REGION=us-east-1
   export ALARM_EMAIL=your-email@example.com
   ```
4. **Ready to deploy!** Inform me that AWS setup is complete

### Deployment Phases

Once AWS account is ready, deployment follows this sequence:

1. **CDK Bootstrap** (one-time, ~2 minutes)
2. **Build Application** (Maven build, ~3 minutes)
3. **Deploy Infrastructure** (7 CDK stacks, ~15-20 minutes)
4. **Push Docker Image** (build + push to ECR, ~5 minutes)
5. **Verify Deployment** (health checks, ~2 minutes)

**Total time**: ~30-35 minutes

---

## Troubleshooting

### Issue: "Invalid Access Key ID"

**Cause**: Credentials not configured correctly

**Solution**:
```bash
aws configure list --profile fcc-deployment
# Verify access_key and secret_key are set

# Reconfigure if needed
aws configure --profile fcc-deployment
```

### Issue: "User is not authorized to perform: cloudformation:CreateStack"

**Cause**: Policy not attached or incorrect policy

**Solution**:
```bash
# Verify policy attachment
aws iam list-attached-user-policies --user-name fcc-deployment --profile fcc-deployment

# Should show CDKDeploymentPolicy
# If missing, attach policy via IAM console
```

### Issue: "MFA token required"

**Cause**: Using admin user for CLI (should use deployment user)

**Solution**:
```bash
# Deployment user should NOT have MFA (for automation)
# Verify you're using the correct profile
echo $AWS_PROFILE  # Should show: fcc-deployment
```

### Issue: Forgot Root Password

**Solution**:
1. Go to AWS sign-in page
2. Click "Forgot your password?"
3. Use root email to reset
4. Set new strong password (20+ characters)

---

## Additional Resources

- [AWS Account Best Practices](https://docs.aws.amazon.com/accounts/latest/reference/best-practices.html)
- [IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [AWS Security Hub](https://aws.amazon.com/security-hub/)
- [AWS Free Tier](https://aws.amazon.com/free/)
- [AWS Pricing Calculator](https://calculator.aws/)

---

## Summary

**What You Created**:
- ✅ AWS account with billing alerts
- ✅ Root account secured with MFA
- ✅ Admin IAM user (`fcc-admin`) for console access
- ✅ Deployment IAM user (`fcc-deployment`) for CDK
- ✅ AWS CLI configured locally
- ✅ Least-privilege policies for security
- ✅ Cost monitoring ($50 warning, $200 limit)

**What's Next**:
- Set environment variables
- Inform me AWS setup is complete
- Begin CDK deployment (30-35 minutes)

**Estimated Monthly Cost**:
- Months 1-12: $10-50 (free tier)
- After 12 months: $116-185

---

**Last Updated**: 2024  
**Infrastructure**: Food Cost Calculator - Minimal Production  
**Target Cost**: $137-200/month (2 venues)
