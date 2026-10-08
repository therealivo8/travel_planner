"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdvancedMarker, Map, Pin, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { api, apiErrorMessage } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatDistance } from "@/lib/format";
import { useOnline } from "@/hooks/useOnline";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useUnits } from "@/hooks/useUnits";
import { PageShell } from "@/components/layout/PageShell";
import { GoogleMapsProvider } from "@/components/routing";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { MapTrip, MyMap } from "@/types";

// Distinct, colour-blind-friendlier line colours, cycled per trip.
const COLORS = ["#2563EB", "#DC2626", "#16A34A", "#9333EA", "#EA580C", "#0891B2", "#CA8A04", "#DB2777"];

function Routes({ trips }: { trips: MapTrip[] }) {
  const map = useMap();
  const geometry = useMapsLibrary("geometry");

  useEffect(() => {
    if (!map || !geometry || trips.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    // All paths are drawn from stored polylines: this page makes no Directions or other Google call.
    const lines = trips.map((t, i) => {
      const path = geometry.encoding.decodePath(t.route_polyline);
      path.forEach((p) => bounds.extend(p));
      return new google.maps.Polyline({
        path,
        map,
        strokeColor: COLORS[i % COLORS.length],
        strokeOpacity: 0.85,
        strokeWeight: 4,
      });
    });
    map.fitBounds(bounds, 48);
    return () => lines.forEach((l) => l.setMap(null));
  }, [map, geometry, trips]);

  return null;
}

export default function MyMapPage() {
  usePageTitle("My map");
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const units = useUnits();
  const online = useOnline();
  const [data, setData] = useState<MyMap | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login?next=/map");
      return;
    }
    api
      .get<MyMap>(year ? `/map?year=${year}` : "/map")
      .then(setData)
      .catch((err) => setError(apiErrorMessage(err, "Couldn't load your map")));
  }, [authLoading, user, router, year]);

  const trips = useMemo(() => data?.trips ?? [], [data]);
  const stats = data?.stats;

  return (
    <PageShell>
      <h1 className="mb-1 text-2xl font-bold text-neutral-900">My map</h1>
      <p className="mb-4 text-sm text-neutral-500">Every trip you&apos;ve planned, on one map.</p>

      {error ? (
        <p className="text-sm text-neutral-600">{error}</p>
      ) : !data ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Trips", String(stats?.trips ?? 0)],
              ["Distance", formatDistance(stats?.total_distance_meters ?? 0, units)],
              ["Stops visited", String(stats?.stops_visited ?? 0)],
              [
                "Longest trip",
                stats?.longest_trip_title
                  ? `${formatDistance(stats.longest_trip_distance_meters, units)}`
                  : "—",
              ],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-neutral-200 bg-white p-3 text-center">
                <dd className="text-lg font-bold text-neutral-900">{value}</dd>
                <dt className="text-xs text-neutral-500">
                  {label}
                  {label === "Longest trip" && stats?.longest_trip_title ? ` · ${stats.longest_trip_title}` : ""}
                </dt>
              </div>
            ))}
          </dl>

          {data.years.length > 1 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by year">
              {[null, ...data.years].map((y) => (
                <button
                  key={y ?? "all"}
                  type="button"
                  onClick={() => setYear(y)}
                  aria-pressed={year === y}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium",
                    year === y
                      ? "border-primary-500 bg-primary-500 text-white"
                      : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400"
                  )}
                >
                  {y ?? "All years"}
                </button>
              ))}
            </div>
          )}

          {trips.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">
              No routes yet. Plan a point-to-point trip and its route will appear here.
            </p>
          ) : (
            <>
              <div className="h-[28rem] overflow-hidden rounded-xl border border-neutral-200 bg-white">
                {online ? (
                  <GoogleMapsProvider>
                    <Map
                      defaultCenter={{ lat: 39.5, lng: -98.35 }}
                      defaultZoom={4}
                      mapId="my-map"
                      gestureHandling="greedy"
                      style={{ width: "100%", height: "100%" }}
                    >
                      <Routes trips={trips} />
                      {trips.flatMap((t, i) =>
                        t.visited_stops.map((s, j) => (
                          <AdvancedMarker key={`${t.id}-${j}`} position={{ lat: s.lat, lng: s.lng }} title={s.label ?? t.title}>
                            <Pin
                              background={COLORS[i % COLORS.length]}
                              borderColor="white"
                              glyphColor="white"
                              scale={0.7}
                            />
                          </AdvancedMarker>
                        ))
                      )}
                    </Map>
                  </GoogleMapsProvider>
                ) : (
                  <p className="flex h-full items-center justify-center text-sm text-neutral-500">
                    Map unavailable offline
                  </p>
                )}
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {trips.map((t, i) => (
                  <li key={t.id}>
                    <Link
                      href={`/trips/${t.id}`}
                      className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm hover:border-neutral-400"
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ background: COLORS[i % COLORS.length] }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate font-medium text-neutral-800">{t.title}</span>
                      <span className="shrink-0 text-xs text-neutral-500">
                        {formatDistance(t.total_distance_meters, units)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </PageShell>
  );
}
