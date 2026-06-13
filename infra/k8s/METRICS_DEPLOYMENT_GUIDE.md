# Metrics Deployment Guide

## Overview

This guide explains how to deploy Spring Boot Actuator metrics to CloudWatch for the Food Cost Calculator application running on Amazon EKS.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          EKS Cluster                                      │
│                                                                           │
│  ┌─────────────────┐         ┌─────────────────┐                       │
│  │  API Pod        │         │  Workers Pod     │                       │
│  │                 │         │                  │                       │
│  │  /actuator/     │         │  /actuator/      │                       │
│  │  prometheus     │         │  prometheus      │                       │
│  └────────┬────────┘         └────────┬─────────┘                       │
│           │                           │                                  │
│           │         Prometheus        │                                  │
│           └─────────────┬─────────────┘                                  │
│                         │                                                │
│                         │ scrape (30s interval)                         │
│                         ▼                                                │
│              ┌──────────────────────┐                                   │
│              │  Prometheus Server    │                                   │
│              │  (ServiceMonitor)     │                                   │
│              └──────────┬────────────┘                                   │
│                         │                                                │
│                         │ remote_write                                  │
│                         ▼                                                │
│              ┌──────────────────────┐                                   │
│              │  CloudWatch Agent     │                                   │
│              │  (DaemonSet)          │                                   │
│              └──────────┬────────────┘                                   │
└────────────────────────┼───────────────────────────────────────────────┘
                         │
                         │ publish metrics
                         ▼
                ┌────────────────────┐
                │  CloudWatch        │
                │  Custom Namespace  │
                │  FoodCostCalculator│
                └────────────────────┘
```

## Prerequisites

1. **EKS Cluster**: Running with Kubernetes 1.24+
2. **Prometheus Operator**: Installed in the cluster (for ServiceMonitor CRD)
3. **IAM Role**: Created with CloudWatch write permissions
4. **Spring Boot Services**: Deployed with Actuator endpoints exposed

## Deployment Steps

### Step 1: Verify Spring Boot Actuator Configuration

Both `api` and `workers` modules already have Actuator configured in their `application.properties`:

```properties
# Actuator endpoints
management.endpoints.web.exposure.include=health,info,metrics,prometheus
management.endpoint.health.show-details=when-authorized
management.metrics.export.prometheus.enabled=true
```

The `/actuator/prometheus` endpoint is available on port 8080 for both services.

### Step 2: Install Prometheus Operator (if not already installed)

```bash
# Add Prometheus community Helm repo
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Install Prometheus Operator
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  --set prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false
```

### Step 3: Deploy ServiceMonitors

Apply the ServiceMonitor configurations to enable Prometheus to scrape Spring Boot metrics:

```bash
# Deploy API ServiceMonitor
kubectl apply -f infra/k8s/servicemonitor-api.yaml

# Deploy Workers ServiceMonitor
kubectl apply -f infra/k8s/servicemonitor-workers.yaml

# Verify ServiceMonitors are created
kubectl get servicemonitor -n default
```

Expected output:
```
NAME                            AGE
food-cost-calculator-api        10s
food-cost-calculator-workers    10s
```

### Step 4: Create IAM Role for CloudWatch Agent

Create an IAM policy with CloudWatch write permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricData",
        "logs:PutLogEvents",
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:DescribeLogStreams"
      ],
      "Resource": "*"
    }
  ]
}
```

Create the IAM role with trust policy for IRSA:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/oidc.eks.REGION.amazonaws.com/id/CLUSTER_OIDC_ID"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.eks.REGION.amazonaws.com/id/CLUSTER_OIDC_ID:sub": "system:serviceaccount:amazon-cloudwatch:cwagent-prometheus",
          "oidc.eks.REGION.amazonaws.com/id/CLUSTER_OIDC_ID:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
```

### Step 5: Deploy CloudWatch Agent

1. Create the `amazon-cloudwatch` namespace:

```bash
kubectl create namespace amazon-cloudwatch
```

2. Update the ServiceAccount annotation in `cloudwatch-prometheus-config.yaml` with your IAM role ARN:

```yaml
annotations:
  eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT_ID:role/EKS-CloudWatchAgent-Role
```

3. Update the cluster name in the ConfigMap:

```yaml
"cluster_name": "food-cost-calculator-eks-staging",
"log_group_name": "/aws/containerinsights/food-cost-calculator-eks-staging/prometheus"
```

4. Apply the CloudWatch configuration:

```bash
kubectl apply -f infra/k8s/cloudwatch-prometheus-config.yaml
```

### Step 6: Verify Deployment

1. Check that CloudWatch Agent pods are running:

```bash
kubectl get pods -n amazon-cloudwatch
```

Expected output:
```
NAME                       READY   STATUS    RESTARTS   AGE
cwagent-prometheus-xxxxx   1/1     Running   0          30s
cwagent-prometheus-yyyyy   1/1     Running   0          30s
```

2. Check CloudWatch Agent logs:

```bash
kubectl logs -n amazon-cloudwatch -l name=cwagent-prometheus --tail=50
```

Look for successful scrape messages:
```
Successfully scraped metrics from food-cost-calculator-api
Successfully scraped metrics from food-cost-calculator-workers
```

3. Verify metrics in CloudWatch Console:

- Navigate to CloudWatch → Metrics → Custom Namespaces
- Look for `FoodCostCalculator` namespace
- Verify metrics are appearing with dimensions: `job`, `namespace`, `pod`

### Step 7: Verify Prometheus Scraping

1. Port-forward to Prometheus:

```bash
kubectl port-forward -n monitoring svc/prometheus-kube-prometheus-prometheus 9090:9090
```

2. Open http://localhost:9090 and query Spring Boot metrics:

```promql
# Check if metrics are being scraped
up{job=~"food-cost-calculator.*"}

# Query HTTP request metrics
http_server_requests_seconds_count{job="food-cost-calculator-api"}

# Query JVM memory metrics
jvm_memory_used_bytes{job="food-cost-calculator-api"}
```

## Available Metrics

### HTTP Server Metrics (API Service)

- `http_server_requests_seconds_count` - Total number of HTTP requests
- `http_server_requests_seconds_sum` - Total duration of HTTP requests
- `http_server_requests_seconds_max` - Maximum HTTP request duration
- `http_server_requests_seconds_bucket` - HTTP request duration histogram

Labels: `method`, `uri`, `status`, `outcome`

### JVM Metrics (Both Services)

- `jvm_memory_used_bytes` - JVM memory usage by area (heap, non-heap)
- `jvm_memory_max_bytes` - JVM maximum memory
- `jvm_threads_live_threads` - Number of live threads
- `jvm_gc_memory_allocated_bytes_total` - Total bytes allocated by GC
- `jvm_gc_pause_seconds_count` - GC pause count
- `jvm_gc_pause_seconds_sum` - Total GC pause time

### Database Connection Pool Metrics (Both Services)

- `hikaricp_connections_active` - Active database connections
- `hikaricp_connections_idle` - Idle database connections
- `hikaricp_connections_total` - Total database connections
- `hikaricp_connections_acquire_seconds_count` - Connection acquisition count
- `hikaricp_connections_acquire_seconds_sum` - Total connection acquisition time

### Spring Data Metrics (Both Services)

- `spring_data_repository_invocations_seconds_count` - Repository method invocation count
- `spring_data_repository_invocations_seconds_sum` - Total repository method duration

### Spring Batch Metrics (Workers Service)

- `spring_batch_job_seconds_count` - Batch job execution count
- `spring_batch_job_seconds_sum` - Total batch job duration
- `spring_batch_step_seconds_count` - Batch step execution count
- `spring_batch_step_seconds_sum` - Total batch step duration

Labels: `job_name`, `status` (COMPLETED, FAILED, STOPPED)

### Redis Metrics (Both Services)

- `lettuce_command_completion_seconds_count` - Redis command count
- `lettuce_command_completion_seconds_sum` - Total Redis command duration

Labels: `command` (GET, SET, HGET, etc.)

### SQS Metrics (Workers Service)

Custom metrics emitted by the application:

- `sqs_listener_messages_received_total` - Total messages received from SQS
- `sqs_listener_messages_processed_total` - Total messages successfully processed
- `sqs_listener_messages_failed_total` - Total messages that failed processing

Labels: `queue_name`

## CloudWatch Dashboard Configuration

The metrics published to CloudWatch are automatically integrated with the dashboards defined in `ObservabilityStack.ts`:

- **API Dashboard**: Request count, latency (p50, p90, p99), error rates
- **Workers Dashboard**: Job processing count, duration, success/failure rates
- **Database Dashboard**: Connection count, CPU utilization
- **Cache Dashboard**: Redis CPU and memory utilization

## Alerting

CloudWatch Alarms are configured in `ObservabilityStack.ts`:

1. **API p99 Latency Alarm**: Triggers when p99 latency > 2 seconds
2. **API 5xx Error Rate Alarm**: Triggers when error rate > 1%
3. **Aurora Failover Alarm**: Triggers on database failover events

## Troubleshooting

### Metrics not appearing in CloudWatch

1. Check CloudWatch Agent logs:
```bash
kubectl logs -n amazon-cloudwatch -l name=cwagent-prometheus
```

2. Verify IAM permissions on the service account role

3. Check Prometheus is scraping the endpoints:
```bash
kubectl port-forward -n monitoring svc/prometheus-kube-prometheus-prometheus 9090:9090
# Query: up{job=~"food-cost-calculator.*"}
```

### ServiceMonitor not discovering services

1. Verify service labels match ServiceMonitor selector:
```bash
kubectl get svc -n default -l app=food-cost-calculator-api -o yaml
```

2. Check Prometheus Operator logs:
```bash
kubectl logs -n monitoring -l app.kubernetes.io/name=prometheus-operator
```

### High cardinality metrics causing issues

The ServiceMonitor includes `metricRelabelings` to drop high-cardinality metrics. Add additional drop rules if needed:

```yaml
metricRelabelings:
  - sourceLabels: [__name__]
    regex: 'metric_to_drop.*'
    action: drop
```

## Alternative: Direct CloudWatch Integration

Instead of using Prometheus + CloudWatch Agent, you can configure Micrometer to publish directly to CloudWatch:

1. Add dependency to `build.gradle`:
```groovy
implementation 'io.micrometer:micrometer-registry-cloudwatch2'
```

2. Configure in `application.properties`:
```properties
management.metrics.export.cloudwatch.namespace=FoodCostCalculator
management.metrics.export.cloudwatch.step=1m
management.metrics.export.cloudwatch.enabled=true
```

**Trade-offs**:
- ✅ Simpler setup (no Prometheus/CloudWatch Agent)
- ❌ Less flexible (harder to query with PromQL)
- ❌ Higher CloudWatch costs (more API calls)
- ❌ No HistogramBuckets support (no p95/p99 from CloudWatch directly)

The Prometheus + CloudWatch Agent approach is recommended for production.

## Cost Optimization

CloudWatch custom metrics pricing:
- First 10,000 metrics: $0.30 per metric per month
- Next 240,000 metrics: $0.10 per metric per month

To reduce costs:

1. **Filter metrics**: Only publish critical metrics to CloudWatch
2. **Increase scrape interval**: Change from 30s to 60s
3. **Use metric aggregation**: Aggregate metrics at Prometheus level before forwarding
4. **Retain metrics in Prometheus**: Keep detailed metrics in Prometheus, forward aggregated metrics to CloudWatch

Example aggregation rule for Prometheus:

```yaml
rule_files:
  - /etc/prometheus/rules.yml

# rules.yml
groups:
  - name: aggregation
    interval: 60s
    rules:
      - record: api_request_rate
        expr: rate(http_server_requests_seconds_count[5m])
```

## References

- [Spring Boot Actuator Metrics](https://docs.spring.io/spring-boot/docs/current/reference/html/actuator.html#actuator.metrics)
- [Prometheus ServiceMonitor](https://github.com/prometheus-operator/prometheus-operator/blob/main/Documentation/user-guides/getting-started.md)
- [CloudWatch Container Insights](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/ContainerInsights.html)
- [CloudWatch Agent for Prometheus](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/ContainerInsights-Prometheus.html)
- [Micrometer Prometheus Registry](https://micrometer.io/docs/registry/prometheus)
