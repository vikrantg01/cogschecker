# Requirements Document

## Introduction

A cost-optimized AWS infrastructure deployment for the Food Cost Calculator SaaS application. The system deploys a Spring Boot API backend, PostgreSQL database, Redis cache, authentication service, and static React frontend using modular AWS CDK stacks adapted from existing infrastructure. The deployment targets a minimal production-ready architecture suitable for supporting 2 initial venues with a cost ceiling of approximately $137-200 per month while maintaining security and scalability for future growth.

## Glossary

- **Deployment_System**: The AWS CDK infrastructure-as-code application that provisions and manages AWS resources
- **API_Service**: The containerized Spring Boot application running on AWS ECS Fargate
- **Database_Service**: The Amazon RDS PostgreSQL instance hosting application data
- **Cache_Service**: The Amazon ElastiCache Redis instance for session storage and query caching
- **Auth_Service**: The Amazon Cognito User Pool providing authentication and OAuth integration
- **CDN_Service**: The Amazon CloudFront distribution serving the React static site
- **Network_Stack**: The CDK stack that provisions VPC, subnets, security groups, and NAT gateway
- **Compute_Stack**: The CDK stack that provisions ECS cluster, Fargate service, ALB, and ECR repository
- **Database_Stack**: The CDK stack that provisions RDS PostgreSQL instance and Secrets Manager credentials
- **Cache_Stack**: The CDK stack that provisions ElastiCache Redis cluster
- **Auth_Stack**: The CDK stack that provisions Cognito User Pool and OAuth providers
- **Storage_Stack**: The CDK stack that provisions S3 buckets for static assets and invoice uploads
- **Observability_Stack**: The CDK stack that provisions CloudWatch log groups, metrics, and alarms
- **NAT_Gateway**: AWS managed network address translation service enabling private subnet internet egress
- **ALB**: Application Load Balancer distributing incoming HTTP/HTTPS traffic across ECS tasks
- **ECS_Fargate**: AWS compute service running containers without managing EC2 instances
- **Container_Image**: Docker image containing the Spring Boot application stored in Amazon ECR
- **Task_Definition**: ECS configuration specifying container image, CPU, memory, environment variables, and secrets
- **Service_Auto_Scaling**: ECS capability to adjust task count based on CPU or memory utilization
- **Health_Check**: Periodic HTTP request to verify service availability and route traffic only to healthy targets
- **Security_Group**: AWS firewall rules controlling ingress and egress network traffic
- **IAM_Role**: AWS identity granting specific permissions to services and applications
- **Secrets_Manager**: AWS service for storing and rotating database credentials and API keys
- **CloudWatch_Logs**: AWS centralized logging service aggregating application and infrastructure logs
- **Cost_Target**: The maximum monthly AWS bill constraint for the minimal deployment phase
- **Terraform_Alternative**: Infrastructure-as-code tool excluded from this deployment in favor of AWS CDK
- **App_Runner**: AWS container service excluded from this deployment in favor of ECS Fargate
- **Aurora_Serverless**: AWS database service excluded from this deployment in favor of standard RDS PostgreSQL

---

## Requirements

### Requirement 1: Modular CDK Stack Architecture

**User Story:** As a platform engineer, I want the infrastructure organized into separate modular CDK stacks for networking, compute, database, cache, authentication, storage, and observability, so that each infrastructure layer can be deployed, updated, and debugged independently while maintaining clear dependency relationships between stacks.

#### Acceptance Criteria

1. THE Deployment_System SHALL organize infrastructure into exactly seven CDK stacks: Network_Stack, Compute_Stack, Database_Stack, Cache_Stack, Auth_Stack, Storage_Stack, and Observability_Stack.
2. THE Deployment_System SHALL define each CDK stack in a separate TypeScript file located in the `infra/lib/stacks/` directory following the naming pattern `{StackName}Stack.ts`.
3. WHEN a stack is deployed, THE Deployment_System SHALL output CloudFormation export values for all resources that subsequent stacks depend on, including VPC ID, subnet IDs, security group IDs, endpoint hostnames, and ARNs.
4. WHEN a dependent stack is deployed, THE Deployment_System SHALL consume exported values from prerequisite stacks via CloudFormation cross-stack references rather than hardcoded values.
5. THE Deployment_System SHALL enforce the following deployment order: Network_Stack first, then Database_Stack and Cache_Stack in parallel, then Auth_Stack, then Compute_Stack, then Storage_Stack, and finally Observability_Stack.
6. THE Deployment_System SHALL set removal policies to RETAIN or SNAPSHOT for stateful resources including RDS instances and S3 buckets.
7. THE Deployment_System SHALL tag all created resources with Component and CostCenter tags for cost allocation and filtering.
8. THE Deployment_System SHALL adapt existing CDK stack implementations from `infra/lib/stacks/` by modifying resource configurations for cost optimization while preserving the modular structure and interfaces.

---

### Requirement 2: Cost-Optimized Network Infrastructure

**User Story:** As a cost-conscious platform engineer, I want a VPC spanning two Availability Zones with one NAT Gateway instead of two, so that the deployment achieves high availability for application and database tiers while minimizing network egress costs.

#### Acceptance Criteria

1. THE Network_Stack SHALL create a VPC with CIDR block 10.0.0.0/16 spanning exactly 2 Availability Zones.
2. THE Network_Stack SHALL create 2 public subnets with /24 CIDR masks in separate Availability Zones for internet-facing load balancers.
3. THE Network_Stack SHALL create 2 private subnets with egress via NAT Gateway with /24 CIDR masks in separate Availability Zones for ECS Fargate tasks.
4. THE Network_Stack SHALL create 2 private isolated subnets without internet access with /24 CIDR masks in separate Availability Zones for RDS and ElastiCache.
5. THE Network_Stack SHALL create exactly 1 NAT Gateway in the first Availability Zone only, and SHALL route egress traffic from both private subnets through this single NAT Gateway.
6. THE Network_Stack SHALL create a security group for ALB that allows ingress on ports 80 and 443 from 0.0.0.0/0 and allows egress to ECS security group on port 8080.
7. THE Network_Stack SHALL create a security group for ECS tasks that allows ingress on port 8080 from ALB security group and allows all outbound traffic.
8. THE Network_Stack SHALL create a security group for RDS that allows ingress on port 5432 from ECS security group only and denies all outbound traffic.
9. THE Network_Stack SHALL create a security group for ElastiCache that allows ingress on port 6379 from ECS security group only and denies all outbound traffic.
10. THE Network_Stack SHALL export VPC ID, subnet IDs, and all security group IDs as CloudFormation outputs for consumption by dependent stacks.
11. THE Network_Stack SHALL use the existing NetworkStackOptimized.ts implementation from `infra/lib/stacks/` as the foundation.

---

### Requirement 3: ECS Fargate Compute Infrastructure

**User Story:** As a platform engineer, I want the API backend deployed on ECS Fargate instead of EKS, so that I eliminate the $72/month EKS control plane fee and pay only for the CPU and memory consumed by running tasks.

#### Acceptance Criteria

1. THE Compute_Stack SHALL create an ECS cluster with Fargate capacity provider and enable CloudWatch Container Insights.
2. THE Compute_Stack SHALL create an ECR repository for storing Container_Images with image scanning enabled and a lifecycle policy retaining the 10 most recent images.
3. THE Compute_Stack SHALL create a Fargate Task_Definition specifying 1 vCPU and 2048 MB memory.
4. THE Compute_Stack SHALL configure the Task_Definition with a container using the Container_Image from ECR tagged `latest`, exposing port 8080, and logging to CloudWatch_Logs.
5. THE Compute_Stack SHALL configure the Task_Definition with environment variables for SPRING_PROFILES_ACTIVE, DATABASE_URL, REDIS_HOST, REDIS_PORT, AWS_REGION, COGNITO_USER_POOL_ID, and COGNITO_CLIENT_ID.
6. THE Compute_Stack SHALL configure the Task_Definition to retrieve DATABASE_PASSWORD from Secrets_Manager as a secret environment variable, not a plain-text environment variable.
7. THE Compute_Stack SHALL create an IAM_Role for task execution with permissions to pull images from ECR, write logs to CloudWatch, and read secrets from Secrets_Manager.
8. THE Compute_Stack SHALL create an IAM_Role for the application task with permissions to access S3 buckets for invoice uploads and read Cognito user attributes.
9. THE Compute_Stack SHALL create a Fargate service with desired count of 1 task, deployed in private subnets with egress.
10. THE Compute_Stack SHALL configure Service_Auto_Scaling with minimum 1 task, maximum 4 tasks, CPU target utilization 70%, and memory target utilization 80%.
11. THE Compute_Stack SHALL create an internet-facing ALB in public subnets with an HTTP listener on port 80 forwarding to a target group on port 8080.
12. THE Compute_Stack SHALL configure the target group Health_Check to send GET requests to `/actuator/health` every 30 seconds with healthy threshold 2 and unhealthy threshold 3.
13. THE Compute_Stack SHALL register the Fargate service as a target of the ALB target group.
14. THE Compute_Stack SHALL export ECR repository URI, ECS cluster name, ECS service name, and ALB DNS name as CloudFormation outputs.
15. THE Compute_Stack SHALL use the existing EcsStack.ts implementation from `infra/lib/stacks/` as the foundation.

---

### Requirement 4: Single-AZ RDS PostgreSQL Database

**User Story:** As a platform engineer prioritizing cost optimization, I want a single-AZ RDS PostgreSQL t4g.micro instance instead of Multi-AZ or Aurora, so that the database cost remains under $30/month while maintaining automated backups and encryption.

#### Acceptance Criteria

1. THE Database_Stack SHALL create an RDS PostgreSQL instance using engine version 15.4 or newer.
2. THE Database_Stack SHALL configure the RDS instance with instance type db.t4g.micro providing 2 vCPUs and 1 GB memory.
3. THE Database_Stack SHALL deploy the RDS instance with Multi-AZ set to false for cost optimization.
4. THE Database_Stack SHALL allocate 20 GB of General Purpose SSD (gp3) storage with auto-scaling enabled up to 100 GB.
5. THE Database_Stack SHALL enable storage encryption at rest using AWS-managed KMS keys.
6. THE Database_Stack SHALL create a Secrets_Manager secret containing the master username `postgres` and a randomly generated 32-character password, and SHALL configure the RDS instance to use these credentials.
7. THE Database_Stack SHALL enable automated backups with 7-day retention and set the preferred backup window to 03:00-04:00 UTC.
8. THE Database_Stack SHALL create a parameter group enforcing SSL connections by setting `rds.force_ssl` to 1.
9. THE Database_Stack SHALL deploy the RDS instance in private isolated subnets with the RDS security group from Network_Stack.
10. THE Database_Stack SHALL export the RDS endpoint hostname, port, database name `foodcost`, and Secrets_Manager secret ARN as CloudFormation outputs.
11. THE Database_Stack SHALL use the existing RdsStack.ts implementation from `infra/lib/stacks/` as the foundation.

---

### Requirement 5: Single-Node ElastiCache Redis

**User Story:** As a platform engineer, I want a single-node ElastiCache Redis t4g.micro instance for session storage and query caching, so that the cache cost remains under $15/month while providing sub-millisecond read/write latency.

#### Acceptance Criteria

1. THE Cache_Stack SHALL create an ElastiCache Redis cluster using engine version 7.0 or newer.
2. THE Cache_Stack SHALL configure the cluster with node type cache.t4g.micro providing burstable performance.
3. THE Cache_Stack SHALL deploy exactly 1 cache node without replication for cost optimization.
4. THE Cache_Stack SHALL enable encryption at rest using AWS-managed KMS keys.
5. THE Cache_Stack SHALL enable encryption in transit by requiring TLS for all client connections.
6. THE Cache_Stack SHALL deploy the cache node in private isolated subnets with the Redis security group from Network_Stack.
7. THE Cache_Stack SHALL create a subnet group spanning both private isolated subnets for future multi-AZ expansion.
8. THE Cache_Stack SHALL export the Redis primary endpoint hostname as a CloudFormation output.
9. THE Cache_Stack SHALL use the existing CacheStack.ts implementation from `infra/lib/stacks/` as the foundation, modified to deploy a single node instead of a cluster.

---

### Requirement 6: Amazon Cognito Authentication

**User Story:** As a platform engineer, I want Amazon Cognito to handle user authentication and OAuth integration with Google and Apple, so that the application does not need to manage user credentials or implement OAuth flows manually.

#### Acceptance Criteria

1. THE Auth_Stack SHALL create a Cognito User Pool with email as the username attribute and email verification required.
2. THE Auth_Stack SHALL configure the User Pool password policy to require minimum 8 characters, at least one uppercase letter, one lowercase letter, and one number.
3. THE Auth_Stack SHALL configure the User Pool to issue JWT access tokens with 1-hour expiration and refresh tokens with 30-day expiration.
4. THE Auth_Stack SHALL create a User Pool client for the web application with OAuth flows for authorization code grant.
5. THE Auth_Stack SHALL configure the User Pool client with callback URLs and logout URLs for both localhost development and production CloudFront domain.
6. THE Auth_Stack SHALL create identity providers for Google OAuth and Apple Sign In, and SHALL link them to the User Pool.
7. THE Auth_Stack SHALL configure custom attributes for `custom:org_id`, `custom:venue_roles`, and `custom:tier` to store organisation and role information in JWT claims.
8. THE Auth_Stack SHALL export the User Pool ID, User Pool ARN, and User Pool client ID as CloudFormation outputs.
9. THE Auth_Stack SHALL use the existing AuthStack.ts implementation from `infra/lib/stacks/` as the foundation.

---

### Requirement 7: S3 Storage Services

**User Story:** As a platform engineer, I want S3 buckets for static assets and invoice uploads, so that the application can serve frontend files via CloudFront and store uploaded invoice files securely.

#### Acceptance Criteria

1. THE Storage_Stack SHALL create an S3 bucket for hosting the React static site with bucket name pattern `fcc-frontend` and block all public access.
2. THE Storage_Stack SHALL create an S3 bucket for invoice file uploads with bucket name pattern `fcc-invoices`, block all public access, and enable encryption at rest using AWS-managed keys.
3. THE Storage_Stack SHALL configure the invoice bucket with a lifecycle policy transitioning objects to Glacier after 90 days.
4. THE Storage_Stack SHALL export both S3 bucket names and ARNs as CloudFormation outputs.
5. THE Storage_Stack SHALL use the existing StorageStack.ts implementation from `infra/lib/stacks/` as the foundation.

---

### Requirement 8: CloudWatch Observability

**User Story:** As a platform engineer and application developer, I want centralized CloudWatch logs, metrics, and alarms for the ECS service, RDS database, and Redis cache, so that I can monitor application health, troubleshoot errors, and receive alerts for critical issues.

#### Acceptance Criteria

1. THE Observability_Stack SHALL create a CloudWatch log group for ECS task logs with name pattern `/ecs/foodcost-api` and 7-day retention.
2. THE Observability_Stack SHALL create CloudWatch alarms for ECS service CPU utilization exceeding 85% for 2 consecutive periods of 5 minutes.
3. THE Observability_Stack SHALL create CloudWatch alarms for ECS service memory utilization exceeding 90% for 2 consecutive periods of 5 minutes.
4. THE Observability_Stack SHALL create CloudWatch alarms for RDS database CPU utilization exceeding 80% for 2 consecutive periods of 5 minutes.
5. THE Observability_Stack SHALL create CloudWatch alarms for RDS database free storage space dropping below 2 GB.
6. THE Observability_Stack SHALL create CloudWatch alarms for ALB target group unhealthy host count exceeding 0 for 2 consecutive periods of 1 minute.
7. THE Observability_Stack SHALL create CloudWatch alarms for ALB HTTP 5xx error rate exceeding 5% over a 5-minute period.
8. THE Observability_Stack SHALL configure all CloudWatch alarms to send notifications to an SNS topic with email subscription for the platform team.
9. THE Observability_Stack SHALL export the CloudWatch log group name and SNS topic ARN as CloudFormation outputs.
10. THE Observability_Stack SHALL use the existing ObservabilityStack.ts implementation from `infra/lib/stacks/` as the foundation, adapted for ECS instead of EKS.

### Requirement 9: Deployment Automation and Repeatability

**User Story:** As a platform engineer, I want to deploy the entire infrastructure with a single CDK command and verify the deployment health automatically, so that the deployment process is repeatable, auditable, and fast.

#### Acceptance Criteria

1. THE Deployment_System SHALL provide a CDK app entry point at `infra/bin/app-optimized.ts` that instantiates all seven stacks with correct dependency relationships.
2. THE Deployment_System SHALL allow the entire infrastructure to be deployed from a clean AWS account using the command `cdk bootstrap` followed by `cdk deploy --all`.
3. WHEN all stacks are deployed, THE Deployment_System SHALL verify that the ALB health check returns HTTP 200 from the `/actuator/health` endpoint within 5 minutes of deployment completion.
4. THE Deployment_System SHALL provide a CloudFormation output with the full ALB URL in the format `http://{alb-dns-name}` for immediate testing.
5. THE Deployment_System SHALL allow incremental updates by running `cdk diff --all` to preview changes before applying them with `cdk deploy`.
6. THE Deployment_System SHALL support zero-downtime updates for ECS service changes by using rolling deployment strategy with minimum healthy percent 50 and maximum healthy percent 200.
7. THE Deployment_System SHALL fail deployment and roll back automatically if Health_Check fails after a service update, preserving the previous task version.
8. THE Deployment_System SHALL output a deployment summary showing stack names, deployment time, and status (success or rollback) for each stack.

---

### Requirement 10: Cost Monitoring and Budget Compliance

**User Story:** As a cost-conscious platform engineer, I want to track monthly AWS spending and ensure it stays within the $137-200 target, so that I can maintain a predictable cost structure while supporting 2 initial venues.

#### Acceptance Criteria

1. THE Deployment_System SHALL export a CloudFormation output listing all major resource types and their estimated monthly costs based on the minimal deployment configuration.
2. THE Deployment_System SHALL deploy with configurations that keep total monthly cost below $200: single-AZ RDS t4g.micro, single Redis node t4g.micro, 1 NAT Gateway, ECS Fargate with 1 task, and 7-day log retention.
3. THE Deployment_System SHALL create an AWS Budget with a monthly limit of $200 and alert thresholds at 80% ($160) and 100% ($200) of the budget.
4. THE Deployment_System SHALL configure the AWS Budget to send email notifications to the platform team when spending exceeds alert thresholds.
5. THE Deployment_System SHALL include cost allocation tags on all resources to enable filtering by Component in AWS Cost Explorer.
6. THE Deployment_System SHALL document the cost breakdown by service category in a CloudFormation output: Compute (ECS Fargate + ALB), Database (RDS), Cache (ElastiCache), Network (NAT Gateway, data transfer), Storage (S3), Observability (CloudWatch Logs).

---

### Requirement 11: Security Hardening

**User Story:** As a security-conscious platform engineer, I want all network traffic encrypted in transit, all data encrypted at rest, and least-privilege IAM policies applied to all services, so that the deployment meets industry security standards without additional manual configuration.

#### Acceptance Criteria

1. THE Deployment_System SHALL enforce TLS encryption for all network communication: ALB to ECS over HTTP within VPC (TLS termination at ALB when HTTPS is configured), ECS to RDS using SSL enforced by parameter group, and ECS to Redis using TLS.
2. THE Deployment_System SHALL enable encryption at rest for all stateful resources: RDS storage using AWS-managed KMS keys, ElastiCache using AWS-managed KMS keys, S3 buckets using AWS-managed KMS keys, and EBS volumes for Fargate tasks using default encryption.
3. THE Deployment_System SHALL apply least-privilege IAM policies: ECS task execution role with access only to ECR, CloudWatch Logs, and Secrets_Manager for the specific secret ARN; ECS task role with access only to specific S3 buckets and Cognito APIs required by the application.
4. THE Deployment_System SHALL block all public access to RDS and ElastiCache by deploying them in private isolated subnets with security groups allowing access only from ECS security group.
5. THE Deployment_System SHALL block all public access to S3 buckets and rely on CloudFront Origin Access Identity for frontend bucket access and signed URLs for invoice bucket access.
6. THE Deployment_System SHALL enable CloudTrail logging for all API calls to track infrastructure changes and access patterns.
7. THE Deployment_System SHALL enable VPC Flow Logs for the VPC to capture all network traffic metadata for security auditing.
8. THE Deployment_System SHALL configure ALB access logs to an S3 bucket for request-level visibility.
9. THE Deployment_System SHALL disable SSH and RDP access to all compute resources by design (Fargate tasks have no SSH access).

---

### Requirement 12: Documentation and Runbook

**User Story:** As a platform engineer onboarding to this infrastructure, I want comprehensive documentation covering deployment steps, troubleshooting procedures, cost breakdown, and rollback instructions, so that I can operate the infrastructure confidently without prior AWS CDK experience.

#### Acceptance Criteria

1. THE Deployment_System SHALL include a README.md file in the `infra/` directory with sections for Prerequisites, Deployment Steps, Stack Descriptions, and Troubleshooting.
2. THE README.md SHALL list all prerequisites: AWS CLI installed and configured, Node.js 18+ installed, AWS CDK CLI installed globally, Docker installed for building Container_Images, and an AWS account with admin permissions.
3. THE README.md SHALL document the deployment command sequence: `npm install`, `cdk bootstrap`, `cdk deploy --all`, and verification steps to confirm ALB health.
4. THE README.md SHALL document the rollback procedure: `cdk deploy {StackName} --rollback` to revert a failed stack update.
5. THE README.md SHALL include a cost breakdown table showing per-service monthly costs.
6. THE README.md SHALL include a troubleshooting section with common deployment errors: ECR authentication failure, health check timeout, secret access denied, and RDS connection refused, along with diagnostic commands and solutions.
7. THE README.md SHALL document how to view CloudWatch logs for ECS tasks using the AWS CLI command `aws logs tail /ecs/foodcost-api --follow`.
8. THE README.md SHALL document how to manually trigger an ECS service deployment using `aws ecs update-service --cluster {cluster-name} --service {service-name} --force-new-deployment`.
9. THE README.md SHALL include a diagram of the deployed architecture showing VPC, subnets, security groups, ECS, RDS, Redis, ALB, and CloudFront.

---

## Summary

This requirements document defines the infrastructure for a cost-optimized AWS deployment of the Food Cost Calculator using modular CDK stacks, ECS Fargate compute, single-AZ RDS PostgreSQL, single-node ElastiCache Redis, Amazon Cognito authentication, and supporting services for storage and observability. The deployment targets a cost ceiling of $137-200/month while maintaining security, automated deployment, and readiness for future scaling.
