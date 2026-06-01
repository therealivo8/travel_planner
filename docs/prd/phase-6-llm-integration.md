# PRD — Phase 6: LLM Integration

## Overview
Add an AI layer powered by Claude (Anthropic) that enhances every stage of trip planning: natural-language trip creation, smart waypoint suggestions, auto-generated itinerary scheduling, and a trip narrative generator. The LLM acts as an assistant layered on top of the existing deterministic planning system — it suggests, the user decides.

## Prerequisites
- Phases 1–5 complete: full stack, auth, both trip modes, itinerary builder, and trip management.
- Anthropic API key.
- All Claude API calls must use **prompt caching** to reduce latency and cost on repeated context.

## Goals
- Users can describe a trip in plain language and the app creates a structured trip with waypoints.
- The AI can suggest additional stops given the current trip context.
- The AI can auto-schedule waypoints into days based on drive times and user preferences.
- The AI generates a human-readable trip narrative (a "trip story") suitable for sharing.
- A persistent chat interface lets users refine their trip conversationally.

## Out of Scope
- Fine-tuning or custom model training.
- Real-time traffic or weather integration.
- Booking / reservation integration.

---

## Tech Stack Additions
| Concern | Choice |
|---|---|
| LLM provider | Anthropic Claude (`claude-sonnet-4-6` default, `claude-opus-4-8` for narrative) |
| Python SDK | `anthropic` (official) with prompt caching enabled |
| Streaming | Server-Sent Events (FastAPI `StreamingResponse`) for chat responses |
| Token budget | Configurable per feature; hard cap at 4096 output tokens |

---

## Data Model Changes

### New Table: `trip_conversations`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `trip_id` | UUID FK → trips.id | ON DELETE CASCADE |
| `user_id` | UUID FK → users.id | |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

### New Table: `conversation_messages`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `conversation_id` | UUID FK → trip_conversations.id | ON DELETE CASCADE |
| `role` | TEXT NOT NULL | `"user"` or `"assistant"` |
| `content` | TEXT NOT NULL | message text |
| `tool_calls` | JSONB | raw tool use block from Claude, if any |
| `created_at` | TIMESTAMPTZ | |

### `trips` table — add columns
| Column | Type | Notes |
|---|---|---|
| `ai_narrative` | TEXT | generated trip story |
| `ai_narrative_generated_at` | TIMESTAMPTZ | |

---

## Features & API Endpoints

### 1. Natural-Language Trip Creation

#### `POST /ai/trips/create-from-prompt`
**Auth**: bearer

**Request**:
```json
{ "prompt": "I want to drive from Chicago to New Orleans with stops at cool blues music spots" }
```

**Backend behavior**:
1. Send the user's prompt to Claude with a system prompt instructing it to extract structured trip data.
2. Use **tool use** — define a `create_trip` tool with the trip schema (mode, start, end, waypoints array).
3. Claude responds with a `create_trip` tool call containing the structured data.
4. The backend validates the tool call output and creates the trip + waypoints via the existing service layer.
5. Returns the created trip object.

**Response**: same shape as `GET /trips/{trip_id}`.

System prompt (cache with `cache_control: {"type": "ephemeral"}`):
```
You are a road trip planning assistant. Extract structured trip information from the user's request.
Use the create_trip tool to return a well-formed trip. Infer reasonable waypoints from the user's description.
For each waypoint, provide a specific named place (not a vague region). Limit to 6 waypoints.
```

---

### 2. Waypoint Suggestions

#### `POST /trips/{trip_id}/ai/suggest-stops`
**Auth**: bearer

**Request**:
```json
{
  "preferences": ["scenic views", "local food", "avoid highways"],
  "max_suggestions": 5
}
```

**Backend behavior**:
1. Build context: trip mode, current waypoints with labels/coordinates, total drive time.
2. Call Claude with the trip context (cached) + user preferences.
3. Use a `suggest_waypoints` tool — Claude returns an array of `{ name, address, reason, lat, lng }`.
4. Return suggestions without automatically adding them (user must confirm).

**Response**:
```json
{
  "suggestions": [
    {
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

---

### 3. Auto-Schedule Itinerary

#### `POST /trips/{trip_id}/ai/schedule-itinerary`
**Auth**: bearer

**Request**:
```json
{
  "start_date": "2025-07-04",
  "max_drive_hours_per_day": 6,
  "preferences": "prefer mornings for driving, afternoons for exploring"
}
```

**Backend behavior**:
1. Gather trip waypoints with `drive_seconds_from_prev` values.
2. Call Claude with the ordered waypoints and constraints.
3. Claude uses an `assign_days` tool: returns `[{ waypoint_id, day_number, arrival_time }]`.
4. The backend applies the schedule (same logic as the manual itinerary builder).
5. Returns the full updated itinerary.

---

### 4. Trip Narrative Generator

#### `POST /trips/{trip_id}/ai/generate-narrative`
**Auth**: bearer

**Backend behavior**:
1. Build a rich context object: trip title, mode, all waypoints with labels and notes, itinerary days, total stats.
2. Call `claude-opus-4-8` (higher quality for creative writing) with a narrative prompt.
3. Stream the response via SSE.
4. On completion, save the narrative to `trips.ai_narrative`.

**Response**: `text/event-stream` with delta chunks. Final event: `event: done`.

---

### 5. Conversational Trip Assistant

#### `POST /trips/{trip_id}/ai/chat`
**Auth**: bearer

**Request**:
```json
{ "message": "Can you move the Nashville stop to day 2 and add a BBQ place near Memphis?" }
```

**Backend behavior**:
1. Load or create a `trip_conversation` for this trip + user.
2. Build the messages array from `conversation_messages` history.
3. Prepend a system prompt with the full trip context (cached).
4. Append the new user message.
5. Call Claude with tools: `add_waypoint`, `remove_waypoint`, `assign_to_day`, `suggest_stops`.
6. Execute any tool calls against the trip service layer.
7. Save assistant message + tool calls to `conversation_messages`.
8. Stream the assistant's final response via SSE.

**Response**: `text/event-stream`.

#### `GET /trips/{trip_id}/ai/chat/history`
Returns the conversation message history for display.

---

## Frontend Requirements

### `AiChatPanel` Component
- A collapsible slide-in panel on the trip detail and itinerary pages.
- Message thread with user and assistant bubbles.
- Streaming responses render incrementally as tokens arrive.
- Shows a "thinking" indicator while waiting for the first token.
- Tool use results rendered as compact action cards (e.g. "Added stop: Shawnee National Forest").
- Triggered by a floating "Ask AI" button.

### Natural Language Creation Flow
- On `/trips/new`, add an "Describe your trip" tab alongside the structured form.
- Textarea for free-form input + "Plan with AI" button.
- Shows a loading state while the backend processes.
- On success, redirects to `/trips/{trip_id}` with a banner "AI created your trip — review and adjust."

### `SuggestStopsModal`
- Opened from a "Suggest Stops" button on the waypoint list.
- Optional preference chips (Scenic / Food & Drink / History / Adventure / etc.).
- Displays suggestion cards with name, reason, detour time.
- "Add to Trip" button per suggestion.

### `GenerateNarrativeButton`
- On the trip share view / export page.
- Triggers narrative generation with a streaming text reveal animation.
- "Regenerate" button regenerates with a loading spinner.

---

## Prompt Caching Strategy
All Claude calls must use the Anthropic SDK's prompt caching feature to minimize cost and latency on repeat calls.

| Call | What to Cache |
|---|---|
| Trip context (waypoints, stats) | System prompt block with `cache_control` |
| Conversation history | All messages except the latest user turn |
| Narrative prompt | System prompt + trip context block |

Use the `anthropic` Python SDK's `messages.create()` with `cache_control={"type": "ephemeral"}` on large, stable context blocks.

---

## Acceptance Criteria
- [ ] `POST /ai/trips/create-from-prompt` with a natural language description creates a trip with ≥2 plausible waypoints.
- [ ] Waypoint suggestions are relevant to the trip context and include a reason for each suggestion.
- [ ] Auto-schedule produces a valid itinerary that respects `max_drive_hours_per_day`.
- [ ] Narrative generation streams tokens to the browser and saves on completion.
- [ ] Chat assistant correctly executes tool calls (add waypoint, assign day) against live trip data.
- [ ] Prompt caching is confirmed active: second identical call shows a cache hit in Anthropic usage metadata.
- [ ] Anthropic API key is never exposed to the frontend.
- [ ] All LLM calls have a timeout (30s) and return a graceful error if exceeded.
- [ ] `mypy`, `ruff`, `pnpm typecheck`, and `pnpm lint` all pass.

---

## Notes for the Implementing Agent
- Use `claude-sonnet-4-6` as the default model for all features except narrative, which uses `claude-opus-4-8`.
- Tool use is critical for structured outputs — do not parse free-text Claude responses; always use tools for any call that produces data to be stored.
- The system prompt for the trip assistant should include the full trip context as a cached block. Rebuild and re-cache when waypoints change.
- For SSE streaming in FastAPI, use `StreamingResponse` with an async generator that yields `data: {chunk}\n\n` formatted events.
- On the frontend, consume SSE with the native `EventSource` API or a `ReadableStream` from `fetch` with `{headers: {Accept: 'text/event-stream'}}`.
- Rate-limit LLM endpoints: max 10 requests per user per minute to prevent abuse.
- Log token usage (input, output, cache_read, cache_creation) per call to a `ai_usage_log` table for cost tracking.
