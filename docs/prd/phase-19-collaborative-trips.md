# PRD — Phase 19: Collaborative Trips

## Overview
Road trips are usually taken with other people, but each trip in the app belongs to exactly one
user (`trips.user_id`). The only way to involve anyone else is the read-only public share link.
Today a group plans by passing screenshots back and forth.

This phase lets a trip owner invite **travel companions** who can view and edit the trip, **vote on
candidate stops**, and **comment** on stops and days. Collaboration doesn't call Google or ORS.
Invites can be plain links, so email is optional and fits Resend's free tier from Phase 15.

## Prerequisites
- Phase 14 (per-user quotas). Collaborators' expensive actions count against **their own** quota,
  and the trip owner's quota stays untouched.
- Phase 15 (account settings, toasts, mobile layout).

## Goals
1. An owner can invite people by link (and optionally by email) as **editors** or **viewers**.
2. Editors can do everything the owner can except delete the trip, manage members, or toggle
   public sharing.
3. Anyone with access can **vote** 👍/👎 on candidate stops and **comment** on stops and days.
4. Simultaneous edits don't silently overwrite each other.
5. The dashboard shows "Shared with me" trips alongside the user's own.

## Out of Scope
- Real-time co-editing over websockets. Polling every 20s plus optimistic concurrency is enough for
  2–6 people. Websockets would need a persistent connection layer that Vercel serverless doesn't
  provide, which means more cost and more operations work.
- Splitting expenses between members. Phase 16's tracker remains per trip. Settle-up could be a
  later phase.
- Organisations, teams, or permissions finer than per-trip roles.

---

## Part A: Consolidate trip access checks (refactor first)

Trip ownership is currently checked by **separate copies** of `_get_owned_trip` /
`_get_owned_trip_bare` or inline `Trip.user_id == user_id` filters in **8 router files**
(`trips`, `waypoints`, `itinerary`, `routing`, `radius`, `corridor`, `sharing`, `export`). Adding
a role model on top of 8 copies would lead to inconsistent access checks.

- Create `backend/app/core/trip_access.py` with:
  ```python
  class TripRole(IntEnum): VIEWER = 1; EDITOR = 2; OWNER = 3
  async def get_trip_for(trip_id, user, db, min_role: TripRole, *, load=()) -> Trip
  ```
  It returns **404, not 403**, when the user has no access, so the response doesn't reveal that the
  trip exists. This matches current behaviour.
- Replace every copy with this function **in a separate PR before any other part of this phase**,
  with no behaviour change (every current call becomes `min_role=OWNER`). Then lower each endpoint to
  its intended role in Part B.
- Add a test per router that confirms a non-member gets a 404. This also adds to Phase 12's test
  suite.

## Part B: Members and invites

### Data model
New table `trip_members`: `trip_id` (FK, cascade), `user_id` (FK, cascade), `role` (enum `editor`,
`viewer`), `invited_by`, `created_at`. The primary key is (`trip_id`, `user_id`). The owner stays in
`trips.user_id`, so existing queries keep working.

New table `trip_invites`: `token_hash char(64)` (primary key), `trip_id`, `role`, `created_by`,
`expires_at` (default 14 days), `max_uses` (default 10), `uses`, `revoked_at`.

### Role matrix
| Action | Viewer | Editor | Owner |
|---|---|---|---|
| View trip, itinerary, weather, budget, and packing list | ✅ | ✅ | ✅ |
| Vote and comment | ✅ | ✅ | ✅ |
| Edit waypoints and itinerary, run discover and optimize (uses **own** quota) | — | ✅ | ✅ |
| Add expenses, tick off packing items | — | ✅ | ✅ |
| Rename the trip, change mode or route endpoints | — | ✅ | ✅ |
| Invite or remove members, change roles | — | — | ✅ |
| Toggle the public share link, delete the trip | — | — | ✅ |

### Endpoints
| Method | Path | Role |
|---|---|---|
| GET | `/trips/{id}/members` | viewer |
| POST | `/trips/{id}/invites` `{role, email?}` → `{url}` | owner. If `email` is given and Resend is configured, also send the invite. Rate limit 20/day. |
| DELETE | `/trips/{id}/invites/{token_id}` | owner |
| POST | `/invites/{token}/accept` | any logged-in user. Idempotent, and an existing member is never demoted. |
| PATCH / DELETE | `/trips/{id}/members/{user_id}` | owner, or the member themselves for DELETE (leave the trip) |

The invite link `/invite/[token]` shows the trip title, the owner's display name, and the role. A
logged-out user goes through `/login?next=/invite/…` or registers first.

### Dashboard
`GET /trips?scope=mine|shared|all`. Shared trips show the owner's avatar or initials and a role badge.
**Duplicate** works for shared trips and creates a copy owned by the user.

## Part C: Votes and comments

### Data model
- `stop_votes`: (`suggestion_kind` enum `radius`/`corridor`/`waypoint`, `target_id uuid`,
  `user_id`) as the primary key, plus `value smallint` (−1 or +1) and `trip_id` (for cascade).
- `trip_comments`: `id`, `trip_id`, `user_id`, `target_kind` (`trip`, `day`, `waypoint`),
  `target_id` (nullable for `trip`), `body varchar(1000)`, `created_at`, `edited_at`,
  `deleted_at`. Deleting sets `deleted_at` instead of removing the row, so threads stay readable.

### UI
- Discover and corridor suggestion cards, and itinerary waypoints, show 👍 count, 👎 count, and
  member avatars. A **"Group favourites"** sort on the discover pages ranks by
  `net votes, then quality_score`.
- A comment-count badge on each waypoint and day opens a side **Sheet** (the `sheet.tsx` component
  exists) containing the thread.
- Render comment bodies as plain text, never HTML. They also appear in the PDF export if
  included, so escape them with `_e()`.

## Part D: Concurrency and freshness

- Add `trips.version integer` (incremented on every mutation to the trip, its waypoints, or its
  itinerary, through a single `touch_trip()` helper called in each mutating endpoint).
- Mutating requests send `If-Match: <version>`. If the version doesn't match, return **409** with
  the current version. The frontend shows "Alex just changed this trip — reload to see their
  changes" with a **Reload** button, then re-applies the user's action if it still makes sense
  (for example, a drag-and-drop).
- `GET /trips/{id}/changes?since_version=N` → `{version, changed: bool, activity: [...]}`. It's
  cheap, and the trip page polls it **every 20 seconds while the tab is visible**
  (`document.visibilityState`) and only when the trip has members. Single-user trips never poll.
- Activity feed: a new table `trip_activity` (`trip_id`, `user_id`, `kind`, `summary`,
  `created_at`) records events such as "Sam added Arches National Park to Day 2". Show the latest 20
  in a dropdown on the trip header.

## Part E: Notifications (in-app only)
- A bell icon in `TopNav` with a count of unread activity and comments across the user's trips,
  using `users.last_seen_activity_at`.
- No push or email notifications in this phase. They can come later through Resend digests if
  wanted.

---

## Acceptance Criteria
- [ ] After the Part A refactor, the full test suite passes and `grep -rn "Trip.user_id ==" backend/app/api`
      matches only `trip_access.py` and the trips list query.
- [ ] A viewer can see everything but gets 404 or 403 on every mutating endpoint. The UI hides edit
      controls for viewers.
- [ ] An editor running corridor discover uses their **own** Phase 14 quota, not the owner's.
- [ ] An invite link stops working after it is revoked, expires, or reaches `max_uses`.
- [ ] Two browsers editing the same trip: the second save gets a 409 and the reload prompt, and no
      data is lost.
- [ ] With two members, a change in browser A appears in browser B within about 20s without a manual
      refresh. Single-member trips make no `/changes` requests.
- [ ] Votes and comments work on suggestion cards and itinerary waypoints. A deleted comment shows
      "deleted" in the thread.
- [ ] "Shared with me" appears on the dashboard, and duplicating a shared trip creates an
      independent trip owned by the user.
- [ ] No Google Maps, ORS, or Anthropic call is made by any member or vote/comment feature.

## Notes for the Implementing Agent
- Ship Part A as its own PR. It's a pure refactor and the riskiest part of this phase, because it
  touches every router.
- Hash invite tokens with sha256 (same pattern as the Phase 15 reset tokens). Show the raw token
  only once, in the returned URL.
- When the public share endpoint is rate-limited (`sharing.py`, `60/hour`), it stays read-only and
  never exposes member names. Members appear only to authenticated members.
- Log membership changes (invite created, accepted, role changed, member removed) through
  `security_log`, since they change who can access data.
