"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, apiErrorMessage } from "@/lib/api";
import type { VoteKind, VoteTally } from "@/types";

/** Group votes for one kind of target (radius/corridor suggestions or waypoints). */
export function useVotes(tripId: string, kind: VoteKind, enabled: boolean, refreshKey?: unknown) {
  const [tallies, setTallies] = useState<Record<string, VoteTally>>({});

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api
      .get<Record<string, VoteTally>>(`/trips/${tripId}/votes?kind=${kind}`)
      .then((t) => {
        if (!cancelled) setTallies(t);
      })
      .catch(() => undefined); // votes are an enhancement; the page works without them
    return () => {
      cancelled = true;
    };
  }, [tripId, kind, enabled, refreshKey]);

  const vote = useCallback(
    async (targetId: string, value: -1 | 0 | 1) => {
      try {
        const tally = await api.put<VoteTally>(`/trips/${tripId}/votes`, {
          kind,
          target_id: targetId,
          value,
        });
        setTallies((prev) => ({ ...prev, [targetId]: tally }));
      } catch (err) {
        toast.error(apiErrorMessage(err, "Couldn't save your vote"));
      }
    },
    [tripId, kind]
  );

  /** Net votes (👍 − 👎) for sorting by group favourites. */
  const net = useCallback((id: string) => (tallies[id] ? tallies[id].up - tallies[id].down : 0), [tallies]);

  return { tallies, vote, net };
}
