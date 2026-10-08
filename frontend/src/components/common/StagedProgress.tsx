"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

interface StagedProgressProps {
  stages: string[];
  /** Calls faster than this show only the skeleton. */
  showAfterMs?: number;
  stepMs?: number;
}

/**
 * Timed status messages for slow discover calls. They're client-side estimates, not server
 * progress: mount it only while the request is in flight (it resets on remount) and it
 * walks through `stages` so a 30 s isochrone doesn't look like a hang.
 */
export function StagedProgress({ stages, showAfterMs = 5000, stepMs = 7000 }: StagedProgressProps) {
  const [step, setStep] = useState(-1);

  useEffect(() => {
    const timers = stages.map((_, i) =>
      setTimeout(() => setStep(i), showAfterMs + i * stepMs)
    );
    return () => timers.forEach(clearTimeout);
  }, [stages, showAfterMs, stepMs]);

  if (step < 0) return null;
  return (
    <p role="status" className="flex items-center gap-2 text-xs text-neutral-500">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      {stages[step]}
    </p>
  );
}
