"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, MapPin } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TripCard } from "@/components/trips";
import { TripActionsMenu } from "@/components/trips/TripActionsMenu";
import { PageShell } from "@/components/layout/PageShell";
import type { PaginatedTrips, TripListItem, TripStatus } from "@/types";

type SortKey = "created_at" | "updated_at" | "start_date";

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

function distanceMi(meters: number | null): number | undefined {
  return meters != null ? Math.round((meters / 1609.34) * 10) / 10 : undefined;
}

function driveMin(seconds: number | null): number | undefined {
  return seconds != null ? Math.round(seconds / 60) : undefined;
}

export default function TripsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [trips, setTrips] = useState<TripListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<TripStatus | "all">("all");
  const [sort, setSort] = useState<SortKey>("created_at");

  const fetchTrips = useCallback(async (status: TripStatus | "all", sortKey: SortKey) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ sort: sortKey });
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
    fetchTrips(statusFilter, sort);
  }, [authLoading, user, router, statusFilter, sort, fetchTrips]);

  async function handleDuplicate(tripId: string) {
    try {
      await api.post(`/trips/${tripId}/duplicate`);
      fetchTrips(statusFilter, sort);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to duplicate trip");
    }
  }

  async function handleDelete(tripId: string) {
    if (!confirm("Delete this trip? This cannot be undone.")) return;
    try {
      await api.delete(`/trips/${tripId}`);
      setTrips((prev) => prev.filter((t) => t.id !== tripId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete trip");
    }
  }

  async function handleArchive(tripId: string) {
    try {
      await api.patch(`/trips/${tripId}`, { status: "completed" });
      fetchTrips(statusFilter, sort);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to archive trip");
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

        {!loading && !error && trips.length === 0 && (
          <div className="text-center py-20">
            <div className="flex justify-center mb-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100">
                <MapPin className="h-6 w-6 text-neutral-400" />
              </div>
            </div>
            <h2 className="text-lg font-semibold text-neutral-900 mb-2">
              {statusFilter === "all" ? "No trips yet" : `No ${statusFilter} trips`}
            </h2>
            <p className="text-sm text-neutral-500 mb-6">
              {statusFilter === "all"
                ? "Plan your first road trip to get started."
                : "Try a different filter or create a new trip."}
            </p>
            <Button asChild>
              <Link href="/trips/new">
                <Plus className="h-4 w-4 mr-1.5" />
                New Trip
              </Link>
            </Button>
          </div>
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
                    distanceMi={distanceMi(trip.total_distance_meters)}
                    driveTimeMin={driveMin(trip.total_drive_seconds)}
                    updatedAt={new Date(trip.updated_at)}
                  />
                </Link>
                <TripActionsMenu
                  tripId={trip.id}
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
