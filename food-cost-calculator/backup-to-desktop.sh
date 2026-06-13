#!/bin/bash
# Automatic backup script - saves to Desktop with timestamp

BACKUP_DIR="$HOME/Desktop/FoodCostBackups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="foodcost_backup_${TIMESTAMP}.sql"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "🔄 Creating backup..."
docker exec foodcost-postgres pg_dump -U postgres foodcost > "$BACKUP_DIR/$BACKUP_FILE"

if [ $? -eq 0 ]; then
    LINES=$(wc -l < "$BACKUP_DIR/$BACKUP_FILE")
    SIZE=$(ls -lh "$BACKUP_DIR/$BACKUP_FILE" | awk '{print $5}')
    echo "✅ Backup successful!"
    echo "   File: $BACKUP_FILE"
    echo "   Location: $BACKUP_DIR"
    echo "   Size: $SIZE ($LINES lines)"
    echo ""
    echo "Recent backups:"
    ls -lht "$BACKUP_DIR" | head -6
else
    echo "❌ Backup failed!"
    exit 1
fi
