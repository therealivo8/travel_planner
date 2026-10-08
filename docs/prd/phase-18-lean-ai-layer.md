# PRD — Phase 18: Lean AI Layer (re-scoping Phase 6 and Phase 9 Part A)

## Overview
`docs/prd/phase-6-llm-integration.md` specified five AI features, and
`phase-9-suggest-stops-and-navigation.md` Part A planned to ship the first of them. **Neither has
been built**: nothing in `backend/` imports `anthropic`, and the landing page still shows a
"Coming soon" AI card. The project memory lists "Claude AI" as part of the stack, so a portfolio
reviewer will expect it.

This PRD replaces the remaining Phase 6 scope with a **smaller, cost-bounded set of features**,
chosen with three rules:

1. **Claude never invents places.** It only chooses from candidates the app already has (Phase 14
   cached discovery results, the user's own waypoints). This avoids made-up places and avoids
   extra Google calls.
2. **Every AI call has a bounded cost**: one structured request, no open-ended agent loop, a
   per-user quota, a global monthly cap, and the output cached by an input hash.
3. **Each feature saves the user real effort** that the deterministic code can't.

The **conversational assistant** (Phase 6 feature 5) is deferred. Multi-turn chat costs the most per
user and is the hardest to bound, and the features below cover most of its value.

## Prerequisites
- Phase 14 complete: the budget ledger (`anthropic.*` SKUs), per-user `ai_*` quotas, and the
  discovery cache. The suggest-stops feature depends on the cache.
- Phase 16 Part C (packing list) for feature D.

## Goals
| # | Feature | Saves the user | Typical calls per trip |
|---|---|---|---|
| A | Natural-language trip creation | Filling out the new-trip form | 1 |
| B | AI suggest-stops (curated picks with reasons) | Reading 50 suggestion cards | 1–3 |
| C | Trip and day narrative (share page, PDF, recap) | Writing descriptions | 1, cached until the trip changes |
| D | Smart packing suggestions | Thinking up a list | 1 |

**Cost target: under $5/month** at personal-project usage (see [`../cost-model.md`](../cost-model.md)).

## Out of Scope
- Chat assistant / `trip_conversations` tables (Phase 6 feature 5). The tables proposed in Phase 6
  should **not** be created.
- AI auto-scheduling of arrival times. The deterministic optimizer from Phase 7 and Phase 13 already
  does this better.
- Web search tools. Claude works only with data the app provides.

---

## Shared infrastructure

### Model and configuration
```python
anthropic_api_key: str = ""            # empty → AI features hidden, like sentry_dsn
anthropic_model: str = "claude-opus-5-5"
ai_monthly_token_budget: int = 2_000_000   # input + output tokens, enforced via api_usage_daily
```
- Use `claude-opus-5-5` by default, with `output_config.effort` set to **`low`**. These are short,
  structured tasks, so low effort keeps output tokens and latency down. Thinking can't be disabled
  on Opus 5.5, so control cost with effort.
- `ANTHROPIC_MODEL` can be overridden in Railway. At the time of writing, `claude-sonnet-5-5`
  ($2/$10 per million tokens) costs half as much as Opus 5.5 ($4/$20). This is an owner's
  decision: measure output quality before switching.
- Use **structured outputs** (`output_config.format` with a JSON schema) for every call. Don't use
  forced `tool_choice` (`any` or `tool`); it returns a 400 on Opus 5.5. Validate each response with
  the matching Pydantic model.
- Check `stop_reason` before reading the content. On `refusal`, return a friendly "Couldn't generate
  this — try rephrasing". Enable the server-side `fallbacks` parameter (`"default"`) as recommended
  for Opus 5.5.
- Put a single static system prompt first and mark it with `cache_control`. Prompts shorter than the
  model's minimum cacheable length simply won't be cached. That's acceptable; prompt caching is a
  bonus here, not the main cost control.

### `backend/app/services/ai.py`
One function per feature. Each one:
1. Builds a **canonical input** (sorted JSON of exactly the fields sent) and its `sha256`.
2. Returns the cached row from `ai_generations` if the hash matches. This costs nothing.
3. Calls `budget.reserve(db, "anthropic.tokens", estimate)` (Phase 14) and the user quota
   `ai_<feature>`.
4. Calls Claude, records the actual `usage.input_tokens` and `usage.output_tokens` in the ledger, and
   stores the result.

New table `ai_generations`: `id`, `user_id`, `trip_id` (nullable), `kind` (enum `create`,
`suggest`, `narrative`, `packing`), `input_hash char(64)`, `output jsonb`, `model`, `tokens_in`,
`tokens_out`, `created_at`. Index on (`kind`, `input_hash`).

### Privacy
Send only trip data (titles, addresses, place names and categories, dates). Never send email
addresses or user IDs. Update the Phase 15 privacy page to name Anthropic as a processor.

---

## Feature A: Natural-language trip creation

`POST /ai/parse-trip {text}` → `TripDraft`:
```json
{
  "mode": "point_to_point" | "radius",
  "title": "...",
  "start_text": "Denver, CO",
  "end_text": "Moab, UT" | null,
  "max_drive_minutes": 60 | null,
  "start_date": "2026-11-14" | null,
  "days": 3 | null,
  "categories": ["park", "landmark"],
  "notes": "wants breweries, back by Sunday",
  "clarifications": ["Which weekend did you mean?"]
}
```
- Provide today's date and the user's home address (Phase 15) in the **user message**, not the
  system prompt, so the cached prefix stays stable.
- **No geocoding happens in this call.** The frontend pre-fills the existing new-trip form with the
  draft (`start_text` goes into `AddressAutocomplete`), and the user confirms. Geocoding then runs
  through the normal path and counts against the normal budget.
- UI: on `/trips/new`, a "Describe your trip" textarea above the mode selector, with an example
  placeholder. Any `clarifications` appear as hints on the form.

## Feature B: AI suggest-stops

`POST /trips/{trip_id}/ai/suggest-stops {prompt, max_suggestions ≤ 8}`
- **Candidate pool**: the trip's existing radius or corridor suggestions, or the Phase 14 discovery
  cache. If there are none, return 409 "Run Discover first". **This feature makes no Google calls.**
- Send compact candidate rows (`idx`, name, category, rating, review count, drive or detour minutes,
  `route_fraction`) along with the user's prompt ("kid-friendly, avoid long hikes, one good lunch
  spot").
- The schema returns `[{idx, reason (≤ 140 chars), suggested_day?}]`. Reject any `idx` that isn't in
  the pool. Claude can only choose from the list.
- UI: an "Ask AI to pick" button on the discover and corridor pages. Show the chosen cards with the
  reason as a highlighted caption, and a one-tap "Add all".
- This replaces Phase 9 Part A. Mark that section as superseded.

## Feature C: Trip and day narrative

`POST /trips/{trip_id}/ai/narrative` → `{trip_summary (≤ 80 words), days: [{day_id, blurb (≤ 50 words)}]}`
- The input hash covers the trip title, ordered waypoint names, day assignments, and dates. **It
  regenerates only when those change.** The UI shows a "Trip changed — refresh description?" hint
  rather than regenerating automatically.
- Used on the public share page (above the itinerary), in the PDF export (`api/export.py`; escape it
  with the existing `_e()` helper, because AI output is untrusted text), and on the Phase 17 recap.
- Users can edit the generated text. Save edits to `trips.notes` and `itinerary_days.notes` so the
  owner always controls what's published.

## Feature D: Smart packing suggestions

`POST /trips/{trip_id}/ai/packing` → `[{label, category}]` (≤ 25 items)
- Input: the day count, stop categories, the Phase 16 weather summary if available, and the user's
  existing packing items, so Claude doesn't duplicate them.
- Shown as a preview list of checkboxes. "Add selected" inserts the items into `packing_items`.
- If AI is disabled (no key), the rule-based suggestions from Phase 16 still work.

---

## Cost estimate

| Feature | Input tokens | Output tokens | Opus 5.5 cost per call |
|---|---|---|---|
| A parse-trip | ~1.5k | ~300 | ~$0.012 |
| B suggest-stops (50 candidates) | ~4k | ~600 | ~$0.028 |
| C narrative (5 days) | ~2k | ~700 | ~$0.022 |
| D packing | ~1k | ~400 | ~$0.012 |

At about 150 uncached calls a month, the cost is about **$3**. The `2,000,000` monthly token cap
limits the worst case to roughly **$10–20**, depending on the input/output mix. Also set a hard
**monthly spend limit in the Anthropic Console** as a backstop outside the app.

---

## Acceptance Criteria
- [ ] With `ANTHROPIC_API_KEY` unset, every AI entry point is hidden and the app works normally.
- [ ] "Long weekend from Denver to Moab, leaving Nov 14, we like hikes and breweries" pre-fills a
      point-to-point form with the correct start, end, date, and categories. No geocode call happens
      until the user submits.
- [ ] Suggest-stops returns only places from the existing candidate pool, verified by a test that
      feeds an out-of-range `idx`. It makes zero Google calls.
- [ ] Generating the narrative twice without changing the trip makes one Claude call. Reordering a
      stop shows the refresh hint.
- [ ] AI-generated text in the PDF is HTML-escaped. An injected `<script>` in a place name appears
      as literal text.
- [ ] Exceeding the per-user `ai_*` quota returns 429 `user_quota`. Exceeding the monthly token budget
      returns 503 `budget_exhausted`.
- [ ] Token usage appears under `anthropic.*` on the Phase 14 `/admin/usage` page.
- [ ] The landing page AI card describes features that actually exist.

## Notes for the Implementing Agent
- Before writing SDK code, load the `claude-api` skill and read the Python README for the current
  structured-outputs and fallbacks syntax. Don't rely on Phase 6's code sketches, which predate
  those API changes.
- Add an `evals/` folder with about 15 realistic parse-trip inputs and expected fields, and run it
  before changing `ANTHROPIC_MODEL` or prompts. It's cheap, and it's what makes the AI layer
  credible as a portfolio piece.
- Update `docs/prd/README.md`: mark Phase 6 features 1, 2, and 4 and Phase 9 Part A as superseded
  by this phase, feature 3 (auto-schedule) as dropped, and feature 5 (chat) as deferred.
