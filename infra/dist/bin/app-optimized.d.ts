#!/usr/bin/env node
/**
 * AWS CDK App - Cost-Optimized Minimal Deployment
 *
 * Modular infrastructure for Food Cost Calculator using ECS Fargate.
 * Targets $137-200/month for minimal production deployment (2 venues).
 *
 * Architecture:
 *  - ECS Fargate compute (vs EKS - saves $72/month control plane)
 *  - RDS PostgreSQL t4g.micro single-AZ (vs Aurora - saves $200-350/month)
 *  - Single NAT Gateway (vs 2 - saves $35/month)
 *  - ElastiCache Redis t4g.micro single-node
 *
 * Deployment:
 *   cdk bootstrap
 *   cdk deploy --all
 *
 * Requirements: 1.1, 1.2, 9.1
 */
import 'source-map-support/register';
