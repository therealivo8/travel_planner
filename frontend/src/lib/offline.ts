import { api } from "@/lib/api";

/** Register the service worker (production only — in dev it would fight hot reload). */
export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV !== "production") return;
  navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
    // Offline support is an enhancement; the app works without it.
  });
}

async function activeWorker(): Promise<ServiceWorker | null> {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg?.active ?? null;
}

/** Private trip data is cached for offline use; wipe it when the user signs out. */
export async function clearOfflineData() {
  (await activeWorker())?.postMessage({ type: "clear-private" });
}

/**
 * "Save for offline": fetch the data endpoints (the service worker caches each response as
 * it passes through) and ask the worker to pre-cache the trip's pages.
 */
export async function saveTripForOffline(tripId: string): Promise<{ ok: boolean; reason?: string }> {
  const worker = await activeWorker();
  if (!worker) {
    return {
      ok: false,
      reason: "Offline mode isn't available here yet — it's enabled in the installed/production app.",
    };
  }
  const base = `/trips/${tripId}`;
  const results = await Promise.allSettled([
    api.get(base),
    api.get(`${base}/itinerary`),
    api.get(`${base}/weather`),
    api.get(`${base}/navigation`),
    api.get(`${base}/expenses`),
    api.get(`${base}/photos`),
  ]);
  // Trip + itinerary are the essentials; weather and photos may legitimately be empty/unavailable.
  if (results[0].status === "rejected" || results[1].status === "rejected") {
    return { ok: false, reason: "Couldn't download the trip. Check your connection and try again." };
  }
  worker.postMessage({
    type: "cache-pages",
    urls: [`/trips/${tripId}`, `/trips/${tripId}/today`, `/trips/${tripId}/itinerary`, "/trips"],
  });
  return { ok: true };
}
