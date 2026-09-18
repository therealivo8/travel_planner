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

HeiGIT shut off `api.openrouteservice.org` on 2026-08-24; the API now lives at
`api.heigit.org/openrouteservice/v2/...`. Same key, same payloads. If ORS breaks
again, check for another migration notice before assuming the key is bad.

Test the key directly, bypassing the app:

```bash
curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' \
  -X POST https://api.heigit.org/openrouteservice/v2/isochrones/driving-car \
  -H "Authorization: $ORS_API_KEY" -H 'Content-Type: application/json' \
  -d '{"locations":[[-84.3885,33.7501]],"range":[1800],"range_type":"time"}'
```

---

## Cost

Railway Hobby is ~$5/month minimum (no permanently free tier as of 2026); Vercel
Hobby and Sentry's free tier cover a personal project at no cost. Check current
usage at [railway.app](https://railway.app) → project → Usage and
[vercel.com](https://vercel.com) → Settings → Billing.

Rate limiting stores counters in-process, which is correct at one replica.
Running more than one replica would silently weaken every limit — see
[`docs/rate-limiting-plan.md`](rate-limiting-plan.md) for the Redis swap, which
would add a third service and its cost.
