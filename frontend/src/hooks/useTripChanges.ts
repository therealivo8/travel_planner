"use client";

import { useEffect, useState } from "react";
import { api, getTripVersion } from "@/lib/api";
import type { Activity } from "@/types";

const POLL_MS = 20_000;

interface Changes {
  version: number;
  changed: boolean;
  activity: Activity[];
}

/**
 * Polls for edits by other members every 20 s while the tab is visible, and only for trips
 * that have members: a solo trip never polls. Returns the latest activity once the server's
 * version moves past the one this tab last saw.
 */
export function useTripChanges(tripId: string, baseVersion: number | undefined, shared: boolean) {
  const [changes, setChanges] = useState<Changes | null>(null);

  useEffect(() => {
    if (!shared || baseVersion === undefined) return;
    let stopped = false;

    async function poll() {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      try {
        // The latest version this tab knows: the page load, advanced by this user's own saves
        // (so their own edits never count as "someone else changed this").
        const since = getTripVersion(tripId) ?? baseVersion;
        const result = await api.get<Changes>(`/trips/${tripId}/changes?since_version=${since}`);
        if (!stopped && result.changed) setChanges(result);
      } catch {
        // A failed poll is simply skipped; the next tick tries again.
      }
    }

    const timer = setInterval(poll, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tripId, shared, baseVersion]);

  return changes;
}
