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

**Step 2 — Copy and configure the env file**

```bash
cd backend
cp .env.example .env
# The DATABASE_URL in .env should be:
# DATABASE_URL=postgresql+asyncpg://node:postgres@127.0.0.1:5433/travel_planner
```

**Step 3 — Run the migration**

```bash
uv run alembic upgrade head
```

**Step 4 — Start the backend**

```bash
cd backend
uv run uvicorn app.main:app --reload --port 8000 &
```

**Step 5 — Start the frontend**

```bash
cd frontend
pnpm install
pnpm dev &
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

## Deploying to Production

Recommended setup: **Vercel** (frontend) + **Railway** (backend + Postgres). Estimated cost: $0–5/mo for personal use.

### 1. Push to GitHub

Make sure your repo is on GitHub. Both platforms deploy directly from it.

### 2. Deploy the backend on Railway

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
2. Select the repo and set the **root directory** to `backend/`
3. Railway auto-detects the Dockerfile and builds it
4. Add a **Postgres plugin** (New → Database → PostgreSQL) — Railway injects `DATABASE_URL` automatically
5. Set these environment variables in the Railway dashboard:

| Variable | Value |
|---|---|
| `SECRET_KEY` | A random secret: `python -c "import secrets; print(secrets.token_hex(32))"` |
| `ENVIRONMENT` | `production` |
| `CORS_ORIGINS` | Your Vercel URL (set this after step 3, e.g. `https://your-app.vercel.app`) |

6. Copy your Railway backend URL (e.g. `https://your-backend.railway.app`) — you need it for step 3.

### 3. Deploy the frontend on Vercel

1. Go to [vercel.com](https://vercel.com) → New Project → Import GitHub repo
2. Set the **root directory** to `frontend/`
3. Set this environment variable in the Vercel dashboard:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | Your Railway backend URL, e.g. `https://your-backend.railway.app` |

4. Deploy — Vercel builds and gives you a `your-app.vercel.app` URL
5. Go back to Railway and update `CORS_ORIGINS` with that Vercel URL

### 4. Verify

```bash
# Health check should return {"status": "ok", "db": "connected"}
curl https://your-backend.railway.app/health
```

Every push to `main` auto-deploys to both platforms.

---

## Environment Variables

**`backend/.env`** (copy from `backend/.env.example`)

| Variable | Dev default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@db:5432/travel_planner` | Async SQLAlchemy connection string |
| `SECRET_KEY` | `changeme` | App secret — **change in production** |
| `ENVIRONMENT` | `development` | Controls SQL echo logging |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated list of allowed frontend origins |

**`frontend/.env.local`** (copy from `frontend/.env.local.example`)

| Variable | Dev default | Description |
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
