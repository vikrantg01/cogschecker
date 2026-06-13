#!/bin/bash
# Quick restart script for local development

echo "🔄 Restarting Food Cost Calculator..."

# Check if Docker services are running
if ! docker ps | grep -q foodcost-postgres; then
    echo "📦 Starting database services..."
    ./start-services.sh
else
    echo "✅ Database services already running"
fi

echo ""
echo "🚀 To start the application:"
echo ""
echo "  Terminal 1 (Backend):"
echo "    ./gradlew :modules:api:bootRun"
echo ""
echo "  Terminal 2 (Frontend):"
echo "    cd frontend && npm run dev"
echo ""
echo "  Then open: http://localhost:5173"
echo ""
