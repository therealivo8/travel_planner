"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, MapPin, Circle, ArrowRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { PaginatedTrips, TripListItem } from "@/types";

const MODE_LABELS: Record<string, string> = {
  point_to_point: "Point-to-Point",
  radius: "Radius",
};

const STATUS_VARIANTS: Record<string, "default" | "outline" | "draft" | "success"> = {
  draft: "draft",
  planned: "default",
  completed: "success",
};

function TripRow({ trip }: { trip: TripListItem }) {
  const isRadius = trip.mode === "radius";
  return (
    <Link
      href={`/trips/${trip.id}`}
      className="flex items-center justify-between px-4 py-4 hover:bg-neutral-50 transition-colors border-b border-neutral-100 last:border-0"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-100 shrink-0">
          {isRadius ? (
            <Circle className="h-4 w-4 text-accent-500" />
          ) : (
            <ArrowRight className="h-4 w-4 text-primary-500" />
          )}
        </div>
        <div>
          <p className="text-sm font-medium text-neutral-900">{trip.title}</p>
          <p className="text-xs text-neutral-400 mt-0.5">
            {new Date(trip.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs hidden sm:inline-flex">
          {MODE_LABELS[trip.mode] ?? trip.mode}
        </Badge>
        <Badge variant={STATUS_VARIANTS[trip.status] ?? "outline"} className="text-xs capitalize">
          {trip.status}
        </Badge>
      </div>
    </Link>
  );
}

export default function TripsPage() {
  const { user } = useAuth();
  const [trips, setTrips] = useState<TripListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<PaginatedTrips>("/trips")
      .then((data) => setTrips(data.items))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load trips"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <div className="bg-white border-b border-neutral-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 flex items-center justify-between">
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
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {loading && (
          <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden divide-y divide-neutral-100">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-4">
                <Skeleton className="h-9 w-9 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
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
            <h2 className="text-lg font-semibold text-neutral-900 mb-2">No trips yet</h2>
            <p className="text-sm text-neutral-500 mb-6">
              Plan your first road trip to get started.
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
          <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
            {trips.map((trip) => (
              <TripRow key={trip.id} trip={trip} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
