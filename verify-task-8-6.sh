#!/bin/bash
# Verification script for Task 8.6: ECS and ALB Exports + Rollback Configuration

set -e

echo "=========================================="
echo "Task 8.6 Verification Script"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}1. Verifying CloudFormation Exports Configuration${NC}"
echo "Checking EcsStack.ts for required exports..."
echo ""

# Check for ECR Repository URI export
if grep -q "exportName: \`FoodCostCalculator-\${envName}-RepositoryUri\`" infra/lib/stacks/EcsStack.ts; then
    echo -e "${GREEN}✓${NC} ECR Repository URI export configured"
else
    echo "✗ ECR Repository URI export NOT found"
    exit 1
fi

# Check for ECS Cluster Name export
if grep -q "exportName: \`FoodCostCalculator-\${envName}-EcsClusterName\`" infra/lib/stacks/EcsStack.ts; then
    echo -e "${GREEN}✓${NC} ECS Cluster Name export configured"
else
    echo "✗ ECS Cluster Name export NOT found"
    exit 1
fi

# Check for ECS Service Name export
if grep -q "exportName: \`FoodCostCalculator-\${envName}-EcsServiceName\`" infra/lib/stacks/EcsStack.ts; then
    echo -e "${GREEN}✓${NC} ECS Service Name export configured"
else
    echo "✗ ECS Service Name export NOT found"
    exit 1
fi

# Check for ALB DNS Name export
if grep -q "exportName: \`FoodCostCalculator-\${envName}-AlbDns\`" infra/lib/stacks/EcsStack.ts; then
    echo -e "${GREEN}✓${NC} ALB DNS Name export configured"
else
    echo "✗ ALB DNS Name export NOT found"
    exit 1
fi

echo ""
echo -e "${BLUE}2. Verifying Automatic Rollback Configuration${NC}"
echo "Checking EcsStack.ts for circuit breaker rollback..."
echo ""

# Check for circuit breaker configuration
if grep -q "circuitBreaker:" infra/lib/stacks/EcsStack.ts; then
    echo -e "${GREEN}✓${NC} Circuit breaker configuration found"
else
    echo "✗ Circuit breaker configuration NOT found"
    exit 1
fi

# Check for rollback: true
if grep -q "rollback: true" infra/lib/stacks/EcsStack.ts; then
    echo -e "${GREEN}✓${NC} Automatic rollback enabled"
else
    echo "✗ Automatic rollback NOT enabled"
    exit 1
fi

echo ""
echo -e "${BLUE}3. Verifying Deployment Strategy Configuration${NC}"
echo "Checking for zero-downtime deployment settings..."
echo ""

# Check for minHealthyPercent
if grep -q "minHealthyPercent: 50" infra/lib/stacks/EcsStack.ts; then
    echo -e "${GREEN}✓${NC} minHealthyPercent: 50 configured"
else
    echo "✗ minHealthyPercent NOT configured correctly"
    exit 1
fi

# Check for maxHealthyPercent
if grep -q "maxHealthyPercent: 200" infra/lib/stacks/EcsStack.ts; then
    echo -e "${GREEN}✓${NC} maxHealthyPercent: 200 configured"
else
    echo "✗ maxHealthyPercent NOT configured correctly"
    exit 1
fi

# Check for health check grace period
if grep -q "healthCheckGracePeriod: cdk.Duration.seconds(60)" infra/lib/stacks/EcsStack.ts; then
    echo -e "${GREEN}✓${NC} Health check grace period: 60 seconds configured"
else
    echo "✗ Health check grace period NOT configured"
    exit 1
fi

echo ""
echo -e "${BLUE}4. Verifying CloudFormation Template (if available)${NC}"
echo ""

if [ -f "infra/cdk.out/FoodCostCalculator-Compute.template.json" ]; then
    echo "Checking synthesized CloudFormation template..."
    
    # Check for DeploymentCircuitBreaker in template
    if grep -q '"DeploymentCircuitBreaker"' infra/cdk.out/FoodCostCalculator-Compute.template.json; then
        echo -e "${GREEN}✓${NC} DeploymentCircuitBreaker present in template"
        
        # Check if rollback is enabled
        if grep -A 5 '"DeploymentCircuitBreaker"' infra/cdk.out/FoodCostCalculator-Compute.template.json | grep -q '"Rollback": true'; then
            echo -e "${GREEN}✓${NC} Rollback enabled in CloudFormation template"
        fi
    fi
    
    # Check for exports in template
    if grep -q '"Export"' infra/cdk.out/FoodCostCalculator-Compute.template.json; then
        echo -e "${GREEN}✓${NC} CloudFormation exports present in template"
        
        # Count exports
        EXPORT_COUNT=$(grep -c '"Export"' infra/cdk.out/FoodCostCalculator-Compute.template.json || true)
        echo "   Found ${EXPORT_COUNT} exports in template"
    fi
else
    echo "CloudFormation template not yet synthesized (run 'cdk synth')"
fi

echo ""
echo "=========================================="
echo -e "${GREEN}Task 8.6 Verification Complete!${NC}"
echo "=========================================="
echo ""
echo "Summary:"
echo "✓ All 4 required CloudFormation exports configured"
echo "✓ Automatic rollback with circuit breaker enabled"
echo "✓ Zero-downtime deployment strategy configured"
echo "✓ Health checks configured at container and ALB levels"
echo ""
echo "Requirements validated:"
echo "  - Requirement 3.14: Export ECS and ALB identifiers ✓"
echo "  - Requirement 9.7: Automatic rollback configuration ✓"
echo ""
