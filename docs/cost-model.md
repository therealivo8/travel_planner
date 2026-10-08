# Cost Model — Running Road Trip Planner as a Personal Project

What this app costs to run each month, which features cost money per use, and how many uses
fit inside each provider's free tier. Read this before adding any feature that calls an external
API. The guardrails that enforce these numbers are in
[`prd/phase-14-api-budget-and-caching.md`](./prd/phase-14-api-budget-and-caching.md).

> Prices were checked on 2026-10-08. Providers change pricing without much notice, so check the
> linked pricing pages before relying on any number here. Google's "$200/month credit" mentioned in
> [`maps-provider-decision.md`](./maps-provider-decision.md) **no longer exists**. Google replaced
> it in March 2025 with a free monthly allowance per SKU (see below).

---

## Fixed monthly costs

| Item | Plan | Cost / month | Notes |
|---|---|---|---|
| Railway (backend + Postgres) | Hobby | **$5** (includes $5 of usage) | Usage beyond $5 is billed per second: $20/vCPU-mo, $10/GB-RAM-mo, $0.15/GB-mo for volumes. A single small FastAPI replica plus a small Postgres usually stays within the included $5. |
| Vercel (frontend) | Hobby | $0 | **Non-commercial use only.** Serverless functions are capped at 60s. |
| Sentry | Developer (free) | $0 | 5k errors/month. |
| Domain (optional) | — | ~$1 | About $12/year. |
| **Total fixed** | | **≈ $5–6** | |

## Variable (per-use) costs

### Google Maps Platform: free allowance per SKU (since March 2025)

Each SKU has its **own** free monthly allowance. Unused allowance on one SKU does not carry
over to another.

| Tier | Free events / month / SKU | Overage (typical) |
|---|---|---|
| Essentials | 10,000 | ~$5 / 1k |
| Pro | 5,000 | ~$17–32 / 1k |
| Enterprise | 1,000 | higher |

How this app's calls map onto those tiers:

| SKU | Tier | Called from | Calls per action |
|---|---|---|---|
| Dynamic Maps (JS) | Essentials | every page that shows a map | 1 per map load |
| Places Autocomplete | Essentials | `AddressAutocomplete.tsx` | 1 session per address picked |
| Directions (legacy) | Essentials | `services/routes.py` | 1 per route calculation |
| Geocoding | Essentials | `services/routes.py` | 1 per fallback lookup |
| **Nearby Search** | **Pro** | `services/places.py` | **see below — the main cost driver** |
| Distance Matrix (legacy) | Essentials (billed per *element*) | `services/places.py` | **see below** |

Calls per feature, measured from the current code:

| Feature | Nearby Search calls (Pro) | Distance Matrix elements | ORS isochrones |
|---|---|---|---|
| Radius discover (`/radius/discover`) | ≤ 10 (5 types × 2 pages) | ~50–200 (one per candidate that passes the quality filter) | 1 |
| **Corridor discover** (`/corridor/discover`) | **≤ 40** (8 samples × 5 types) | **~100–500** (2 per candidate: origin→stop and stop→destination) | 0 |
| Optimize a day / build an itinerary | 0 | **N²** for N stops (15 stops = 225) | 0 |
| Route calculation | 0 | 0 (1 Directions call instead) | 0 |

**How many runs fit in the free tier, from the current code:**
- Corridor discover: about **125/month**, limited by Nearby Search (5,000 ÷ 40), or **20–100/month**
  limited by Distance Matrix. One person testing heavily can exhaust this.
- Radius discover: about **50–200/month**, limited by Distance Matrix.

The per-user limits in `slowapi` (`10/hour` on discover) do **not** prevent this. They are
per user, per hour, and stored in memory, so they reset on every deploy. Nothing currently caps total
spend across all users. Phase 14 adds that cap.

### OpenRouteService (HeiGIT Standard plan, free)

| Endpoint | Daily limit | Per-minute limit |
|---|---|---|
| Isochrones | **500** | **20** |

There is no billing, so the risk is hitting the limit rather than paying. When the limit is
reached, radius mode stops working for everyone until UTC midnight. The `2,000/day` figure in
`maps-provider-decision.md` is the limit for the *directions* endpoint, not isochrones.

### Anthropic Claude (if Phase 18 is built)

Prices per million tokens as of 2026-10:

| Model | Input | Output | Cache read |
|---|---|---|---|
| Claude Opus 5.5 (`claude-opus-5-5`) | $4 | $20 | $0.20 |
| Claude Sonnet 5.5 (`claude-sonnet-5-5`) | $2 | $10 | $0.20 |
| Claude Haiku 4.5 (`claude-haiku-4-5`) | $1 | $5 | — |

A typical structured call in this app (about 3k tokens in and 800 out) costs about **$0.03 on Opus
5.5** or **$0.014 on Sonnet 5.5**. 200 AI actions a month comes to roughly **$3–6**. Set a monthly
spend limit in the Anthropic Console as a hard backstop.

### Other services proposed in Phases 15–19 (all have free tiers)

| Service | Used for | Free tier | Phase |
|---|---|---|---|
| Resend (or Postmark) | password reset and invite emails | 3,000 emails/month | 15, 19 |
| Open-Meteo | weather forecast for each trip day | 10,000 calls/day for non-commercial use, no key needed | 16 |
| Cloudflare R2 | trip journal photos | 10 GB stored, **no egress fees** | 17 |
| Google Maps URLs (`https://www.google.com/maps/dir/?api=1&...`) | "Open in Google Maps" navigation links | **Free, no API key, not billed** | 16 |

---

## Target monthly budget

| Scenario | Expected monthly cost |
|---|---|
| You plus a few friends, Phase 14 guardrails in place | **$5–8** (Railway + domain + a little Claude) |
| Same usage, *without* Phase 14 | $5 plus unbounded Google overage. A single run of heavy corridor testing can cost $10–40. |

### Rules for every future feature
1. **Prefer features that call no API.** Build on data already stored (polylines, waypoints, drive
   times) before calling a new API.
2. **Every paid upstream call goes through the Phase 14 budget check.** Never call the Google
   client directly from a new endpoint.
3. **Make expensive calls only when the user asks** (for example, Place Details when a user expands
   a card), never in bulk.
4. **Cache anything the provider's terms allow you to cache.** ORS/OSM-derived data can be cached
   freely. Google content has restrictions; see the Phase 14 notes.
