#!/usr/bin/env bash
# Automated Postgres backup (master plan Phase 1, item 6 --
# docs/status/2026-07-19-founder-market-readiness-audit.md §3: before this,
# the only backup was a single manual dump from 2026-07-11, nothing scheduled
# since). Dumps the DB to backups/<name>_<timestamp>.dump (pg_dump custom
# format, so it restores with `pg_restore`), then deletes dumps older than
# KEEP_DAYS so this directory doesn't grow forever.
#
# Usage:
#   DATABASE_URL=postgresql://vaep:vaep@localhost:5433/vaep ./scripts/backup-db.sh
# (defaults to the local dev DB in infra/docker-compose.yml if DATABASE_URL
# is unset)
#
# Schedule it (pick whichever matches how this is actually deployed):
#   - Local/dev machine or a VM you control: a system crontab entry, e.g.
#     nightly at 2am --
#       0 2 * * * cd /path/to/platform && DATABASE_URL=... ./scripts/backup-db.sh >> backups/backup.log 2>&1
#   - A managed Postgres host (RDS, Supabase, Neon, Cloud SQL, etc.): most of
#     these already offer automated snapshot backups built in -- turn that on
#     instead of relying on this script, it's more reliable than a cron job on
#     a single box.
#   - A scheduled CI job: a GitHub Actions workflow on a `schedule:` cron
#     trigger can run this same script and upload the dump as an artifact or
#     push it to object storage.

set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgresql://vaep:vaep@localhost:5433/vaep}"
KEEP_DAYS="${KEEP_DAYS:-14}"
# Strip a Prisma-style "?schema=..." (or any other query string) -- pg_dump's
# own URI parser doesn't understand it and dumps every schema by default
# anyway, so it's not needed for a full-database backup.
PG_DUMP_URL="${DATABASE_URL%%\?*}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup_dir="$repo_root/backups"
mkdir -p "$backup_dir"

timestamp="$(date -u +%Y-%m-%d_%H%M%SZ)"
out_file="$backup_dir/vaep_${timestamp}.dump"

echo "Backing up $PG_DUMP_URL -> $out_file"
pg_dump --format=custom --file="$out_file" "$PG_DUMP_URL"
echo "Backup complete: $out_file ($(du -h "$out_file" | cut -f1))"

echo "Pruning dumps older than ${KEEP_DAYS} days..."
find "$backup_dir" -name 'vaep_*.dump' -mtime "+${KEEP_DAYS}" -print -delete
