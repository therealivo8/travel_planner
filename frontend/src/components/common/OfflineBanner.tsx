"use client";

import { useEffect } from "react";
import { WifiOff } from "lucide-react";
import { useOnline } from "@/hooks/useOnline";
import { registerServiceWorker } from "@/lib/offline";

/** Registers the service worker and tells the user when they're offline. */
export function OfflineBanner() {
  const online = useOnline();

  useEffect(() => {
    registerServiceWorker();
  }, []);

  if (online) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-xs font-medium text-amber-900"
    >
      <WifiOff className="h-3.5 w-3.5" aria-hidden />
      You&apos;re offline. Saved trips still work; changes that need the server are paused.
    </div>
  );
}
