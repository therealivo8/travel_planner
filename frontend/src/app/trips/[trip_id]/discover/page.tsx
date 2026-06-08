"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, Map as MapIcon, List } from "lucide-react";
import { AdvancedMarker, Pin } from "@vis.gl/react-google-maps";
import { api, discoverRadius, getRadiusSuggestions, selectSuggestions } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { GoogleMapsProvider, TripMap, IsochroneLayer } from "@/components/routing";
import { SuggestionCard } from "@/components/radius";
import { cn } from "@/lib/utils";
import type { Trip, RadiusSuggestion, GeoJSONPolygon, SuggestionCategory } from "@/types";

const CATEGORIES: { value: SuggestionCategory | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "park", label: "Parks" },
  { value: "restaurant", label: "Food" },
  { value: "landmark", label: "Landmarks" },
  { value: "town", label: "Towns" },
];

const CATEGORY_COLORS: Record<SuggestionCategory, string> = {
  park: "#16A34A",
  restaurant: "#EA580C",
  landmark: "#2563EB",
  town: "#7C3AED",
  other: "#6B7280",
};

export default function DiscoverPage({
  params,
}: {
  params: Promise<{ trip_id: string }>;
}) {
  const { trip_id } = use(params);
  const router = useRouter();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [suggestions, setSuggestions] = useState<RadiusSuggestion[]>([]);
  const [isochrone, setIsochrone] = useState<GeoJSONPolygon | null>(null);
  const [activeCategory, setActiveCategory] = useState<SuggestionCategory | "all">("all");
  const [discovering, setDiscovering] = useState(false);
  const [buildingRoute, setBuildingRoute] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [mobileView, setMobileView] = useState<"map" | "list">("map");
  const hasRunDiscovery = useRef(false);

  const loadTrip = useCallback(async () => {
    const t = await api.get<Trip>(`/trips/${trip_id}`);
    setTrip(t);
    return t;
  }, [trip_id]);

  const runDiscovery = useCallback(
    async (categoriesFilter?: SuggestionCategory[]) => {
      setDiscovering(true);
      setError(null);
      try {
        const result = await discoverRadius(
          trip_id,
          categoriesFilter?.length ? categoriesFilter : undefined
        );
        setSuggestions(result.suggestions);
        if (result.isochrone_geojson && "coordinates" in result.isochrone_geojson) {
          setIsochrone(result.isochrone_geojson as GeoJSONPolygon);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Discovery failed");
      } finally {
        setDiscovering(false);
      }
    },
    [trip_id]
  );

  // On mount: load trip, then try loading cached suggestions. If none, run discovery.
  useEffect(() => {
    if (hasRunDiscovery.current) return;
    hasRunDiscovery.current = true;

    (async () => {
      try {
        const t = await loadTrip();
        if (t.mode !== "radius") {
          router.replace(`/trips/${trip_id}`);
          return;
        }
        // Try cached suggestions first
        try {
          const cached = await getRadiusSuggestions(trip_id);
          if (cached.suggestions.length > 0) {
            setSuggestions(cached.suggestions);
            if (cached.isochrone_geojson && "coordinates" in cached.isochrone_geojson) {
              setIsochrone(cached.isochrone_geojson as GeoJSONPolygon);
            }
            setInitialLoading(false);
            return;
          }
        } catch {
          // No cached suggestions — fall through to discovery
        }
        setInitialLoading(false);
        await runDiscovery();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load trip");
        setInitialLoading(false);
      }
    })();
  }, [loadTrip, runDiscovery, router, trip_id]);

  function toggleSuggestion(id: string) {
    setSuggestions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, selected: !s.selected } : s))
    );
  }

  const selectedIds = suggestions.filter((s) => s.selected).map((s) => s.id);

  async function handleBuildRoute() {
    if (selectedIds.length === 0) return;
    setBuildingRoute(true);
    setError(null);
    try {
      await selectSuggestions(trip_id, {
        suggestion_ids: selectedIds,
        generate_route: true,
      });
      router.push(`/trips/${trip_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build route");
      setBuildingRoute(false);
    }
  }

  const visibleSuggestions =
    activeCategory === "all"
      ? suggestions
      : suggestions.filter((s) => s.category === activeCategory);

  if (initialLoading || !trip) {
    return (
      <div className="min-h-screen bg-neutral-50">
        <div className="bg-white border-b border-neutral-200">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <Skeleton className="h-6 w-56" />
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Skeleton className="h-[480px] w-full rounded-xl" />
          </div>
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const SidebarContent = (
    <div className="flex flex-col gap-3 h-full">
      {/* Category filters */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            type="button"
            onClick={() => setActiveCategory(cat.value)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
              activeCategory === cat.value
                ? "bg-primary-500 border-primary-500 text-white"
                : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-400"
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Re-run discovery */}
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 self-start"
        onClick={() => runDiscovery()}
        disabled={discovering}
      >
        <RefreshCw className={cn("h-3.5 w-3.5", discovering && "animate-spin")} />
        {discovering ? "Searching…" : "Re-run discovery"}
      </Button>

      {error && (
        <p className="text-xs text-error-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Suggestion list */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1">
        {discovering ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))
        ) : visibleSuggestions.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-8">No places found.</p>
        ) : (
          visibleSuggestions.map((s) => (
            <SuggestionCard key={s.id} suggestion={s} onToggle={toggleSuggestion} />
          ))
        )}
      </div>

      {/* Build route CTA */}
      <div className="pt-2 border-t border-neutral-100">
        {selectedIds.length > 0 && (
          <p className="text-xs text-neutral-500 mb-2">
            {selectedIds.length} stop{selectedIds.length !== 1 ? "s" : ""} selected
          </p>
        )}
        <Button
          className="w-full"
          disabled={selectedIds.length === 0 || buildingRoute}
          onClick={handleBuildRoute}
        >
          {buildingRoute ? "Building route…" : "Build Route"}
        </Button>
      </div>
    </div>
  );

  return (
    <GoogleMapsProvider>
      <div className="min-h-screen bg-neutral-50 flex flex-col">
        {/* Header */}
        <div className="bg-white border-b border-neutral-200 shrink-0">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Button variant="ghost" size="icon" asChild>
                <Link href="/trips">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <div className="min-w-0">
                <h1 className="text-lg font-semibold text-neutral-900 truncate">{trip.title}</h1>
                <p className="text-xs text-neutral-500">
                  {trip.max_drive_minutes}min drive radius from {trip.start_address}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs shrink-0">
                {suggestions.length} places found
              </Badge>

              {/* Mobile: map/list toggle */}
              <div className="flex sm:hidden">
                <button
                  type="button"
                  onClick={() => setMobileView(mobileView === "map" ? "list" : "map")}
                  className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600"
                >
                  {mobileView === "map" ? (
                    <>
                      <List className="h-3.5 w-3.5" /> List
                    </>
                  ) : (
                    <>
                      <MapIcon className="h-3.5 w-3.5" /> Map
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6">
          {/* Desktop: side-by-side */}
          <div className="hidden sm:grid sm:grid-cols-3 gap-6 h-[calc(100vh-140px)]">
            {/* Map */}
            <div className="sm:col-span-2 rounded-xl overflow-hidden border border-neutral-200 bg-white">
              <TripMap
                startLat={trip.start_lat}
                startLng={trip.start_lng}
                startAddress={trip.start_address}
                endLat={null}
                endLng={null}
                endAddress={null}
                waypoints={[]}
                routePolyline={null}
                layers={
                  <>
                    {isochrone && <IsochroneLayer geojson={isochrone} />}
                    {visibleSuggestions.map((s) => (
                      <AdvancedMarker
                        key={s.id}
                        position={{ lat: s.lat, lng: s.lng }}
                        title={s.name}
                        onClick={() => toggleSuggestion(s.id)}
                      >
                        <Pin
                          background={s.selected ? "#2563EB" : CATEGORY_COLORS[s.category]}
                          borderColor={s.selected ? "#1D4ED8" : CATEGORY_COLORS[s.category]}
                          glyphColor="white"
                          scale={s.selected ? 1.2 : 1}
                        />
                      </AdvancedMarker>
                    ))}
                  </>
                }
              />
            </div>

            {/* Sidebar */}
            <div className="flex flex-col gap-4 overflow-hidden">
              {SidebarContent}
            </div>
          </div>

          {/* Mobile: single view with sheet */}
          <div className="sm:hidden">
            {mobileView === "map" ? (
              <div className="rounded-xl overflow-hidden border border-neutral-200 bg-white" style={{ height: "calc(100vh - 200px)" }}>
                <TripMap
                  startLat={trip.start_lat}
                  startLng={trip.start_lng}
                  startAddress={trip.start_address}
                  endLat={null}
                  endLng={null}
                  endAddress={null}
                  waypoints={[]}
                  routePolyline={null}
                  layers={
                    <>
                      {isochrone && <IsochroneLayer geojson={isochrone} />}
                      {visibleSuggestions.map((s) => (
                        <AdvancedMarker
                          key={s.id}
                          position={{ lat: s.lat, lng: s.lng }}
                          title={s.name}
                          onClick={() => toggleSuggestion(s.id)}
                        >
                          <Pin
                            background={s.selected ? "#2563EB" : CATEGORY_COLORS[s.category]}
                            borderColor={s.selected ? "#1D4ED8" : CATEGORY_COLORS[s.category]}
                            glyphColor="white"
                            scale={s.selected ? 1.2 : 1}
                          />
                        </AdvancedMarker>
                      ))}
                    </>
                  }
                />
              </div>
            ) : (
              <div className="flex flex-col gap-3" style={{ minHeight: "calc(100vh - 200px)" }}>
                {SidebarContent}
              </div>
            )}

            {/* Floating Build Route button on map view */}
            {mobileView === "map" && selectedIds.length > 0 && (
              <div className="fixed bottom-6 left-0 right-0 flex justify-center px-4 z-10">
                <Button
                  className="shadow-lg px-8"
                  disabled={buildingRoute}
                  onClick={handleBuildRoute}
                >
                  {buildingRoute
                    ? "Building route…"
                    : `Build Route (${selectedIds.length} stop${selectedIds.length !== 1 ? "s" : ""})`}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </GoogleMapsProvider>
  );
}
