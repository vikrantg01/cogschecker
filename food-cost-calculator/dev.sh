#!/bin/bash
# Easy development script using Docker Compose

COMMAND=${1:-help}

case "$COMMAND" in
  start)
    echo "🚀 Starting services with Docker Compose..."
    docker-compose up -d
    echo ""
    echo "✅ Services started!"
    echo ""
    echo "📊 Service Status:"
    docker-compose ps
    echo ""
    echo "Next steps:"
    echo "  1. Start backend:  ./gradlew :modules:api:bootRun"
    echo "  2. Start frontend: cd frontend && npm run dev"
    echo "  3. Open: http://localhost:5173"
    ;;
    
  stop)
    echo "🛑 Stopping services..."
    docker-compose stop
    echo "✅ Services stopped (data is preserved)"
    ;;
    
  restart)
    echo "🔄 Restarting services..."
    docker-compose restart
    echo "✅ Services restarted"
    ;;
    
  down)
    echo "⚠️  Stopping and removing containers (data volumes are kept)..."
    docker-compose down
    echo "✅ Containers removed (volumes preserved)"
    ;;
    
  logs)
    SERVICE=${2:-}
    if [ -z "$SERVICE" ]; then
      docker-compose logs -f
    else
      docker-compose logs -f "$SERVICE"
    fi
    ;;
    
  ps|status)
    echo "📊 Service Status:"
    docker-compose ps
    ;;
    
  backup)
    BACKUP_FILE="backup_$(date +%Y%m%d_%H%M%S).sql"
    echo "💾 Creating backup: $BACKUP_FILE"
    docker exec foodcost-postgres pg_dump -U postgres foodcost > "$BACKUP_FILE"
    echo "✅ Backup created: $BACKUP_FILE ($(wc -l < "$BACKUP_FILE") lines)"
    ;;
    
  restore)
    BACKUP_FILE=${2:-}
    if [ -z "$BACKUP_FILE" ]; then
      echo "❌ Please specify backup file: ./dev.sh restore backup.sql"
      exit 1
    fi
    if [ ! -f "$BACKUP_FILE" ]; then
      echo "❌ Backup file not found: $BACKUP_FILE"
      exit 1
    fi
    echo "📥 Restoring from: $BACKUP_FILE"
    docker exec -i foodcost-postgres psql -U postgres foodcost < "$BACKUP_FILE"
    echo "✅ Database restored"
    ;;
    
  clean)
    echo "🧹 Cleaning up old data (⚠️  THIS WILL DELETE YOUR DATA!)..."
    read -p "Are you sure? Type 'yes' to confirm: " confirm
    if [ "$confirm" = "yes" ]; then
      docker-compose down -v
      echo "✅ All data cleaned"
    else
      echo "❌ Cancelled"
    fi
    ;;
    
  help|*)
    echo "Food Cost Calculator - Development Helper"
    echo ""
    echo "Usage: ./dev.sh <command>"
    echo ""
    echo "Commands:"
    echo "  start    - Start PostgreSQL and Redis with Docker Compose"
    echo "  stop     - Stop services (data is preserved)"
    echo "  restart  - Restart services"
    echo "  down     - Stop and remove containers (volumes kept)"
    echo "  logs     - View logs (optional: specify service name)"
    echo "  status   - Show service status"
    echo "  backup   - Create database backup"
    echo "  restore  - Restore from backup file"
    echo "  clean    - Remove all data (⚠️  destructive!)"
    echo "  help     - Show this message"
    echo ""
    echo "Examples:"
    echo "  ./dev.sh start              # Start all services"
    echo "  ./dev.sh logs postgres      # View PostgreSQL logs"
    echo "  ./dev.sh backup             # Create backup"
    echo "  ./dev.sh restore backup.sql # Restore from backup"
    echo ""
    ;;
esac
