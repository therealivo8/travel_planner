# PRD — Phase 9: AI Suggest-Stops, Global Navigation & Itinerary Completion

## Overview
Three independent gaps, bundled into one phase because each is either small or a prerequisite for
work already in flight:

- **Part A** ships the first slice of Phase 6 (LLM Integration) rather than all of it at once.
  `docs/prd/phase-6-llm-integration.md` specifies four AI features; this phase builds **only**
  waypoint suggestions (`POST /trips/{trip_id}/ai/suggest-stops`), because Phase 7 deliberately built
  `corridor.discover_corridor_suggestions()` (`backend/app/services/corridor.py:77-140`) with no
  FastAPI/DB coupling specifically so an AI endpoint could call it directly and re-rank its output —
  see the "Phase 6 hook-in" note in `docs/prd/phase-7-corridor-and-itinerary-optimization.md:133-134`.
  This is the cheapest of the four Phase 6 features to build and the easiest to evaluate, and it
  unblocks the landing page's existing "Coming soon" AI card (`frontend/src/app/page.tsx:65`).
- **Part B** gives the app a working global navigation shell and a reachable sign-out control. This
  was scoped separately from Phase 8's sign-out *endpoint* fix because it touches layout files
  across every page rather than auth logic, but it's a hard dependency of Phase 8 being
  user-visible — see `docs/prd/phase-8-hardening-and-bugfixes.md`, Part A.
- **Part C** closes three persistence gaps in the Phase 5 itinerary board that were shipped
  incomplete: drag-to-unschedule doesn't save, in-day reordering doesn't save, and arrival
  times/day dates have no input UI despite being fully supported by the data model and API.

## Prerequisites
- Phases 1–5 and 7 complete.
- Phase 8 (Hardening & Bug Fixes) complete or in progress — Part A of this phase adds the nav bar
  that makes Phase 8's new logout endpoint reachable; doing Part B without Phase 8 landed first
  would ship a sign-out button that calls a broken flow.
- Anthropic API key, for Part A only.

## Goals
- A user can ask for stop suggestions in natural language and get back places tied to real,
  geometrically-valid candidates — not hallucinated addresses — with a stated reason for each.
- Every authenticated page has a persistent nav with a working user menu and sign-out.
- The itinerary board's drag interactions all persist; a reload never reverts a user's arrangement.

## Out of Scope
- The other three Phase 6 features (natural-language trip creation, auto-schedule, narrative
  generator, conversational chat) — remain as specified in `phase-6-llm-integration.md` for a later
  phase once suggest-stops validates the approach.
- Any test suite (separate phase).
- Redesigning the itinerary board's mobile layout (tracked separately; Part C only fixes
  persistence, not the `min-w-[240px]` fixed-column layout that's cramped under 375px).

---

## Part A: AI Suggest-Stops

### Model selection
`phase-6-llm-integration.md:28,252` names `claude-sonnet-4-6` and `claude-opus-4-8`. **Those IDs must
be re-verified against current Anthropic model IDs before implementation** — do not copy them
as-is. At time of writing this PRD, the current generation is Claude 5 (Opus 5 / Sonnet 5 / Haiku
4.5); confirm the exact model ID string against the `claude-api` reference at implementation time
rather than trusting either this document or the Phase 6 PRD.

### Tech stack additions
| Concern | Choice |
|---|---|
| LLM provider | Anthropic Claude — model ID to be confirmed at implementation time (see above) |
| Python SDK | `anthropic` (official), added to `backend/pyproject.toml` |
| Config | `anthropic_api_key: str = ""` added to `Settings` (`backend/app/config.py`), never exposed to frontend |
| Prompt caching | Required on the candidate-pool context block per call, per Phase 6's stated design decision (`docs/prd/README.md:62`) |

### Data model
No new tables. This feature is stateless per-request — unlike Phase 6's chat feature, there's no
conversation history to persist.

### API Endpoint
| Method | Path | Notes |
|---|---|---|
| POST | `/trips/{trip_id}/ai/suggest-stops` | Bearer auth. Rate limit `10/hour` (LLM calls are the most expensive external call in the system — tighter than the `10/hour` on `/radius/discover`, which this reuses as a starting point, not a hard requirement). 400 if the trip has no calculated route (point-to-point) or no isochrone (radius mode). |

**Request:**
```json
{
  "preferences": ["scenic views", "local food", "avoid highways"],
  "max_suggestions": 5
}
```

**Response:** same shape as `phase-6-llm-integration.md`'s spec —
```json
{
  "suggestions": [
    {
      "place_id": "...",
      "name": "Shawnee National Forest",
      "address": "...",
      "reason": "Scenic forest 45 min off your current route with stunning rock formations",
      "lat": 37.5,
      "lng": -88.7,
      "estimated_detour_minutes": 45
    }
  ]
}
```
`place_id`/`lat`/`lng` are populated from the underlying discovery call, not from the model — see
pipeline step 3 below. This guarantees every suggestion is a real, mappable place.

### Pipeline (`backend/app/services/ai_suggest.py`, new)
1. Determine trip mode. For point-to-point, call
   `corridor.discover_corridor_suggestions()` directly (already DB-free per its docstring) using the
   trip's stored route/polyline to get a geometrically-valid, quality-floored candidate pool — do
   **not** re-implement route sampling. For radius mode, call the equivalent radius discovery
   service (`app/services/radius.py`) using the trip's stored isochrone.
2. Take the top ~30 candidates from that pool (already ranked by time-bucket + quality per Phase 7)
   as the context Claude reasons over — this bounds token usage and keeps latency predictable
   regardless of how large the raw candidate pool is.
3. Call Claude with **tool use** — a `select_stops` tool whose schema is `{place_id, reason}[]`,
   constrained to `place_id` values present in the candidate pool passed in context. Claude's job is
   filtering/ranking by the user's stated natural-language preference, not generating new places.
   This is what makes hallucination structurally impossible: the model can only pick `place_id`s it
   was shown, never invent one.
4. Cache the candidate-pool context block (`cache_control: {"type": "ephemeral"}`) since it's large
   and identical across repeated calls with different preference text on the same trip.
5. Map the returned `place_id`s back to their full candidate records (name/address/lat/lng/detour)
   from step 1's pool, attach Claude's `reason` text, and return — the backend never trusts
   coordinates or addresses from the model's output, only from the discovery pipeline.
6. 30-second timeout on the Claude call; on timeout or API error, return a 503 with a generic
   message (do not leak Anthropic error text — same principle as Phase 8 Part F).

### Frontend
- New `SuggestStopsModal` component (`frontend/src/components/ai/SuggestStopsModal.tsx`), per
  `phase-6-llm-integration.md:212-216`: preference chips (Scenic / Food & Drink / History /
  Adventure), suggestion cards with name/reason/detour time, "Add to Trip" button per suggestion
  that inserts the place the same way an existing `SuggestionCard` selection does (reuse the
  radius/corridor `select` endpoints' insert-as-waypoint logic rather than adding a new insertion
  path).
- Entry point: "Suggest Stops" button on the trip detail page waypoint list, enabled once a route
  (point-to-point) or isochrone (radius) exists — same precondition pattern as corridor's "no route
  calculated yet" guard (`frontend/src/app/trips/[trip_id]/corridor/page.tsx:96-100`).
- Landing page: swap the AI feature card's "Coming soon" badge
  (`frontend/src/app/page.tsx:65`) for a real link once this ships.

### Acceptance criteria specific to this part
- [ ] `POST /trips/{trip_id}/ai/suggest-stops` returns suggestions whose `place_id`/`lat`/`lng`
      exactly match entries from the trip's own discovery pool — never a coordinate absent from
      that pool.
- [ ] Each suggestion includes a non-empty `reason` string relevant to the stated preferences.
- [ ] A request with no route/isochione yet returns 400, not a 500 or empty list.
- [ ] Second identical call within the cache TTL shows a cache hit in Anthropic usage metadata.
- [ ] The Anthropic API key never appears in any frontend bundle or network response.
- [ ] A simulated Claude timeout returns a generic 503, with the real error logged server-side only.
- [ ] "Add to Trip" from a suggestion card results in a real waypoint, visible on the trip detail map
      after the modal closes.

---

## Part B: Global Navigation & Session UI

### Problem
`PageShell.tsx` (`frontend/src/components/layout/PageShell.tsx`) has zero importers in production
code, and `TopNav.tsx` is imported only by `PageShell` and the dev-only `/design` route. Every real
page hand-rolls its own `bg-white border-b` header. Result: **the authenticated app has no global
nav, no user menu, and no sign-out control anywhere outside `/design`** — contradicting
`docs/prd/phase-0-design-system.md:111-131`, which specifies `TopNav` as a shared shell component.

### Design
1. Wrap all authenticated routes (`/trips`, `/trips/new`, `/trips/[trip_id]`, `/trips/[trip_id]/discover`,
   `/trips/[trip_id]/corridor`, `/trips/[trip_id]/itinerary`) in the existing `PageShell` +
   `TopNav`, replacing each page's hand-rolled header. Reuse these components as designed rather than
   introducing a new shell — they already have the correct responsive/mobile-menu behavior via the
   `Sheet` primitive.
2. Add a user menu to `TopNav`: display name/email from `useAuth()`, a "Sign Out" item that calls
   the now-working `logout()` from Phase 8 Part A and redirects to `/login`.
3. Fix the two dead links surfaced during the same audit: `TopNav.tsx:25` points at `/explore`
   (no such route) and `frontend/src/app/page.tsx:218,221` point at `/privacy`/`/terms` (neither
   exists). Either build minimal placeholder pages or remove the links — removing is the smaller
   change and avoids implying content that doesn't exist.
4. No change to `proxy.ts`'s auth-gating logic — this part is purely the visible shell around
   already-gated pages.

### Acceptance criteria specific to this part
- [ ] Every authenticated page shows the same top nav with a user menu.
- [ ] Sign Out is reachable from any authenticated page in at most one click, and results in the
      Phase 8 Part A behavior (cookie cleared, redirect to `/login`, no silent re-auth on reload).
- [ ] No links in the app point to a route that 404s.

---

## Part C: Itinerary Board Persistence

### Problem
Three gaps in the Phase 5 itinerary board (`frontend/src/app/trips/[trip_id]/itinerary/page.tsx`),
all confirmed against source:

1. **Drag-to-unschedule doesn't persist.** `handleDragEnd` (`:336-346`) calls the `assign` endpoint
   with `waypoint_ids: []` when a waypoint is dropped into the Unscheduled column, and the backend
   no-ops on an empty list (`backend/app/api/itinerary.py:218`, `if body.waypoint_ids:`). The
   optimistic UI shows the move; a reload reverts it. (The `void overId; // suppress lint` and the
   `"Persist unschhedule"` comment at the same call site mark this as a known gap, not an oversight
   to rediscover.)
2. **In-day reordering doesn't persist.** `SortableContext` allows visually reordering waypoints
   within a day, but only the `assign` endpoint (day membership) is ever called — nothing sends the
   new order.
3. **No input UI for arrival times or day dates**, despite both being fully supported:
   `ItineraryWaypoint.scheduled_arrival_time` is typed, accepted by
   `POST .../days/{day_id}/assign`, and rendered read-only in the shared trip view
   (`frontend/src/components/trips/SharedTripView.tsx:48-50`) — but no page lets a user set one.
   Same for `day.date`: `DayColumn` displays it if already set (`itinerary/page.tsx:138-143`) but
   nothing can set it, despite `phase-5-trip-management.md:126` specifying an "optional date picker".

### Design
1. **Unschedule fix**: when `handleDragEnd` detects a drop into the Unscheduled column, call a
   distinct "unassign" path rather than `assign` with an empty array — either a new
   `DELETE .../days/{day_id}/waypoints/{waypoint_id}` endpoint, or extend `assign` to accept an
   explicit `unassign: true` (extending is smaller; prefer it unless a dedicated endpoint reads
   more clearly to the implementing agent). The waypoint's `itinerary_day_id` must actually be
   nulled server-side.
2. **In-day reorder fix**: on drag-end within the same day, send the reordered waypoint ID list to
   the backend. Check whether `POST .../days/{day_id}/assign` can be extended to accept ordering (it
   already assigns waypoints to a day; adding a position/order field is the smaller change) before
   adding a new endpoint.
3. **Arrival time input**: add an inline time input to each waypoint row in `DayColumn`
   (`itinerary/page.tsx`), following the existing inline-edit pattern already used for day titles
   (`handleUpdateTitle`, `:241-243`) rather than introducing a new edit-state pattern. Persist via
   the existing `assign` endpoint's `scheduled_arrival_time` field.
4. **Day date picker**: add a date input to `DayColumn`'s header, same inline-edit pattern, calling
   the existing `PATCH .../days/{day_id}` endpoint (`backend/app/api/itinerary.py:131`, already
   accepts partial updates — confirm `date` is in its accepted fields; add it if not).
5. While touching these handlers, fix the two silent-failure patterns nearby: `handleUpdateTitle`'s
   `catch { /* silently ignore */ }` (`:241-243`) should surface a toast (Phase 8/9 both assume
   `sonner` gets adopted — if that migration hasn't landed yet when this part is implemented, a
   minimal inline error state is an acceptable substitute, but silent swallowing should not remain).

### Acceptance criteria specific to this part
- [ ] Dragging a waypoint from a day into Unscheduled persists across a reload.
- [ ] Reordering waypoints within a day persists across a reload, in the dragged order.
- [ ] A user can set and save an arrival time on any scheduled waypoint; it appears correctly in the
      shared trip view and the PDF export (both already render it if present).
- [ ] A user can set and save a date on any itinerary day.
- [ ] A failed persistence attempt (e.g. simulated network failure) surfaces visibly to the user
      rather than silently reverting on next reload with no explanation.

---

## Acceptance Criteria (full phase)
- [ ] All Part A, B, and C criteria above pass.
- [ ] `ruff check app/`, `mypy app/`, `pnpm typecheck`, `pnpm lint` all pass.
- [ ] Manual end-to-end walk: sign in via the new nav → open a point-to-point trip with a calculated
      route → open Suggest Stops, request suggestions with a preference, add one to the trip → open
      the itinerary board, drag it into a day, set an arrival time, reorder it against another stop,
      drag a different stop back to Unscheduled → reload the page → every change from this walk is
      still present → sign out from the nav → reload → still signed out.

---

See also: [phase-6-llm-integration.md](./phase-6-llm-integration.md) (full LLM scope; this phase
implements only its "Waypoint Suggestions" section), [phase-7-corridor-and-itinerary-optimization.md](./phase-7-corridor-and-itinerary-optimization.md)
(the discovery pipeline this phase reuses), [phase-8-hardening-and-bugfixes.md](./phase-8-hardening-and-bugfixes.md)
(sign-out endpoint this phase's nav depends on), [phase-0-design-system.md](./phase-0-design-system.md)
(original `TopNav`/`PageShell` spec), [phase-5-trip-management.md](./phase-5-trip-management.md)
(original itinerary board spec).
