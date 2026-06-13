#!/bin/bash

echo "========================================="
echo "Food Cost Calculator - Service Startup"
echo "========================================="
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running!"
    echo ""
    echo "Please start Docker Desktop and try again."
    echo "On macOS: Open Docker Desktop from Applications"
    echo ""
    exit 1
fi

echo "✅ Docker is running"
echo ""

# Start PostgreSQL
echo "Starting PostgreSQL..."
if docker ps -a | grep -q foodcost-postgres; then
    docker start foodcost-postgres
    echo "✅ PostgreSQL container started"
else
    docker run -d \
      --name foodcost-postgres \
      -e POSTGRES_DB=foodcost \
      -e POSTGRES_USER=postgres \
      -e POSTGRES_PASSWORD=postgres \
      -p 5432:5432 \
      -v foodcost-postgres-data:/var/lib/postgresql/data \
      postgres:15-alpine
    echo "✅ PostgreSQL container created and started"
    echo "   Data volume: foodcost-postgres-data"
fi

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to be ready..."
sleep 3

# Start Redis
echo "Starting Redis..."
if docker ps -a | grep -q foodcost-redis; then
    docker start foodcost-redis
    echo "✅ Redis container started"
else
    docker run -d \
      --name foodcost-redis \
      -p 6379:6379 \
      redis:7-alpine
    echo "✅ Redis container created and started"
fi

echo ""
echo "========================================="
echo "✅ All services started successfully!"
echo "========================================="
echo ""
echo "PostgreSQL: localhost:5432 (user: postgres, password: postgres, db: foodcost)"
echo "Redis: localhost:6379"
echo ""
echo "Next steps:"
echo "1. Start the backend API:"
echo "   ./gradlew :modules:api:bootRun"
echo ""
echo "2. In a new terminal, start the frontend:"
echo "   cd frontend && npm install && npm run dev"
echo ""
echo "3. Open http://localhost:5173 in your browser"
echo ""
