# Deployment Runbook

Operational procedures for the live deployment: how to deploy, roll back, rotate a
secret, set up error tracking, and restore from backup.

For *why* the stack is Railway + Vercel, see
[`docs/prd/phase-11-production-deployment.md`](prd/phase-11-production-deployment.md).
For how security logging and alerting work once Sentry is on, see
[`docs/security-alerting.md`](security-alerting.md). For first-time deploy setup,
see the "Deploying to Production" section of the root [README](../README.md).

---

## Where things live

| Thing | Where | Notes |
|---|---|---|
| Backend (FastAPI) | Railway service, root directory `/backend` | Builds `backend/Dockerfile` |
| Database | Railway Postgres, **same project, same region** as the backend | Private networking only — never expose publicly |
| Frontend (Next.js) | Vercel project, root directory `frontend` | |
| Secrets | Railway and Vercel dashboard env vars | No file, no secrets manager — see Phase 11 Part B |

Keep the backend and Postgres in the same Railway region. They were split
(backend US East, Postgres EU West) for a while, which worked but put a
transatlantic round trip on every query.

---

## Deploying

Push to `main`. Both platforms build automatically from GitHub.

To verify a deploy landed:

```bash
curl https://<backend-domain>/health      # {"status":"ok"} — liveness, no DB
curl https://<backend-domain>/health/db   # {"status":"ok","db":"connected"}
```

Migrations run automatically: `railway.toml`'s `startCommand` runs
`alembic upgrade head` before uvicorn starts. There is no manual migration step.

Get `<backend-domain>` from Railway → service → **Settings → Networking**, fresh
each time (see the stale-domain trap below).

---

## Rolling back

Both platforms roll back from the dashboard — no CLI, no revert commit.

**Railway:** service → Deployments → find the last known-good deployment →
"Redeploy". Note this redeploys that *code*; it does not roll back database
migrations. If the bad deploy included a destructive migration, restore from
backup instead.

**Vercel:** project → Deployments → find the good one → "Promote to Production".

---

## Rotating secrets

| Secret | Where | Side effects |
|---|---|---|
| `SECRET_KEY` | Railway | **Invalidates every session and refresh token.** All users are logged out. Rare, deliberate operation. |
| `MAPS_API_KEY` | Railway | None — regenerate in Google Cloud Console, update, redeploy |
| `NEXT_PUBLIC_MAPS_API_KEY` | Vercel | None — browser key, restrict by HTTP referrer |
| `ORS_API_KEY` | Railway | None — regenerate at the HeiGIT account page |
| `RESEND_API_KEY` | Railway | None — regenerate in the Resend dashboard, update, redeploy. Until it's set, users can't reset by email: outside production the link is only logged, and in production nothing is logged or sent. |
| `R2_SECRET_ACCESS_KEY` | Railway | None — create a new token in Cloudflare, update, redeploy, then revoke the old one |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Railway / Vercel | None — DSNs are write-only, not secrets |
| `DATABASE_URL` | Railway (auto-injected) | Don't set by hand; Railway manages it |

Generate a new signing key with:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

**Paste values unquoted.** Railway and Vercel store the field verbatim. A local
`.env` can say `ORS_API_KEY="eyJ..."` and work, because python-dotenv strips the
quotes — paste that same string into a dashboard and the quotes become part of
the value, producing auth failures that look like an expired or invalid key.

---

## Setting up Sentry

The code is already wired on both sides and no-ops when the DSN is unset. Turning
it on is purely configuration.

1. Create **two** projects at [sentry.io](https://sentry.io):
   - one **Python / FastAPI** project for the backend
   - one **Next.js** project for the frontend

   They need separate DSNs. One DSN across both mixes incompatible stack traces
   and makes alerting rules ambiguous.

2. Copy each project's DSN from **Settings → Client Keys (DSN)**.

3. Set them:
   - Railway → backend service → Variables → `SENTRY_DSN`
   - Vercel → project → Settings → Environment Variables → `NEXT_PUBLIC_SENTRY_DSN`

   Unquoted, as above.

4. Redeploy both.

5. Configure the failed-login alert rule described in
   [`docs/security-alerting.md`](security-alerting.md). **Alert rules are not
   code** — they exist only in Sentry's UI, so that doc is the only record of
   them. If the Sentry project is ever recreated, reproduce them from there.

To confirm it's live, trigger an error and check it arrives in Sentry within a
minute or so.

Why this matters more than it looks: API error responses deliberately return
generic messages ("Discovery failed. Please try again.") so upstream error text
never reaches clients. The real cause goes to logs and Sentry only. Without a
DSN, diagnosing a production failure means tailing Railway logs and hoping to
catch it live.

---

## Backups and restore

> **Not yet set up.** This section describes what needs doing — it is the last
> open item in Phase 11 Part A.

Check whether the current Railway plan includes automatic Postgres backups
(Postgres service → Settings). If it does, enable daily backups. If not, add a
scheduled job that runs `pg_dump` to cheap object storage (Cloudflare R2 has a
free tier).

**Then test a restore into a scratch database before considering this done.** An
untested backup is not a backup. Record here what the restore procedure actually
was once you've run it, including how long it took.

---

## Troubleshooting

### Railway edge 404: "Application not found"

```
HTTP/2 404
server: railway-hikari
x-railway-fallback: true
{"status":"error","code":404,"message":"Application not found"}
```

This is **Railway's edge**, not your app — the request never reached the
container. Almost always a stale hostname: deleting and regenerating a public
domain issues a *new* one (the random suffix changes), and the old hostname stops
resolving to anything.

Re-copy the domain from Settings → Networking rather than reusing one from shell
history. Distinguish by response body — the app's own 404 is plain
`{"detail":"Not Found"}` with no `x-railway-fallback` header.

Verify the app is healthy independently from the Railway Console (the container
image has no `curl`):

```bash
python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8080/health').read())"
```

If that returns `{"status":"ok"}` while the public domain 404s, it's the domain,
not the app.

### Build fails: "Railpack could not determine how to build"

Railway isn't reading `backend/railway.toml`. Root Directory and the config file
path are **separate settings** — setting the former to `/backend` does not make
Railway look for `/backend/railway.toml`.

### CORS errors in the browser

`CORS_ORIGINS` on Railway must exactly match the frontend's origin — scheme
included, no trailing slash, no quotes. Comma-separate multiple origins. Note
this is a backend-only setting; there is no CORS variable on the frontend.

CORS failures appear only in the browser console. `curl` does not enforce CORS,
so the health checks above pass regardless.

### Radius mode times out

Isochrone cost scales sharply with drive time: roughly 5s at 30 minutes, 15s at
45, 35s at the 60-minute cap. The backend's httpx timeout is 90s to accommodate
this.

The full `/radius/discover` pipeline (isochrone → paginated Google Nearby Search
→ Distance Matrix) can approach **Vercel's 60s serverless function limit** on
Hobby for 60-minute trips. If users hit timeouts there, options are raising
`maxDuration` in `vercel.json`, calling the backend directly for that endpoint,
or making discovery asynchronous.

### ORS calls fail

**First check whether it's quota.** The free tier is 500 requests/day. Filter
logs for:

```
event=upstream.quota_exceeded      # confirmed quota/rate-limit rejection
event=upstream.quota_state         # remaining quota, logged on every success
```

`quota_state` carries `quota_remaining` on every successful call, so a downward
trend is visible before exhaustion becomes an outage. A confirmed exhaustion
also raises a Sentry warning (if a DSN is configured).

This distinction matters because **ORS returns 403 for daily quota exhaustion —
the same status as an invalid key**. The app disambiguates using the
`x-ratelimit-remaining` header: 429 always means rate limited, while 403 counts
as quota only when that header confirms nothing is left. A 403 with quota
remaining is an auth problem, not a quota one.

Quota resets daily; `quota_reset` in the logs is the Unix timestamp.

**If it isn't quota:** HeiGIT shut off `api.openrouteservice.org` on 2026-08-24;
the API now lives at `api.heigit.org/openrouteservice/v2/...`. Same key, same
payloads. If ORS breaks again, check for another migration notice before
assuming the key is bad.

Test the key directly, bypassing the app:

```bash
curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' \
  -X POST https://api.heigit.org/openrouteservice/v2/isochrones/driving-car \
  -H "Authorization: $ORS_API_KEY" -H 'Content-Type: application/json' \
  -d '{"locations":[[-84.3885,33.7501]],"range":[1800],"range_type":"time"}'
```

---

## Collaborative trips (Phase 19)

Trip owners invite people by link (optionally emailed through Resend, so the Phase 15 email
settings apply) as **editors** or **viewers**. There are no new services or keys.

- **Invites** are 14-day links, 10 uses by default, revocable by the owner. Only a sha256 of the
  token is stored, so a lost link can't be recovered: create a new one. Creating invites is
  limited to 20 per day per account.
- **Concurrency:** edits to a trip, its stops and its itinerary carry an `If-Match` version. A
  stale save gets `409 version_conflict` and the UI prompts a reload. Members' pages poll
  `GET /trips/{id}/changes` every 20 s while the tab is visible; solo trips never poll.
- **Security log events** (logger `security`): `trip.invite_created`, `trip.invite_accepted`,
  `trip.invite_revoked`, `trip.member_role_changed`, `trip.member_removed`, `trip.member_left`.
  These change who can read or edit a trip, so they're worth watching if access looks wrong.
- Activity history is pruned after 90 days by the daily cleanup job.
- Editors spend their **own** daily discovery quota and Google budget share, never the owner's;
  photo storage counts toward the trip owner.

## Trip photos on Cloudflare R2 (Phase 17)

Photos go **browser → R2** on presigned PUT URLs, so image bytes never pass through Railway.
Without R2 credentials the photo endpoints answer 503 and everything else works.

1. Cloudflare dashboard → R2 → create a bucket (free tier: 10 GB, no egress fees).
2. R2 → Manage API tokens → create a token with **Object Read & Write** on that bucket.
3. Set in Railway (paste values **unquoted**): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
4. **CORS on the bucket** (otherwise uploads fail in the browser): allow origin = your frontend
   (e.g. `https://your-app.vercel.app`), methods `PUT` and `GET`, allowed headers `Content-Type`
   and `Content-Length`.
5. Optional: connect a custom domain to the bucket and set `R2_PUBLIC_BASE_URL` (e.g.
   `https://photos.example.com`). It's used **only** for photos on trips whose recap is shared;
   everything else gets 1-hour presigned URLs.

Limits are 50 photos per trip, 500 per user and 5 MB per file (`PHOTOS_PER_TRIP`,
`PHOTOS_PER_USER`, `PHOTO_MAX_UPLOAD_BYTES`). Deleting a photo, trip or account queues the R2
objects in `pending_object_deletes`; the daily cleanup job deletes them, so an R2 outage never
blocks a user's delete. Check the queue if storage looks too full:
`SELECT count(*) FROM pending_object_deletes;` — rows that keep failing are dropped after 20 tries.

## API budgets and quotas (Phase 14)

Every paid upstream call is reserved against a Postgres ledger (`api_usage_daily`) before it
runs. When a SKU's daily or monthly budget is spent, the API answers `503 budget_exhausted`
and the UI shows a "discovery is paused" banner. Per-user daily quotas answer `429 user_quota`.

- **Change a budget without a deploy:** set `API_BUDGETS` (JSON) in Railway. Keys are SKU names such as
  `google.nearby_search`; values are `{"day": n, "month": n}`.
- **See usage:** sign in as an email listed in `ADMIN_EMAILS` and open `/admin/usage`.
- **Sentry:** a warning fires once per SKU per day when a SKU passes 80% of its monthly budget.
- **Daily cleanup** (runs at startup and every 24h in the API process) deletes unselected
  suggestions older than 30 days and expired cache rows.
- **Risk — legacy Google APIs:** Directions, Distance Matrix and Nearby Search use the *legacy*
  endpoints. Google stopped offering legacy APIs to *new* Cloud projects in 2025, so if this
  project is ever recreated, those calls will fail until migrated to the Routes and Places (New) APIs.
- **Check Google's current Service Specific Terms** before raising `DISCOVERY_CACHE_TTL_DAYS`
  above its 7-day default; most Places content may only be cached temporarily.

## Cost

Railway Hobby is ~$5/month minimum (no permanently free tier as of 2026); Vercel
Hobby and Sentry's free tier cover a personal project at no cost. Check current
usage at [railway.app](https://railway.app) → project → Usage and
[vercel.com](https://vercel.com) → Settings → Billing.

Rate limiting stores counters in-process, which is correct at one replica.
Running more than one replica would silently weaken every limit — see
[`docs/rate-limiting-plan.md`](rate-limiting-plan.md) for the Redis swap, which
would add a third service and its cost.
