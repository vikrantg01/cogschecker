# Implementation Plan: AWS Minimal Deployment

## Overview

This implementation plan converts the modular AWS CDK infrastructure design into a series of coding tasks. The deployment creates seven CDK stacks (Network, Database, Cache, Auth, Compute, Storage, Observability) that provision a cost-optimized AWS infrastructure for the Food Cost Calculator, targeting $137-200/month while maintaining production-readiness.

The implementation strategy follows a bottom-up approach: networking foundation first, then data and auth services, followed by compute layer, and finally observability and supporting services. Each stack is implemented as an independent TypeScript file with clear CloudFormation exports for cross-stack references. This simplified architecture removes environment switching logic and focuses on a single deployment configuration.

## Tasks

- [x] 1. Set up CDK project structure and configuration
  - Create CDK app entry point at `infra/bin/app-optimized.ts`
  - Configure `infra/cdk.json` with CDK configuration (no environment context needed)
  - Set up TypeScript compilation configuration in `infra/tsconfig.json`
  - Create `infra/lib/stacks/` directory for stack implementations
  - Install CDK dependencies: `@aws-cdk/aws-ec2`, `@aws-cdk/aws-ecs`, `@aws-cdk/aws-rds`, `@aws-cdk/aws-elasticache`, `@aws-cdk/aws-cognito`, etc.
  - _Requirements: 1.1, 1.2, 9.1_

- [x] 2. Implement NetworkStackOptimized for VPC and security groups
  - [x] 2.1 Create NetworkStackOptimized.ts with VPC configuration
    - Define VPC with CIDR 10.0.0.0/16 spanning 2 Availability Zones
    - Create 2 public subnets (/24 masks) for ALB
    - Create 2 private subnets with NAT egress (/24 masks) for ECS tasks
    - Create 2 private isolated subnets (/24 masks) for RDS and Redis
    - Deploy exactly 1 NAT Gateway in first AZ with route configuration for both private subnets
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  
  - [x] 2.2 Create security groups for all tiers
    - ALB security group: allow ports 80/443 from 0.0.0.0/0, egress to ECS on 8080
    - ECS security group: allow port 8080 from ALB, all outbound
    - RDS security group: allow port 5432 from ECS only, no outbound
    - Redis security group: allow port 6379 from ECS only, no outbound
    - _Requirements: 2.6, 2.7, 2.8, 2.9_
  
  - [x] 2.3 Export VPC and security group identifiers
    - Export VPC ID, public subnet IDs, private subnet IDs, isolated subnet IDs
    - Export all four security group IDs with naming pattern `FoodCostCalculator-*`
    - Apply Component and CostCenter tags to all resources
    - _Requirements: 2.10, 1.7_

- [~] 3. Checkpoint - Verify network stack synthesis
  - Ensure CDK synth succeeds for NetworkStackOptimized
  - Verify CloudFormation template includes exactly 1 NAT Gateway
  - Verify all resources have required tags
  - Ask the user if questions arise

- [ ] 4. Implement DatabaseStack for RDS PostgreSQL
  - [~] 4.1 Create RdsStack.ts with PostgreSQL configuration
    - Configure RDS PostgreSQL 15.4+ instance with db.t4g.micro instance type
    - Set Multi-AZ to false for single-AZ cost optimization
    - Allocate 20 GB gp3 storage with auto-scaling to 100 GB
    - Enable storage encryption using AWS-managed KMS keys
    - Deploy in private isolated subnets with RDS security group
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  
  - [~] 4.2 Configure database credentials and security
    - Create Secrets Manager secret with username 'postgres' and 32-character random password
    - Create parameter group with rds.force_ssl=1 to enforce SSL connections
    - Enable automated backups with 7-day retention, backup window 03:00-04:00 UTC
    - _Requirements: 4.6, 4.7, 4.8_
  
  - [~] 4.3 Export database connection details
    - Export RDS endpoint hostname, port 5432, database name 'foodcost'
    - Export Secrets Manager secret ARN
    - Apply RETAIN removal policy to prevent accidental data loss
    - _Requirements: 4.10, 1.6_

- [ ] 5. Implement CacheStack for ElastiCache Redis
  - [~] 5.1 Create CacheStack.ts with Redis configuration
    - Configure ElastiCache Redis 7.0+ with cache.t4g.micro node type
    - Deploy single cache node (no replication) for cost optimization
    - Create subnet group spanning both private isolated subnets
    - Enable encryption at rest using AWS-managed KMS keys
    - Enable encryption in transit with TLS requirement
    - Deploy in private isolated subnets with Redis security group
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  
  - [~] 5.2 Export Redis endpoint
    - Export primary endpoint hostname
    - Apply Component and CostCenter tags
    - _Requirements: 5.8_

- [ ] 6. Implement AuthStack for Amazon Cognito
  - [~] 6.1 Create AuthStack.ts with User Pool configuration
    - Create Cognito User Pool with email as username attribute
    - Configure email verification requirement
    - Set password policy: min 8 chars, uppercase, lowercase, number
    - Configure JWT expiration: 1-hour access tokens, 30-day refresh tokens
    - _Requirements: 6.1, 6.2, 6.3_
  
  - [~] 6.2 Configure OAuth and custom attributes
    - Create User Pool client with authorization code grant flow
    - Configure callback and logout URLs for localhost and production domain
    - Create identity providers for Google OAuth and Apple Sign In
    - Add custom attributes: custom:org_id, custom:venue_roles, custom:tier
    - _Requirements: 6.4, 6.5, 6.6, 6.7_
  
  - [~] 6.3 Export Cognito identifiers
    - Export User Pool ID, User Pool ARN, User Pool client ID
    - _Requirements: 6.8_

- [~] 7. Checkpoint - Verify data and auth stacks
  - Ensure all four stacks (Network, Database, Cache, Auth) synthesize successfully
  - Verify cross-stack references use Fn::ImportValue
  - Verify single-AZ RDS and RETAIN removal policies
  - Ask the user if questions arise

- [ ] 8. Implement ComputeStack for ECS Fargate
  - [~] 8.1 Create EcsStack.ts with ECS cluster and ECR repository
    - Create ECS cluster with Fargate capacity provider
    - Enable CloudWatch Container Insights
    - Create ECR repository with image scanning enabled
    - Configure lifecycle policy to retain last 10 images
    - _Requirements: 3.1, 3.2_
  
  - [~] 8.2 Create Fargate task definition
    - Configure task with 1 vCPU (1024) and 2048 MB memory
    - Configure container with ECR image tagged 'latest', port 8080
    - Set up environment variables: SPRING_PROFILES_ACTIVE, DATABASE_URL, REDIS_HOST, REDIS_PORT, AWS_REGION, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID
    - Configure secret environment variable for DATABASE_PASSWORD from Secrets Manager
    - Set up CloudWatch Logs with log group `/ecs/foodcost-api`
    - _Requirements: 3.3, 3.4, 3.5, 3.6_
  
  - [~] 8.3 Create IAM roles for ECS tasks
    - Create task execution role with permissions: ECR pull, CloudWatch Logs write, Secrets Manager read
    - Create task role with permissions: S3 access (invoice bucket), Cognito user attribute read
    - Apply least-privilege policies with specific resource ARNs
    - _Requirements: 3.7, 3.8, 11.3_
  
  - [~] 8.4 Create Fargate service with auto-scaling
    - Deploy service with desired count of 1 task
    - Deploy in private subnets with NAT egress using ECS security group
    - Configure auto-scaling: min 1, max 4, CPU target 70%, memory target 80%
    - Set deployment configuration: minHealthyPercent 50, maxHealthyPercent 200
    - _Requirements: 3.9, 3.10, 9.6_
  
  - [~] 8.5 Create Application Load Balancer and target group
    - Create internet-facing ALB in public subnets
    - Create HTTP listener on port 80 forwarding to target group on port 8080
    - Configure target group health check: GET /actuator/health, 30s interval, healthy threshold 2, unhealthy threshold 3
    - Register Fargate service as ALB target
    - _Requirements: 3.11, 3.12, 3.13_
  
  - [~] 8.6 Export ECS and ALB identifiers
    - Export ECR repository URI, ECS cluster name, ECS service name, ALB DNS name
    - Configure automatic rollback if health checks fail after deployment
    - _Requirements: 3.14, 9.7_

- [ ] 9. Implement StorageStack for S3 buckets
  - [~] 9.1 Create StorageStack.ts with S3 bucket configurations
    - Create frontend bucket: `fcc-frontend`, block public access, SSE-S3 encryption
    - Create invoice bucket: `fcc-invoices`, block public access, SSE-S3 encryption
    - Configure invoice bucket lifecycle policy: transition to Glacier after 90 days
    - Apply RETAIN removal policy to prevent accidental data loss
    - _Requirements: 7.1, 7.2, 7.3, 1.6_
  
  - [~] 9.2 Export S3 bucket identifiers
    - Export both bucket names and ARNs
    - _Requirements: 7.4_

- [~] 10. Checkpoint - Verify compute and supporting services
  - Ensure ComputeStack and StorageStack synthesize successfully
  - Verify IAM policies follow least-privilege principle
  - Verify cross-stack references to Network, Database, Cache, and Auth stacks
  - Ask the user if questions arise

- [ ] 11. Implement ObservabilityStack for CloudWatch monitoring
  - [~] 11.1 Create ObservabilityStack.ts with log groups and SNS topic
    - Create CloudWatch log group `/ecs/foodcost-api` with 7-day retention
    - Create SNS topic for alarm notifications with email subscription
    - _Requirements: 8.1, 8.8_
  
  - [~] 11.2 Create CloudWatch alarms for ECS service
    - ECS CPU utilization alarm: > 85% for 2 periods of 5 minutes
    - ECS memory utilization alarm: > 90% for 2 periods of 5 minutes
    - _Requirements: 8.2, 8.3_
  
  - [~] 11.3 Create CloudWatch alarms for RDS database
    - RDS CPU utilization alarm: > 80% for 2 periods of 5 minutes
    - RDS free storage space alarm: < 2 GB
    - _Requirements: 8.4, 8.5_
  
  - [~] 11.4 Create CloudWatch alarms for ALB
    - ALB unhealthy host count alarm: > 0 for 2 periods of 1 minute
    - ALB HTTP 5xx error rate alarm: > 5% over 5-minute period
    - _Requirements: 8.6, 8.7_
  
  - [~] 11.5 Export observability identifiers
    - Export log group name and SNS topic ARN
    - _Requirements: 8.9_

- [ ] 12. Implement cost monitoring with AWS Budgets
  - [~] 12.1 Add budget configuration to ObservabilityStack or separate BudgetStack
    - Create AWS Budget with $200 monthly limit
    - Configure alert thresholds at 80% ($160) and 100% ($200)
    - Set up email notifications to platform team
    - _Requirements: 10.3, 10.4_
  
  - [~] 12.2 Add cost breakdown output
    - Create CloudFormation output with estimated monthly costs by service category
    - Include cost allocation for: Compute, Database, Cache, Network, Storage, Observability
    - _Requirements: 10.1, 10.6_

- [ ] 13. Implement CDK app entry point with stack orchestration
  - [~] 13.1 Create app-optimized.ts without environment context
    - Remove environment parameter and context handling logic
    - Define single deployment configuration
    - _Requirements: 9.1, 9.2_
  
  - [~] 13.2 Instantiate all stacks with dependency order
    - Instantiate NetworkStackOptimized first
    - Instantiate DatabaseStack, CacheStack, AuthStack (depend on Network)
    - Instantiate ComputeStack (depends on Network, Database, Cache, Auth)
    - Instantiate StorageStack (independent)
    - Instantiate ObservabilityStack last (depends on Compute)
    - Pass configuration and cross-stack references
    - _Requirements: 1.5, 9.2_
  
  - [~] 13.3 Configure stack naming and tagging
    - Apply stack name pattern: `FoodCostCalculator-{Component}`
    - Apply resource name pattern: `foodcost-{component}` or `fcc-{component}`
    - Ensure all resources receive Component and CostCenter tags
    - _Requirements: 1.7, 10.5_

- [ ] 14. Implement security hardening across all stacks
  - [~] 14.1 Verify encryption configurations
    - Audit RDS encryption at rest (AWS-managed KMS)
    - Audit ElastiCache encryption at rest and in transit (TLS)
    - Audit S3 bucket encryption (SSE-S3)
    - Audit ECS task EBS volumes (default encryption)
    - _Requirements: 11.2, 11.1_
  
  - [~] 14.2 Verify network security configurations
    - Audit security group rules for least-privilege access
    - Verify RDS and Redis in private isolated subnets with no internet routing
    - Verify S3 buckets block all public access
    - _Requirements: 11.4, 11.5_
  
  - [~] 14.3 Add VPC Flow Logs and CloudTrail
    - Enable VPC Flow Logs for network traffic metadata
    - Document CloudTrail requirement (account-level, not stack-specific)
    - Add ALB access logs to S3 bucket
    - _Requirements: 11.7, 11.6, 11.8_

- [~] 15. Checkpoint - Final stack verification
  - Ensure all seven stacks synthesize successfully
  - Verify CloudFormation templates include all required resources
  - Verify cross-stack exports and imports are correct
  - Verify security configurations meet requirements
  - Ask the user if questions arise

- [ ] 16. Create deployment documentation
  - [~] 16.1 Write infra/README.md with deployment guide
    - Document prerequisites: AWS CLI, Node.js 18+, CDK CLI, Docker, AWS account
    - Document deployment command sequence: npm install, cdk bootstrap, cdk deploy
    - Document verification steps for ALB health check
    - _Requirements: 12.1, 12.2, 12.3_
  
  - [~] 16.2 Add troubleshooting section
    - Document common deployment errors and solutions
    - Include diagnostic commands for viewing CloudWatch logs
    - Document ECS service force deployment command
    - _Requirements: 12.6, 12.7, 12.8_
  
  - [~] 16.3 Add cost breakdown and rollback procedures
    - Document cost breakdown table
    - Document rollback procedure using CDK and CloudFormation
    - Include architecture diagram (text or link to external diagram)
    - _Requirements: 12.5, 12.4, 12.9_

- [ ] 17. Write CDK synthesis tests
  - [ ] 17.1 Create test suite for NetworkStackOptimized
    - Test: Verify exactly 1 NAT Gateway created
    - Test: Verify 4 security groups created with correct rules
    - Test: Verify all resources have required tags
    - Test: Verify CloudFormation exports are present
  
  - [ ] 17.2 Create test suite for DatabaseStack
    - Test: Verify RDS instance type is db.t4g.micro
    - Test: Verify Multi-AZ is set to false for single-AZ deployment
    - Test: Verify storage encryption enabled
    - Test: Verify Secrets Manager secret created
  
  - [ ] 17.3 Create test suite for ComputeStack
    - Test: Verify Fargate task definition has 1 vCPU and 2048 MB memory
    - Test: Verify IAM policies follow least-privilege (no wildcard resources except GetAuthorizationToken)
    - Test: Verify auto-scaling configuration matches requirements
    - Test: Verify health check configured on /actuator/health
  
  - [ ] 17.4 Create property-based test for universal properties
    - Test: All resources follow naming convention pattern
    - Test: All resources have Component and CostCenter tags
    - Test: All stateful resources have encryption enabled
    - Test: All IAM roles have least-privilege policies

- [~] 18. Final integration verification
  - Run `cdk synth --all` to generate all templates
  - Verify no CloudFormation errors or warnings
  - Review generated templates for security and cost optimization
  - Document deployment status and readiness

## Notes

- Tasks marked with `*` are optional test tasks that can be skipped for faster deployment
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation before proceeding to dependent components
- The implementation builds from infrastructure foundation (Network) to application layer (Compute) to observability
- CDK synthesis tests validate configuration before actual AWS deployment
- The design uses TypeScript for CDK infrastructure definitions
- All stacks are modular and can be deployed, updated, and debugged independently
- No environment context switching - single deployment configuration
- Security hardening is applied throughout with encryption, least-privilege IAM, and network isolation
- SQS messaging has been removed from this simplified architecture

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3"] },
    { "id": 3, "tasks": ["4.1", "4.2", "5.1"] },
    { "id": 4, "tasks": ["4.3", "5.2", "6.1", "6.2"] },
    { "id": 5, "tasks": ["6.3", "8.1", "8.2", "8.3"] },
    { "id": 6, "tasks": ["8.4", "8.5", "9.1"] },
    { "id": 7, "tasks": ["8.6", "9.2", "11.1", "11.2", "11.3", "11.4"] },
    { "id": 8, "tasks": ["11.5", "12.1"] },
    { "id": 9, "tasks": ["12.2", "13.1"] },
    { "id": 10, "tasks": ["13.2"] },
    { "id": 11, "tasks": ["13.3", "14.1", "14.2"] },
    { "id": 12, "tasks": ["14.3"] },
    { "id": 13, "tasks": ["16.1", "16.2"] },
    { "id": 14, "tasks": ["16.3", "17.1", "17.2", "17.3", "17.4"] },
    { "id": 15, "tasks": ["18"] }
  ]
}
```
