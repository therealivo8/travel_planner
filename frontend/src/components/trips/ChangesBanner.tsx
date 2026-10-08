import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Activity } from "@/types";

/** Shown when another member changed the trip after this page loaded. */
export function ChangesBanner({ activity, onReload }: { activity: Activity[]; onReload: () => void }) {
  const latest = activity[0]?.summary ?? "Someone changed this trip";
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <p className="flex-1">
        <strong>{latest}.</strong> Reload to see the latest.
      </p>
      <Button size="sm" onClick={onReload} className="gap-1.5">
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        Reload
      </Button>
    </div>
  );
}
