# PRD — Phase 15: Account, Onboarding & App Polish

## Overview
The planning features are substantial, but the parts around them, which make an app feel finished,
are missing:

- **No account management.** Users can register, log in, and log out, and nothing else. They can't
  edit their display name, change or reset their password, export their data, or delete their account.
  The `users` table has only `email`, `hashed_password`, and `display_name`.
- **No first-run experience.** A new user lands on an empty `/trips` page, and the first thing they
  can do (discover) is also the most expensive (see Phase 14).
- **Rough interaction details.** There are 8 browser `alert()`/`confirm()` calls in
  `frontend/src` even though `sonner` is already a dependency. There's no `not-found.tsx` or
  `error.tsx`. Units are hard-coded to miles (`distanceMi` in `app/trips/page.tsx`).
- **No legal or attribution pages.** Using the Google Maps Platform requires Google attribution
  and a privacy policy that names Google as a data processor, since addresses are sent to Google.

All of this costs nothing to run, except password-reset email, which fits in a free tier.

## Prerequisites
- Phase 14 Part B (per-user quotas). The demo trip in Part C relies on it so that new users can't
  burn API budget by accident.

## Goals
1. Users can manage their own account and data from a settings page.
2. A new user sees what the app does within 10 seconds of signing up, **without any API calls**.
3. Browser `alert()`/`confirm()` calls are replaced by toasts and dialogs; the app has 404 and error
   pages and works at phone width.
4. A privacy policy and terms page exist and are linked from the footer.

## Out of Scope
- OAuth/social login. Worth considering later, since "Sign in with Google" removes the
  password-reset problem. Left out here to keep auth changes small.
- Email verification on sign-up. Add it only if spam accounts appear. The Phase 14 quotas already
  limit the damage an abusive account can do.
- Admin roles beyond Phase 14's `ADMIN_EMAILS`.

---

## Part A: Settings page (`/settings`)

### Data model: add columns to `users`
| column | type | default | purpose |
|---|---|---|---|
| `units` | enum `imperial` / `metric` | `imperial` | Distance display everywhere, including the PDF. |
| `home_address` | text, nullable | — | Pre-fills the start location on new trips. |
| `home_lat`, `home_lng` | numeric(10,7), nullable | — | Saved when the user sets it, so new trips **skip a geocode call**. |
| `default_stop_minutes` | smallint | 60 | Default stop duration when adding a waypoint. |
| `password_changed_at` | timestamptz, nullable | — | Refresh tokens issued before this time are rejected. |

### Endpoints
| Method | Path | Notes |
|---|---|---|
| PATCH | `/auth/me` | Updates `display_name`, `units`, home address, and `default_stop_minutes`. |
| POST | `/auth/change-password` | Requires `current_password`. Sets `password_changed_at`, which revokes other sessions. Rate limit 5/hour. |
| GET | `/auth/me/export` | Returns a JSON download of the user plus all trips, waypoints, and itinerary days. Rate limit 3/day. |
| DELETE | `/auth/me` | Requires `password` in the body. Cascades through the existing `ondelete="CASCADE"` foreign keys. Clears the refresh cookie. |

### Frontend
Tabs for **Profile**, **Preferences** (units, home, default stop length), **Security** (change
password, sign out everywhere), and **Data** (export, delete account). Deleting the account requires
typing the email address to confirm. Add a units formatter (`lib/format.ts`) and use it to replace
every hard-coded mile and minute formatter, including `backend/app/api/export.py` for the PDF.

## Part B: Password reset by email

- Provider: **Resend** (free for 3,000 emails/month, simple HTTP API). Config `RESEND_API_KEY` and
  `EMAIL_FROM`. If the key is empty, log the reset link to the console instead, so local development
  needs no account. This follows the same pattern as `sentry_dsn`.
- New table `password_reset_tokens`: `token_hash` (sha256, primary key), `user_id`, `expires_at`
  (1 hour), `used_at`.
- `POST /auth/forgot-password {email}` → always returns **202**, so the response doesn't reveal
  whether an account exists. Rate limit 3/hour per IP and per email.
- `POST /auth/reset-password {token, new_password}` → single use. Sets `password_changed_at`.
- Pages: `/forgot-password` and `/reset-password?token=…`. Add a "Forgot password?" link to `/login`.
- Log reset requests through `security_log`, since they're security-relevant events.

## Part C: First-run experience with zero API calls

### Demo trip
On registration, copy a **pre-built example trip** (for example, "Pacific Coast Highway: SF → LA,
3 days") into the new account. Store it as a JSON fixture in the repo
(`backend/app/fixtures/demo_trip.json`). The fixture contains the polyline, legs, waypoints with
`place_id` and drive times, and itinerary days, all captured once from a real run.

- Loading it uses **no Google or ORS calls.** It's only database inserts.
- Mark it with a new `trips.is_example boolean`. The card shows an "Example" badge, and the user can
  delete it or duplicate it to edit.
- The fixture must contain only user-level data (addresses, coordinates, `place_id`), not cached
  Google names or ratings. That keeps it within the caching terms from Phase 14 Part C3.

### Onboarding
- An empty state on `/trips` for users with no trips of their own offers two options:
  "Plan a route (A → B)" and "Explore around me (radius)". Use the existing `EmptyState` component
  and `ModeSelector`.
- On the first visit to a trip page, show a one-time, dismissible 3-step tip strip. Store the
  dismissal in `localStorage` via the existing `useLocalStorage` hook. It has no server state.

### Landing page
Replace the "Coming soon" AI card in `frontend/src/app/page.tsx` with a feature that actually
exists, or remove it, until Phase 18 is built. A "coming soon" card makes the app look unfinished
more than leaving it out does.

## Part D: Polish

1. **Replace all `alert()`/`confirm()` calls** (`grep -rn "alert(\|confirm(" frontend/src`): use
   `sonner` toasts for results and a shadcn `AlertDialog` for destructive confirmations.
2. **Add `app/not-found.tsx`, `app/error.tsx`, and `app/trips/[trip_id]/not-found.tsx`** with a link
   back to `/trips`.
3. **Mobile pass at 375px**: trip page (map above the list, collapsible), itinerary board (day
   columns scroll horizontally with snap; Phase 13's non-drag assign path is required here), and
   the discover pages (cards in one column, with a sticky Select bar).
4. **Loading states**: replace plain spinners with `Skeleton` on the trips list and trip detail page.
   For discover calls longer than 5s, show staged progress messages ("Finding drive-time area…",
   "Searching places…", "Checking drive times…"). These messages are timed on the client; no
   server streaming is needed.
5. **Page titles**: `generateMetadata` on each route, e.g. "Pacific Coast Highway · Road Trip
   Planner".
6. **Accessibility**: every icon-only button gets an `aria-label`, and the focus ring stays visible
   (it already does in the `button.tsx` variants).

## Part E: Legal and attribution
- `/privacy` should say what's stored (email, trips, addresses), that addresses go to Google Maps
  Platform and OpenRouteService (and Anthropic, if Phase 18 is built), and how to export or delete
  data (link to `/settings`).
- `/terms` should be short and state that this is a personal project with no uptime guarantee.
- Footer links: Privacy · Terms · "Map data © Google, routing © openrouteservice.org / OpenStreetMap
  contributors". ORS requires attribution to OpenStreetMap.

---

## Acceptance Criteria
- [ ] Switching units to metric changes every distance in the dashboard, trip pages, share page, and PDF.
- [ ] Creating a trip after setting a home address pre-fills the start location and makes no
      geocode call.
- [ ] Changing the password invalidates refresh tokens on other browsers.
- [ ] Password reset works end-to-end with Resend in production, and with console logging locally.
- [ ] `/auth/forgot-password` returns 202 for both known and unknown emails.
- [ ] Deleting the account removes all of the user's trips (verified in the database) and logs the
      user out.
- [ ] A newly registered user sees the example trip immediately, and logs show zero upstream API calls
      during registration.
- [ ] `grep -rn "alert(\|confirm(" frontend/src` returns nothing.
- [ ] Every main page is usable at 375px width with no horizontal page scroll.
- [ ] Privacy and terms pages are linked from the footer and include ORS/OSM attribution.

## Notes for the Implementing Agent
- Store only the sha256 of password reset tokens, never the raw token.
- The JSON export is the user's data. Exclude `radius_suggestions` and `corridor_suggestions`,
  which are cached Google content, not user data.
- Capture the demo trip once with a script (`backend/scripts/capture_demo_trip.py`) that runs the
  real pipeline and strips Google-owned fields. Commit the output, and re-capture it only if the
  schema changes.
