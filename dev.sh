#!/usr/bin/env bash
set -e

cleanup() {
  echo "Stopping..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
  wait
}
trap cleanup EXIT INT TERM

ROOT="$(cd "$(dirname "$0")" && pwd)"

PGDATA="/tmp/pgdata17"
PGPORT=5433

# Start PostgreSQL if not running (dev container setup — see README Option 2)
if ! pg_isready -h 127.0.0.1 -p "$PGPORT" -q 2>/dev/null; then
  echo "Starting PostgreSQL..."
  if [ ! -d "$PGDATA" ]; then
    /usr/lib/postgresql/17/bin/initdb -D "$PGDATA" --auth=trust --username=postgres
  fi
  /usr/lib/postgresql/17/bin/pg_ctl -D "$PGDATA" -o "-p $PGPORT -k /tmp" -l /tmp/pg.log start
  sleep 2
  psql -U postgres -h 127.0.0.1 -p "$PGPORT" -tc "SELECT 1 FROM pg_roles WHERE rolname='node'" | grep -q 1 \
    || psql -U postgres -h 127.0.0.1 -p "$PGPORT" -c "CREATE ROLE node SUPERUSER LOGIN PASSWORD 'postgres';"
  psql -U postgres -h 127.0.0.1 -p "$PGPORT" -tc "SELECT 1 FROM pg_database WHERE datname='travel_planner'" | grep -q 1 \
    || psql -U postgres -h 127.0.0.1 -p "$PGPORT" -c "CREATE DATABASE travel_planner OWNER node;"
fi

(cd "$ROOT/backend" && uv run alembic upgrade head)

(cd "$ROOT/backend" && uv run uvicorn app.main:app --reload --port 8000) &
BACKEND_PID=$!

(cd "$ROOT/frontend" && pnpm dev) &
FRONTEND_PID=$!

echo "Backend  → http://localhost:8000"
echo "Frontend → http://localhost:3000"
echo "Press Ctrl+C to stop."
wait
