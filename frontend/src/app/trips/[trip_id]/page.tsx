"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, Trash2, PencilLine, Check, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  GoogleMapsProvider,
  TripMap,
  RouteStats,
  WaypointList,
  type AddressSelection,
} from "@/components/routing";
import type { Trip, Waypoint } from "@/types";

const STATUS_VARIANTS: Record<string, "default" | "outline" | "draft" | "success"> = {
  draft: "draft",
  planned: "default",
  completed: "success",
};

export default function TripDetailPage({
  params,
}: {
  params: Promise<{ trip_id: string }>;
}) {
  const { trip_id } = use(params);
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  // Inline title editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");

  const recalcTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRecalc = useCallback(
    (updatedTrip: Trip) => {
      if (updatedTrip.mode !== "point_to_point") return;
      if (recalcTimer.current) clearTimeout(recalcTimer.current);
      recalcTimer.current = setTimeout(async () => {
        setCalculating(true);
        setRouteError(null);
        try {
          const refreshed = await api.post<Trip>(`/trips/${trip_id}/calculate-route`);
          setTrip(refreshed);
        } catch (err) {
          setRouteError(err instanceof Error ? err.message : "Route calculation failed");
        } finally {
          setCalculating(false);
        }
      }, 500);
    },
    [trip_id]
  );

  // Auth guard + initial load
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?next=/trips/${trip_id}`);
      return;
    }
    api
      .get<Trip>(`/trips/${trip_id}`)
      .then((data) => {
        setTrip(data);
        setDraftTitle(data.title);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load trip"))
      .finally(() => setLoading(false));
  }, [authLoading, user, trip_id, router]);

  async function handleRecalculate() {
    if (!trip) return;
    setCalculating(true);
    setRouteError(null);
    try {
      const refreshed = await api.post<Trip>(`/trips/${trip_id}/calculate-route`);
      setTrip(refreshed);
    } catch (err) {
      setRouteError(err instanceof Error ? err.message : "Route calculation failed");
    } finally {
      setCalculating(false);
    }
  }

  async function handleSaveTitle() {
    if (!trip || !draftTitle.trim()) return;
    try {
      const updated = await api.patch<Trip>(`/trips/${trip_id}`, { title: draftTitle.trim() });
      setTrip(updated);
      setEditingTitle(false);
    } catch {
      // leave editing open
    }
  }

  async function handleDeleteTrip() {
    if (!confirm("Delete this trip? This cannot be undone.")) return;
    await api.delete(`/trips/${trip_id}`);
    router.push("/trips");
  }

  // Waypoint handlers
  async function handleAddWaypoint(selection: AddressSelection) {
    const wp = await api.post<Waypoint>(`/trips/${trip_id}/waypoints`, {
      address: selection.address,
      lat: selection.lat,
      lng: selection.lng,
      place_id: selection.place_id,
    });
    setTrip((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, waypoints: [...prev.waypoints, wp] };
      scheduleRecalc(updated);
      return updated;
    });
  }

  async function handleDeleteWaypoint(waypointId: string) {
    await api.delete(`/trips/${trip_id}/waypoints/${waypointId}`);
    setTrip((prev) => {
      if (!prev) return prev;
      const updated = {
        ...prev,
        waypoints: prev.waypoints
          .filter((w) => w.id !== waypointId)
          .map((w, i) => ({ ...w, position: i })),
      };
      scheduleRecalc(updated);
      return updated;
    });
  }

  async function handleReorder(orderedIds: string[]) {
    const updated = await api.post<Waypoint[]>(
      `/trips/${trip_id}/waypoints/reorder`,
      { ordered_ids: orderedIds }
    );
    setTrip((prev) => {
      if (!prev) return prev;
      const next = { ...prev, waypoints: updated };
      scheduleRecalc(next);
      return next;
    });
  }

  async function handleUpdateLabel(waypointId: string, label: string) {
    const updated = await api.patch<Waypoint>(`/trips/${trip_id}/waypoints/${waypointId}`, {
      label: label || null,
    });
    setTrip((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        waypoints: prev.waypoints.map((w) => (w.id === waypointId ? updated : w)),
      };
    });
  }

  async function handleUpdateStopDuration(waypointId: string, minutes: number | null) {
    const updated = await api.patch<Waypoint>(`/trips/${trip_id}/waypoints/${waypointId}`, {
      stop_duration_minutes: minutes,
    });
    setTrip((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        waypoints: prev.waypoints.map((w) => (w.id === waypointId ? updated : w)),
      };
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50">
        <div className="bg-white border-b border-neutral-200">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <Skeleton className="h-6 w-48" />
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Skeleton className="h-[420px] w-full rounded-xl" />
          </div>
          <div className="flex flex-col gap-4">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-60 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !trip) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-error-500 mb-4">{error ?? "Trip not found"}</p>
          <Button asChild variant="outline">
            <Link href="/trips">Back to trips</Link>
          </Button>
        </div>
      </div>
    );
  }

  const sortedWaypoints = [...trip.waypoints].sort((a, b) => a.position - b.position);
  const isPointToPoint = trip.mode === "point_to_point";
  const isRadius = trip.mode === "radius";
  const hasRoute = !!trip.route_polyline;

  return (
    <GoogleMapsProvider>
      <div className="min-h-screen bg-neutral-50">
        {/* Header */}
        <div className="bg-white border-b border-neutral-200">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Button variant="ghost" size="icon" asChild>
                <Link href="/trips">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>

              {editingTitle ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveTitle();
                      if (e.key === "Escape") setEditingTitle(false);
                    }}
                    className="h-8 text-base font-semibold"
                    autoFocus
                  />
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleSaveTitle}>
                    <Check className="h-4 w-4 text-primary-600" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => setEditingTitle(false)}
                  >
                    <X className="h-4 w-4 text-neutral-400" />
                  </Button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setDraftTitle(trip.title);
                    setEditingTitle(true);
                  }}
                  className="flex items-center gap-1.5 group min-w-0"
                >
                  <h1 className="text-xl font-semibold text-neutral-900 truncate">{trip.title}</h1>
                  <PencilLine className="h-3.5 w-3.5 text-neutral-300 group-hover:text-neutral-500 shrink-0" />
                </button>
              )}

              <Badge
                variant={STATUS_VARIANTS[trip.status] ?? "outline"}
                className="text-xs capitalize shrink-0"
              >
                {trip.status}
              </Badge>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={handleDeleteTrip}
              className="text-neutral-400 hover:text-error-500 shrink-0"
              aria-label="Delete trip"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Map */}
          <div className="lg:col-span-2 rounded-xl overflow-hidden border border-neutral-200 bg-white" style={{ height: 420 }}>
            <TripMap
              startLat={trip.start_lat}
              startLng={trip.start_lng}
              startAddress={trip.start_address}
              endLat={trip.end_lat}
              endLng={trip.end_lng}
              endAddress={trip.end_address}
              waypoints={sortedWaypoints}
              routePolyline={trip.route_polyline}
            />
          </div>

          {/* Sidebar */}
          <div className="flex flex-col gap-4">
            {/* Point-to-point route stats */}
            {isPointToPoint && (
              <div className="bg-white rounded-xl border border-neutral-200 p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-neutral-700">Route summary</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={handleRecalculate}
                    disabled={calculating}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${calculating ? "animate-spin" : ""}`} />
                    {calculating ? "Calculating…" : "Recalculate"}
                  </Button>
                </div>

                {hasRoute ? (
                  <RouteStats
                    totalDistanceMeters={trip.total_distance_meters}
                    totalDriveSeconds={trip.total_drive_seconds}
                  />
                ) : (
                  <p className="text-xs text-neutral-400">
                    {calculating ? "Calculating route…" : "No route calculated yet."}
                  </p>
                )}

                {routeError && (
                  <p className="text-xs text-error-500">{routeError}</p>
                )}
              </div>
            )}

            {/* Radius mode summary */}
            {isRadius && (
              <div className="bg-white rounded-xl border border-neutral-200 p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-neutral-700">Radius trip</p>
                  <Button variant="outline" size="sm" className="text-xs" asChild>
                    <Link href={`/trips/${trip_id}/discover`}>Explore more</Link>
                  </Button>
                </div>
                <p className="text-xs text-neutral-500">
                  Within {trip.max_drive_minutes} min drive
                </p>
                {hasRoute && (
                  <RouteStats
                    totalDistanceMeters={trip.total_distance_meters}
                    totalDriveSeconds={trip.total_drive_seconds}
                  />
                )}
                {!hasRoute && sortedWaypoints.length === 0 && (
                  <p className="text-xs text-neutral-400">
                    Select stops on the discover page to build a route.
                  </p>
                )}
              </div>
            )}

            {/* Route addresses */}
            <div className="bg-white rounded-xl border border-neutral-200 p-4 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <div className="mt-0.5 h-2.5 w-2.5 rounded-full bg-green-500 shrink-0" />
                <div>
                  <p className="text-xs text-neutral-400">Start</p>
                  <p className="text-sm text-neutral-700">{trip.start_address}</p>
                </div>
              </div>
              {sortedWaypoints.length > 0 && (
                <div className="ml-1 border-l-2 border-dashed border-neutral-200 pl-3 py-1 flex flex-col gap-1">
                  {sortedWaypoints.map((wp, i) => (
                    <p key={wp.id} className="text-xs text-neutral-500 truncate">
                      {i + 1}. {wp.label ?? wp.address}
                    </p>
                  ))}
                </div>
              )}
              {trip.end_address && (
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 h-2.5 w-2.5 rounded-full bg-red-500 shrink-0" />
                  <div>
                    <p className="text-xs text-neutral-400">End</p>
                    <p className="text-sm text-neutral-700">{trip.end_address}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Waypoints — point-to-point (editable) or radius (read-only selected stops) */}
            {isPointToPoint && (
              <div className="bg-white rounded-xl border border-neutral-200 p-4 flex flex-col gap-3">
                <p className="text-sm font-medium text-neutral-700">Stops</p>
                <WaypointList
                  waypoints={sortedWaypoints}
                  onAdd={handleAddWaypoint}
                  onDelete={handleDeleteWaypoint}
                  onReorder={handleReorder}
                  onUpdateLabel={handleUpdateLabel}
                  onUpdateStopDuration={handleUpdateStopDuration}
                  loading={calculating}
                />
              </div>
            )}
            {isRadius && sortedWaypoints.length > 0 && (
              <div className="bg-white rounded-xl border border-neutral-200 p-4 flex flex-col gap-2">
                <p className="text-sm font-medium text-neutral-700">Selected stops</p>
                {sortedWaypoints.map((wp, i) => (
                  <div key={wp.id} className="flex items-start gap-2">
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-500 text-[10px] font-bold text-white">
                      {i + 1}
                    </div>
                    <div>
                      <p className="text-sm text-neutral-700">{wp.label ?? wp.address}</p>
                      {wp.drive_seconds_from_prev != null && (
                        <p className="text-xs text-neutral-400">
                          +{Math.round(wp.drive_seconds_from_prev / 60)} min
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </GoogleMapsProvider>
  );
}
