# Road Trip Planner — PRD Index

## Project Summary
A web application for planning car road trips. Users create trips in one of two modes:
- **Point-to-point**: defined start and end destination with optional waypoints.
- **Radius mode**: starting location + max drive time; the app surfaces reachable destinations.

**Tech stack**: Next.js 15 (App Router) · FastAPI · PostgreSQL 16 · OpenAPI 3.1 · Anthropic Claude

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
| 6 | [phase-6-llm-integration.md](./phase-6-llm-integration.md) | Phase 5 | Claude AI — natural language planning, suggestions, chat |

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
                                    └── Phase 6 (LLM Integration)
```

Each phase is designed to be independently workable in a single agent session with a focused context window.

---

## External API Dependencies
| API | Used In | Purpose |
|---|---|---|
| Google Maps Platform | Phase 3, 4 | Geocoding, Places Autocomplete, Routes API, Nearby Search, Distance Matrix, Static Maps |
| OpenRouteService | Phase 4 | Isochrone (drive-time boundary) generation |
| Anthropic (Claude) | Phase 6 | LLM — trip creation, suggestions, scheduling, narrative |

---

## Key Design Decisions
- **Design system first (Phase 0)**: color palette, component library, and landing page are defined before any feature work so all agents share the same visual language.
- **shadcn/ui + Tailwind**: component primitives generated into the repo (not a runtime dependency); all styling via Tailwind tokens — no hardcoded hex values in components.
- **Full DB schema in Phase 2**: all tables are created upfront to avoid destructive migrations in later phases.
- **Refresh token in httpOnly cookie**: keeps the long-lived token out of JS memory/localStorage.
- **Maps API key server-side only**: frontend never receives the API key; a proxy endpoint handles geocoding.
- **Tool use for LLM outputs**: Claude never returns free-text that the backend parses — always structured tool calls.
- **Prompt caching on all LLM calls**: large stable context blocks (trip data, system prompts) are cached to reduce cost and latency.
