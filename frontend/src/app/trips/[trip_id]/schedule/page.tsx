"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  Car,
  Clock,
  Download,
  LayoutGrid,
  MapPin,
  Share2,
  StickyNote,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { api, getApiToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/layout/PageShell";
import type { Itinerary, ItineraryDay, Trip } from "@/types";

/** Kept in step with the itinerary board's assumption so the two pages never
 *  disagree about how long a day is. */
const DEFAULT_DWELL_MINUTES = 30;
const DAY_BUDGET_MINUTES = 8 * 60;

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function dayTotalMinutes(day: ItineraryDay): number {
  const driveMinutes = day.waypoints.reduce(
    (sum, w) => sum + (w.drive_seconds_from_prev ?? 0) / 60,
    0
  );
  return driveMinutes + day.waypoints.length * DEFAULT_DWELL_MINUTES;
}

function formatDate(date: string | null): string | null {
  if (!date) return null;
  // Parse as a plain calendar date — `new Date("2026-03-14")` is UTC midnight and
  // renders as the previous day for anyone west of Greenwich.
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatTime(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h)) return null;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m ?? 0).padStart(2, "0")} ${period}`;
}

// ── day section ───────────────────────────────────────────────────────────

function DaySection({ day }: { day: ItineraryDay }) {
  const totalMinutes = dayTotalMinutes(day);
  const overBudget = totalMinutes > DAY_BUDGET_MINUTES;
  const dateLabel = formatDate(day.date);

  return (
    <section className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-4 border-b border-neutral-200 bg-neutral-50">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <span className="text-xs font-bold text-neutral-400 uppercase tracking-wide shrink-0">
            Day {day.day_number}
          </span>
          <h2 className="text-base font-semibold text-neutral-900 truncate">
            {day.title || <span className="text-neutral-400 font-normal">Untitled day</span>}
          </h2>
        </div>
        <div className="flex items-center gap-3 text-xs shrink-0">
          {dateLabel && (
            <span className="flex items-center gap-1 text-neutral-500">
              <CalendarDays className="h-3.5 w-3.5" />
              {dateLabel}
            </span>
          )}
          <span className="flex items-center gap-1 text-neutral-500">
            <MapPin className="h-3.5 w-3.5" />
            {day.waypoints.length} stop{day.waypoints.length === 1 ? "" : "s"}
          </span>
          <span
            className={`flex items-center gap-1 ${
              overBudget ? "text-amber-600 font-medium" : "text-neutral-500"
            }`}
            title={`${day.waypoints.length} stop(s) × ${DEFAULT_DWELL_MINUTES}m, plus known drive legs`}
          >
            <Clock className="h-3.5 w-3.5" />
            {formatMinutes(totalMinutes)}
            {overBudget && " · over budget"}
          </span>
        </div>
      </header>

      {day.waypoints.length === 0 ? (
        <p className="px-5 py-6 text-sm text-neutral-400 italic text-center">
          No stops scheduled for this day yet.
        </p>
      ) : (
        <ol className="divide-y divide-neutral-100">
          {day.waypoints.map((wp, i) => {
            const arrival = formatTime(wp.scheduled_arrival_time);
            return (
              <li key={wp.id} className="flex items-start gap-3 px-5 py-3.5">
                <span className="shrink-0 mt-0.5 h-6 w-6 rounded-full bg-primary-50 text-primary-700 text-xs font-semibold flex items-center justify-center">
                  {i + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-sm text-neutral-900 font-medium leading-snug">
                    {wp.label || wp.address}
                  </p>
                  {wp.label && wp.address !== wp.label && (
                    <p className="text-xs text-neutral-500 leading-snug mt-0.5">{wp.address}</p>
                  )}
                </div>

                <div className="shrink-0 flex items-center gap-3 text-xs">
                  {wp.drive_seconds_from_prev != null && (
                    <span className="flex items-center gap-1 text-neutral-400" title="Drive time to this stop">
                      <Car className="h-3.5 w-3.5" />
                      {formatDuration(wp.drive_seconds_from_prev)}
                    </span>
                  )}
                  {arrival ? (
                    <span className="font-medium text-neutral-700 tabular-nums w-20 text-right">
                      {arrival}
                    </span>
                  ) : (
                    <span className="text-neutral-300 w-20 text-right">—</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {day.notes && (
        <div className="flex items-start gap-2 px-5 py-3 bg-amber-50/60 border-t border-amber-100">
          <StickyNote className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-neutral-700 whitespace-pre-wrap leading-relaxed">{day.notes}</p>
        </div>
      )}
    </section>
  );
}

// ── page ──────────────────────────────────────────────────────────────────

export default function SchedulePage({ params }: { params: Promise<{ trip_id: string }> }) {
  const { trip_id } = use(params);
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [itin, tripData] = await Promise.all([
        api.get<Itinerary>(`/trips/${trip_id}/itinerary`),
        api.get<Trip>(`/trips/${trip_id}`),
      ]);
      setItinerary(itin);
      setTrip(tripData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load schedule");
    } finally {
      setLoading(false);
    }
  }, [trip_id]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?next=/trips/${trip_id}/schedule`);
      return;
    }
    // Matches the auth-gated load pattern every other page in this app uses. It
    // trips react-hooks/set-state-in-effect, as those pages do; converting the
    // whole app to a fetch library is a separate change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [authLoading, user, router, trip_id, load]);

  async function handleExportPdf() {
    setExporting(true);
    try {
      const res = await fetch(`/api/trips/${trip_id}/export/pdf`, {
        headers: { Authorization: `Bearer ${getApiToken() ?? ""}` },
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${trip?.title ?? "trip"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "PDF export failed");
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <PageShell className="max-w-4xl mx-auto w-full">
        <Skeleton className="h-8 w-56 mb-6" />
        <div className="flex flex-col gap-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      </PageShell>
    );
  }

  if (error || !itinerary) {
    return (
      <PageShell fullBleed>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-red-500 mb-4">{error ?? "Could not load schedule"}</p>
            <Button asChild variant="outline">
              <Link href={`/trips/${trip_id}`}>Back to trip</Link>
            </Button>
          </div>
        </div>
      </PageShell>
    );
  }

  const scheduledCount = itinerary.days.reduce((n, d) => n + d.waypoints.length, 0);
  const totalMinutes = itinerary.days.reduce((n, d) => n + dayTotalMinutes(d), 0);
  const hasSchedule = itinerary.days.length > 0 && scheduledCount > 0;

  return (
    <PageShell className="max-w-4xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/trips/${trip_id}/itinerary`} aria-label="Back to itinerary builder">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-neutral-900 truncate">
              {trip?.title ?? "Schedule"}
            </h1>
            {hasSchedule && (
              <p className="text-xs text-neutral-500 mt-0.5">
                {itinerary.days.length} day{itinerary.days.length === 1 ? "" : "s"} ·{" "}
                {scheduledCount} stop{scheduledCount === 1 ? "" : "s"} ·{" "}
                {formatMinutes(totalMinutes)} total
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/trips/${trip_id}/itinerary`}>
              <LayoutGrid className="h-4 w-4 mr-1.5" />
              Edit
            </Link>
          </Button>
          {hasSchedule && (
            <Button size="sm" onClick={handleExportPdf} disabled={exporting}>
              <Download className="h-4 w-4 mr-1.5" />
              {exporting ? "Exporting…" : "Export PDF"}
            </Button>
          )}
        </div>
      </div>

      {!hasSchedule ? (
        <div className="bg-white rounded-xl border border-neutral-200 py-16 px-6 text-center">
          <CalendarDays className="h-8 w-8 text-neutral-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-neutral-700 mb-1">Nothing scheduled yet</p>
          <p className="text-xs text-neutral-500 mb-5 max-w-sm mx-auto">
            Arrange your stops into days on the itinerary board, then come back here for the
            day-by-day view.
          </p>
          <Button asChild size="sm">
            <Link href={`/trips/${trip_id}/itinerary`}>
              <LayoutGrid className="h-4 w-4 mr-1.5" />
              Open itinerary builder
            </Link>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {itinerary.days.map((day) => (
            <DaySection key={day.id} day={day} />
          ))}

          {itinerary.unscheduled_waypoints.length > 0 && (
            <section className="rounded-xl border border-dashed border-neutral-300 bg-white/60 px-5 py-4">
              <p className="text-sm font-medium text-neutral-700 mb-1">
                {itinerary.unscheduled_waypoints.length} stop
                {itinerary.unscheduled_waypoints.length === 1 ? "" : "s"} not scheduled
              </p>
              <p className="text-xs text-neutral-500 mb-3">
                {itinerary.unscheduled_waypoints
                  .slice(0, 4)
                  .map((w) => w.label || w.address)
                  .join(" · ")}
                {itinerary.unscheduled_waypoints.length > 4 &&
                  ` · +${itinerary.unscheduled_waypoints.length - 4} more`}
              </p>
              <Button asChild size="sm" variant="outline">
                <Link href={`/trips/${trip_id}/itinerary`}>Schedule them</Link>
              </Button>
            </section>
          )}

          <div className="flex items-center justify-center gap-2 pt-2 pb-6">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/trips/${trip_id}`}>
                <Share2 className="h-4 w-4 mr-1.5" />
                Trip &amp; sharing
              </Link>
            </Button>
          </div>
        </div>
      )}
    </PageShell>
  );
}
