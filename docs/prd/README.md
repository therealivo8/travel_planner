# Road Trip Planner — PRD Index

## Project Summary
A web application for planning car road trips. Users create trips in one of two modes:
- **Point-to-point**: defined start and end destination with optional waypoints.
- **Radius mode**: starting location + max drive time; the app surfaces reachable destinations.

Both modes go beyond simple point-A-to-point-B navigation: point-to-point trips can discover stops *along the route* within an acceptable detour, and radius trips can auto-build a time-budgeted day itinerary rather than just a naive stop list.

**Tech stack**: Next.js 15 (App Router) · FastAPI · PostgreSQL 16 · OpenAPI 3.1

---

## Phases

| Phase | Document | Dependencies | Scope |
|---|---|---|---|
| 0 | [phase-0-design-system.md](./phase-0-design-system.md) | none | Color palette, typography, shadcn/ui components, landing page, `/design` showcase |
| 1 | [phase-1-foundation.md](./phase-1-foundation.md) | Phase 0 | Monorepo scaffold, Docker Compose, CI |
| 2 | [phase-2-auth-and-data-model.md](./phase-2-auth-and-data-model.md) | Phase 1 | JWT auth, full DB schema, trips/waypoints CRUD |
| 3 | [phase-3-point-to-point-routing.md](./phase-3-point-to-point-routing.md) | Phase 2 | Maps integration, route calculation, interactive map UI |
| 4 | [phase-4-radius-mode.md](./phase-4-radius-mode.md) | Phase 3 | Isochrone, POI discovery, radius trip flow |
| 5 | [phase-5-trip-management.md](./phase-5-trip-management.md) | Phase 4 | Itinerary builder, sharing, PDF export, dashboard |
| 6 | [phase-6-llm-integration.md](./phase-6-llm-integration.md) | Phase 5 | **Shelved — AI features are not planned for now.** Kept only as a record if they are revisited. Nothing from it is built |
| 7 | [phase-7-corridor-and-itinerary-optimization.md](./phase-7-corridor-and-itinerary-optimization.md) | Phase 5 | Corridor stop discovery (point-to-point), radius itinerary optimization |
| 8 | [phase-8-hardening-and-bugfixes.md](./phase-8-hardening-and-bugfixes.md) | Phase 7 | Sign-out, token refresh, rate-limit fix, PDF injection fix, prod secret-key guard, error-detail leakage |
| 9 | [phase-9-suggest-stops-and-navigation.md](./phase-9-suggest-stops-and-navigation.md) | Phase 7, Phase 8 | AI suggest-stops (**Part A shelved, not built**), global nav + sign-out UI, itinerary board persistence fixes |
| 10 | [phase-10-security-hardening-round-2.md](./phase-10-security-hardening-round-2.md) | Phase 9 | Rate-limit auth/export endpoints, Sentry + structured security logging + alerting, CI lockfile pinning, `next` upgrade, input bounds |
| 11 | [phase-11-production-deployment.md](./phase-11-production-deployment.md) | Phase 10 | Deploy to Railway (backend + Postgres) + Vercel (frontend), secrets inventory, prod guardrails, deployment runbook |
| 12 | [phase-12-resume-relevant-devops-practices.md](./phase-12-resume-relevant-devops-practices.md) | Phase 11 | Terraform IaC for Railway/Vercel, CI/CD pipeline that gates deploy on tests, real backend/frontend test suites, external-reader repo documentation |
| 13 | [phase-13-itinerary-builder-completion.md](./phase-13-itinerary-builder-completion.md) | Phase 9 | Itinerary board: register day columns as drop targets (drag was inert), non-drag assign paths, day feasibility/auto-order/notes |
| 14 | [phase-14-api-budget-and-caching.md](./phase-14-api-budget-and-caching.md) | Phase 11 | Postgres-backed daily/monthly budget per upstream SKU, per-user daily quotas, isochrone + discovery caches, 3–5× cheaper corridor discovery, `/admin/usage` page. **Do this first** — every later phase adds traffic |
| 15 | [phase-15-account-onboarding-and-polish.md](./phase-15-account-onboarding-and-polish.md) | Phase 14 | Settings (units, home address, password change, export, delete account), password reset via Resend, zero-API demo trip, toasts/404/error pages, mobile pass, privacy/terms + attribution |
| 16 | [phase-16-trip-logistics-toolkit.md](./phase-16-trip-logistics-toolkit.md) | Phase 13 (15 optional) | Fuel-cost estimate + expense tracker, Open-Meteo weather per day + sunset warning, packing checklist, "Open in Google/Apple Maps" deep links, .ics/.gpx export — **no Google/ORS calls** |
| 17 | [phase-17-on-the-road-and-trip-memories.md](./phase-17-on-the-road-and-trip-memories.md) | Phase 15, 16 | PWA + offline itinerary, Today view with check-ins, journal + photos on Cloudflare R2, trip recap, "My Map" of all trips, polyline SVG thumbnails + `next/og` share previews (no Static Maps) |
| 18 | *(removed)* | — | The AI layer was dropped; the number is left unused so Phase 19 and its cross-references stay stable |
| 19 | [phase-19-collaborative-trips.md](./phase-19-collaborative-trips.md) | Phase 14, 15 | Consolidate the 8 copies of trip-ownership checks, trip members (owner/editor/viewer) via invite links, stop voting, comments, optimistic concurrency + 20s polling, activity feed |

---

## Phase Dependency Graph
```
Phase 0 (Design System) ──┐
                          ├── can run concurrently
Phase 1 (Foundation) ─────┘
    └── Phase 2 (Auth + Data Model)
            └── Phase 3 (Point-to-Point Routing)
                    └── Phase 4 (Radius Mode)
                            └── Phase 5 (Trip Management)
                                    ├── Phase 6 (LLM Integration)
                                    └── Phase 7 (Corridor Stops & Itinerary Optimization)
                                            └── Phase 8 (Hardening & Bug Fixes)
                                                    └── Phase 9 (Suggest-Stops, Nav & Itinerary Completion)
                                                            └── Phase 10 (Security Hardening, Round 2)
                                                                    └── Phase 11 (Production Deployment)
                                                                            └── Phase 12 (Resume-Relevant DevOps Practices)

Phase 9 (Itinerary board) ── Phase 13 (Itinerary Builder Completion)
    └── independent of 10-12; touches only the itinerary board

"Complete app" track (cost-aware; see ../cost-model.md):
Phase 11 ── Phase 14 (API Budget & Caching)  ← do first
                ├── Phase 15 (Account, Onboarding & Polish)
                │       ├── Phase 17 (On the Road & Memories) ← also needs 16
                │       └── Phase 19 (Collaborative Trips)
Phase 13 ── Phase 16 (Trip Logistics Toolkit, zero API cost) ── Phase 17
```

Suggested order: **14 → 16 → 15 → 17 → 19**. Phase 16 is cheap and very visible, so it can
start as soon as 13 is done; 19 is the largest.

Each phase is designed to be independently workable in a single agent session with a focused context window.

---

## External API Dependencies
| API | Used In | Purpose |
|---|---|---|
| Google Maps Platform | Phase 3, 4 | Geocoding, Places Autocomplete, Routes API, Nearby Search, Distance Matrix, Static Maps |
| OpenRouteService | Phase 4 | Isochrone (drive-time boundary) generation — free Standard plan: 500 isochrones/day, 20/min |
| Open-Meteo | Phase 16 | Weather forecast + sunrise/sunset (free, no key, non-commercial) |
| Google Maps URLs | Phase 16 | Navigation deep links (free, no key, not billed) |
| Resend | Phase 15, 19 | Password-reset and invite email (free tier 3k/month) |
| Cloudflare R2 | Phase 17 | Journal photo storage (10 GB free, zero egress) |

Per-feature call counts, free-tier capacity, and the monthly budget are in
[`../cost-model.md`](../cost-model.md).

---

## Key Design Decisions
- **Design system first (Phase 0)**: color palette, component library, and landing page are defined before any feature work so all agents share the same visual language.
- **shadcn/ui + Tailwind**: component primitives generated into the repo (not a runtime dependency); all styling via Tailwind tokens — no hardcoded hex values in components.
- **Full DB schema in Phase 2**: all tables are created upfront to avoid destructive migrations in later phases.
- **Refresh token in httpOnly cookie**: keeps the long-lived token out of JS memory/localStorage.
- **Maps API key server-side only**: frontend never receives the API key; a proxy endpoint handles geocoding.
