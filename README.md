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

### Option 3 — Dev script (local, one command)

Requires: Node.js 20+, npm, Python 3.12, uv, and PostgreSQL installed locally.

```bash
./dev.sh
```

This starts PostgreSQL (if not already running), the FastAPI backend, and the Next.js frontend — all in one terminal. Press `Ctrl+C` to stop everything.

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| Swagger UI | http://localhost:8000/docs |

---

### Option 4 — Local (no Docker at all)

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
| `CORS_ORIGINS` | Your frontend's origin (set this after step 3, e.g. `https://your-app.vercel.app` or your custom domain). Comma-separated for multiple. |
| `MAPS_API_KEY` | Your server-side Google Maps key (Directions, Geocoding, Places, Distance Matrix) |
| `ORS_API_KEY` | Your OpenRouteService key (required for Radius Explorer mode) |
| `SENTRY_DSN` | Optional — the backend Sentry project's DSN. Leave unset to disable error tracking. |

> **Paste values unquoted.** Railway's dashboard stores the field verbatim, unlike a
> `.env` file where python-dotenv strips surrounding quotes. A quoted key becomes
> part of the value and breaks auth against Google/ORS in ways that look like an
> expired key.

6. Copy your Railway backend URL from **Settings → Networking** — you need it for step 3.

> **Copy the domain fresh each time.** If you ever delete and regenerate the
> public domain, Railway issues a *new* hostname. Requests to the old one return
> Railway's edge 404 (`x-railway-fallback: true`, `"Application not found"`),
> which looks exactly like a platform outage. The app's own 404 is plain
> `{"detail":"Not Found"}` with no such header.

### 3. Deploy the frontend on Vercel

1. Go to [vercel.com](https://vercel.com) → New Project → Import GitHub repo
2. Set the **root directory** to `frontend/`
3. Set these environment variables in the Vercel dashboard:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | Your Railway backend URL, e.g. `https://your-backend.up.railway.app` |
| `NEXT_PUBLIC_MAPS_API_KEY` | Your client-side Google Maps key (Maps JavaScript API + Places API (New)) |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional — the *frontend* Sentry project's DSN (a different project from the backend's) |

4. Deploy — Vercel builds and gives you a `your-app.vercel.app` URL
5. Go back to Railway and update `CORS_ORIGINS` with that URL (or your custom domain, if you've added one)

If `NEXT_PUBLIC_API_URL` is missing, the build still succeeds — every API call
just silently falls back to `http://localhost:8000` and fails in the browser.

### 4. Verify

```bash
# Liveness — no database dependency
curl https://your-backend.up.railway.app/health      # {"status":"ok"}

# Database connectivity
curl https://your-backend.up.railway.app/health/db   # {"status":"ok","db":"connected"}
```

Then exercise the golden path in a browser: register → log in → create a trip.
A CORS misconfiguration only shows up here, as a console error — not in the
curl checks above.

Every push to `main` auto-deploys to both platforms.

### 5. Optional: error tracking and backups

See [docs/deployment-runbook.md](docs/deployment-runbook.md) for Sentry setup,
backups, rollback, and secret rotation.

---

## Environment Variables

### Backend — `backend/.env` (copy from `backend/.env.example`)

| Variable | Dev default | Required | Description |
|---|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@db:5432/travel_planner` | Yes | Async SQLAlchemy connection string |
| `SECRET_KEY` | `changeme` | Yes | JWT signing secret — **change in production** |
| `ENVIRONMENT` | `development` | No | Set to `production` in prod. Gates several behaviors: refuses to boot on the default `SECRET_KEY`, switches logs to JSON, sets `secure`/`samesite=none` on the refresh cookie, and sends HSTS. |
| `CORS_ORIGINS` | `http://localhost:3000` | Yes | Comma-separated allowed frontend origins. Backend-only — the frontend has no CORS setting. |
| `MAPS_API_KEY` | _(empty)_ | Yes | **Server-side** Google Maps key. Needed for Directions API, Geocoding API, Places API (Nearby Search), and Distance Matrix API. Restrict by IP in GCP, not by HTTP referrer. |
| `ORS_API_KEY` | _(empty)_ | For radius mode | OpenRouteService API key for isochrone polygons. Free tier: 500 req/day. Get one at [openrouteservice.org](https://openrouteservice.org) — note the API itself is now served from `api.heigit.org`. |
| `SENTRY_DSN` | _(empty)_ | No | Backend Sentry project DSN. Empty disables Sentry entirely. See [docs/deployment-runbook.md](docs/deployment-runbook.md#setting-up-sentry). |

### Frontend — `frontend/.env.local` (copy from `frontend/.env.local.example`)

| Variable | Dev default | Required | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Yes | Backend base URL. If unset in production the build still succeeds — requests just fall back to localhost and fail in the browser. |
| `NEXT_PUBLIC_MAPS_API_KEY` | _(empty)_ | Yes | **Client-side** Google Maps key. Needed for Maps JavaScript API and Places API (New) for address autocomplete. Restrict by HTTP referrer in GCP. |
| `NEXT_PUBLIC_SENTRY_DSN` | _(empty)_ | No | Frontend Sentry project DSN — a *different* project from the backend's. Safe to expose (write-only). See [docs/deployment-runbook.md](docs/deployment-runbook.md#setting-up-sentry). |

### Two separate Google Maps keys

The app uses **two different API keys** intentionally:

- **`NEXT_PUBLIC_MAPS_API_KEY`** (frontend) — sent to the browser. Restricted by HTTP referrer (your domain). Enables map rendering and address autocomplete.
- **`MAPS_API_KEY`** (backend) — never sent to the browser. Used server-side for geocoding, route calculation, POI discovery (Places Nearby Search), and drive-time confirmation (Distance Matrix). Restrict by server IP in production.

Using a single key for both would require it to be browser-safe (referrer-restricted), which breaks server-to-server calls that don't send a referrer header.

### Required GCP APIs

Enable all of these in your [Google Cloud Console](https://console.cloud.google.com/apis/library) project:

| API | Used by | Key |
|---|---|---|
| Maps JavaScript API | Map rendering | Frontend |
| Places API (New) | Address autocomplete | Frontend |
| Geocoding API | Address → coordinates proxy | Backend |
| Directions API | Route calculation | Backend |
| Places API | Nearby Search (radius discovery) | Backend |
| Distance Matrix API | Drive-time confirmation (radius mode) | Backend |

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
│       │   ├── page.tsx                        # Landing page (/)
│       │   ├── login/page.tsx                  # /login
│       │   ├── register/page.tsx               # /register
│       │   ├── trips/
│       │   │   ├── page.tsx                    # /trips — trip list
│       │   │   ├── new/page.tsx                # /trips/new — create trip
│       │   │   └── [trip_id]/
│       │   │       ├── page.tsx                # /trips/:id — detail + route map
│       │   │       └── discover/page.tsx       # /trips/:id/discover — radius POI picker
│       │   └── design/page.tsx                 # Component showcase (dev only)
│       ├── components/
│       │   ├── ui/         # Primitive building blocks (Button, Badge, Card, Sheet…)
│       │   ├── layout/     # App chrome (TopNav, PageShell)
│       │   ├── common/     # Shared across features (EmptyState, StatPill, LoadingOverlay)
│       │   ├── trips/      # Trip domain components (TripCard)
│       │   ├── planning/   # Planning flow components (ModeSelector)
│       │   ├── routing/    # Map + route components
│       │   │   ├── GoogleMapsProvider.tsx      # APIProvider wrapper
│       │   │   ├── TripMap.tsx                 # Base map with markers + polyline
│       │   │   ├── IsochroneLayer.tsx          # Drive-time polygon overlay (radius mode)
│       │   │   ├── AddressAutocomplete.tsx     # Places-backed address input
│       │   │   ├── WaypointList.tsx            # Drag-reorderable stop list
│       │   │   └── RouteStats.tsx              # Distance / time summary chips
│       │   └── radius/     # Radius Explorer components
│       │       └── SuggestionCard.tsx          # POI card with category, rating, drive time
│       ├── context/
│       │   └── AuthContext.tsx                 # JWT auth state + refresh logic
│       ├── hooks/          # Reusable React hooks (useDebounce, useLocalStorage)
│       ├── types/          # Shared TypeScript types (Trip, Waypoint, RadiusSuggestion…)
│       └── lib/
│           ├── api.ts      # Typed fetch wrapper + domain helpers
│           └── utils.ts    # cn() helper
├── backend/                # FastAPI app
│   ├── app/
│   │   ├── main.py         # App factory, middleware, router registration
│   │   ├── config.py       # Pydantic-settings (env vars)
│   │   ├── api/
│   │   │   ├── auth.py     # /auth/register, /auth/login, /auth/refresh
│   │   │   ├── trips.py    # CRUD for trips
│   │   │   ├── waypoints.py # CRUD + reorder for waypoints
│   │   │   ├── routing.py  # /calculate-route, /route, /geocode
│   │   │   ├── radius.py   # /radius/discover, /suggestions, /select, deselect
│   │   │   └── health.py   # /health (liveness), /health/db (DB connectivity)
│   │   ├── models/
│   │   │   ├── user.py     # User + RefreshToken
│   │   │   └── trip.py     # Trip, Waypoint, RadiusSuggestion
│   │   ├── schemas/
│   │   │   ├── auth.py     # Login/register request + token response shapes
│   │   │   └── trip.py     # Trip, Waypoint, Radius* Pydantic schemas
│   │   ├── services/
│   │   │   ├── routes.py   # Google Directions + Geocoding calls
│   │   │   └── radius.py   # ORS isochrone + Places Nearby + Distance Matrix pipeline
│   │   ├── core/
│   │   │   ├── deps.py     # CurrentUser dependency
│   │   │   └── security.py # JWT encode/decode, password hashing
│   │   └── db/
│   │       └── session.py  # Async engine + get_db dependency
│   └── alembic/
│       └── versions/
│           ├── 0001_baseline.py
│           ├── 0002_phase2_auth_and_data_model.py
│           ├── 0003_phase3_routing_columns.py
│           └── 0004_phase4_radius_mode.py
├── docs/
│   ├── prd/                # Phase PRDs (source of truth for feature scope)
│   └── phase-4-implementation.md  # Implementation notes + design decisions
├── docker-compose.yml
└── docker-compose.override.yml    # Dev-only: hot reload, Adminer
```
