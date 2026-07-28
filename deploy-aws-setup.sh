#!/bin/bash

# AWS Deployment Environment Setup
# This script sets up environment variables for CDK deployment

# Set AWS profile for deployment
export AWS_PROFILE=fcc-deployment

# Get AWS account ID dynamically
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text --profile fcc-deployment)

# Set deployment region (us-east-1 for lowest costs)
export CDK_DEFAULT_REGION=us-east-1

# Optional: Set email for CloudWatch alarm notifications
# export ALARM_EMAIL=your-email@example.com

# Display configuration
echo "✅ AWS Deployment Environment Configured"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "AWS Profile:       $AWS_PROFILE"
echo "AWS Account ID:    $CDK_DEFAULT_ACCOUNT"
echo "AWS Region:        $CDK_DEFAULT_REGION"
echo "Alarm Email:       ${ALARM_EMAIL:-Not set (optional)}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "To use these settings in your current terminal:"
echo "  source deploy-aws-setup.sh"
echo ""
