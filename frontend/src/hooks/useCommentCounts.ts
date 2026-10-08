"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { CommentKind } from "@/types";

/** Live comment counts keyed by "kind:targetId" ("trip:" for the trip thread). */
export function useCommentCounts(tripId: string, enabled: boolean) {
  const [counts, setCounts] = useState<Record<string, number>>({});

  const reload = useCallback(() => {
    if (!enabled) return Promise.resolve();
    return api
      .get<Record<string, number>>(`/trips/${tripId}/comments/counts`)
      .then(setCounts)
      .catch(() => undefined);
  }, [tripId, enabled]);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) return;
    api
      .get<Record<string, number>>(`/trips/${tripId}/comments/counts`)
      .then((c) => {
        if (!cancelled) setCounts(c);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tripId, enabled]);

  const countFor = (kind: CommentKind, targetId?: string) => counts[`${kind}:${targetId ?? ""}`] ?? 0;
  return { countFor, reload };
}
