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

echo "Waiting for API at http://api:3001/health..."
until node -e '
  fetch("http://api:3001/health", { signal: AbortSignal.timeout(5000) })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    })
    .catch(error => { console.error(`API health check failed: ${error.cause?.message || error.message}`); process.exit(1); });
'; do
  sleep 5
done
echo "API is ready."

echo "Starting VekInbox worker..."
exec node /app/apps/worker/dist/index.js
