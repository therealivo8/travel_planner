# PRD — Phase 5: Trip Management & Itinerary

## Overview
Turn a calculated route into a fully planned, shareable road trip itinerary. This phase adds day-by-day scheduling, trip export, shareable public links, and a trip dashboard so users can manage all their saved trips in one place.

## Prerequisites
- Phases 1–4 complete: auth, full CRUD, point-to-point routing, and radius mode all working.

## Goals
- Users can organize a trip's waypoints into a multi-day itinerary.
- Trips can be exported as a PDF or shared via a public read-only link.
- A dashboard gives users an overview of all their trips with quick actions.
- Trip duplication makes it easy to create variations of a trip.

## Out of Scope
- LLM-generated itinerary suggestions (Phase 6).
- Collaborative editing (multiple users on one trip).
- Mobile app (web-responsive only).

---

## Data Model Changes

### New Table: `itinerary_days`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `trip_id` | UUID FK → trips.id | ON DELETE CASCADE |
| `day_number` | SMALLINT NOT NULL | 1-based |
| `date` | DATE | optional — user can set an actual calendar date |
| `title` | VARCHAR(200) | optional custom day title |
| `notes` | TEXT | |

Index: `(trip_id, day_number)` UNIQUE.

### `waypoints` table — add columns
| Column | Type | Notes |
|---|---|---|
| `itinerary_day_id` | UUID FK → itinerary_days.id | null = unscheduled |
| `scheduled_arrival_time` | TIME | optional |

### `trips` table — add columns
| Column | Type | Notes |
|---|---|---|
| `share_token` | VARCHAR(64) UNIQUE | null = not shared; set to a random token when sharing is enabled |
| `is_public` | BOOLEAN | default false |
| `start_date` | DATE | optional trip start date |
| `cover_image_url` | TEXT | optional hero image URL |

---

## API Endpoints

### Itinerary Days
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/trips/{trip_id}/itinerary` | bearer | Return all days with their assigned waypoints |
| POST | `/trips/{trip_id}/itinerary/days` | bearer | Create a new day |
| PATCH | `/trips/{trip_id}/itinerary/days/{day_id}` | bearer | Update day title, date, notes |
| DELETE | `/trips/{trip_id}/itinerary/days/{day_id}` | bearer | Delete day (unschedule its waypoints) |
| POST | `/trips/{trip_id}/itinerary/days/{day_id}/assign` | bearer | Assign waypoint(s) to a day |

**GET /trips/{trip_id}/itinerary** response shape:
```json
{
  "trip_id": "uuid",
  "days": [
    {
      "id": "uuid",
      "day_number": 1,
      "date": "2025-07-04",
      "title": "Down to Nashville",
      "waypoints": [
        {
          "id": "uuid",
          "label": "Mammoth Cave National Park",
          "scheduled_arrival_time": "14:00",
          "drive_seconds_from_prev": 3600
        }
      ]
    }
  ],
  "unscheduled_waypoints": []
}
```

### Trip Sharing
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/trips/{trip_id}/share` | bearer | Enable sharing, return share URL |
| DELETE | `/trips/{trip_id}/share` | bearer | Disable sharing, invalidate token |
| GET | `/shared/{share_token}` | public | Return read-only trip + itinerary |

### Trip Operations
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/trips/{trip_id}/duplicate` | bearer | Clone trip (new id, title prefixed "Copy of …", status reset to draft) |
| GET | `/trips` | bearer | Existing — add `?status=` filter and `?sort=updated_at` |

### Export
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/trips/{trip_id}/export/pdf` | bearer | Generate and return a PDF itinerary |

PDF contents:
- Trip title, total distance, total drive time, travel dates.
- One section per itinerary day with waypoints, arrival times, and leg drive times.
- Map image via the Google Maps Static API (or Mapbox Static Images API).

---

## Frontend Requirements

### Dashboard (`/trips` — upgraded from Phase 2)
- Grid of `TripCard` components, each showing: cover image, title, mode badge, status, total distance/drive time, last updated.
- Filter tabs: All / Draft / Planned / Completed.
- Sort: Newest / Recently Updated / Upcoming.
- Empty state with CTA to create a first trip.
- Quick actions menu per card: Edit, Duplicate, Share, Archive, Delete.

### Itinerary Builder (`/trips/{trip_id}/itinerary` — new page)
- Left panel: ordered list of all waypoints (unscheduled shown at top).
- Right panel: day columns (drag-and-drop target).
- User can drag waypoints into day columns to assign them.
- "Add Day" button appends a new day column.
- Each day column shows: day number, optional date picker, optional title, total drive time for that day.
- Waypoints can be dragged between days or back to "Unscheduled."
- Use `@dnd-kit/core` (already used in Phase 3 for waypoint reordering).

### Share Modal
- Toggle switch to enable/disable sharing.
- Displays the share URL when enabled (e.g. `https://app.example.com/shared/abc123`).
- Copy-to-clipboard button.

### Public Share View (`/shared/[token]` — new page)
- Read-only version of the trip: map, route stats, itinerary days.
- No edit controls, no auth required.
- `<meta>` OG tags for social preview (title, description, map image).
- `noindex` robots tag to prevent search engine indexing.

### Export
- "Export PDF" button on the trip detail page triggers `GET /trips/{trip_id}/export/pdf` and downloads the file.
- Show a loading spinner during generation (can take 2–5 seconds).

---

## Acceptance Criteria
- [ ] User can create an itinerary with 3 days and assign waypoints to each day; assignments persist across page reloads.
- [ ] Unscheduled waypoints appear in the unscheduled column after a day is deleted.
- [ ] Enabling sharing produces a working public URL that renders the trip without login.
- [ ] Disabling sharing makes the public URL return 404.
- [ ] `POST /trips/{trip_id}/duplicate` creates an independent copy that can be edited without affecting the original.
- [ ] PDF export contains the trip title, all days, and a static map image.
- [ ] Dashboard filter by status and sort by updated_at work correctly.
- [ ] Share URL includes correct OG meta tags for social preview.
- [ ] All drag-and-drop interactions work on touch devices (mobile).

---

## Notes for the Implementing Agent
- For PDF generation, use `WeasyPrint` (Python) or `Playwright` headless (render the HTML itinerary page and print to PDF). WeasyPrint is simpler but Playwright produces higher-fidelity output.
- The share token should be a 32-byte URL-safe random string (`secrets.token_urlsafe(32)`).
- Day deletion should set `itinerary_day_id = NULL` on the affected waypoints — do not delete the waypoints themselves.
- The itinerary builder is a client-heavy component; batch all drag-and-drop mutations into a single `POST /trips/{trip_id}/itinerary/days/{day_id}/assign` call when the user drops a waypoint rather than saving on every drag event.
- Scheduled arrival times are user-set (not auto-calculated) in this phase. Auto-scheduling based on drive times is a potential Phase 6 / LLM feature.
