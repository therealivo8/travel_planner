"use client";

import { X } from "lucide-react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import type { TripMode } from "@/types";

const STEPS: Record<TripMode, string[]> = {
  point_to_point: [
    "Add stops along your route and drag them into order.",
    "Use Discover to find places worth a detour — it uses a small daily allowance.",
    "Open Itinerary to spread your stops across days.",
  ],
  radius: [
    "Run Discover to see what's within your drive-time radius.",
    "Select the places you like and build a day itinerary.",
    "Open Itinerary to schedule them across days.",
  ],
};

/** One-time, dismissible 3-step tip strip. Dismissal lives in localStorage only. */
export function FirstVisitTips({ mode }: { mode: TripMode }) {
  const [dismissed, setDismissed] = useLocalStorage("tips-dismissed-v1", false);
  if (dismissed) return null;
  return (
    <div
      role="note"
      className="mb-4 flex items-start gap-3 rounded-xl border border-primary-200 bg-primary-50 p-3 text-sm text-primary-900"
    >
      <ol className="flex flex-1 flex-col gap-1 sm:flex-row sm:gap-6">
        {STEPS[mode].map((step, i) => (
          <li key={step} className="flex gap-2">
            <span className="font-semibold">{i + 1}.</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss tips" className="shrink-0">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
