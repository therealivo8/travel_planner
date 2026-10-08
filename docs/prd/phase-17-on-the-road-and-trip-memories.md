# PRD — Phase 17: On the Road & Trip Memories

## Overview
Everything in the app so far happens **before** the trip. When the user is actually driving or
back home, the app has nothing for them: no phone-friendly "today" view, no record of where they
went, and nothing worth showing friends. The `completed` trip status exists but does nothing.

This phase covers the rest of a trip's lifecycle: **plan → drive → remember**. It's what makes a
user return to the app after planning. Features reuse stored data where possible: route polylines
draw maps and thumbnails at no API cost. The one new paid service is photo storage, and it's
designed to stay inside a free tier.

## Prerequisites
- Phase 16 Part D (navigation deep links). The Today view depends on them.
- Phase 15 Part D (mobile pass).

## Goals
1. The app **installs as a PWA** and shows the current trip's itinerary **offline**.
2. A **Today view** shows the next stop, its navigation link, and check-ins, designed for a phone in a
   car mount.
3. Users can add **journal notes and photos** to stops and days.
4. Finished trips produce a **recap page** and update a **"My Map" of all trips**.
5. Shared links display a good **social preview image**, generated without Google Static Maps.

## Out of Scope
- Live GPS tracking or turn-by-turn directions. Navigation is handed off to Google or Apple Maps
  (Phase 16).
- Native iOS or Android apps. A PWA covers this use case at no cost.
- Public social feeds, likes, or follows.

---

## Part A: PWA and offline itinerary

- Add `app/manifest.ts` (name, icons, `display: standalone`, theme colour from the design tokens).
- Service worker via `@serwist/next` (the maintained successor to `next-pwa`):
  - Cache the app shell and static assets (cache-first).
  - Use **network-first with cache fallback** for `GET /trips/{id}`, `GET /trips/{id}/itinerary`,
    and `/weather`.
  - **Don't cache Google Maps tiles.** Google's terms forbid it, and the map simply won't show
    offline. When offline, replace the map with a "Map unavailable offline" panel and keep the
    list view working.
- Add a **"Save for offline"** button on the trip page that pre-fetches those three endpoints.
- Show an offline banner when `navigator.onLine === false`. Disable mutating actions offline, or
  queue check-ins (Part B) in IndexedDB and send them when the connection returns.

## Part B: Today view (`/trips/[trip_id]/today`)

### Data model: `waypoints` table, add columns
| column | type | purpose |
|---|---|---|
| `visited_at` | timestamptz, nullable | Check-in time. |
| `skipped` | bool, default false | The user skipped this stop. |

### Behaviour
- Choose the day by matching `itinerary_days.date` to today in the trip's timezone (Phase 16
  `trips.timezone`). If no day matches, offer a day picker.
- Show the **next unvisited stop** prominently: name, scheduled arrival, how far ahead of or behind
  schedule the user is (computed from check-in times and stored leg drive times, with no API call),
  a large **Navigate** button (Phase 16 deep link), and **Arrived** and **Skip** buttons.
- Below it, list the remaining stops for the day, the sunset time (Phase 16), and the day's spending
  with a quick-add expense button (Phase 16).
- Layout for use in a car: large tap targets (at least 48px), high contrast, nothing that needs
  precise tapping.
- **Automatic status changes** (in the trip GET handler, not a cron job): `planned` → shows a "Trip
  in progress" chip when today falls between the first and last day dates. After the last day,
  prompt "Mark trip complete?" instead of changing the status silently.

## Part C: Journal and photos

### Storage: Cloudflare R2
- **Why R2**: 10 GB free storage and **no egress fees**, so serving photos on share pages costs
  nothing. It's S3-compatible (`boto3`). Railway volumes cost money and tie photos to a single
  replica. Vercel Blob's free tier is smaller and charges for egress.
- **Direct-to-R2 uploads**: the backend issues a presigned PUT URL (`POST /trips/{id}/photos/upload-url`),
  and the browser uploads directly. Upload bandwidth never passes through Railway.
- **Resize on the client before uploading** (canvas, longest edge 1600px, WebP at about 0.8 quality),
  giving about 200–400 KB per photo. 10 GB holds roughly 25,000+ photos.
- **Limits**: 50 photos per trip, 500 per user, 5 MB maximum before resizing. Enforce them in the
  upload-URL endpoint. Track `users.storage_bytes`.
- Strip EXIF GPS data on the client before upload. Photos may appear on public share pages.

### Data model
New table `trip_photos`: `id`, `trip_id`, `waypoint_id` (nullable), `itinerary_day_id` (nullable),
`object_key`, `width`, `height`, `bytes`, `caption varchar(300)`, `taken_at`, `created_at`.
`waypoints.notes` and `itinerary_days.notes` already exist. Reuse them as journal text and give
them a richer textarea in the Today and recap views.

### Deletion
Deleting a photo, trip, or account must delete the R2 objects too. Queue the deletes in a
`pending_object_deletes` table that the Phase 14 cleanup job empties, so a failed R2 call never
blocks a user's delete.

## Part D: Trip recap and "My Map"

### Recap (`/trips/[trip_id]/recap`, and an optional section on the public share page)
- Stats computed from stored data: total distance, drive time, stops visited versus planned, days,
  money spent by category (Phase 16), and photos taken.
- A day-by-day timeline with notes and photos.
- An "Add to share page" toggle (`trips.share_recap bool`) that adds the recap to `/shared/[token]`.

### My Map (`/map`)
- One Google map that draws **every trip's stored `route_polyline`** in a different colour, plus
  pins for visited stops. This is **one Dynamic Maps load and no other API calls.**
- Lifetime stats: trips, miles or km, stops, and "longest trip".
- Filter by year.

## Part E: Polyline thumbnails and share preview images (no Static Maps)

Google Static Maps would cost one call per image view. Instead:
- **Trip card thumbnail**: render the decoded polyline as an inline **SVG path** scaled to the card,
  on a light background, with start and end dots. It needs no network request and looks good.
  Replace the current blank or `cover_image_url` area in `TripCard.tsx` with it, keeping
  `cover_image_url` as an override if the user sets one, or a journal photo.
- **Share preview image**: `app/shared/[token]/opengraph-image.tsx` using `next/og` (`ImageResponse`).
  It draws the same SVG route plus the title, distance, and day count at 1200×630. It's generated on
  demand on Vercel and cached at the edge. Wire it into the existing `generateMetadata` in
  `shared/[token]/page.tsx`, which currently sets `images: []` when there's no cover image.

---

## Acceptance Criteria
- [ ] The app installs to a phone's home screen. With airplane mode on, a trip saved for offline
      shows its itinerary list, notes, and weather chips.
- [ ] Checking in while offline queues the check-in, and it syncs within 10s of reconnecting.
- [ ] The Today view picks the correct day from the trip timezone and shows ahead/behind-schedule
      status after two check-ins.
- [ ] A 4 MB phone photo uploads as a file of 500 KB or less, with no GPS EXIF data, directly to R2.
      Railway logs show no upload body.
- [ ] Deleting a trip removes its R2 objects within one cleanup cycle.
- [ ] The 51st photo upload on a trip is rejected with a clear message.
- [ ] `/map` with 10 trips loads one Dynamic Maps session and makes no other Google API calls.
- [ ] Pasting a share link into Slack or iMessage shows a preview image of the route.
- [ ] Trip cards show route thumbnails on the dashboard with no new network requests.

## Notes for the Implementing Agent
- Polyline decoding in the browser: `@googlemaps/polyline-codec` (small, and already in the Google
  ecosystem) or a 20-line decoder.
- R2 credentials (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`) go into
  Railway variables and the Phase 11 secrets inventory. Remember the memory note: paste values
  **without quotes** in the Railway dashboard.
- Serve photos through presigned GET URLs (1 hour) for private trips, and through a public R2
  custom domain only for photos on trips with `share_recap = true`.
- Add the R2 bucket to the Phase 12 Terraform configuration (the Cloudflare provider is official),
  which also helps the resume goal.
