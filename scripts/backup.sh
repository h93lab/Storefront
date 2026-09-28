#!/usr/bin/env bash
# Backs up the database (pg_dump) and the stored images into ./backups/<timestamp>/.
# Usage: ./scripts/backup.sh
# Uses DATABASE_BACKUP_URL if set, otherwise DATABASE_URL from .env.
# For Supabase use the "Session pooler" (port 5432) or direct connection string:
# pg_dump does not work through the transaction pooler (port 6543).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
# shellcheck disable=SC1091
source .env
set +a
URL="${DATABASE_BACKUP_URL:-$DATABASE_URL}"
if [[ "$URL" == *":6543/"* ]]; then
  echo "DATABASE_URL points at the transaction pooler (port 6543). Set DATABASE_BACKUP_URL to the session pooler (port 5432) in .env." >&2
  exit 1
fi
DEST="backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"
NET=()
if [[ "$URL" == *"@db:"* ]]; then NET=(--network "$(basename "$PWD" | tr -cd 'a-z0-9_-')_default"); fi
docker run --rm "${NET[@]}" postgres:17-alpine pg_dump --no-owner --no-privileges --format=custom "$URL" > "$DEST/database.dump"
tar -czf "$DEST/media.tar.gz" -C data media
echo "Backup written to $DEST ($(du -sh "$DEST" | cut -f1))"
echo "Restore: pg_restore --no-owner -d <url> $DEST/database.dump && tar -xzf $DEST/media.tar.gz -C data"
