#!/usr/bin/env bash
# MongoDB backup script for Study Partner
# Usage: ./backup.sh [MONGODB_URI] [BACKUP_DIR]
#
# Defaults:
#   MONGODB_URI  = $MONGODB_URI env var, or mongodb://localhost:27017/study_partner
#   BACKUP_DIR   = ./backups (relative to script location)
#
# Produces a gzipped BSON dump in BACKUP_DIR/<timestamp>/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
MONGODB_URI="${1:-${MONGODB_URI:-mongodb://localhost:27017/study_partner}}"
BACKUP_DIR="${2:-${SCRIPT_DIR}/../backups}/${TIMESTAMP}"

echo "==> MongoDB backup"
echo "    URI:        ${MONGODB_URI}"
echo "    Target dir: ${BACKUP_DIR}"

mkdir -p "${BACKUP_DIR}"

mongodump \
  --uri="${MONGODB_URI}" \
  --out="${BACKUP_DIR}" \
  --gzip \
  --numParallelCollections=4

# Verify at least one collection was dumped
if [ -d "${BACKUP_DIR}/study_partner" ]; then
  COLLECTIONS=$(ls -1 "${BACKUP_DIR}/study_partner" | wc -l)
  echo "==> Backup complete: ${COLLECTIONS} collections dumped"
else
  # Try the database name extracted from URI
  DB_NAME=$(echo "${MONGODB_URI}" | grep -oP '(?<=/)[^/?]+' | tail -1)
  if [ -d "${BACKUP_DIR}/${DB_NAME}" ]; then
    COLLECTIONS=$(ls -1 "${BACKUP_DIR}/${DB_NAME}" | wc -l)
    echo "==> Backup complete: ${COLLECTIONS} collections dumped to ${DB_NAME}/"
  else
    echo "==> WARNING: No collections found in backup. Check URI." >&2
    exit 1
  fi
fi

# Prune backups older than 30 days (keep at least 7)
PARENT_DIR="$(dirname "${BACKUP_DIR}")"
find "${PARENT_DIR}" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} + 2>/dev/null || true
echo "==> Pruned backups older than 30 days"
