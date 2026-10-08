"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { TRIP_CONFLICT_EVENT } from "@/lib/api";

/**
 * Turns a refused (409) save into a persistent prompt. The refused change was NOT applied, so
 * nothing is lost: reloading shows the collaborator's changes, then the edit can be redone.
 */
export function CollabEvents() {
  useEffect(() => {
    function onConflict() {
      toast.warning("Someone else just changed this trip", {
        id: "trip-conflict",
        description: "Your last change wasn't saved. Reload to see their changes, then try again.",
        duration: Infinity,
        action: { label: "Reload", onClick: () => window.location.reload() },
      });
    }
    window.addEventListener(TRIP_CONFLICT_EVENT, onConflict);
    return () => window.removeEventListener(TRIP_CONFLICT_EVENT, onConflict);
  }, []);
  return null;
}
