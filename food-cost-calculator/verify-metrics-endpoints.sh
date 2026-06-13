#!/bin/bash
# Verification script for Spring Boot Actuator Prometheus metrics endpoints
# This script verifies that both API and Workers services expose metrics correctly

set -e

echo "========================================="
echo "Spring Boot Actuator Metrics Verification"
echo "========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
API_URL="${API_URL:-http://localhost:8080}"
WORKERS_URL="${WORKERS_URL:-http://localhost:8081}"
TIMEOUT=5

# Function to check endpoint
check_endpoint() {
    local service_name=$1
    local url=$2
    local endpoint=$3
    
    echo -n "Checking ${service_name} ${endpoint}... "
    
    if response=$(curl -s -f -m ${TIMEOUT} "${url}${endpoint}" 2>&1); then
        echo -e "${GREEN}✓ OK${NC}"
        return 0
    else
        echo -e "${RED}✗ FAILED${NC}"
        echo "  Error: ${response}"
        return 1
    fi
}

# Function to validate Prometheus metrics format
validate_prometheus_metrics() {
    local service_name=$1
    local url=$2
    
    echo ""
    echo "Validating ${service_name} Prometheus metrics format..."
    
    if response=$(curl -s -f -m ${TIMEOUT} "${url}/actuator/prometheus" 2>&1); then
        # Check for expected metric types
        local checks_passed=0
        local checks_total=0
        
        # Check for JVM metrics
        checks_total=$((checks_total + 1))
        if echo "$response" | grep -q "jvm_memory_used_bytes"; then
            echo -e "  ${GREEN}✓${NC} JVM memory metrics present"
            checks_passed=$((checks_passed + 1))
        else
            echo -e "  ${RED}✗${NC} JVM memory metrics missing"
        fi
        
        # Check for HTTP metrics (API only)
        if [ "$service_name" = "API" ]; then
            checks_total=$((checks_total + 1))
            if echo "$response" | grep -q "http_server_requests_seconds"; then
                echo -e "  ${GREEN}✓${NC} HTTP request metrics present"
                checks_passed=$((checks_passed + 1))
            else
                echo -e "  ${RED}✗${NC} HTTP request metrics missing"
            fi
        fi
        
        # Check for HikariCP metrics
        checks_total=$((checks_total + 1))
        if echo "$response" | grep -q "hikaricp_connections"; then
            echo -e "  ${GREEN}✓${NC} Database connection pool metrics present"
            checks_passed=$((checks_passed + 1))
        else
            echo -e "  ${YELLOW}⚠${NC} Database connection pool metrics not yet initialized"
        fi
        
        # Check for Spring Boot system metrics
        checks_total=$((checks_total + 1))
        if echo "$response" | grep -q "process_cpu_usage"; then
            echo -e "  ${GREEN}✓${NC} System CPU metrics present"
            checks_passed=$((checks_passed + 1))
        else
            echo -e "  ${RED}✗${NC} System CPU metrics missing"
        fi
        
        echo ""
        echo "  Metrics validation: ${checks_passed}/${checks_total} checks passed"
        
        if [ $checks_passed -eq $checks_total ]; then
            return 0
        else
            return 1
        fi
    else
        echo -e "  ${RED}✗ Failed to fetch metrics${NC}"
        return 1
    fi
}

# Main verification flow
echo "Starting endpoint verification..."
echo ""

# API Service checks
echo "=== API Service (${API_URL}) ==="
api_health_ok=false
api_metrics_ok=false
api_prometheus_ok=false

if check_endpoint "API" "${API_URL}" "/actuator/health"; then
    api_health_ok=true
fi

if check_endpoint "API" "${API_URL}" "/actuator/metrics"; then
    api_metrics_ok=true
fi

if check_endpoint "API" "${API_URL}" "/actuator/prometheus"; then
    api_prometheus_ok=true
    validate_prometheus_metrics "API" "${API_URL}"
fi

echo ""

# Workers Service checks
echo "=== Workers Service (${WORKERS_URL}) ==="
workers_health_ok=false
workers_metrics_ok=false
workers_prometheus_ok=false

if check_endpoint "Workers" "${WORKERS_URL}" "/actuator/health"; then
    workers_health_ok=true
fi

if check_endpoint "Workers" "${WORKERS_URL}" "/actuator/metrics"; then
    workers_metrics_ok=true
fi

if check_endpoint "Workers" "${WORKERS_URL}" "/actuator/prometheus"; then
    workers_prometheus_ok=true
    validate_prometheus_metrics "Workers" "${WORKERS_URL}"
fi

echo ""
echo "========================================="
echo "Verification Summary"
echo "========================================="

# API summary
echo ""
echo "API Service:"
[ "$api_health_ok" = true ] && echo -e "  Health:     ${GREEN}✓${NC}" || echo -e "  Health:     ${RED}✗${NC}"
[ "$api_metrics_ok" = true ] && echo -e "  Metrics:    ${GREEN}✓${NC}" || echo -e "  Metrics:    ${RED}✗${NC}"
[ "$api_prometheus_ok" = true ] && echo -e "  Prometheus: ${GREEN}✓${NC}" || echo -e "  Prometheus: ${RED}✗${NC}"

# Workers summary
echo ""
echo "Workers Service:"
[ "$workers_health_ok" = true ] && echo -e "  Health:     ${GREEN}✓${NC}" || echo -e "  Health:     ${RED}✗${NC}"
[ "$workers_metrics_ok" = true ] && echo -e "  Metrics:    ${GREEN}✓${NC}" || echo -e "  Metrics:    ${RED}✗${NC}"
[ "$workers_prometheus_ok" = true ] && echo -e "  Prometheus: ${GREEN}✓${NC}" || echo -e "  Prometheus: ${RED}✗${NC}"

echo ""

# Overall result
if [ "$api_health_ok" = true ] && [ "$api_prometheus_ok" = true ] && \
   [ "$workers_health_ok" = true ] && [ "$workers_prometheus_ok" = true ]; then
    echo -e "${GREEN}✓ All endpoints verified successfully!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Deploy ServiceMonitors: kubectl apply -f infra/k8s/servicemonitor-*.yaml"
    echo "  2. Deploy CloudWatch Agent: kubectl apply -f infra/k8s/cloudwatch-prometheus-config.yaml"
    echo "  3. Verify metrics in Prometheus: kubectl port-forward -n monitoring svc/prometheus 9090:9090"
    echo "  4. Verify metrics in CloudWatch: aws cloudwatch list-metrics --namespace FoodCostCalculator"
    exit 0
else
    echo -e "${RED}✗ Some endpoints failed verification${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  - Ensure services are running: docker-compose ps"
    echo "  - Check service logs: docker-compose logs api | docker-compose logs workers"
    echo "  - Verify actuator is enabled in application.properties"
    exit 1
fi
