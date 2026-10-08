# PRD — Phase 16: Trip Logistics Toolkit (Zero-Cost Features)

## Overview
The app is good at deciding **where** to go. Planning a real road trip also involves practical
questions it doesn't answer yet: what gas will cost, what the weather will be, what to pack, how to
get the route onto a phone, and how to add it to a calendar.

Every feature in this phase is built from **data the app already stores** (distances, drive times,
coordinates, day dates) or from **free services that need no key**. Nothing here uses Google or ORS
quota, which makes this the cheapest way to make the app feel more complete.

## Prerequisites
- Phase 5 (itinerary days with dates) and Phase 13 (itinerary builder completed).
- Phase 15 Part A (`users.units`) for unit-aware display. If Phase 15 isn't built yet, default to
  imperial units.

## Goals
1. Every trip shows an **estimated cost** and lets the user track **actual spending**.
2. Each itinerary day shows a **weather forecast** when the trip is within 16 days.
3. Users can tick off a **packing checklist** made from templates.
4. One tap opens a day's route in **Google Maps or Apple Maps navigation** on a phone.
5. Trips export to **calendar (.ics)** and **GPX**, in addition to the existing PDF.

## Out of Scope
- Live gas prices. No free, keyless, reliable API covers the US. The user enters the price, with a
  sensible default.
- Lodging or booking integrations (affiliate APIs, scraping). These take a lot of maintenance.
- Splitting costs between people. Revisit once Phase 19 (collaboration) exists.

---

## Part A: Trip cost estimate and expense tracker

### Data model
`trips` table: add columns
| column | type | default |
|---|---|---|
| `vehicle_mpg` | numeric(4,1) | 28.0 |
| `fuel_price_per_unit` | numeric(5,2) | 3.50 (per gallon, or per litre when units are metric) |
| `budget_total` | numeric(10,2), nullable | — |
| `currency` | char(3) | `USD` |

New table `trip_expenses`: `id`, `trip_id` (FK, cascade), `itinerary_day_id` (nullable FK, SET
NULL), `category` (enum: `fuel`, `lodging`, `food`, `activities`, `other`), `amount numeric(10,2)`,
`note varchar(200)`, `spent_on date`, `created_at`.

### Computation (no API)
- Fuel estimate = `total_distance_meters / 1609.34 / vehicle_mpg × fuel_price`, using the stored
  route. For radius trips, use the sum of the built itinerary legs.
- Show the estimate per day using `distance_meters_from_prev` summed over each day's waypoints.

### Endpoints
CRUD under `/trips/{trip_id}/expenses`. `GET /trips/{trip_id}/budget` returns
`{estimated_fuel, budget_total, spent_by_category, spent_total, remaining}`.

### Frontend
A **Budget** tab on the trip page with an estimate card (editable MPG and fuel price), a quick-add
expense form, a list of expenses grouped by day, and a progress bar of spending against budget.

## Part B: Weather per day (Open-Meteo)

- **Provider: Open-Meteo** (`https://api.open-meteo.com/v1/forecast`). It's free for
  non-commercial use, needs **no API key**, allows about 10k calls a day, and provides a 16-day
  forecast plus sunrise and sunset.
- For each itinerary day that has a `date` within the next 16 days, request the forecast at the
  day's **last stop** (where the user sleeps), or at its first stop if the day has only one.
- Request `daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset`.
- **Cache** in a new table `weather_cache (lat_key, lng_key, date, payload jsonb, fetched_at)`,
  with coordinates rounded to 2 decimals and a 3-hour TTL. Fetch only when the itinerary page
  is viewed, never in bulk.
- Endpoint: `GET /trips/{trip_id}/weather` → `{day_id: {hi, lo, precip_pct, code, sunrise, sunset}}`.
- UI: a small weather chip on each day column header. Days outside the forecast range show
  "Forecast available N days before".
- **Sunset warning**: if a day's last scheduled arrival plus its stop duration is after sunset,
  show "You'll arrive after dark". This uses `scheduled_arrival_time`, which is already stored.
- If Open-Meteo is unavailable, hide the chips. The app shouldn't fail because of weather.
- Credit "Weather data by Open-Meteo.com" in the footer, as Open-Meteo requires (CC BY 4.0).

## Part C: Packing checklist

- New table `packing_items`: `id`, `trip_id`, `label varchar(120)`, `category varchar(40)`,
  `packed bool`, `position smallint`.
- Templates are built-in constants (no database table): *Essentials*, *Camping*, *Beach*,
  *Cold weather*, *Kids*, *Pets*. "Add template" inserts its items, skipping duplicates.
- **Suggestions from data the app already has**: if Part B forecasts rain or lows below 5°C, show a
  dismissible "Add rain or cold-weather gear?" prompt. If any stop's category is `park` or `campground`,
  suggest the *Camping* template.
- UI: a **Packing** tab with checkboxes grouped by category and a "3 / 24 packed" progress count.
- Include it in the PDF export as an optional section.

## Part D: "Open in Maps" navigation handoff (free)

**Google Maps URLs** (`https://www.google.com/maps/dir/?api=1&origin=…&destination=…&waypoints=…`)
need no API key and are **not billed**. On a phone they open the Google Maps app directly.

- For each itinerary day, build a URL from the previous day's last stop (or the trip start) through
  the day's waypoints in `day_position` order. Pass `place_id` through `destination_place_id` and
  `waypoint_place_ids` when available, for accurate pins.
- Google Maps URLs allow **up to 9 waypoints** in the app and on desktop, but fewer (3) in a mobile
  *browser*. For longer days, split the route into chunks ("Part 1", "Part 2"). Check the current
  limits in Google's Maps URLs documentation when implementing.
- Also offer an **Apple Maps** link (`https://maps.apple.com/?saddr=…&daddr=…`) for the first leg.
  Apple Maps URLs don't support multiple stops, so offer one link per stop.
- Show the buttons on each day column, on the trip page, and on the public share page.

## Part E: Calendar and GPX export

- `GET /trips/{trip_id}/export/ics`: one all-day `VEVENT` per itinerary day, plus a timed `VEVENT`
  for each waypoint that has a `scheduled_arrival_time` (duration = `stop_duration_minutes`), with
  `LOCATION` set to the address and the Google Maps URL in `DESCRIPTION`. Generate it with the
  `icalendar` package; no API is needed.
- `GET /trips/{trip_id}/export/gpx`: a `<rte>` with one `<rtept>` per waypoint, plus a `<trk>`
  decoded from the stored `route_polyline`. This works with offline navigation apps such as OsmAnd,
  Gaia, and Garmin.
- Both endpoints use the same `20/hour` limiter pattern as the PDF export. Add them to an
  **Export** dropdown on the trip page.
- Optional: `webcal://` subscribe link, served through the share token, so a calendar app picks up
  itinerary changes. Only offer this when sharing is enabled.

---

## Acceptance Criteria
- [ ] A 500-mile trip at 25 MPG and $4.00 shows a fuel estimate of $80.00. Changing MPG updates it
      immediately.
- [ ] Expenses can be added, edited, and deleted, and the budget bar matches their sum.
- [ ] For a trip starting within 16 days, each dated day shows a weather chip, and a second page load
      within 3 hours makes no Open-Meteo request.
- [ ] A day ending after sunset shows the after-dark warning.
- [ ] Adding the *Camping* template twice doesn't duplicate items.
- [ ] Tapping "Open in Google Maps" for a day with 4 stops on a phone opens navigation with all 4
      stops in order.
- [ ] A day with 12 stops produces two navigation links that together cover every stop.
- [ ] The `.ics` file imports into Google Calendar and Apple Calendar with the correct dates and times.
- [ ] The `.gpx` file opens in a GPX viewer and shows both the route line and the stop pins.
- [ ] No Google Maps Platform or ORS call is made by any feature in this phase. Verify with the
      Phase 14 usage counters before and after.

## Notes for the Implementing Agent
- Decode the polyline with the `polyline` PyPI package, or reuse whatever the frontend uses for
  `TripMap`.
- Times in `.ics` need a timezone. Use a new `trips.timezone` column, defaulting to the browser's
  `Intl.DateTimeFormat().resolvedOptions().timeZone` when the trip is created. Don't call Google's
  Time Zone API.
- Map Open-Meteo `weather_code` values (WMO codes) to icons with a small lookup table, using
  `lucide-react` icons (`Sun`, `CloudRain`, `Snowflake`, …).
