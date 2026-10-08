"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { use } from "react";
import Link from "next/link";
import { notFound, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { usePageTitle } from "@/hooks/usePageTitle";
import { saveTripForOffline } from "@/lib/offline";
import { useTripChanges } from "@/hooks/useTripChanges";
import { useVotes } from "@/hooks/useVotes";
import { useCommentCounts } from "@/hooks/useCommentCounts";
import { ChangesBanner } from "@/components/trips/ChangesBanner";
import { MembersModal } from "@/components/trips/MembersModal";
import { ActivityMenu } from "@/components/collab/ActivityMenu";
import { CommentBadge } from "@/components/collab/CommentsSheet";
import { VoteButtons } from "@/components/collab/VoteButtons";
import {
  ArrowLeft,
  RefreshCw,
  Trash2,
  PencilLine,
  Check,
  X,
  Share2,
  FileDown,
  CalendarDays,
  ListChecks,
  Wallet,
  Backpack,
  ChevronDown,
  CalendarCheck,
  BookOpen,
  Users,
  CloudDownload,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api, getApiToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ShareModal } from "@/components/trips/ShareModal";
import { FirstVisitTips } from "@/components/trips/FirstVisitTips";
import { NavButtons } from "@/components/logistics/NavButtons";
import { useTripNavigation } from "@/hooks/useTripExtras";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  GoogleMapsProvider,
  TripMap,
  RouteStats,
  WaypointList,
  type AddressSelection,
} from "@/components/routing";
import type { Trip, Waypoint } from "@/types";
import { PageShell } from "@/components/layout/PageShell";

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
  const ask = useConfirm();
  const { user, isLoading: authLoading } = useAuth();

  const [trip, setTrip] = useState<Trip | null>(null);
  usePageTitle(trip?.title);

  // Collaboration: what this person may do, and whether the trip has other members at all
  // (solo trips never poll or show vote/comment UI).
  const role = trip?.my_role ?? "owner";
  const isOwner = role === "owner";
  const canEdit = role !== "viewer";
  const shared = (trip?.member_count ?? 0) > 0 || role !== "owner";
  const changes = useTripChanges(trip_id, trip?.version, shared);
  const { tallies, vote } = useVotes(trip_id, "waypoint", shared);
  const { countFor, reload: reloadCounts } = useCommentCounts(trip_id, shared);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [savingOffline, setSavingOffline] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [dismissedComplete, setDismissedComplete] = useState(false);
  // Phones show the map collapsible above the stop list; desktop always shows it.
  const [mapOpen, setMapOpen] = useState(true);

  // Inline title editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");

  const navigation = useTripNavigation(
    trip_id,
    Boolean(trip),
    (trip?.waypoints ?? []).map((w) => w.id).join(",")
  );

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
    const ok = await ask({
      title: "Delete this trip?",
      description: "The trip, its stops and its itinerary will be permanently removed.",
      confirmLabel: "Delete trip",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/trips/${trip_id}`);
      router.push("/trips");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete trip");
    }
  }

  async function handleSaveOffline() {
    setSavingOffline(true);
    const result = await saveTripForOffline(trip_id);
    setSavingOffline(false);
    if (result.ok) toast.success("Saved for offline. Your itinerary, notes and weather will open without a connection.");
    else toast.error(result.reason ?? "Couldn't save for offline");
  }

  async function handleMarkComplete() {
    try {
      const updated = await api.patch<Trip>(`/trips/${trip_id}`, { status: "completed" });
      setTrip((prev) => (prev ? { ...prev, status: updated.status, ended: false, in_progress: false } : prev));
      toast.success("Trip marked complete.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the trip");
    }
  }

  async function handleExport(path: string, extension: string) {
    setExporting(true);
    try {
      const res = await fetch(`/api/trips/${trip_id}/export/${path}`, {
        headers: { Authorization: `Bearer ${getApiToken() ?? ""}` },
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${trip?.title ?? "trip"}.${extension}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
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
      <PageShell fullWidth className="max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-3 mb-6">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <Skeleton className="h-6 w-48" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Skeleton className="h-[420px] w-full rounded-xl" />
          </div>
          <div className="flex flex-col gap-4">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-60 w-full rounded-xl" />
          </div>
        </div>
      </PageShell>
    );
  }

  // A missing (or someone else's) trip gets the proper 404 page instead of an inline message.
  if (error?.startsWith("API 404") || error?.startsWith("API 422")) notFound();

  if (error || !trip) {
    return (
      <PageShell fullBleed>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-error-500 mb-4">{error ?? "Trip not found"}</p>
            <Button asChild variant="outline">
              <Link href="/trips">Back to trips</Link>
            </Button>
          </div>
        </div>
      </PageShell>
    );
  }

  const sortedWaypoints = [...trip.waypoints].sort((a, b) => a.position - b.position);
  const isPointToPoint = trip.mode === "point_to_point";
  const isRadius = trip.mode === "radius";
  const hasRoute = !!trip.route_polyline;

  return (
    <GoogleMapsProvider>
      <PageShell fullWidth className="max-w-5xl mx-auto w-full">
        {/* Page header row */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/trips" aria-label="Back to trips">
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
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={handleSaveTitle}
                  aria-label="Save title"
                >
                  <Check className="h-4 w-4 text-primary-600" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => setEditingTitle(false)}
                  aria-label="Cancel editing title"
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
                disabled={!canEdit}
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
            {trip.in_progress && (
              <Badge className="text-xs shrink-0 bg-green-600 text-white">Trip in progress</Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" asChild>
              <Link href={`/trips/${trip_id}/today`}>
                <CalendarCheck className="h-3.5 w-3.5" />
                Today
              </Link>
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" asChild>
              <Link href={`/trips/${trip_id}/recap`}>
                <BookOpen className="h-3.5 w-3.5" />
                Recap
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={handleSaveOffline}
              disabled={savingOffline}
            >
              <CloudDownload className="h-3.5 w-3.5" />
              {savingOffline ? "Saving…" : "Save for offline"}
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" asChild>
              <Link href={`/trips/${trip_id}/itinerary`}>
                <CalendarDays className="h-3.5 w-3.5" />
                Itinerary
              </Link>
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" asChild>
              <Link href={`/trips/${trip_id}/schedule`}>
                <ListChecks className="h-3.5 w-3.5" />
                Schedule
              </Link>
            </Button>
            {isOwner && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => setShowShareModal(true)}
              >
                <Share2 className="h-3.5 w-3.5" />
                Share
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setShowMembers(true)}
            >
              <Users className="h-3.5 w-3.5" />
              {shared ? `Members (${(trip?.member_count ?? 0) + 1})` : "Invite"}
            </Button>
            {shared && <ActivityMenu tripId={trip_id} />}
            {shared && (
              <CommentBadge
                tripId={trip_id}
                kind="trip"
                title="Trip discussion"
                count={countFor("trip")}
                onChanged={reloadCounts}
              />
            )}
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" asChild>
              <Link href={`/trips/${trip_id}/budget`}>
                <Wallet className="h-3.5 w-3.5" />
                Budget
              </Link>
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" asChild>
              <Link href={`/trips/${trip_id}/packing`}>
                <Backpack className="h-3.5 w-3.5" />
                Packing
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 text-xs" disabled={exporting}>
                  <FileDown className={`h-3.5 w-3.5 ${exporting ? "animate-bounce" : ""}`} />
                  {exporting ? "Exporting…" : "Export"}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => handleExport("pdf", "pdf")}>
                  PDF itinerary
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleExport("pdf?include_packing=true", "pdf")}>
                  PDF with packing list
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleExport("ics", "ics")}>
                  Calendar (.ics)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleExport("gpx", "gpx")}>
                  GPX (offline navigation apps)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {isOwner && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDeleteTrip}
              className="text-neutral-400 hover:text-error-500"
              aria-label="Delete trip"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            )}
          </div>
        </div>

        {showShareModal && trip && (
          <ShareModal
            tripId={trip_id}
            initialIsPublic={trip.is_public}
            initialShareRecap={trip.share_recap}
            initialShareToken={trip.share_token}
            onClose={() => setShowShareModal(false)}
          />
        )}

        <MembersModal
          tripId={trip_id}
          myRole={role}
          open={showMembers}
          onOpenChange={setShowMembers}
          onChanged={(opts) => (opts?.left ? router.push("/trips") : window.location.reload())}
        />

        {changes && <ChangesBanner activity={changes.activity} onReload={() => window.location.reload()} />}

        {role === "viewer" && (
          <p className="mb-4 rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-600">
            You&apos;re a viewer on {trip.owner_name ? `${trip.owner_name}'s` : "this"} trip: you can look, vote and comment.
          </p>
        )}

        {trip.ended && !dismissedComplete && (
          <div
            role="status"
            className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900"
          >
            <p className="flex-1">Your trip&apos;s last day has passed. Mark trip complete?</p>
            <Button size="sm" onClick={handleMarkComplete}>
              Mark complete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDismissedComplete(true)}>
              Not yet
            </Button>
          </div>
        )}

        <FirstVisitTips mode={trip.mode} />

        <NavButtons nav={navigation?.trip} className="mb-4" />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Map */}
          <button
            type="button"
            onClick={() => setMapOpen((v) => !v)}
            aria-expanded={mapOpen}
            className="lg:hidden flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700"
          >
            Map
            <ChevronDown className={`h-4 w-4 transition-transform ${mapOpen ? "rotate-180" : ""}`} />
          </button>
          <div
            className={`lg:col-span-2 rounded-xl overflow-hidden border border-neutral-200 bg-white ${mapOpen ? "" : "hidden lg:block"}`}
            style={{ height: 420 }}
          >
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
                    className={`gap-1.5 text-xs ${canEdit ? "" : "hidden"}`}
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

                <Button
                  variant="outline"
                  size="sm"
                  className={`gap-1.5 text-xs self-start ${canEdit ? "" : "hidden"}`}
                  disabled={!hasRoute}
                  title={hasRoute ? undefined : "Calculate a route to discover stops along the way"}
                  asChild={hasRoute}
                >
                  {hasRoute ? (
                    <Link href={`/trips/${trip_id}/corridor`}>Find stops along the way</Link>
                  ) : (
                    <span>Find stops along the way</span>
                  )}
                </Button>
              </div>
            )}

            {/* Radius mode summary */}
            {isRadius && (
              <div className="bg-white rounded-xl border border-neutral-200 p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-neutral-700">Radius trip</p>
                  <Button variant="outline" size="sm" className={`text-xs ${canEdit ? "" : "hidden"}`} asChild>
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
                  readOnly={!canEdit}
                  renderExtra={
                    shared
                      ? (wp) => (
                          <div className="mt-1 flex flex-wrap items-center gap-2 px-1 pb-1">
                            <VoteButtons tally={tallies[wp.id]} onVote={(v) => vote(wp.id, v)} />
                            <CommentBadge
                              tripId={trip_id}
                              kind="waypoint"
                              targetId={wp.id}
                              title={wp.label ?? wp.address}
                              count={countFor("waypoint", wp.id)}
                              onChanged={reloadCounts}
                            />
                          </div>
                        )
                      : undefined
                  }
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
      </PageShell>
    </GoogleMapsProvider>
  );
}
