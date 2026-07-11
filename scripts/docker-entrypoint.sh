#!/usr/bin/env bash
set -euo pipefail

POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-vekinbox}"
POSTGRES_DB="${POSTGRES_DB:-vekinbox}"

echo "Waiting for PostgreSQL at ${POSTGRES_HOST}:${POSTGRES_PORT}..."
until pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
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
