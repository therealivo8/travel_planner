#!/usr/bin/env bash
set -e

cleanup() {
  echo "Stopping..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
  wait
}
trap cleanup EXIT INT TERM

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Start PostgreSQL if not running
if ! pg_isready -h localhost -p 5432 -q 2>/dev/null; then
  echo "Starting PostgreSQL..."
  sudo service postgresql start
  sleep 2
fi

(cd "$ROOT/backend" && uv run uvicorn app.main:app --reload) &
BACKEND_PID=$!

(cd "$ROOT/frontend" && npm run dev) &
FRONTEND_PID=$!

echo "Backend  → http://localhost:8000"
echo "Frontend → http://localhost:3000"
echo "Press Ctrl+C to stop."
wait
