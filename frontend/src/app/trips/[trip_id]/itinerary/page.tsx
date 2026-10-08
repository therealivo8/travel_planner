"use client";

import { createContext, use, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Trash2,
  GripVertical,
  CalendarDays,
  MoreVertical,
  Wand2,
  StickyNote,
  LayoutGrid,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { PageShell } from "@/components/layout/PageShell";
import { WeatherChip } from "@/components/logistics/WeatherChip";
import { NavButtons } from "@/components/logistics/NavButtons";
import { useDayWeather, useTripNavigation } from "@/hooks/useTripExtras";
import { useTripChanges } from "@/hooks/useTripChanges";
import { useVotes } from "@/hooks/useVotes";
import { useCommentCounts } from "@/hooks/useCommentCounts";
import { ChangesBanner } from "@/components/trips/ChangesBanner";
import { CommentBadge } from "@/components/collab/CommentsSheet";
import { VoteButtons } from "@/components/collab/VoteButtons";
import type {
  Trip,
  VoteTally,
  DayNavigation,
  DayWeather,
  Itinerary,
  ItineraryDay,
  ItineraryWaypoint,
} from "@/types";

// ── collaboration context ──────────────────────────────────────────────────
// Read by the day/unscheduled columns so role gating, votes and comment counts don't have
// to be threaded through every prop.

interface Collab {
  tripId: string;
  /** Viewers see the board but can't change it. */
  readOnly: boolean;
  /** The trip has other members: show votes and comments. */
  shared: boolean;
  tallies: Record<string, VoteTally>;
  vote: (targetId: string, value: -1 | 0 | 1) => void;
  countFor: (kind: "day" | "waypoint", id: string) => number;
  reloadCounts: () => void;
}

const CollabContext = createContext<Collab | null>(null);

function useCollab(): Collab {
  const ctx = useContext(CollabContext);
  if (!ctx) throw new Error("CollabContext missing");
  return ctx;
}

/** Votes and the comment badge shown under a stop when the trip has collaborators. */
function WaypointExtras({ waypoint }: { waypoint: ItineraryWaypoint }) {
  const c = useCollab();
  if (!c.shared) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 px-1">
      <VoteButtons tally={c.tallies[waypoint.id]} onVote={(v) => c.vote(waypoint.id, v)} />
      <CommentBadge
        tripId={c.tripId}
        kind="waypoint"
        targetId={waypoint.id}
        title={waypoint.label || waypoint.address}
        count={c.countFor("waypoint", waypoint.id)}
        onChanged={c.reloadCounts}
      />
    </div>
  );
}

// ── constants ──────────────────────────────────────────────────────────────

/** Sentinel droppable id for the unscheduled column. Day ids are UUIDs, so this
 *  literal can never collide with one. */
const UNSCHEDULED = "unscheduled";

/** Assumed time spent at a stop when the waypoint doesn't specify one. Matches the
 *  `stop_duration_minutes: 30` the discover flow sends to /radius/build-itinerary. */
const DEFAULT_DWELL_MINUTES = 30;

/** Drive + dwell time above which a day is flagged as unrealistic. */
const DAY_BUDGET_MINUTES = 8 * 60;

/** Prefer whatever is under the pointer; fall back to rectangle overlap when the
 *  pointer is in a gap between targets, so a drag never silently resolves to nothing. */
const pointerWithinOrIntersecting: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

// ── helpers ────────────────────────────────────────────────────────────────

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Total committed time for a day: drive legs we know about, plus dwell time per stop.
 *  `drive_seconds_from_prev` is populated from trip-wide route calculation, so it is
 *  null for manually-assigned waypoints — those contribute dwell time only. */
function dayTotalMinutes(day: ItineraryDay): number {
  const driveMinutes = day.waypoints.reduce(
    (sum, w) => sum + (w.drive_seconds_from_prev ?? 0) / 60,
    0
  );
  return driveMinutes + day.waypoints.length * DEFAULT_DWELL_MINUTES;
}

// ── draggable waypoint card ────────────────────────────────────────────────

/** Click/keyboard equivalent of dragging a chip, so assignment never depends on a
 *  pointer drag. `currentDayId` is null when the chip is in the Unscheduled column. */
interface AssignMenuProps {
  days: ItineraryDay[];
  currentDayId: string | null;
  onAssign: (dayId: string) => void;
  onUnassign: () => void;
  onAssignToNewDay: () => void;
}

function AssignMenu({
  days,
  currentDayId,
  onAssign,
  onUnassign,
  onAssignToNewDay,
}: AssignMenuProps) {
  const targets = days.filter((d) => d.id !== currentDayId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          // Stop the sensor from reading this as the start of a drag.
          onPointerDown={(e) => e.stopPropagation()}
          className="shrink-0 h-5 w-5 flex items-center justify-center rounded text-neutral-300 hover:text-neutral-600 hover:bg-neutral-100"
          aria-label="Move this stop"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-xs">Move to</DropdownMenuLabel>
        {targets.map((d) => (
          <DropdownMenuItem key={d.id} onSelect={() => onAssign(d.id)} className="text-xs">
            Day {d.day_number}
            {d.title ? ` · ${d.title}` : ""}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={onAssignToNewDay} className="text-xs">
          <Plus className="h-3 w-3 mr-1.5" />
          New day
        </DropdownMenuItem>
        {currentDayId && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onUnassign} className="text-xs">
              Remove from day
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WaypointChip({
  waypoint,
  isDragging,
  isOverlay,
  onUpdateArrivalTime,
  assignMenu,
}: {
  waypoint: ItineraryWaypoint;
  isDragging?: boolean;
  /** Rendered inside the DragOverlay — the chip that follows the cursor. It is free
   *  of the column's width, so it shows the full label instead of truncating. */
  isOverlay?: boolean;
  onUpdateArrivalTime?: (waypointId: string, time: string) => void;
  assignMenu?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const name = waypoint.label || waypoint.address;
  // The label and the address are often different strings; only worth showing the
  // address separately when it adds something.
  const secondary = waypoint.label && waypoint.address !== waypoint.label ? waypoint.address : null;
  // Roughly the point where a name stops fitting a 240px column. A heuristic rather
  // than a measurement — it only decides whether to offer the expand toggle, and the
  // `title` tooltip covers anything it misjudges.
  const isTruncatable = name.length > 24;

  return (
    <div
      className={`flex flex-col gap-1 px-2.5 py-2 bg-white rounded-lg border shadow-sm text-sm select-none ${
        isDragging ? "opacity-50" : ""
      } ${isOverlay ? "border-primary-400 shadow-lg ring-2 ring-primary-200 w-[260px]" : "border-neutral-200"}`}
    >
      {/* Row 1 — the name gets the full width of the chip. */}
      <div className="flex items-start gap-1.5">
        {/* Affordance only — the whole chip is draggable, so this is not a handle. */}
        <span className="shrink-0 pt-0.5" aria-hidden="true">
          <GripVertical className="h-3.5 w-3.5 text-neutral-300" />
        </span>

        {/* Plain text, not a control: pointer events pass through to the drag
            sensor so the name — the chip's largest surface — is draggable. */}
        <span
          title={expanded || isOverlay ? undefined : name}
          className={`flex-1 min-w-0 text-neutral-800 leading-snug ${
            expanded || isOverlay ? "" : "truncate"
          }`}
        >
          {name}
        </span>

        {/* Expanding is its own control, so it can't be confused with a drag. */}
        {!isOverlay && (isTruncatable || secondary) && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${name}` : `Show full name for ${name}`}
            className="shrink-0 h-5 w-5 flex items-center justify-center rounded text-neutral-300 hover:text-neutral-600 hover:bg-neutral-100"
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        )}

        {assignMenu}
      </div>

      {(expanded || isOverlay) && secondary && (
        <p className="text-xs text-neutral-500 leading-snug pl-5">{secondary}</p>
      )}

      {/* Row 2 — scheduling controls, below the name rather than competing with it. */}
      {(onUpdateArrivalTime || waypoint.drive_seconds_from_prev != null) && (
        <div className="flex items-center gap-2 pl-5">
          {onUpdateArrivalTime && (
            <input
              type="time"
              value={waypoint.scheduled_arrival_time?.slice(0, 5) ?? ""}
              onChange={(e) => onUpdateArrivalTime(waypoint.id, e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              className="text-xs text-neutral-500 border border-neutral-200 rounded px-1 py-0.5 w-[5.5rem] shrink-0"
              aria-label={`Arrival time for ${name}`}
            />
          )}
          {waypoint.drive_seconds_from_prev != null && (
            <span className="text-xs text-neutral-400 shrink-0">
              +{formatDuration(waypoint.drive_seconds_from_prev)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function SortableWaypointChip({
  waypoint,
  onUpdateArrivalTime,
  assignMenu,
}: {
  waypoint: ItineraryWaypoint;
  onUpdateArrivalTime?: (waypointId: string, time: string) => void;
  assignMenu?: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: waypoint.id,
    data: { waypoint },
  });
  return (
    // The whole chip is the drag surface, not just the 14px grip — a grip-only
    // handle is a hard target in a 240px column. Children that need their own
    // pointer events (the time input, the name, the menu) stop propagation, so
    // they stay clickable; `touch-none` keeps the touch sensor from scrolling.
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="touch-none cursor-grab active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <WaypointChip
        waypoint={waypoint}
        isDragging={isDragging}
        onUpdateArrivalTime={onUpdateArrivalTime}
        assignMenu={assignMenu}
      />
    </div>
  );
}

// ── day column ────────────────────────────────────────────────────────────

interface DayColumnProps {
  day: ItineraryDay;
  allDays: ItineraryDay[];
  weather?: DayWeather;
  nav?: DayNavigation;
  optimizing: boolean;
  onDelete: (dayId: string) => void;
  onUpdateTitle: (dayId: string, title: string) => void;
  onUpdateDate: (dayId: string, date: string) => void;
  onUpdateNotes: (dayId: string, notes: string) => void;
  onUpdateArrivalTime: (waypointId: string, time: string) => void;
  onOptimize: (dayId: string) => void;
  onAssign: (waypointId: string, dayId: string) => void;
  onUnassign: (waypointId: string, fromDayId: string) => void;
  onAssignToNewDay: (waypointId: string) => void;
}

function DayColumn({
  day,
  allDays,
  weather,
  nav,
  optimizing,
  onDelete,
  onUpdateTitle,
  onUpdateDate,
  onUpdateNotes,
  onUpdateArrivalTime,
  onOptimize,
  onAssign,
  onUnassign,
  onAssignToNewDay,
}: DayColumnProps) {
  const collab = useCollab();
  const readOnly = collab.readOnly;
  const [editingTitle, setEditingTitle] = useState(false);
  const [draft, setDraft] = useState(day.title ?? "");
  const [showNotes, setShowNotes] = useState(Boolean(day.notes));
  const [notesDraft, setNotesDraft] = useState(day.notes ?? "");

  // Registers this column as a real drop target. Without this the column is just a
  // styled <div> that dnd-kit cannot see, so dropping onto an empty day is a no-op.
  // `type: "day"` is what the collision branch in handleDragOver keys off.
  const { setNodeRef, isOver } = useDroppable({
    id: day.id,
    data: { type: "day", dayId: day.id },
  });

  const totalMinutes = dayTotalMinutes(day);
  const overBudget = totalMinutes > DAY_BUDGET_MINUTES;

  return (
    <div className="flex flex-col min-w-[240px] w-[240px] snap-start bg-neutral-100 rounded-xl p-3 gap-2">
      {/* Day header */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-bold text-neutral-400 uppercase shrink-0">
            Day {day.day_number}
          </span>
          {editingTitle ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                setEditingTitle(false);
                onUpdateTitle(day.id, draft);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") {
                  setEditingTitle(false);
                  onUpdateTitle(day.id, draft);
                }
              }}
              className="text-xs font-medium text-neutral-700 bg-white border border-neutral-300 rounded px-1.5 py-0.5 min-w-0 flex-1"
              placeholder="Add title…"
            />
          ) : (
            <button
              onClick={() => !readOnly && setEditingTitle(true)}
              disabled={readOnly}
              className="text-xs font-medium text-neutral-700 hover:text-neutral-900 truncate"
            >
              {day.title || <span className="text-neutral-400 italic">Add title</span>}
            </button>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {collab.shared && (
            <CommentBadge
              tripId={collab.tripId}
              kind="day"
              targetId={day.id}
              title={`Day ${day.day_number}`}
              count={collab.countFor("day", day.id)}
              onChanged={collab.reloadCounts}
              className="mr-1 inline-flex items-center gap-1 rounded-full bg-white px-1.5 py-0.5 text-[11px] text-neutral-600"
            />
          )}
          <button
            onClick={() => onOptimize(day.id)}
            hidden={readOnly}
            disabled={optimizing || day.waypoints.length < 3}
            title={
              day.waypoints.length < 3
                ? "Needs at least 3 stops to reorder"
                : "Reorder stops to cut drive time"
            }
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-neutral-200 text-neutral-400 hover:text-primary-600 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-400"
          >
            <Wand2 className="h-3 w-3" />
          </button>
          <button
            onClick={() => setShowNotes((v) => !v)}
            title="Day notes"
            className={`h-6 w-6 flex items-center justify-center rounded hover:bg-neutral-200 ${
              day.notes ? "text-primary-600" : "text-neutral-400 hover:text-neutral-600"
            }`}
          >
            <StickyNote className="h-3 w-3" />
          </button>
          <button
            onClick={() => onDelete(day.id)}
            hidden={readOnly}
            title="Delete day"
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-neutral-200 text-neutral-400 hover:text-red-500"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      <label className="text-xs text-neutral-500 flex items-center gap-1">
        <CalendarDays className="h-3 w-3 shrink-0" />
        <input
          type="date"
          disabled={readOnly}
          value={day.date ?? ""}
          onChange={(e) => onUpdateDate(day.id, e.target.value)}
          className="text-xs text-neutral-500 bg-transparent border border-transparent hover:border-neutral-300 rounded px-1 py-0.5 min-w-0 flex-1"
        />
      </label>

      <WeatherChip date={day.date} weather={weather} />

      {showNotes && (
        <Textarea
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={() => !readOnly && onUpdateNotes(day.id, notesDraft)}
          readOnly={readOnly}
          placeholder="Notes for this day…"
          rows={3}
          className="text-xs bg-white resize-none"
        />
      )}

      {/* Drop zone */}
      <SortableContext items={day.waypoints.map((w) => w.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={`flex flex-col gap-1.5 rounded-lg transition-colors ${
            day.waypoints.length === 0 ? "min-h-[120px]" : "min-h-[60px]"
          } ${isOver ? "bg-primary-50 ring-2 ring-primary-400 ring-inset" : ""}`}
        >
          {day.waypoints.map((wp) => (
            <div key={wp.id}>
              <SortableWaypointChip
                waypoint={wp}
                onUpdateArrivalTime={readOnly ? undefined : onUpdateArrivalTime}
                assignMenu={
                  readOnly ? undefined : (
                    <AssignMenu
                      days={allDays}
                      currentDayId={day.id}
                      onAssign={(target) => onAssign(wp.id, target)}
                      onUnassign={() => onUnassign(wp.id, day.id)}
                      onAssignToNewDay={() => onAssignToNewDay(wp.id)}
                    />
                  )
                }
              />
              <WaypointExtras waypoint={wp} />
            </div>
          ))}
          {day.waypoints.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-xs text-neutral-400 italic py-3">
              Drop stops here
            </div>
          )}
        </div>
      </SortableContext>

      <NavButtons nav={nav} />

      {day.waypoints.length > 0 && (
        <p
          className={`text-xs text-right ${overBudget ? "text-amber-600 font-medium" : "text-neutral-500"}`}
          title={`${day.waypoints.length} stop(s) × ${DEFAULT_DWELL_MINUTES}m, plus known drive legs`}
        >
          {formatMinutes(totalMinutes)}
          {overBudget && " · over budget"}
        </p>
      )}
    </div>
  );
}

// ── unscheduled column ────────────────────────────────────────────────────

interface UnscheduledColumnProps {
  waypoints: ItineraryWaypoint[];
  days: ItineraryDay[];
  distributing: boolean;
  onDistribute: () => void;
  onAssign: (waypointId: string, dayId: string) => void;
  onAssignToNewDay: (waypointId: string) => void;
}

function UnscheduledColumn({
  waypoints,
  days,
  distributing,
  onDistribute,
  onAssign,
  onAssignToNewDay,
}: UnscheduledColumnProps) {
  const readOnly = useCollab().readOnly;
  // Dragging a scheduled stop back out needs a real drop target here too.
  const { setNodeRef, isOver } = useDroppable({
    id: UNSCHEDULED,
    data: { type: "day", dayId: UNSCHEDULED },
  });

  return (
    <div className="w-64 shrink-0 border-r border-neutral-200 bg-white p-4 overflow-y-auto flex flex-col gap-2">
      <p className="text-xs font-bold text-neutral-400 uppercase tracking-wide mb-1">
        Unscheduled ({waypoints.length})
      </p>

      {waypoints.length > 0 && !readOnly && (
        <Button
          variant="outline"
          size="sm"
          className="text-xs h-7 mb-1"
          onClick={onDistribute}
          disabled={distributing}
        >
          <LayoutGrid className="h-3 w-3 mr-1.5" />
          {distributing ? "Distributing…" : "Distribute across days"}
        </Button>
      )}

      <SortableContext items={waypoints.map((w) => w.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={`flex flex-col gap-1.5 min-h-[120px] flex-1 rounded-lg transition-colors ${
            isOver ? "bg-primary-50 ring-2 ring-primary-400 ring-inset" : ""
          }`}
        >
          {waypoints.map((wp) => (
            <div key={wp.id}>
              <SortableWaypointChip
                waypoint={wp}
                assignMenu={
                  readOnly ? undefined : (
                    <AssignMenu
                      days={days}
                      currentDayId={null}
                      onAssign={(target) => onAssign(wp.id, target)}
                      onUnassign={() => {}}
                      onAssignToNewDay={() => onAssignToNewDay(wp.id)}
                    />
                  )
                }
              />
              <WaypointExtras waypoint={wp} />
            </div>
          ))}
          {waypoints.length === 0 && (
            <p className="text-xs text-neutral-400 italic py-4 text-center">
              All stops scheduled
            </p>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────

export default function ItineraryPage({ params }: { params: Promise<{ trip_id: string }> }) {
  const { trip_id } = use(params);
  const router = useRouter();
  const ask = useConfirm();
  usePageTitle("Itinerary");
  const { user, isLoading: authLoading } = useAuth();

  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeWaypoint, setActiveWaypoint] = useState<ItineraryWaypoint | null>(null);
  const [distributing, setDistributing] = useState(false);
  const [optimizingDayId, setOptimizingDayId] = useState<string | null>(null);
  // Container the active drag started in — captured at drag-start since the
  // optimistic move in handleDragOver mutates state before handleDragEnd runs.
  const dragOriginRef = useRef<string | typeof UNSCHEDULED | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    // Space/Enter picks a chip up, arrows move it, Space drops it.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Role and collaboration state. Loading the trip also records its version, which this
  // page's edits send as If-Match so a stale tab can't overwrite a collaborator.
  useEffect(() => {
    if (authLoading || !user) return;
    api.get<Trip>(`/trips/${trip_id}`).then(setTrip).catch(() => undefined);
  }, [authLoading, user, trip_id]);
  const role = trip?.my_role ?? "owner";
  const readOnly = role === "viewer";
  const shared = (trip?.member_count ?? 0) > 0 || role !== "owner";
  const changes = useTripChanges(trip_id, trip?.version, shared);
  const { tallies, vote } = useVotes(trip_id, "waypoint", shared);
  const { countFor, reload: reloadCounts } = useCommentCounts(trip_id, shared);

  // Weather depends on each day's date and last stop; nav links on the order of every stop.
  const days = itinerary?.days;
  const weather = useDayWeather(
    trip_id,
    Boolean(days?.length),
    (days ?? []).map((d) => `${d.id}:${d.date}:${d.waypoints.at(-1)?.id}`).join("|")
  );
  const navigation = useTripNavigation(
    trip_id,
    Boolean(days?.length),
    (days ?? []).map((d) => `${d.id}:${d.waypoints.map((w) => w.id).join(",")}`).join("|")
  );

  const loadItinerary = useCallback(async () => {
    try {
      const data = await api.get<Itinerary>(`/trips/${trip_id}/itinerary`);
      setItinerary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load itinerary");
    } finally {
      setLoading(false);
    }
  }, [trip_id]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?next=/trips/${trip_id}/itinerary`);
      return;
    }
    loadItinerary();
  }, [authLoading, user, router, trip_id, loadItinerary]);

  async function handleAddDay(): Promise<ItineraryDay | null> {
    if (!itinerary) return null;
    try {
      const day = await api.post<ItineraryDay>(`/trips/${trip_id}/itinerary/days`, {});
      const created = { ...day, waypoints: [] };
      setItinerary((prev) => (prev ? { ...prev, days: [...prev.days, created] } : prev));
      return created;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add day");
      return null;
    }
  }

  /** Click/keyboard path for assigning a stop to a day — the non-drag equivalent of
   *  a drop, hitting the same endpoint. */
  async function handleAssignToDay(waypointId: string, dayId: string) {
    if (!itinerary) return;
    const target = itinerary.days.find((d) => d.id === dayId);
    if (!target) return;
    const ordered = [...target.waypoints.map((w) => w.id), waypointId];
    try {
      await api.post(`/trips/${trip_id}/itinerary/days/${dayId}/assign`, {
        waypoint_ids: [waypointId],
        ordered_waypoint_ids: ordered,
      });
      await loadItinerary();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to assign stop");
      await loadItinerary();
    }
  }

  async function handleAssignToNewDay(waypointId: string) {
    const day = await handleAddDay();
    if (!day) return;
    try {
      await api.post(`/trips/${trip_id}/itinerary/days/${day.id}/assign`, {
        waypoint_ids: [waypointId],
        ordered_waypoint_ids: [waypointId],
      });
      await loadItinerary();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to assign stop");
      await loadItinerary();
    }
  }

  async function handleUnassign(waypointId: string, fromDayId: string) {
    try {
      await api.delete(`/trips/${trip_id}/itinerary/days/${fromDayId}/waypoints/${waypointId}`);
      await loadItinerary();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to unschedule stop");
      await loadItinerary();
    }
  }

  /** Spread every unscheduled stop evenly across the days, preserving their current
   *  order. Creates a day first if there are none. One request per day, not per stop —
   *  the assign endpoint already takes an array. */
  async function handleDistribute() {
    if (!itinerary || itinerary.unscheduled_waypoints.length === 0) return;
    setDistributing(true);
    try {
      let days = itinerary.days;
      if (days.length === 0) {
        const created = await handleAddDay();
        if (!created) return;
        days = [created];
      }

      const pending = itinerary.unscheduled_waypoints.map((w) => w.id);
      const buckets: string[][] = days.map((d) => d.waypoints.map((w) => w.id));

      // Even chunks, remainder spread over the leading days.
      const perDay = Math.floor(pending.length / days.length);
      const remainder = pending.length % days.length;
      let cursor = 0;
      for (let i = 0; i < days.length; i++) {
        const take = perDay + (i < remainder ? 1 : 0);
        buckets[i].push(...pending.slice(cursor, cursor + take));
        cursor += take;
      }

      for (let i = 0; i < days.length; i++) {
        const added = buckets[i].filter((id) => pending.includes(id));
        if (added.length === 0) continue;
        await api.post(`/trips/${trip_id}/itinerary/days/${days[i].id}/assign`, {
          waypoint_ids: added,
          ordered_waypoint_ids: buckets[i],
        });
      }
      await loadItinerary();
      toast.success(`Distributed ${pending.length} stop(s) across ${days.length} day(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to distribute stops");
      await loadItinerary();
    } finally {
      setDistributing(false);
    }
  }

  /** Reorder one day's stops to cut drive time. The ordering is computed server-side,
   *  which is where the distance matrix lives. */
  async function handleOptimizeDay(dayId: string) {
    setOptimizingDayId(dayId);
    try {
      await api.post(`/trips/${trip_id}/itinerary/days/${dayId}/optimize`, {});
      await loadItinerary();
      toast.success("Reordered to cut drive time");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to optimize day");
    } finally {
      setOptimizingDayId(null);
    }
  }

  async function handleUpdateNotes(dayId: string, notes: string) {
    const value = notes.trim() || null;
    try {
      await api.patch(`/trips/${trip_id}/itinerary/days/${dayId}`, { notes: value });
      setItinerary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          days: prev.days.map((d) => (d.id === dayId ? { ...d, notes: value } : d)),
        };
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save notes");
    }
  }

  async function handleDeleteDay(dayId: string) {
    if (!itinerary) return;
    const ok = await ask({
      title: "Delete this day?",
      description: "Its stops will become unscheduled.",
      confirmLabel: "Delete day",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/trips/${trip_id}/itinerary/days/${dayId}`);
      await loadItinerary();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete day");
    }
  }

  async function handleUpdateTitle(dayId: string, title: string) {
    try {
      await api.patch(`/trips/${trip_id}/itinerary/days/${dayId}`, { title: title || null });
      setItinerary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          days: prev.days.map((d) => (d.id === dayId ? { ...d, title: title || null } : d)),
        };
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update day title");
    }
  }

  async function handleUpdateDate(dayId: string, date: string) {
    try {
      await api.patch(`/trips/${trip_id}/itinerary/days/${dayId}`, { date: date || null });
      setItinerary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          days: prev.days.map((d) => (d.id === dayId ? { ...d, date: date || null } : d)),
        };
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update day date");
    }
  }

  async function handleUpdateArrivalTime(waypointId: string, time: string) {
    const arrivalTime = time ? `${time}:00` : null;
    setItinerary((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        days: prev.days.map((d) => ({
          ...d,
          waypoints: d.waypoints.map((w) =>
            w.id === waypointId ? { ...w, scheduled_arrival_time: arrivalTime } : w
          ),
        })),
      };
    });
    try {
      await api.patch(`/trips/${trip_id}/itinerary/waypoints/${waypointId}/arrival-time`, {
        scheduled_arrival_time: arrivalTime,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update arrival time");
      await loadItinerary();
    }
  }

  function findWaypointContainer(wpId: string): string | typeof UNSCHEDULED | null {
    if (!itinerary) return null;
    for (const day of itinerary.days) {
      if (day.waypoints.some((w) => w.id === wpId)) return day.id;
    }
    if (itinerary.unscheduled_waypoints.some((w) => w.id === wpId)) return UNSCHEDULED;
    return null;
  }

  function handleDragStart(event: DragStartEvent) {
    const wp = event.active.data.current?.waypoint as ItineraryWaypoint | undefined;
    if (wp) setActiveWaypoint(wp);
    dragOriginRef.current = findWaypointContainer(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || !itinerary) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const fromContainer = findWaypointContainer(activeId);

    // Determine target container (could be a day id or the unscheduled sentinel)
    let toContainer: string | typeof UNSCHEDULED | null = null;
    if (over.data.current?.type === "day") {
      toContainer = overId;
    } else {
      toContainer = findWaypointContainer(overId);
    }

    if (!fromContainer || !toContainer) return;

    if (fromContainer === toContainer) {
      // Same-container reorder
      setItinerary((prev) => {
        if (!prev) return prev;
        if (toContainer === UNSCHEDULED) {
          const oldIndex = prev.unscheduled_waypoints.findIndex((w) => w.id === activeId);
          const newIndex = prev.unscheduled_waypoints.findIndex((w) => w.id === overId);
          if (oldIndex === -1 || newIndex === -1) return prev;
          return {
            ...prev,
            unscheduled_waypoints: arrayMove(prev.unscheduled_waypoints, oldIndex, newIndex),
          };
        }
        return {
          ...prev,
          days: prev.days.map((d) => {
            if (d.id !== toContainer) return d;
            const oldIndex = d.waypoints.findIndex((w) => w.id === activeId);
            const newIndex = d.waypoints.findIndex((w) => w.id === overId);
            if (oldIndex === -1 || newIndex === -1) return d;
            return { ...d, waypoints: arrayMove(d.waypoints, oldIndex, newIndex) };
          }),
        };
      });
      return;
    }

    // Move waypoint optimistically in local state
    setItinerary((prev) => {
      if (!prev) return prev;

      let movedWp: ItineraryWaypoint | undefined;

      const updatedDays = prev.days.map((d) => {
        const idx = d.waypoints.findIndex((w) => w.id === activeId);
        if (idx !== -1) {
          movedWp = d.waypoints[idx];
          return { ...d, waypoints: d.waypoints.filter((w) => w.id !== activeId) };
        }
        return d;
      });

      let updatedUnscheduled = prev.unscheduled_waypoints;
      if (!movedWp) {
        const idx = updatedUnscheduled.findIndex((w) => w.id === activeId);
        if (idx !== -1) {
          movedWp = updatedUnscheduled[idx];
          updatedUnscheduled = updatedUnscheduled.filter((w) => w.id !== activeId);
        }
      }

      if (!movedWp) return prev;

      if (toContainer === UNSCHEDULED) {
        return { ...prev, days: updatedDays, unscheduled_waypoints: [...updatedUnscheduled, movedWp] };
      }

      const finalDays = updatedDays.map((d) => {
        if (d.id === toContainer) return { ...d, waypoints: [...d.waypoints, movedWp!] };
        return d;
      });

      return { ...prev, days: finalDays, unscheduled_waypoints: updatedUnscheduled };
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveWaypoint(null);
    const { active, over } = event;
    const origin = dragOriginRef.current;
    dragOriginRef.current = null;
    if (!over || !itinerary) return;

    const activeId = String(active.id);

    // Find where the waypoint landed after the optimistic update in handleDragOver.
    const targetDay = itinerary.days.find((d) => d.waypoints.some((w) => w.id === activeId));

    if (!targetDay) {
      // Landed in Unscheduled.
      if (origin && origin !== UNSCHEDULED) {
        try {
          await api.delete(`/trips/${trip_id}/itinerary/days/${origin}/waypoints/${activeId}`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Failed to unschedule waypoint");
          await loadItinerary();
        }
      }
      return;
    }

    try {
      await api.post(`/trips/${trip_id}/itinerary/days/${targetDay.id}/assign`, {
        waypoint_ids: [activeId],
        ordered_waypoint_ids: targetDay.waypoints.map((w) => w.id),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to assign waypoint");
      await loadItinerary();
    }
  }

  if (loading) {
    return (
      <PageShell fullWidth className="max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-3 mb-6">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <Skeleton className="h-6 w-48" />
        </div>
        <div className="flex gap-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-64 w-60 rounded-xl" />
          ))}
        </div>
      </PageShell>
    );
  }

  if (error || !itinerary) {
    return (
      <PageShell fullBleed>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-red-500 mb-4">{error ?? "Could not load itinerary"}</p>
            <Button asChild variant="outline">
              <Link href={`/trips/${trip_id}`}>Back to trip</Link>
            </Button>
          </div>
        </div>
      </PageShell>
    );
  }

  // Something is actually planned — gates the "next step" CTA.
  const hasSchedule = itinerary.days.some((d) => d.waypoints.length > 0);

  return (
    <PageShell fullBleed className="overflow-hidden">
      {/* Sub-header */}
      <div className="bg-white border-b border-neutral-200 shrink-0">
        <div className="max-w-full px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link href={`/trips/${trip_id}`} aria-label="Back to trip">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <h1 className="text-lg font-semibold text-neutral-900">Itinerary Builder</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleAddDay} size="sm" variant="outline" hidden={readOnly}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add Day
            </Button>
            {/* The board is for arranging; this is where arranging leads. Shown
                only once something is scheduled — `disabled` has no effect on an
                anchor, so the button is omitted rather than visually disabled. */}
            {hasSchedule && (
              <Button size="sm" asChild>
                <Link href={`/trips/${trip_id}/schedule`}>
                  View schedule
                  <ArrowRight className="h-4 w-4 ml-1.5" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      {changes && (
        <div className="px-4 pt-4">
          <ChangesBanner activity={changes.activity} onReload={() => window.location.reload()} />
        </div>
      )}
      {readOnly && (
        <p className="mx-4 mt-4 rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-600">
          View only: you can see the plan, vote and comment, but not change it.
        </p>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <CollabContext.Provider
          value={{
            tripId: trip_id,
            readOnly,
            shared,
            tallies,
            vote,
            countFor,
            reloadCounts,
          }}
        >
        <DndContext
          sensors={readOnly ? [] : sensors}
          // pointerWithin follows the cursor rather than the dragged chip's centre.
          // With the taller two-row chips, closestCenter would resolve against the
          // overlay's midpoint and miss the column the user is actually pointing at;
          // it falls back to rectIntersection when the pointer is between targets.
          collisionDetection={pointerWithinOrIntersecting}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {/* Left: unscheduled */}
          <UnscheduledColumn
            waypoints={itinerary.unscheduled_waypoints}
            days={itinerary.days}
            distributing={distributing}
            onDistribute={handleDistribute}
            onAssign={handleAssignToDay}
            onAssignToNewDay={handleAssignToNewDay}
          />

          {/* Right: day columns */}
          <div className="flex-1 overflow-x-auto p-4 snap-x snap-mandatory sm:snap-none">
            <div className="flex gap-4 h-full">
              {itinerary.days.map((day) => (
                <DayColumn
                  key={day.id}
                  day={day}
                  allDays={itinerary.days}
                  weather={weather?.[day.id]}
                  nav={navigation?.days[day.id]}
                  optimizing={optimizingDayId === day.id}
                  onDelete={handleDeleteDay}
                  onUpdateTitle={handleUpdateTitle}
                  onUpdateDate={handleUpdateDate}
                  onUpdateNotes={handleUpdateNotes}
                  onUpdateArrivalTime={handleUpdateArrivalTime}
                  onOptimize={handleOptimizeDay}
                  onAssign={handleAssignToDay}
                  onUnassign={handleUnassign}
                  onAssignToNewDay={handleAssignToNewDay}
                />
              ))}

              {itinerary.days.length === 0 && (
                <div className="flex items-center justify-center flex-1 text-neutral-400">
                  <div className="text-center max-w-xs">
                    <p className="text-sm mb-1 text-neutral-600 font-medium">No days yet</p>
                    <p className="text-xs mb-3">
                      {itinerary.unscheduled_waypoints.length > 0
                        ? `Add a day, then drag any of your ${itinerary.unscheduled_waypoints.length} stop(s) onto it — or use "Distribute across days".`
                        : "Add a day to start building your itinerary."}
                    </p>
                    <Button onClick={handleAddDay} size="sm" variant="outline" hidden={readOnly}>
                      <Plus className="h-4 w-4 mr-1.5" />
                      Add Day
                    </Button>
                  </div>
                </div>
              )}

              {itinerary.days.length > 0 &&
                itinerary.unscheduled_waypoints.length === 0 &&
                itinerary.days.every((d) => d.waypoints.length === 0) && (
                  <div className="flex items-center justify-center flex-1 text-neutral-400">
                    <div className="text-center max-w-xs">
                      <p className="text-sm mb-1 text-neutral-600 font-medium">
                        No stops on this trip yet
                      </p>
                      <p className="text-xs mb-3">
                        Add stops to your trip, then come back to schedule them across days.
                      </p>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/trips/${trip_id}`}>Go to trip</Link>
                      </Button>
                    </div>
                  </div>
                )}
            </div>
          </div>

          <DragOverlay dropAnimation={null}>
            {activeWaypoint && <WaypointChip waypoint={activeWaypoint} isOverlay />}
          </DragOverlay>
        </DndContext>
        </CollabContext.Provider>
        {weather && Object.keys(weather).length > 0 && (
          <p className="shrink-0 px-4 py-2 text-center text-[11px] text-neutral-400">
            <a
              href="https://open-meteo.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              Weather data by Open-Meteo.com
            </a>
          </p>
        )}
      </div>
    </PageShell>
  );
}
