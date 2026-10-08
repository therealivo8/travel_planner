"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, getMyQuota } from "@/lib/api";

/**
 * Tracks the user's remaining daily discoveries and whether discovery is paused by the
 * shared API budget (Phase 14). `noteError` returns true when it consumed the error as a
 * pause, so the caller shouldn't also render it as a generic failure.
 */
export function useDiscoveryQuota(action: "radius_discover" | "corridor_discover") {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [pausedUntil, setPausedUntil] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const q = await getMyQuota();
      setRemaining(q.remaining[action] ?? null);
    } catch {
      // Purely informational — never block discovery on it.
    }
  }, [action]);

  useEffect(() => {
    let cancelled = false;
    getMyQuota()
      .then((q) => {
        if (!cancelled) setRemaining(q.remaining[action] ?? null);
      })
      .catch(() => {
        // Purely informational — never block discovery on it.
      });
    return () => {
      cancelled = true;
    };
  }, [action]);

  // Lift the pause by itself once the reset time passes.
  useEffect(() => {
    if (!pausedUntil) return;
    const ms = Math.max(0, Date.parse(pausedUntil) - Date.now());
    // setTimeout caps at ~24.8 days; a month-end reset can exceed that, so clamp.
    const id = setTimeout(() => setPausedUntil(null), Math.min(ms, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [pausedUntil]);

  const noteError = useCallback((err: unknown): boolean => {
    if (err instanceof ApiError && err.code === "budget_exhausted") {
      setPausedUntil(err.resetsAt);
      return true;
    }
    if (err instanceof ApiError && err.code === "user_quota") {
      setRemaining(0);
    }
    return false;
  }, []);

  return { remaining, pausedUntil, paused: pausedUntil !== null, reload, noteError };
}
