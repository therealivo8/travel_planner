# PRD — Phase 2: Authentication & Core Data Model

## Overview
Add user accounts (JWT-based auth) and define the full PostgreSQL schema that all trip planning features will build on. This phase produces a stable, versioned data model and a set of authenticated CRUD endpoints that later phases consume.

## Prerequisites
Phase 1 complete — Docker Compose stack running, FastAPI + Next.js scaffolding in place.

## Goals
- Users can register, log in, and receive a JWT.
- The frontend can make authenticated API requests.
- The full data model (users, trips, waypoints, trip modes) is defined and migrated.
- Authenticated CRUD exists for trips so agents in later phases have a real API to build against.

## Out of Scope
- Route calculation, mapping, or geospatial logic (Phase 3 & 4).
- Trip sharing or export (Phase 5).
- LLM features (Phase 6).

---

## Data Model

### `users`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | gen_random_uuid() |
| `email` | VARCHAR(255) UNIQUE NOT NULL | |
| `hashed_password` | VARCHAR NOT NULL | bcrypt |
| `display_name` | VARCHAR(100) | |
| `created_at` | TIMESTAMPTZ | default now() |
| `updated_at` | TIMESTAMPTZ | updated via trigger |

### `trips`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → users.id | ON DELETE CASCADE |
| `title` | VARCHAR(200) NOT NULL | |
| `mode` | ENUM('point_to_point', 'radius') NOT NULL | |
| `status` | ENUM('draft', 'planned', 'completed') | default 'draft' |
| `start_address` | TEXT NOT NULL | human-readable address |
| `start_lat` | NUMERIC(10,7) NOT NULL | |
| `start_lng` | NUMERIC(10,7) NOT NULL | |
| `end_address` | TEXT | null when mode = 'radius' |
| `end_lat` | NUMERIC(10,7) | null when mode = 'radius' |
| `end_lng` | NUMERIC(10,7) | null when mode = 'radius' |
| `max_drive_minutes` | INTEGER | null when mode = 'point_to_point' |
| `notes` | TEXT | |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

### `waypoints`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `trip_id` | UUID FK → trips.id | ON DELETE CASCADE |
| `position` | SMALLINT NOT NULL | ordering index, 0-based |
| `address` | TEXT NOT NULL | |
| `lat` | NUMERIC(10,7) NOT NULL | |
| `lng` | NUMERIC(10,7) NOT NULL | |
| `label` | VARCHAR(200) | user-facing name |
| `stop_duration_minutes` | INTEGER | planned time at stop |
| `notes` | TEXT | |
| `created_at` | TIMESTAMPTZ | |

Index: `(trip_id, position)` UNIQUE.

---

## API Endpoints

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Create user, return tokens |
| POST | `/auth/login` | Email + password → JWT |
| POST | `/auth/refresh` | Refresh access token |
| GET | `/auth/me` | Return current user profile |

**Token format**: short-lived access token (15 min) + long-lived refresh token (30 days) stored in httpOnly cookie.

### Trips (all require auth)
| Method | Path | Description |
|---|---|---|
| GET | `/trips` | List current user's trips (paginated) |
| POST | `/trips` | Create a new trip |
| GET | `/trips/{trip_id}` | Get single trip with waypoints |
| PATCH | `/trips/{trip_id}` | Update trip fields |
| DELETE | `/trips/{trip_id}` | Delete trip |

### Waypoints (all require auth)
| Method | Path | Description |
|---|---|---|
| GET | `/trips/{trip_id}/waypoints` | List ordered waypoints |
| POST | `/trips/{trip_id}/waypoints` | Add a waypoint |
| PATCH | `/trips/{trip_id}/waypoints/{waypoint_id}` | Update a waypoint |
| DELETE | `/trips/{trip_id}/waypoints/{waypoint_id}` | Remove a waypoint |
| POST | `/trips/{trip_id}/waypoints/reorder` | Bulk reorder (send ordered id array) |

**Authorization rule**: a user may only access trips they own. Return 404 (not 403) on other users' resources to avoid information leakage.

---

## Frontend Requirements

### Pages / Components
- `/login` — email + password form, calls `POST /auth/login`, stores token in memory + refresh token in cookie
- `/register` — registration form
- `/trips` — list of user's trips (title, mode badge, status, created date)
- `/trips/new` — form to create a trip (title, mode selector, start location)
- Auth state managed via a React context (`AuthContext`) + custom `useAuth` hook
- A `withAuth` higher-order component (or middleware) that redirects unauthenticated users to `/login`
- API client from Phase 1 extended to attach `Authorization: Bearer <token>` header automatically

### Validation
- Frontend: Zod schemas for all form inputs
- Backend: Pydantic v2 validators on all request bodies; 422 with field-level errors on validation failure

---

## Acceptance Criteria
- [ ] `POST /auth/register` creates a user; duplicate email returns 409.
- [ ] `POST /auth/login` returns access + refresh tokens.
- [ ] All `/trips` endpoints return 401 when called without a valid token.
- [ ] A user cannot read, modify, or delete another user's trip (returns 404).
- [ ] `POST /trips` with `mode = 'radius'` requires `max_drive_minutes`; returns 422 without it.
- [ ] `POST /trips` with `mode = 'point_to_point'` requires `end_address` and coordinates; returns 422 without them.
- [ ] Waypoint `position` values are always contiguous (0, 1, 2 …) after any reorder or delete operation.
- [ ] All DB operations go through async SQLAlchemy; no sync DB calls in request handlers.
- [ ] `alembic upgrade head` from a clean DB produces all tables and indexes.
- [ ] Frontend login/register flow works end-to-end against the local dev stack.
- [ ] Unauthenticated navigation to `/trips` redirects to `/login`.

---

## Notes for the Implementing Agent
- Use `python-jose` for JWT encoding and `passlib[bcrypt]` for password hashing.
- Store the refresh token in an httpOnly, SameSite=Strict cookie — not in localStorage.
- The `position` reorder endpoint should use a single transaction to avoid gaps.
- Add a DB constraint `CHECK (mode = 'radius' OR (end_lat IS NOT NULL AND end_lng IS NOT NULL))` to enforce mode-specific required fields at the DB level as a safety net.
- Alembic autogenerate is fine here; review the generated migration before committing.
- Do not implement geolocation or address autocomplete in this phase — coordinates can be entered manually in the form (a text input for lat/lng is acceptable for now).
