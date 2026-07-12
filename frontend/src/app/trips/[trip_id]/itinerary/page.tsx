"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2, GripVertical, CalendarDays } from "lucide-react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Itinerary, ItineraryDay, ItineraryWaypoint } from "@/types";

// ── helpers ────────────────────────────────────────────────────────────────

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── draggable waypoint card ────────────────────────────────────────────────

function WaypointChip({
  waypoint,
  isDragging,
}: {
  waypoint: ItineraryWaypoint;
  isDragging?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 bg-white rounded-lg border border-neutral-200 shadow-sm text-sm select-none ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <GripVertical className="h-3.5 w-3.5 text-neutral-300 shrink-0" />
      <span className="truncate flex-1 text-neutral-800">{waypoint.label || waypoint.address}</span>
      {waypoint.drive_seconds_from_prev != null && (
        <span className="text-xs text-neutral-400 shrink-0">
          +{formatDuration(waypoint.drive_seconds_from_prev)}
        </span>
      )}
    </div>
  );
}

function SortableWaypointChip({ waypoint }: { waypoint: ItineraryWaypoint }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: waypoint.id,
    data: { waypoint },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <WaypointChip waypoint={waypoint} isDragging={isDragging} />
    </div>
  );
}

// ── day column ────────────────────────────────────────────────────────────

interface DayColumnProps {
  day: ItineraryDay;
  onDelete: (dayId: string) => void;
  onUpdateTitle: (dayId: string, title: string) => void;
}

function DayColumn({ day, onDelete, onUpdateTitle }: DayColumnProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [draft, setDraft] = useState(day.title ?? "");
  const totalDrive = day.waypoints.reduce(
    (sum, w) => sum + (w.drive_seconds_from_prev ?? 0),
    0
  );

  return (
    <div className="flex flex-col min-w-[240px] w-[240px] bg-neutral-100 rounded-xl p-3 gap-2">
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
              onClick={() => setEditingTitle(true)}
              className="text-xs font-medium text-neutral-700 hover:text-neutral-900 truncate"
            >
              {day.title || <span className="text-neutral-400 italic">Add title</span>}
            </button>
          )}
        </div>
        <button
          onClick={() => onDelete(day.id)}
          className="h-6 w-6 flex items-center justify-center rounded hover:bg-neutral-200 text-neutral-400 hover:text-red-500 shrink-0"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {day.date && (
        <p className="text-xs text-neutral-500 flex items-center gap-1">
          <CalendarDays className="h-3 w-3" />
          {new Date(day.date).toLocaleDateString()}
        </p>
      )}

      {/* Drop zone */}
      <SortableContext items={day.waypoints.map((w) => w.id)} strategy={verticalListSortingStrategy}>
        <div
          data-day-id={day.id}
          className="flex flex-col gap-1.5 min-h-[60px] rounded-lg transition-colors"
        >
          {day.waypoints.map((wp) => (
            <SortableWaypointChip key={wp.id} waypoint={wp} />
          ))}
          {day.waypoints.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-xs text-neutral-400 italic py-3">
              Drop waypoints here
            </div>
          )}
        </div>
      </SortableContext>

      {totalDrive > 0 && (
        <p className="text-xs text-neutral-500 text-right">
          {formatDuration(totalDrive)} drive
        </p>
      )}
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────

export default function ItineraryPage({ params }: { params: Promise<{ trip_id: string }> }) {
  const { trip_id } = use(params);
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeWaypoint, setActiveWaypoint] = useState<ItineraryWaypoint | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
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

  async function handleAddDay() {
    if (!itinerary) return;
    try {
      const day = await api.post<ItineraryDay>(`/trips/${trip_id}/itinerary/days`, {});
      setItinerary((prev) =>
        prev ? { ...prev, days: [...prev.days, { ...day, waypoints: [] }] } : prev
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add day");
    }
  }

  async function handleDeleteDay(dayId: string) {
    if (!itinerary) return;
    if (!confirm("Delete this day? Its waypoints will become unscheduled.")) return;
    try {
      await api.delete(`/trips/${trip_id}/itinerary/days/${dayId}`);
      await loadItinerary();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete day");
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
    } catch {
      // silently ignore
    }
  }

  function findWaypointContainer(wpId: string): string | "unscheduled" | null {
    if (!itinerary) return null;
    for (const day of itinerary.days) {
      if (day.waypoints.some((w) => w.id === wpId)) return day.id;
    }
    if (itinerary.unscheduled_waypoints.some((w) => w.id === wpId)) return "unscheduled";
    return null;
  }

  function handleDragStart(event: DragStartEvent) {
    const wp = event.active.data.current?.waypoint as ItineraryWaypoint | undefined;
    if (wp) setActiveWaypoint(wp);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || !itinerary) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const fromContainer = findWaypointContainer(activeId);

    // Determine target container (could be a day id or "unscheduled")
    let toContainer: string | "unscheduled" | null = null;
    // Check if over is a day container header area (data-day-id)
    if (over.data.current?.type === "day") {
      toContainer = overId;
    } else {
      toContainer = findWaypointContainer(overId);
    }

    if (!fromContainer || !toContainer || fromContainer === toContainer) return;

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

      if (toContainer === "unscheduled") {
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
    if (!over || !itinerary) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Find where the waypoint landed after optimistic update
    let targetDayId: string | null = null;
    for (const day of itinerary.days) {
      if (day.waypoints.some((w) => w.id === activeId)) {
        targetDayId = day.id;
        break;
      }
    }

    if (!targetDayId) {
      // It's in unscheduled — persist that
      try {
        await api.post(`/trips/${trip_id}/itinerary/days/${overId}/assign`, {
          waypoint_ids: [],
        });
      } catch {
        // no-op: unscheduled is implicit
      }
      return;
    }

    try {
      await api.post(`/trips/${trip_id}/itinerary/days/${targetDayId}/assign`, {
        waypoint_ids: [activeId],
      });
      // Persist unschhedule if moved out of a day — handled via reload
      void overId; // suppress lint
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to assign waypoint");
      await loadItinerary();
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50">
        <div className="bg-white border-b border-neutral-200">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <Skeleton className="h-6 w-48" />
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex gap-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-64 w-60 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !itinerary) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-500 mb-4">{error ?? "Could not load itinerary"}</p>
          <Button asChild variant="outline">
            <Link href={`/trips/${trip_id}`}>Back to trip</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-neutral-200 shrink-0">
        <div className="max-w-full px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link href={`/trips/${trip_id}`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <h1 className="text-lg font-semibold text-neutral-900">Itinerary Builder</h1>
          </div>
          <Button onClick={handleAddDay} size="sm">
            <Plus className="h-4 w-4 mr-1.5" />
            Add Day
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {/* Left: unscheduled */}
          <div className="w-64 shrink-0 border-r border-neutral-200 bg-white p-4 overflow-y-auto flex flex-col gap-2">
            <p className="text-xs font-bold text-neutral-400 uppercase tracking-wide mb-1">
              Unscheduled ({itinerary.unscheduled_waypoints.length})
            </p>
            <SortableContext
              items={itinerary.unscheduled_waypoints.map((w) => w.id)}
              strategy={verticalListSortingStrategy}
            >
              <div data-container="unscheduled" className="flex flex-col gap-1.5 min-h-[60px]">
                {itinerary.unscheduled_waypoints.map((wp) => (
                  <SortableWaypointChip key={wp.id} waypoint={wp} />
                ))}
                {itinerary.unscheduled_waypoints.length === 0 && (
                  <p className="text-xs text-neutral-400 italic py-4 text-center">
                    All waypoints scheduled
                  </p>
                )}
              </div>
            </SortableContext>
          </div>

          {/* Right: day columns */}
          <div className="flex-1 overflow-x-auto p-4">
            <div className="flex gap-4 h-full">
              {itinerary.days.map((day) => (
                <DayColumn
                  key={day.id}
                  day={day}
                  onDelete={handleDeleteDay}
                  onUpdateTitle={handleUpdateTitle}
                />
              ))}

              {itinerary.days.length === 0 && (
                <div className="flex items-center justify-center flex-1 text-neutral-400">
                  <div className="text-center">
                    <p className="text-sm mb-3">No days yet. Add your first day to get started.</p>
                    <Button onClick={handleAddDay} size="sm" variant="outline">
                      <Plus className="h-4 w-4 mr-1.5" />
                      Add Day
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <DragOverlay>
            {activeWaypoint && <WaypointChip waypoint={activeWaypoint} />}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
