#!/usr/bin/env bash
set -euo pipefail

POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-vekinbox}"
POSTGRES_DB="${POSTGRES_DB:-vekinbox}"

# Bound startup even when the database is healthy but Docker networking is not.
# The JSON reason is stable for supervisors and log collectors.
POSTGRES_WAIT_TIMEOUT="${POSTGRES_WAIT_TIMEOUT:-60}"
if [[ ! "$POSTGRES_WAIT_TIMEOUT" =~ ^[0-9]+$ ]]; then
  echo '{"error":"invalid_postgres_wait_timeout"}' >&2
  exit 2
fi

echo "Waiting for PostgreSQL at ${POSTGRES_HOST}:${POSTGRES_PORT}..."
SECONDS=0
until pg_isready -t 1 -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
  if (( SECONDS >= 10#$POSTGRES_WAIT_TIMEOUT )); then
    echo '{"error":"postgres_unreachable"}' >&2
    exit 1
  fi
  sleep 1
done
echo "PostgreSQL is ready."

echo "Running database migrations..."
node /app/packages/db/dist/migrate.js

if [ "${EMPTY_DB:-false}" = "true" ]; then
  echo "EMPTY_DB=true — seeding database..."
  node /app/packages/db/dist/seed.js
fi

echo "Starting VekInbox API..."
exec node /app/apps/api/dist/index.js
