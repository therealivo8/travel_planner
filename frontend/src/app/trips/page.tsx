"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { Plus, MapPin } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TripCard } from "@/components/trips";
import { EmptyState } from "@/components/common";
import { TripActionsMenu } from "@/components/trips/TripActionsMenu";
import { PageShell } from "@/components/layout/PageShell";
import { distanceParts } from "@/lib/format";
import { useUnits } from "@/hooks/useUnits";
import { usePageTitle } from "@/hooks/usePageTitle";
import type { PaginatedTrips, TripListItem, TripStatus } from "@/types";

type SortKey = "created_at" | "updated_at" | "start_date";
type Scope = "all" | "mine" | "shared";

const SCOPE_TABS: { label: string; value: Scope }[] = [
  { label: "All trips", value: "all" },
  { label: "My trips", value: "mine" },
  { label: "Shared with me", value: "shared" },
];

const STATUS_TABS: { label: string; value: TripStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Planned", value: "planned" },
  { label: "Completed", value: "completed" },
];

const SORT_OPTIONS: { label: string; value: SortKey }[] = [
  { label: "Newest", value: "created_at" },
  { label: "Recently Updated", value: "updated_at" },
  { label: "Upcoming", value: "start_date" },
];

function driveMin(seconds: number | null): number | undefined {
  return seconds != null ? Math.round(seconds / 60) : undefined;
}

export default function TripsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const units = useUnits();
  const ask = useConfirm();
  usePageTitle("My trips");
  const [trips, setTrips] = useState<TripListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<TripStatus | "all">("all");
  const [sort, setSort] = useState<SortKey>("created_at");
  const [scope, setScope] = useState<Scope>("all");

  const fetchTrips = useCallback(async (status: TripStatus | "all", sortKey: SortKey, scopeKey: Scope) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ sort: sortKey, scope: scopeKey });
      if (status !== "all") params.set("status", status);
      const data = await api.get<PaginatedTrips>(`/trips?${params.toString()}`);
      setTrips(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trips");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login?next=/trips");
      return;
    }
    fetchTrips(statusFilter, sort, scope);
  }, [authLoading, user, router, statusFilter, sort, scope, fetchTrips]);

  async function handleDuplicate(tripId: string) {
    try {
      await api.post(`/trips/${tripId}/duplicate`);
      fetchTrips(statusFilter, sort, scope);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to duplicate trip");
    }
  }

  async function handleDelete(tripId: string) {
    const ok = await ask({
      title: "Delete this trip?",
      description: "The trip, its stops and its itinerary will be permanently removed.",
      confirmLabel: "Delete trip",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/trips/${tripId}`);
      setTrips((prev) => prev.filter((t) => t.id !== tripId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete trip");
    }
  }

  async function handleArchive(tripId: string) {
    try {
      await api.patch(`/trips/${tripId}`, { status: "completed" });
      fetchTrips(statusFilter, sort, scope);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to archive trip");
    }
  }

  return (
    <PageShell fullBleed>
      {/* Header */}
      <div className="bg-white border-b border-neutral-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">My Trips</h1>
            {user && (
              <p className="text-sm text-neutral-500 mt-0.5">
                {user.display_name ?? user.email}
              </p>
            )}
          </div>
          <Button asChild>
            <Link href="/trips/new">
              <Plus className="h-4 w-4 mr-1.5" />
              New Trip
            </Link>
          </Button>
        </div>

        {/* Whose trips: everything, mine, or shared with me */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex gap-2 pb-3" role="group" aria-label="Show trips">
          {SCOPE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setScope(tab.value)}
              aria-pressed={scope === tab.value}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                scope === tab.value
                  ? "border-primary-500 bg-primary-500 text-white"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filter + sort bar */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-0 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  statusFilter === tab.value
                    ? "border-primary-600 text-primary-700"
                    : "border-transparent text-neutral-500 hover:text-neutral-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="text-xs text-neutral-600 border border-neutral-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-neutral-200 overflow-hidden bg-white">
                <Skeleton className="h-36 w-full" />
                <div className="p-4 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="text-sm text-error-500 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {!loading && !error && trips.length === 0 && statusFilter === "all" && scope !== "shared" && (
          <EmptyState
            icon={<MapPin className="h-6 w-6 text-neutral-400" />}
            heading="Plan your first road trip"
            subtext="Pick how you'd like to start."
          >
            <div className="grid w-full max-w-md grid-cols-1 gap-3 sm:grid-cols-2">
              <Link
                href="/trips/new?mode=point_to_point"
                className="rounded-xl border-2 border-neutral-200 p-4 text-left hover:border-primary-500"
              >
                <p className="text-sm font-medium text-neutral-900">Plan a route (A → B)</p>
                <p className="mt-1 text-xs text-neutral-500">Add stops between two places.</p>
              </Link>
              <Link
                href="/trips/new?mode=radius"
                className="rounded-xl border-2 border-neutral-200 p-4 text-left hover:border-primary-500"
              >
                <p className="text-sm font-medium text-neutral-900">Explore around me</p>
                <p className="mt-1 text-xs text-neutral-500">Find places within a drive time.</p>
              </Link>
            </div>
          </EmptyState>
        )}

        {!loading && !error && trips.length === 0 && statusFilter === "all" && scope === "shared" && (
          <p className="py-20 text-center text-sm text-neutral-500">
            Nothing has been shared with you yet. Ask a friend to send you an invite link.
          </p>
        )}

        {!loading && !error && trips.length === 0 && statusFilter !== "all" && (
          <p className="py-20 text-center text-sm text-neutral-500">
            No {statusFilter} trips. Try a different filter.
          </p>
        )}

        {!loading && !error && trips.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {trips.map((trip) => (
              <div key={trip.id} className="relative">
                <Link href={`/trips/${trip.id}`} className="block">
                  <TripCard
                    title={trip.title}
                    mode={trip.mode}
                    status={trip.status}
                    coverImage={trip.cover_image_url ?? undefined}
                    distance={
                      trip.total_distance_meters != null
                        ? distanceParts(trip.total_distance_meters, units)
                        : undefined
                    }
                    isExample={trip.is_example}
                    role={trip.role}
                    ownerName={trip.owner_name ?? undefined}
                    routePolyline={trip.route_thumb}
                    driveTimeMin={driveMin(trip.total_drive_seconds)}
                    updatedAt={new Date(trip.updated_at)}
                  />
                </Link>
                <TripActionsMenu
                  tripId={trip.id}
                  role={trip.role ?? "owner"}
                  onDuplicate={() => handleDuplicate(trip.id)}
                  onDelete={() => handleDelete(trip.id)}
                  onArchive={() => handleArchive(trip.id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
