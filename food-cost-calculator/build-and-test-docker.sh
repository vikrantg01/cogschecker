#!/bin/bash
# Build and test Docker image locally before pushing to AWS

set -e  # Exit on error

echo "🏗️  Building Spring Boot application..."
./gradlew :modules:api:clean :modules:api:bootJar

echo "📦 Building Docker image..."
docker build -t food-cost-calculator-api:latest -f Dockerfile.api .

echo "🔍 Checking image size..."
docker images food-cost-calculator-api:latest

echo "🧪 Testing Docker image locally..."
docker run -d --name foodcost-api-test \
  -p 8080:8080 \
  -e DATABASE_URL=jdbc:postgresql://host.docker.internal:5432/foodcost \
  -e DATABASE_USERNAME=postgres \
  -e DATABASE_PASSWORD=postgres \
  -e REDIS_HOST=host.docker.internal \
  -e REDIS_PORT=6379 \
  food-cost-calculator-api:latest

echo "⏳ Waiting for application to start..."
sleep 10

echo "🏥 Checking health endpoint..."
if curl -f http://localhost:8080/actuator/health; then
  echo "✅ Health check passed!"
else
  echo "❌ Health check failed!"
  docker logs foodcost-api-test
  docker stop foodcost-api-test
  docker rm foodcost-api-test
  exit 1
fi

echo "🧹 Cleaning up test container..."
docker stop foodcost-api-test
docker rm foodcost-api-test

echo ""
echo "✅ Docker image is ready for AWS deployment!"
echo ""
echo "Next steps:"
echo "1. Tag image:   docker tag food-cost-calculator-api:latest <ECR-URL>/food-cost-calculator:latest"
echo "2. Push to ECR: docker push <ECR-URL>/food-cost-calculator:latest"
echo "3. Update ECS:  aws ecs update-service --cluster <cluster> --service <service> --force-new-deployment"
