/**
 * Check-ins made without a connection wait in IndexedDB and are replayed when it returns.
 * The backend's check-in endpoint is idempotent and takes the original timestamp, so a
 * replay (or a double replay) always lands in the right state at the right time.
 */
import { api } from "@/lib/api";

export type CheckInAction = "arrived" | "skipped" | "undo";

export interface QueuedCheckIn {
  id?: number;
  tripId: string;
  waypointId: string;
  action: CheckInAction;
  at: string; // ISO time the user actually did it
}

const DB_NAME = "rtp-offline";
const STORE = "checkins";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = fn(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
  );
}

export const enqueueCheckIn = (item: Omit<QueuedCheckIn, "id">) =>
  tx("readwrite", (s) => s.add(item));

export const pendingCheckIns = (tripId?: string): Promise<QueuedCheckIn[]> =>
  tx<QueuedCheckIn[]>("readonly", (s) => s.getAll()).then((all) =>
    tripId ? all.filter((i) => i.tripId === tripId) : all
  );

const remove = (id: number) => tx("readwrite", (s) => s.delete(id));

/** Replay in order. Stops at the first network failure; drops items the server rejects (4xx). */
export async function flushCheckIns(): Promise<number> {
  let sent = 0;
  for (const item of (await pendingCheckIns()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0))) {
    try {
      await api.post(`/trips/${item.tripId}/waypoints/${item.waypointId}/check-in`, {
        action: item.action,
        at: item.at,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (/^API 4\d\d/.test(message) || message.startsWith("Session expired")) {
        // The stop was deleted or the session ended: this item can never succeed.
        if (item.id != null) await remove(item.id);
        continue;
      }
      break; // still offline (or a 5xx): keep it and retry later
    }
    if (item.id != null) await remove(item.id);
    sent += 1;
  }
  return sent;
}
