# Database Setup Guide

## Current: Postgres inside the dev container (sidecar)

The `.devcontainer` setup runs Postgres as a Docker sidecar service alongside the dev container shell. No local install needed.

**How it works:**
- `docker-compose.yml` defines the `db` service (Postgres 16)
- `docker-compose.devcontainer.yml` adds the `devcontainer` shell that depends on `db`
- VS Code attaches to the `devcontainer` service; the backend reaches Postgres at `db:5432`

**To start:**
1. Open the project in VS Code
2. Press `F1` → **"Reopen in Container"**
3. Wait for `postCreateCommand` to run migrations (`alembic upgrade head`)
4. Run the backend: `cd backend && uv run uvicorn app.main:app --reload --port 8000`

**Adminer** (DB browser UI) is available at http://localhost:8080
- System: PostgreSQL
- Server: `db`
- Username: `postgres`
- Password: `postgres`
- Database: `travel_planner`

---

## Future: Postgres outside the container (local Mac)

When you're ready to move the database to your Mac:

### Step 1 — Install Postgres on Mac
```bash
brew install postgresql@16
brew services start postgresql@16
createdb travel_planner
```

### Step 2 — Update backend/.env
Change `DATABASE_URL` to point to your Mac's Postgres.

From inside the dev container, your Mac host is reachable at `host.docker.internal`:
```
DATABASE_URL=postgresql+asyncpg://postgres@host.docker.internal:5432/travel_planner
```

If running the backend outside the container entirely (directly on Mac):
```
DATABASE_URL=postgresql+asyncpg://postgres@localhost:5432/travel_planner
```

### Step 3 — Run migrations
```bash
cd backend
uv run alembic upgrade head
```

### Step 4 — Remove the db sidecar (optional)
Once you're happy with the external DB, you can remove the `db` service from
`docker-compose.devcontainer.yml` and drop the `depends_on` block so the
dev container starts without waiting for it.

---

## Production (Railway)

Railway auto-injects `DATABASE_URL` when you add a Postgres plugin.
Copy the value from the Railway dashboard into your Railway environment variables —
do not commit it to `.env`.
