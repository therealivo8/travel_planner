"use client";

import { useEffect, useState } from "react";
import { getAdminUsage } from "@/lib/api";
import { PageShell } from "@/components/layout/PageShell";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { AdminUsage, SkuUsage } from "@/types";

function pct(used: number, cap: number | null): number {
  return cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
}

function UsageBar({ used, cap }: { used: number; cap: number | null }) {
  const value = pct(used, cap);
  return (
    <div className="flex flex-col gap-1 min-w-32">
      <Progress
        value={value}
        className="h-2"
        aria-label={`${value}% of budget used`}
      />
      <span className={cn("text-xs", value >= 80 ? "text-amber-700" : "text-neutral-500")}>
        {used.toLocaleString()} {cap ? `/ ${cap.toLocaleString()}` : ""}
      </span>
    </div>
  );
}

function Row({ s }: { s: SkuUsage }) {
  return (
    <tr className="border-t border-neutral-100">
      <td className="py-3 pr-4 font-mono text-xs text-neutral-800">{s.sku}</td>
      <td className="py-3 pr-4">
        <UsageBar used={s.today} cap={s.day_budget} />
      </td>
      <td className="py-3 pr-4">
        <UsageBar used={s.month} cap={s.month_budget} />
      </td>
      <td className="py-3 pr-4 text-xs text-neutral-600">
        {s.free_allowance != null ? s.free_allowance.toLocaleString() : "—"}
      </td>
      <td className="py-3 text-right text-xs text-neutral-800">
        ${s.estimated_cost_usd.toFixed(2)}
      </td>
    </tr>
  );
}

export default function AdminUsagePage() {
  const [usage, setUsage] = useState<AdminUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdminUsage()
      .then(setUsage)
      .catch((err) => {
        // The backend answers 403 to non-admins; don't reveal more than "not found".
        const forbidden = err instanceof Error && err.message.startsWith("API 403");
        setError(forbidden ? "You don't have access to this page." : "Failed to load usage.");
      });
  }, []);

  return (
    <PageShell title="API usage">
      {error ? (
        <p className="text-sm text-neutral-600">{error}</p>
      ) : !usage ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-neutral-600">
              Month to date since {usage.month_start} (UTC). Budgets sit at ~90% of each free
              allowance.
            </p>
            <p className="text-sm font-medium text-neutral-900">
              Estimated overage: ${usage.estimated_total_cost_usd.toFixed(2)}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-neutral-400">
                  <th className="pb-2 pr-4 font-medium">SKU</th>
                  <th className="pb-2 pr-4 font-medium">Today / daily budget</th>
                  <th className="pb-2 pr-4 font-medium">Month / monthly budget</th>
                  <th className="pb-2 pr-4 font-medium">Free allowance</th>
                  <th className="pb-2 text-right font-medium">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {usage.skus.map((s) => (
                  <Row key={s.sku} s={s} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PageShell>
  );
}
