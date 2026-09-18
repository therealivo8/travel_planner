# PRD — Phase 11: Production Deployment

## Overview
The app is closer to deployable than a fresh look suggests. `8bc5ae4` already added
`frontend/vercel.json` and `backend/railway.toml`, both Dockerfiles are production-shaped
(multi-stage Next.js standalone build; `uv`-based Python image that runs `alembic upgrade head`
before `uvicorn`), and Phase 8/10 already added the two guardrails a first prod deploy usually
forgets: the app refuses to boot with a placeholder `SECRET_KEY` when `ENVIRONMENT=production`
(`backend/app/config.py:28-38`), and Sentry + structured security logging are already wired and
DSN-gated (`docs/security-alerting.md`). Rate limiting is in-process/in-memory by design —
documented in `docs/rate-limiting-plan.md` as correct for one backend instance, with Redis called
out as the upgrade path if that ever changes.

So this phase is mostly **account setup, secret provisioning, and a launch checklist** — not new
application code. The only code changes are a small number of production-only guardrails (Part D)
that don't exist yet because there's been no production to guard.

**Platform choice**: Vercel (frontend) + Railway (backend + Postgres). This matches the config
already committed, keeps the whole stack on usage-based free/low tiers appropriate for a
low-traffic personal project, and requires no infrastructure to provision or patch (no VMs, no
networking, no IAM). An Azure/AWS/GCP-style App Service + managed DB + Key Vault stack was
considered and rejected for this phase: it's a better fit once there's real multi-tenant traffic or
a team, but for one person's project it roughly 5-10x's both setup effort and idle-time cost for no
functional benefit today. If traffic or requirements outgrow Railway later, that's a follow-on PRD,
not a blocker now — see "Future Phase Candidates" below.

## Prerequisites
Phases 1–10 complete (current `main`). No application feature work is blocked on this phase, but
nothing is live for real users until it's done.

## Goals
- The app is reachable at a real HTTPS URL for both frontend and backend, deployed from `main` on
  every merge.
- All secrets (JWT signing key, Maps key, ORS key, Sentry DSN, DB credentials) live in the hosting
  platforms' secret stores — never in a committed file, never in shell history.
- Postgres data survives a redeploy, a dyno/instance restart, and (via backups) an accidental bad
  migration.
- A person other than the developer hitting the URL cannot see stack traces, default secrets, or
  permissive CORS.
- Monthly cost is known, bounded, and near $0 at personal-project traffic levels — no
  surprise-bill risk from an unbounded pay-per-use resource.
- There's a written, repeatable runbook for deploying, rolling back, and rotating a secret — so a
  6-months-later solo maintainer isn't reconstructing this from memory.

## Out of Scope
- Custom domain purchase/DNS setup — supported by both platforms with zero code changes, but it's a
  user decision (do you want one, what registrar) not an engineering task. Documented as an optional
  step in the runbook (Part E) if the user wants it later.
- Moving rate-limit storage to Redis — only needed at more than one backend instance; Railway's
  cheapest tier runs one. Revisit if traffic ever justifies horizontal scaling (see
  `docs/rate-limiting-plan.md:162-164`).
- CI/CD pipeline changes beyond what's needed to trigger Vercel/Railway's existing git-push-to-deploy
  — both platforms auto-deploy from a connected GitHub branch; no new GitHub Actions workflow is
  required for deployment itself (existing lint/typecheck/test CI is untouched).
- A staging environment — out of budget for a personal project; Part E's rollback procedure and
  Railway's preview environments (free, ephemeral, per-PR) cover "test before it's live" well enough
  without a second always-on environment.
- Load testing / capacity planning — not meaningful at expected personal-project traffic.
- Phase 6 (LLM integration) deployment concerns — Phase 6 is unbuilt; whichever phase builds it
  should add `ANTHROPIC_API_KEY` to the secret list in Part B at that time, following the same
  pattern as `MAPS_API_KEY`.

---

## Part A: Railway — Backend + Database

### Design
Railway hosts both the FastAPI backend and a managed Postgres instance in one project, so they
share a private network and the DB is never exposed to the public internet.

1. **Create Railway project**, connect the GitHub repo, set the service root to `backend/`.
   Railway detects `railway.toml` automatically (`builder = "dockerfile"`, uses
   `backend/Dockerfile`).
2. **Add a Postgres plugin** to the same project. Railway provisions it and injects
   `DATABASE_URL` into linked services automatically — but the app expects the `asyncpg` driver
   (`postgresql+asyncpg://...`, see `config.py:6`) and Railway's injected URL uses the plain
   `postgresql://` scheme. Two ways to reconcile, pick one and document which in the runbook:
   - Reference `${{Postgres.DATABASE_URL}}` in the backend service's env vars but override the
     scheme prefix in an env-specific var, or
   - Add a one-line startup shim in `app/config.py` that rewrites `postgresql://` →
     `postgresql+asyncpg://` if present, so either form works. **Recommended** — it's a two-line
     change that removes an entire footgun class (this bites every asyncpg + Railway/Heroku-style
     project at least once).
3. **Set backend env vars** in Railway's dashboard (never in a file): `SECRET_KEY` (generate via
   `python -c "import secrets; print(secrets.token_hex(32))"`, per the existing comment in
   `.env.example`), `ENVIRONMENT=production`, `CORS_ORIGINS` (the Vercel production URL, set after
   Part C), `MAPS_API_KEY`, `ORS_API_KEY`, `SENTRY_DSN`.
4. **Confirm `railway.toml`'s existing config is used as-is**: `startCommand` already runs
   `alembic upgrade head` before `uvicorn` — migrations run automatically on every deploy, no manual
   step. `healthcheckPath = "/health"` — confirm this route exists and returns 200 without hitting
   the DB in a way that fails before migrations finish on first boot.
5. **Enable Railway's automatic daily Postgres backups** (or confirm the plan tier includes them —
   this varies; check current Railway pricing since it changes). If the tier doesn't include
   backups, add a small scheduled job (Railway cron or GitHub Action) that runs `pg_dump` to
   cheap object storage (e.g., Cloudflare R2, which has a free tier) on a daily cadence. Either way,
   **test one real restore** before calling this done — an untested backup is not a backup.

### Acceptance Criteria
- [ ] Pushing to `main` triggers an automatic Railway deploy of the backend.
- [ ] `DATABASE_URL` resolves correctly to the `asyncpg` driver at runtime with no manual string
      editing required on future redeploys.
- [ ] The backend boots successfully with `ENVIRONMENT=production` and a real `SECRET_KEY` (Phase 8's
      guard from `config.py:28-38` passes).
- [ ] `alembic upgrade head` runs automatically on deploy; a fresh Railway Postgres instance ends up
      at the current migration head with no manual `alembic` command run by hand.
- [ ] `GET /health` returns 200 from the public Railway URL.
- [ ] A daily backup exists and one restore has been performed successfully into a scratch database
      to confirm the backup is valid.
- [ ] Postgres is not reachable from the public internet — only from the backend service on
      Railway's private network.

---

## Part B: Secrets Inventory and Storage

### Design
Every secret the app needs, where it's stored, and how it's rotated — written down once so nothing
is guessed later. Railway and Vercel each have a built-in encrypted env var store; that *is* this
project's "key vault." A dedicated secrets-manager product (Doppler, Infisical, AWS Secrets Manager)
is unnecessary overhead at this scale — one more account, one more integration, one more thing that
can misconfigure — and is called out as a non-goal.

| Secret | Where it lives | Notes |
|---|---|---|
| `SECRET_KEY` (JWT signing) | Railway env var | Generate with `secrets.token_hex(32)`; rotating it invalidates all existing sessions/refresh tokens — document that tradeoff in the runbook. |
| `DATABASE_URL` | Railway env var (auto-injected by the Postgres plugin) | Never manually copy this into a file. |
| `MAPS_API_KEY` (server-side) | Railway env var | Per `.env.example`, do not restrict by HTTP referrer (server calls have none); restrict by IP in GCP console once the Railway static egress IP is known, if Railway's tier provides one — otherwise leave unrestricted but keep it server-side only, which is already the design. |
| `NEXT_PUBLIC_MAPS_API_KEY` (client-side) | Vercel env var | Safe to expose; restrict by HTTP referrer to the production domain in GCP console once that domain is known (Part C). |
| `ORS_API_KEY` | Railway env var | Free tier (500 req/day) — Part D adds monitoring so this is visibly the cause if isochrone requests start failing from quota exhaustion. |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Railway / Vercel env vars | Already documented as non-secret (write-only DSN) in `docs/security-alerting.md`. |
| `CORS_ORIGINS` | Railway env var | Set to the exact Vercel production URL (+ custom domain if added later). No wildcards. |

### Acceptance Criteria
- [ ] No secret exists in any committed file, `.env` (real, non-example), shell history saved to a
      dotfile, or Slack/chat message.
- [ ] The table above (or its equivalent) exists in `docs/` so a future session/collaborator doesn't
      have to reverse-engineer where each secret lives.
- [ ] Each API key is scoped to the minimum permission it needs (Maps key restricted by referrer or
      IP, not left fully open).

---

## Part C: Vercel — Frontend

### Design
`frontend/vercel.json` already declares the framework, build command, and output directory — Vercel
needs only the GitHub connection and env vars.

1. **Import the repo into Vercel**, set the project root to `frontend/`.
2. **Set env vars**: `NEXT_PUBLIC_API_URL` (the Railway backend's public URL from Part A),
   `NEXT_PUBLIC_MAPS_API_KEY`, `NEXT_PUBLIC_SENTRY_DSN`.
3. **Confirm preview deployments** (Vercel's default for non-`main` branches/PRs) point at a
   preview `NEXT_PUBLIC_API_URL` or the same production backend — decide explicitly rather than by
   default, since a preview frontend hitting prod backend/DB is a real risk for a trip-planning app
   with user data. Recommended: preview deployments use the same production backend (there's no
   staging backend per the Out of Scope decision above), but this means preview branches can create
   real user data — acceptable at personal-project scale, but worth a one-line note in the runbook
   so it's a decision, not an accident.
4. **After first deploy**, take the resulting `*.vercel.app` URL and set it as `CORS_ORIGINS` on the
   Railway backend (Part A step 3) — there's a one-time circular dependency (frontend needs the
   backend URL, backend's CORS needs the frontend URL) that just requires deploying backend first,
   then frontend, then updating backend's `CORS_ORIGINS` once the frontend URL is known.

### Acceptance Criteria
- [ ] Pushing to `main` triggers an automatic Vercel deploy of the frontend.
- [ ] The deployed frontend successfully calls the Railway backend (no CORS errors in browser
      console).
- [ ] The Maps JS key works from the production domain and is confirmed rejected from an arbitrary
      other origin (referrer restriction actually enforced, not just configured).
- [ ] Preview-deployment behavior (which backend they hit) is a documented decision, not an
      accident.

---

## Part D: Production-Only Guardrails (code changes)

### Problem
Everything above is configuration. These four are the only actual code changes this phase needs —
small gaps that only matter once there's a real production environment to protect.

1. **`DATABASE_URL` scheme shim** (Part A, item 2) — `backend/app/config.py` should accept
   Railway's injected `postgresql://` form transparently.
2. **`/health` must not depend on the DB being warm/migrated** — confirm (or fix) that Railway's
   healthcheck endpoint returns 200 based on process liveness, not a DB query, so a slow-starting
   migration doesn't cause Railway to kill the container mid-boot in a restart loop. If `/health`
   currently does check DB connectivity, consider a lightweight process-only check for the
   healthcheck path specifically, since `railway.toml`'s `healthcheckTimeout = 30` gives a narrow
   window.
3. **CORS origin exact-match, no accidental wildcard** — confirm `cors_origins_list`
   (`config.py:24-26`) is used with FastAPI's `CORSMiddleware` as an exact allowlist, not a regex or
   wildcard fallback, now that it's protecting a real production origin instead of `localhost`.
4. **ORS quota-exhaustion visibility** — the free ORS tier (500 req/day) will eventually get hit at
   some usage level. Add a structured log line (following the Phase 10 `security`-logging pattern)
   or a Sentry breadcrumb when ORS returns a rate-limit/quota error, so a "radius mode isochrones
   silently stopped working" bug reports as a clear quota event instead of a confusing 500.

### Acceptance Criteria
- [ ] A `DATABASE_URL` in Railway's native `postgresql://` form works with no manual edits.
- [ ] `/health` returns 200 within Railway's healthcheck timeout on a cold boot that includes running
      pending migrations.
- [ ] CORS rejects a request from an origin not in `CORS_ORIGINS`, confirmed against the live prod
      deploy (not just unit-tested).
- [x] An ORS 429/quota response produces a distinguishable log/Sentry event, not a generic 500.
      (Implemented 2026-09-18 in `app/core/upstream_log.py`. Note ORS returns **403** for daily
      quota exhaustion — the same status as a bad key — so quota is inferred from 429, or from 403
      only when `x-ratelimit-remaining` confirms nothing is left. Remaining quota is also logged at
      INFO on every successful call, so exhaustion shows as a downward trend before it becomes an
      outage.)

---

## Part E: Runbook

### Design
A short markdown doc, `docs/deployment-runbook.md`, covering the things a solo maintainer forgets
between deploys:
- How to deploy (push to `main`; both platforms auto-deploy — link each dashboard).
- How to roll back (Railway: redeploy a previous build from its deployment history; Vercel: promote
  a previous deployment to production — both are dashboard actions, no CLI required, document the
  exact buttons).
- How to rotate `SECRET_KEY` (generate new value, set in Railway, understand it invalidates all
  active sessions — a deliberate, rare operation, not routine).
- How to rotate the Maps/ORS keys (regenerate in the respective provider console, update the env
  var, no invalidation side effects).
- Where each secret lives (link to Part B's table).
- Current expected monthly cost and where to check current usage against each platform's free-tier
  limits, so a bill surprise is caught by the maintainer checking a dashboard, not by an actual
  invoice.
- Optional custom-domain setup steps (Vercel + Railway both support this with no code changes —
  documented as an appendix, not a requirement).

### Acceptance Criteria
- [x] `docs/deployment-runbook.md` exists and a person unfamiliar with the deploy (including
      future-you in six months) could follow it to deploy, roll back, and rotate a secret without
      re-deriving any of this PRD. (Written 2026-09-18. Also carries a Troubleshooting section for
      the failure modes actually hit during the first deploy — stale Railway domains, dashboard
      env-var quoting, the ORS host migration, and the Vercel function-timeout risk — plus the
      Sentry setup procedure, which `security-alerting.md` deliberately doesn't cover.)
- [x] The runbook states the current expected monthly cost figure and links to both platforms'
      current usage/billing dashboards.

---

## Acceptance Criteria (full phase)
- [ ] Backend is live on Railway with Postgres, auto-migrating on deploy, health-checked, and backed
      up with at least one verified restore.
- [ ] Frontend is live on Vercel, successfully talking to the Railway backend with no CORS errors.
- [ ] Every secret lives only in Railway/Vercel's env var stores — none committed, none in shell
      history files.
- [ ] The Phase 8 production secret-key guard and Phase 10 Sentry/structured-logging setup are both
      confirmed working against the *real* production deploy, not just locally.
- [ ] `docs/deployment-runbook.md` exists and covers deploy, rollback, and secret rotation.
- [ ] Monthly cost is known and, at expected personal-project traffic, is $0 or close to it (Vercel
      Hobby tier + Railway's lowest paid tier, since Railway no longer has a fully free tier as of
      recent pricing changes — confirm current pricing before committing, since this changes).

---

## Future Phase Candidates (not this phase)
Noted here so they aren't lost, not because they're needed now:
- **Custom domain** — cosmetic/branding, zero-code, purely a "does the user want one" decision.
- **Redis-backed rate limiting** — only if/when horizontal scaling happens.
- **Dedicated secrets manager** (Doppler/Infisical) — only if the number of environments or
  collaborators grows enough that Railway/Vercel's per-project env var stores stop being enough.
- **Staging environment** — only if change velocity or user count grows enough that testing against
  prod (mitigated today by Railway preview environments) stops being acceptable.
- **Multi-instance backend / Redis rate-limit migration** — only under real concurrent load Railway's
  single instance can't handle.
