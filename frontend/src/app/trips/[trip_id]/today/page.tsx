"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, CloudSun, Navigation, SkipForward, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { api, apiErrorMessage } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { formatMoney } from "@/lib/logistics";
import { navigateTo } from "@/lib/navigation";
import { enqueueCheckIn, flushCheckIns, pendingCheckIns, type CheckInAction } from "@/lib/offlineQueue";
import { describeDelta, scheduleStatus, todayIn } from "@/lib/schedule";
import { useOnline } from "@/hooks/useOnline";
import { useDayWeather, useTripNavigation } from "@/hooks/useTripExtras";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageShell } from "@/components/layout/PageShell";
import { NavButtons } from "@/components/logistics/NavButtons";
import { PhotoGrid } from "@/components/memories/PhotoGrid";
import { PhotoUploadButton } from "@/components/memories/PhotoUploadButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { Expense, ExpenseCategory, Itinerary, ItineraryWaypoint, Trip, TripPhoto } from "@/types";

const SYNC_RETRY_MS = 8000;
const EXPENSE_CATEGORIES: ExpenseCategory[] = ["food", "fuel", "lodging", "activities", "other"];

// Car-friendly: every tap target is at least 48px tall.
const BIG = "h-14 text-base";

function clock(time: string | null): string {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError; // fetch rejects with TypeError when there is no connection
}

export default function TodayPage({ params }: { params: Promise<{ trip_id: string }> }) {
  const { trip_id } = use(params);
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const online = useOnline();
  usePageTitle("Today");

  const [trip, setTrip] = useState<Trip | null>(null);
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [photos, setPhotos] = useState<TripPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pickedDayId, setPickedDayId] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [dayNote, setDayNote] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("food");

  // Viewers follow along but can't check in, edit notes, upload or add expenses.
  const readOnly = trip?.my_role === "viewer";
  const days = itinerary?.days;
  const weather = useDayWeather(trip_id, Boolean(days?.length), (days ?? []).map((d) => d.id).join());
  const navigation = useTripNavigation(trip_id, Boolean(days?.length), (days ?? []).map((d) => d.id).join());

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?next=/trips/${trip_id}/today`);
      return;
    }
    (async () => {
      try {
        const [t, it] = await Promise.all([
          api.get<Trip>(`/trips/${trip_id}`),
          api.get<Itinerary>(`/trips/${trip_id}/itinerary`),
        ]);
        setTrip(t);
        setItinerary(it);
        // Optional extras: the page works without them (and offline they come from the cache).
        api.get<Expense[]>(`/trips/${trip_id}/expenses`).then(setExpenses).catch(() => undefined);
        api.get<TripPhoto[]>(`/trips/${trip_id}/photos`).then(setPhotos).catch(() => undefined);
      } catch (err) {
        setError(apiErrorMessage(err, "Couldn't load this trip"));
      }
    })();
  }, [authLoading, user, router, trip_id]);

  // ── pick the day: match today's date in the trip's timezone ────────────────
  const today = trip ? todayIn(trip.timezone) : null;
  const autoDay = days?.find((d) => d.date === today);
  const day = days?.find((d) => d.id === (pickedDayId ?? autoDay?.id));
  const stops: ItineraryWaypoint[] = useMemo(() => day?.waypoints ?? [], [day]);
  const nextStop = stops.find((s) => !s.visited_at && !s.skipped);
  const status = trip ? scheduleStatus(stops, trip.timezone) : null;
  const fullStop = (id: string) => trip?.waypoints.find((w) => w.id === id);

  // ── offline check-in queue ─────────────────────────────────────────────────
  const refreshPending = useCallback(async () => {
    try {
      setPending((await pendingCheckIns(trip_id)).length);
    } catch {
      /* IndexedDB unavailable: nothing is ever queued */
    }
  }, [trip_id]);

  useEffect(() => {
    let cancelled = false;
    const count = () =>
      pendingCheckIns(trip_id)
        .then((q) => {
          if (!cancelled) setPending(q.length);
          return q.length;
        })
        .catch(() => 0); // IndexedDB unavailable: nothing is ever queued
    const sync = () => {
      if (!navigator.onLine) return;
      void flushCheckIns().then(count);
    };
    void count().then((n) => n > 0 && sync());
    window.addEventListener("online", sync); // replay as soon as the connection returns
    const timer = setInterval(() => {
      void count().then((n) => n > 0 && sync()); // and keep retrying while anything is waiting
    }, SYNC_RETRY_MS);
    return () => {
      cancelled = true;
      window.removeEventListener("online", sync);
      clearInterval(timer);
    };
  }, [trip_id]);

  function applyLocally(stopId: string, action: CheckInAction, at: string) {
    setItinerary((prev) =>
      prev && {
        ...prev,
        days: prev.days.map((d) => ({
          ...d,
          waypoints: d.waypoints.map((w) =>
            w.id !== stopId
              ? w
              : {
                  ...w,
                  visited_at: action === "arrived" ? at : null,
                  skipped: action === "skipped",
                }
          ),
        })),
      }
    );
  }

  async function checkIn(stop: ItineraryWaypoint, action: CheckInAction) {
    const before = { visited_at: stop.visited_at, skipped: stop.skipped };
    const at = new Date().toISOString();
    applyLocally(stop.id, action, at);
    const queue = async () => {
      await enqueueCheckIn({ tripId: trip_id, waypointId: stop.id, action, at });
      await refreshPending();
      toast.message("Saved offline — it will sync when you're back online.");
    };
    if (!navigator.onLine) return queue();
    try {
      await api.post(`/trips/${trip_id}/waypoints/${stop.id}/check-in`, { action, at });
    } catch (err) {
      if (isNetworkError(err)) return queue(); // lie-fi: online by the browser's account, but no luck
      setItinerary((prev) =>
        prev && {
          ...prev,
          days: prev.days.map((d) => ({
            ...d,
            waypoints: d.waypoints.map((w) => (w.id === stop.id ? { ...w, ...before } : w)),
          })),
        }
      );
      toast.error(apiErrorMessage(err, "Couldn't save that check-in"));
    }
  }

  // ── journal + spending ─────────────────────────────────────────────────────
  async function saveStopNote(stop: ItineraryWaypoint) {
    const text = noteDrafts[stop.id];
    if (text === undefined || text === (stop.notes ?? "")) return;
    try {
      await api.patch(`/trips/${trip_id}/waypoints/${stop.id}`, { notes: text });
      setItinerary((prev) =>
        prev && {
          ...prev,
          days: prev.days.map((d) => ({
            ...d,
            waypoints: d.waypoints.map((w) => (w.id === stop.id ? { ...w, notes: text } : w)),
          })),
        }
      );
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't save the note"));
    }
  }

  async function saveDayNote() {
    if (!day || dayNote === null || dayNote === (day.notes ?? "")) return;
    try {
      await api.patch(`/trips/${trip_id}/itinerary/days/${day.id}`, { notes: dayNote });
      setItinerary((prev) =>
        prev && { ...prev, days: prev.days.map((d) => (d.id === day.id ? { ...d, notes: dayNote } : d)) }
      );
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't save the day's notes"));
    }
  }

  async function addExpense(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!day || !Number.isFinite(value) || value <= 0) return;
    try {
      const created = await api.post<Expense>(`/trips/${trip_id}/expenses`, {
        category,
        amount: value,
        itinerary_day_id: day.id,
      });
      setExpenses((prev) => [...prev, created]);
      setAmount("");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't add that expense"));
    }
  }

  async function removePhoto(photo: TripPhoto) {
    try {
      await api.delete(`/trips/${trip_id}/photos/${photo.id}`);
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't delete the photo"));
    }
  }

  if (error) {
    return (
      <PageShell>
        <p className="text-sm text-neutral-600">{error}</p>
      </PageShell>
    );
  }
  if (!trip || !itinerary) {
    return (
      <PageShell>
        <Skeleton className="h-72 w-full rounded-2xl" />
      </PageShell>
    );
  }

  const dayExpenses = expenses.filter((x) => x.itinerary_day_id === day?.id);
  const spent = dayExpenses.reduce((sum, x) => sum + x.amount, 0);
  const sunset = day ? weather?.[day.id]?.sunset : undefined;
  const next = nextStop ? fullStop(nextStop.id) : undefined;
  const dayPhotos = photos.filter((p) => p.itinerary_day_id === day?.id);

  return (
    <PageShell>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 pb-12">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/trips/${trip_id}`} aria-label="Back to trip">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold text-neutral-900">{trip.title}</h1>
            <p className="text-sm text-neutral-500">
              {day ? `Day ${day.day_number}${day.title ? ` · ${day.title}` : ""}` : "Pick a day"}
            </p>
          </div>
        </div>

        {pending > 0 && (
          <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {pending} check-in{pending === 1 ? "" : "s"} waiting to sync
            {online ? " — syncing…" : " — will send when you're back online"}
          </p>
        )}

        {(!autoDay || itinerary.days.length > 1) && itinerary.days.length > 0 && (
          <label className="flex flex-col gap-1 text-sm text-neutral-600">
            {autoDay ? "Day" : "No day is dated today — choose one"}
            <select
              className="h-12 rounded-lg border border-neutral-300 bg-white px-3 text-base text-neutral-900"
              value={day?.id ?? ""}
              onChange={(e) => setPickedDayId(e.target.value || null)}
            >
              {!day && <option value="">Select a day…</option>}
              {itinerary.days.map((d) => (
                <option key={d.id} value={d.id}>
                  Day {d.day_number}
                  {d.date ? ` · ${d.date}` : ""}
                  {d.title ? ` · ${d.title}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}

        {itinerary.days.length === 0 && (
          <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-neutral-500">
            This trip has no itinerary days yet.{" "}
            <Link href={`/trips/${trip_id}/itinerary`} className="text-primary-700 underline">
              Plan your days
            </Link>
            .
          </p>
        )}

        {day && nextStop && (
          <section className="flex flex-col gap-4 rounded-2xl border-2 border-primary-500 bg-white p-5 shadow-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Next stop</p>
              <h2 className="mt-1 text-2xl font-bold text-neutral-900">{nextStop.label || nextStop.address}</h2>
              {nextStop.label && <p className="text-sm text-neutral-500">{nextStop.address}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-neutral-700">
                {nextStop.scheduled_arrival_time && <span>Planned {clock(nextStop.scheduled_arrival_time)}</span>}
                {nextStop.drive_seconds_from_prev != null && (
                  <span>{formatDuration(nextStop.drive_seconds_from_prev)} drive</span>
                )}
                {status && (
                  <span
                    className={`rounded-full px-3 py-1 text-sm font-semibold ${
                      status.deltaMinutes < -5 ? "bg-amber-100 text-amber-900" : "bg-green-100 text-green-800"
                    }`}
                  >
                    {describeDelta(status.deltaMinutes)}
                  </span>
                )}
              </div>
            </div>

            {next && (
              <Button asChild className={`${BIG} w-full gap-2`}>
                <a href={navigateTo(next)} target="_blank" rel="noopener noreferrer">
                  <Navigation className="h-5 w-5" aria-hidden />
                  Navigate
                </a>
              </Button>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Button className={`${BIG} gap-2 bg-green-600 hover:bg-green-700`} onClick={() => checkIn(nextStop, "arrived")} disabled={readOnly}>
                <Check className="h-5 w-5" aria-hidden />
                Arrived
              </Button>
              <Button variant="outline" className={`${BIG} gap-2`} onClick={() => checkIn(nextStop, "skipped")} disabled={readOnly}>
                <SkipForward className="h-5 w-5" aria-hidden />
                Skip
              </Button>
            </div>
          </section>
        )}

        {day && !nextStop && stops.length > 0 && (
          <section className="rounded-2xl border border-green-200 bg-green-50 p-5 text-green-900">
            <h2 className="text-lg font-bold">That&apos;s everything for today</h2>
            <p className="text-sm">
              {stops.filter((s) => s.visited_at).length} of {stops.length} stops visited.
            </p>
            {trip.ended && (
              <Button asChild className="mt-3 h-12">
                <Link href={`/trips/${trip_id}/recap`}>See the trip recap</Link>
              </Button>
            )}
          </section>
        )}

        {day && stops.length > 0 && (
          <section className="rounded-2xl border border-neutral-200 bg-white">
            <h2 className="border-b border-neutral-100 px-4 py-3 text-sm font-semibold text-neutral-700">
              Today&apos;s stops
            </h2>
            <ul className="divide-y divide-neutral-100">
              {stops.map((s) => {
                const done = Boolean(s.visited_at) || s.skipped;
                return (
                  <li key={s.id} className="flex flex-col gap-2 px-4 py-3">
                    <div className="flex min-h-12 items-center gap-3">
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                          s.visited_at ? "bg-green-600 text-white" : s.skipped ? "bg-neutral-300 text-neutral-600" : "bg-primary-100 text-primary-800"
                        }`}
                        aria-hidden
                      >
                        {s.visited_at ? "✓" : s.skipped ? "–" : s.day_position != null ? s.day_position + 1 : ""}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-base font-medium ${done ? "text-neutral-400 line-through" : "text-neutral-900"}`}>
                          {s.label || s.address}
                        </p>
                        <p className="text-sm text-neutral-500">
                          {s.visited_at
                            ? `Arrived ${new Date(s.visited_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                            : s.skipped
                              ? "Skipped"
                              : clock(s.scheduled_arrival_time)}
                        </p>
                      </div>
                      {done && (
                        <Button variant="ghost" className="h-12 gap-1.5" disabled={readOnly} onClick={() => checkIn(s, "undo")} aria-label={`Undo check-in for ${s.label || s.address}`}>
                          <Undo2 className="h-4 w-4" aria-hidden />
                          Undo
                        </Button>
                      )}
                    </div>
                    {s.visited_at && (
                      <div className="flex flex-col gap-2 pl-11">
                        <Textarea
                          rows={2}
                          placeholder="Notes about this stop…"
                          className="text-base"
                          value={noteDrafts[s.id] ?? s.notes ?? ""}
                          readOnly={readOnly}
                          onChange={(e) => setNoteDrafts((p) => ({ ...p, [s.id]: e.target.value }))}
                          onBlur={() => saveStopNote(s)}
                        />
                        <PhotoGrid photos={photos.filter((p) => p.waypoint_id === s.id)} onDelete={removePhoto} />
                        {!readOnly && <PhotoUploadButton
                          tripId={trip_id}
                          waypointId={s.id}
                          label="Add photo"
                          className="h-12 self-start"
                          onUploaded={(p) => setPhotos((prev) => [...prev, p])}
                        />}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {day && (
          <section className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span className="flex items-center gap-2 text-neutral-700">
                <CloudSun className="h-5 w-5" aria-hidden />
                {sunset ? `Sunset ${clock(sunset.slice(11, 16))}` : "Sunset time unavailable"}
              </span>
              <span className="font-semibold text-neutral-900">Spent today {formatMoney(spent, trip.currency)}</span>
            </div>
            <form onSubmit={addExpense} className="flex gap-2">
              <select
                aria-label="Expense category"
                className="h-12 rounded-lg border border-neutral-300 bg-white px-2 text-base capitalize"
                value={category}
                onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <Input
                aria-label="Amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="Amount"
                className="h-12 flex-1 text-base"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <Button type="submit" className="h-12" disabled={!online || readOnly}>
                Add
              </Button>
            </form>
            <NavButtons nav={navigation?.days[day.id]} />
          </section>
        )}

        {day && (
          <section className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-neutral-700">Day journal</h2>
            <Textarea
              rows={3}
              placeholder="How was today?"
              className="text-base"
              readOnly={readOnly}
              value={dayNote ?? day.notes ?? ""}
              onChange={(e) => setDayNote(e.target.value)}
              onBlur={saveDayNote}
            />
            <PhotoGrid photos={dayPhotos} onDelete={removePhoto} />
            {!readOnly && <PhotoUploadButton
              tripId={trip_id}
              itineraryDayId={day.id}
              label="Add photos to this day"
              className="h-12 self-start"
              onUploaded={(p) => setPhotos((prev) => [...prev, p])}
            />}
          </section>
        )}
      </div>
    </PageShell>
  );
}
