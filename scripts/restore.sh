#!/usr/bin/env bash
# MongoDB restore script for Study Partner
# Usage: ./restore.sh <BACKUP_DIR> [MONGODB_URI]
#
# Args:
#   BACKUP_DIR   - Path to a backup directory (e.g., ./backups/20260818_120000)
#   MONGODB_URI  - Target URI (default: $MONGODB_URI or mongodb://localhost:27017/study_partner)
#
# WARNING: This drops and replaces collections in the target database.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <BACKUP_DIR> [MONGODB_URI]"
  echo "  BACKUP_DIR: path to backup (e.g., ./backups/20260818_120000)"
  echo "  MONGODB_URI: target database URI (default: \$MONGODB_URI or mongodb://localhost:27017/study_partner)"
  exit 1
fi

BACKUP_DIR="$1"
MONGODB_URI="${2:-${MONGODB_URI:-mongodb://localhost:27017/study_partner}}"

if [ ! -d "${BACKUP_DIR}" ]; then
  echo "ERROR: Backup directory not found: ${BACKUP_DIR}" >&2
  exit 1
fi

# Find the database dump subdirectory (could be study_partner or another name)
DB_DUMP_DIR=""
for d in "${BACKUP_DIR}"/*/; do
  if [ -d "$d" ] && ls "$d"/*.gz &>/dev/null; then
    DB_DUMP_DIR="$d"
    break
  fi
done

if [ -z "${DB_DUMP_DIR}" ]; then
  echo "ERROR: No valid mongodump found in ${BACKUP_DIR}" >&2
  exit 1
fi

DUMPED_DB="$(basename "${DB_DUMP_DIR}")"
echo "==> MongoDB restore"
echo "    Source:     ${DB_DUMP_DIR} (database: ${DUMPED_DB})"
echo "    Target URI: ${MONGODB_URI}"
echo ""
echo "    WARNING: This will DROP and REPLACE collections in the target database."
read -p "    Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

mongorestore \
  --uri="${MONGODB_URI}" \
  --gzip \
  --drop \
  --numParallelCollections=4 \
  "${DB_DUMP_DIR}"

echo "==> Restore complete"
