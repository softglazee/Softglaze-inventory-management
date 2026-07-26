#!/usr/bin/env bash
# Dump the SoftGlaze database to a timestamped gzip in /var/backups/softglaze.
# Used by update.sh and by the daily cron (see deploy/README.md step 6).
set -euo pipefail

DB_NAME="${SOFTGLAZE_DB:-softglaze}"
DB_USER="${SOFTGLAZE_DB_USER:-softglaze}"
OUT_DIR="/var/backups/softglaze"
KEEP_DAYS="${SOFTGLAZE_BACKUP_KEEP_DAYS:-30}"

mkdir -p "$OUT_DIR"
STAMP="$(date +%F_%H%M)"
FILE="$OUT_DIR/softglaze-$STAMP.sql.gz"

pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$FILE"
echo "Backup written: $FILE ($(du -h "$FILE" | cut -f1))"

# Prune old backups
find "$OUT_DIR" -name 'softglaze-*.sql.gz' -mtime "+$KEEP_DAYS" -delete
