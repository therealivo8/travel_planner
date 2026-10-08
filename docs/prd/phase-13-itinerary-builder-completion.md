# PRD — Phase 13: Itinerary Builder Completion

> **Status: implemented** in commits `7d83a03` ("fix itinerary builder") and `4e2b154` ("improve drag
> feature for each day"). This document was written afterwards from the shipped code so the PRD
> index has no missing file; it records scope and decisions rather than driving new work. Where it
> says "known gaps", those are not yet built.

## Overview
Phase 9 Part C made itinerary changes persist, but the board was still hard to use: the day columns
were not registered as drop targets, so dragging a stop onto a day did nothing. There was also no
way to move a stop without dragging, and no sense of whether a day was realistic. This phase made
the board usable and added a few planning aids.

## Prerequisites
Phase 9 (itinerary board persistence), Phase 7 (`order_day_stops` / pairwise drive-time matrix).

## What shipped

### Drag-and-drop fixes
- Day columns and the unscheduled column are registered with `useDroppable`, so dropping a stop on
  an empty or full day now works. Drop-target choice prefers whatever is under the pointer and falls
  back to rectangle overlap (`itinerary/page.tsx`).
- In-day reordering and moves between days persist through
  `POST /trips/{id}/itinerary/days/{day_id}/assign`.

### Non-drag paths
- Each stop has an **assign to day** control and an **assign to new day** action
  (`handleAssignToDay`, `handleAssignToNewDay`), so the board works on touch and with a keyboard.
- **Distribute stops**: splits unscheduled stops into even chunks across days, with the remainder
  spread over the leading days.

### Day-level aids
- **Optimize day** (`POST .../days/{day_id}/optimize`): reorders a day's stops to minimise drive
  time (`order_day_stops`: nearest-neighbour start plus 2-opt over the pairwise matrix). Disabled
  for days with fewer than 3 stops. This uses Google Distance Matrix elements, one per stop pair
  (N² for N stops), and is governed by the Phase 14 budget and the 15-stop cap.
- **Day notes**: free text per day, saved on blur through `PATCH .../days/{day_id}`.
- **Over-budget indicator**: a day's total (drive plus stop time) is compared with
  `DAY_BUDGET_MINUTES`; the header turns amber and shows "over budget" when exceeded.
- **Schedule view** (`trips/[trip_id]/schedule`): a read-oriented day-by-day page with PDF export.

## Known gaps (candidates for later work)
- No automatic scheduling of arrival times from drive times; arrival times are still entered by
  hand (`PATCH .../waypoints/{id}/arrival-time`). Phase 17's Today view computes ahead/behind
  schedule from check-ins and stored leg times, which covers part of this.
- The day budget is a single fixed constant, not a per-trip or per-user setting.
- Optimize uses N² Distance Matrix elements; a haversine pre-ordering before the matrix call would
  cut cost for long days.

## Acceptance Criteria (as shipped)
- [x] Dropping a stop on any day column, including an empty one, assigns it and survives a reload.
- [x] Reordering within a day persists.
- [x] A stop can be assigned to a day or a new day without dragging.
- [x] Distribute spreads unscheduled stops evenly across the existing days.
- [x] Optimize reorders a day of 3 or more stops and persists the new order.
- [x] Day notes persist; days over the time budget are visibly flagged.
