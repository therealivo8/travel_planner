"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DayWeather, TripNavigation } from "@/types";

/**
 * Fetches a trip-scoped resource whenever `signature` changes (e.g. the day dates or stop
 * order). Failures leave `data` undefined: weather and nav links are enhancements, so the
 * page must keep working without them.
 */
function useTripResource<T>(path: string | null, signature: string): T | undefined {
  const [data, setData] = useState<T>();
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    api
      .get<T>(path)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(undefined);
      });
    return () => {
      cancelled = true;
    };
    // `signature` is the intentional refetch trigger.
  }, [path, signature]);
  return data;
}

export function useDayWeather(tripId: string, enabled: boolean, signature: string) {
  return useTripResource<Record<string, DayWeather>>(
    enabled ? `/trips/${tripId}/weather` : null,
    signature
  );
}

export function useTripNavigation(tripId: string, enabled: boolean, signature: string) {
  return useTripResource<TripNavigation>(enabled ? `/trips/${tripId}/navigation` : null, signature);
}
