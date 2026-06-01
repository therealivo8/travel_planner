# Road Trip Planner

Plan road trips in two modes: **Point-to-Point** (A→B with waypoints) and **Radius Explorer** (discover destinations within a drive time).

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind 4 |
| Backend | FastAPI, Python 3.12, Pydantic v2 |
| Database | PostgreSQL 16/17 |
| ORM | SQLAlchemy 2.x (async) + Alembic |
| Package mgmt | pnpm (frontend), uv (backend) |

---

## Starting the Application

### Option 1 — Docker Compose (recommended)

Requires Docker with Compose v2 (`docker compose`) or Compose v1 (`docker-compose`).

```bash
# Copy env file
cp backend/.env.example backend/.env

# Start all services (frontend, backend, db, adminer)
docker compose up
# or if you have Compose v1:
docker-compose up
```

Run the database migration once on first start:

```bash
docker compose exec backend uv run alembic upgrade head
# or:
docker-compose exec backend uv run alembic upgrade head
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| Swagger UI | http://localhost:8000/docs |
| Adminer (DB GUI) | http://localhost:8080 |
| Design system | http://localhost:3000/design |

Stop everything:

```bash
docker compose down
```

---

### Option 2 — Dev Container (no Docker daemon)

Use this when running inside a VS Code dev container where the Docker daemon is not available (e.g. this repo's devcontainer setup).

**Step 1 — Start PostgreSQL**

First time only — initialize the cluster and create the database:

```bash
PGDATA=/tmp/pgdata17
/usr/lib/postgresql/17/bin/initdb -D $PGDATA --auth=trust --username=postgres
/usr/lib/postgresql/17/bin/pg_ctl -D $PGDATA -o "-p 5433 -k /tmp" -l /tmp/pg.log start
sleep 3
psql -U postgres -h 127.0.0.1 -p 5433 -c "CREATE ROLE node SUPERUSER LOGIN PASSWORD 'postgres';"
psql -U postgres -h 127.0.0.1 -p 5433 -c "CREATE DATABASE travel_planner OWNER node;"
```

On subsequent starts, just run:

```bash
/usr/lib/postgresql/17/bin/pg_ctl -D /tmp/pgdata17 -o "-p 5433 -k /tmp" -l /tmp/pg.log start
```

**Step 2 — Run the migration**

```bash
cd backend
uv run alembic upgrade head
```

**Step 3 — Start the backend**

```bash
cd backend
uv run uvicorn app.main:app --reload --port 8000 &
```

**Step 4 — Start the frontend**

```bash
cd frontend
pnpm dev &
```

The `.env` for this environment is already configured:

```
DATABASE_URL=postgresql+asyncpg://node:postgres@127.0.0.1:5433/travel_planner
```

To stop the background processes:

```bash
pkill -f uvicorn
pkill -f "next dev"
/usr/lib/postgresql/17/bin/pg_ctl -D /tmp/pgdata17 stop
```

---

### Option 3 — Local (no Docker at all)

Requires: Node.js 20+, pnpm, Python 3.12, uv, and a running PostgreSQL instance.

**Database setup**

```bash
createdb travel_planner
# or via psql:
psql -c "CREATE DATABASE travel_planner;"
```

**Backend**

```bash
cd backend
cp .env.example .env
# Edit .env and set DATABASE_URL to point at your local postgres

uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
```

**Frontend** (separate terminal)

```bash
cd frontend
pnpm install
pnpm dev
```

---

## Environment Variables

**`backend/.env`**

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@db:5432/travel_planner` | Async SQLAlchemy connection string |
| `SECRET_KEY` | `changeme` | App secret — change in production |
| `ENVIRONMENT` | `development` | Controls CORS origins and SQL echo |

**`frontend/.env.local`**

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Backend base URL |

---

## Development

```bash
# Frontend type check + lint
cd frontend
pnpm typecheck
pnpm lint

# Backend lint + type check
cd backend
uv run ruff check app/
uv run mypy app/

# Create a new Alembic migration
cd backend
uv run alembic revision --autogenerate -m "description"
uv run alembic upgrade head
```

## Project Structure

```
travel-planner/
├── frontend/               # Next.js app
│   └── src/
│       ├── app/            # Routing only — thin pages, no logic
│       │   ├── page.tsx    # Landing page (/)
│       │   └── design/     # Component showcase (/design, dev only)
│       ├── components/
│       │   ├── ui/         # Primitive building blocks (Button, Badge, Card…)
│       │   ├── layout/     # App chrome (TopNav, PageShell)
│       │   ├── common/     # Shared across features (EmptyState, StatPill, LoadingOverlay)
│       │   ├── trips/      # Trip domain components (TripCard…)
│       │   └── planning/   # Planning flow components (ModeSelector…)
│       ├── hooks/          # Reusable React hooks (useDebounce, useLocalStorage)
│       ├── types/          # Shared TypeScript types (Trip, Waypoint, TripMode…)
│       └── lib/
│           ├── api.ts      # Typed fetch wrapper
│           └── utils.ts    # cn() helper
├── backend/                # FastAPI app
│   ├── app/
│   │   ├── main.py
│   │   ├── api/            # Route modules
│   │   ├── models/         # SQLAlchemy models
│   │   ├── schemas/        # Pydantic schemas
│   │   └── db/             # Async session + config
│   └── alembic/            # Migrations
├── docker-compose.yml
├── docker-compose.override.yml   # Dev-only: hot reload, Adminer
└── docs/prd/               # Phase PRDs
```
