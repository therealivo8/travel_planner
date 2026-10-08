import { PauseCircle } from "lucide-react";

function formatReset(iso: string | null): string {
  if (!iso) return "later";
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Calm, non-modal notice shown when the shared API budget is spent. */
export function BudgetPausedBanner({ resetsAt }: { resetsAt: string | null }) {
  return (
    <div
      role="status"
      className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
    >
      <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        Discovery is paused until {formatReset(resetsAt)} to stay within our free API limits. Your
        saved suggestions and manual stops still work.
      </p>
    </div>
  );
}

function daysAgo(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** "3 discoveries left today" and, for cached results, "Updated 2 days ago". */
export function DiscoveryMeta({
  remaining,
  cached,
  updatedAt,
}: {
  remaining: number | null;
  cached: boolean;
  updatedAt: string | null;
}) {
  if (remaining === null && !(cached && updatedAt)) return null;
  return (
    <p className="text-xs text-neutral-500">
      {cached && updatedAt && <>Updated {daysAgo(updatedAt)}</>}
      {cached && updatedAt && remaining !== null && " · "}
      {remaining !== null &&
        `${remaining} discover${remaining === 1 ? "y" : "ies"} left today`}
    </p>
  );
}
