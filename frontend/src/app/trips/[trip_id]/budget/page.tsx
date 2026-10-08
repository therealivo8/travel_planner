"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/logistics";
import { formatDistance } from "@/lib/format";
import { useUnits } from "@/hooks/useUnits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageShell } from "@/components/layout/PageShell";
import type { Budget, Expense, ExpenseCategory, Itinerary, Trip } from "@/types";

const CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: "fuel", label: "Fuel" },
  { value: "lodging", label: "Lodging" },
  { value: "food", label: "Food" },
  { value: "activities", label: "Activities" },
  { value: "other", label: "Other" },
];

const selectClass =
  "h-9 rounded-lg border border-neutral-200 bg-white px-2 text-sm text-neutral-700";

export default function BudgetPage({ params }: { params: Promise<{ trip_id: string }> }) {
  usePageTitle("Budget");
  const { trip_id } = use(params);
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const units = useUnits();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [days, setDays] = useState<Itinerary["days"]>([]);
  const [error, setError] = useState<string | null>(null);
  const readOnly = trip?.my_role === "viewer"; // viewers see the numbers but can't change them

  // Estimate inputs (strings, so a half-typed number isn't clobbered)
  const [mpg, setMpg] = useState("");
  const [price, setPrice] = useState("");
  const [budgetTotal, setBudgetTotal] = useState("");

  // Quick-add form
  const [category, setCategory] = useState<ExpenseCategory>("food");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [dayId, setDayId] = useState("");

  const reloadBudget = useCallback(async () => {
    setBudget(await api.get<Budget>(`/trips/${trip_id}/budget`));
  }, [trip_id]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?next=/trips/${trip_id}/budget`);
      return;
    }
    (async () => {
      try {
        const [t, b, e, it] = await Promise.all([
          api.get<Trip>(`/trips/${trip_id}`),
          api.get<Budget>(`/trips/${trip_id}/budget`),
          api.get<Expense[]>(`/trips/${trip_id}/expenses`),
          api.get<Itinerary>(`/trips/${trip_id}/itinerary`),
        ]);
        setTrip(t);
        setBudget(b);
        setExpenses(e);
        setDays(it.days);
        setMpg(String(t.vehicle_mpg));
        setPrice(String(t.fuel_price_per_unit));
        setBudgetTotal(t.budget_total != null ? String(t.budget_total) : "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load budget");
      }
    })();
  }, [authLoading, user, router, trip_id]);

  async function saveSettings(patch: Partial<Trip>) {
    try {
      await api.patch<Trip>(`/trips/${trip_id}`, patch);
      await reloadBudget(); // the estimate updates as soon as the inputs are saved
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }

  async function addExpense(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0 || amount.trim() === "") return;
    try {
      const created = await api.post<Expense>(`/trips/${trip_id}/expenses`, {
        category,
        amount: value,
        note: note.trim() || undefined,
        itinerary_day_id: dayId || undefined,
      });
      setExpenses((prev) => [...prev, created]);
      setAmount("");
      setNote("");
      await reloadBudget();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add expense");
    }
  }

  async function updateAmount(expense: Expense, raw: string) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value === expense.amount) return;
    try {
      const updated = await api.patch<Expense>(`/trips/${trip_id}/expenses/${expense.id}`, {
        amount: value,
      });
      setExpenses((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      await reloadBudget();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update expense");
    }
  }

  async function removeExpense(id: string) {
    try {
      await api.delete(`/trips/${trip_id}/expenses/${id}`);
      setExpenses((prev) => prev.filter((x) => x.id !== id));
      await reloadBudget();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete expense");
    }
  }

  if (!trip || !budget) {
    return (
      <PageShell>
        {error ? (
          <p className="text-sm text-neutral-600">{error}</p>
        ) : (
          <Skeleton className="h-96 w-full rounded-xl" />
        )}
      </PageShell>
    );
  }

  const money = (n: number) => formatMoney(n, budget.currency);
  const pct = budget.budget_total
    ? Math.min(100, Math.round((budget.spent_total / budget.budget_total) * 100))
    : 0;
  const over = budget.remaining != null && budget.remaining < 0;

  // Group expenses by day (undated/unassigned ones last).
  const dayLabel = (id: string | null) => {
    const d = days.find((x) => x.id === id);
    return d ? `Day ${d.day_number}${d.title ? ` · ${d.title}` : ""}` : "Not tied to a day";
  };
  const groups = new Map<string, Expense[]>();
  for (const x of [...expenses].sort((a, b) => a.spent_on.localeCompare(b.spent_on))) {
    const key = x.itinerary_day_id ?? "";
    groups.set(key, [...(groups.get(key) ?? []), x]);
  }
  const orderedKeys = [...groups.keys()].sort((a, b) => {
    const na = days.find((d) => d.id === a)?.day_number ?? Infinity;
    const nb = days.find((d) => d.id === b)?.day_number ?? Infinity;
    return na - nb;
  });

  return (
    <PageShell>
      <div className="mb-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/trips/${trip_id}`} aria-label="Back to trip">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">{trip.title} · Budget</h1>
          <p className="text-xs text-neutral-500">
            {formatDistance(budget.distance_miles * 1609.34, units)} route
          </p>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-error-500">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Estimate + budget */}
        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-neutral-200 bg-white p-4">
            <h2 className="text-sm font-medium text-neutral-700">Fuel estimate</h2>
            <p className="mt-1 text-3xl font-bold text-neutral-900">
              {money(budget.estimated_fuel)}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs text-neutral-500">
                Vehicle MPG
                <Input
                  type="number"
                  min={1}
                  step="0.5"
                  disabled={readOnly}
                  value={mpg}
                  onChange={(e) => setMpg(e.target.value)}
                  onBlur={() => Number(mpg) > 0 && saveSettings({ vehicle_mpg: Number(mpg) })}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-neutral-500">
                Price per gallon
                <Input
                  type="number"
                  min={0}
                  step="0.05"
                  disabled={readOnly}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  onBlur={() =>
                    price !== "" && saveSettings({ fuel_price_per_unit: Number(price) })
                  }
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-neutral-400">
              Based on the saved route. Gas prices are your own estimate.
            </p>
          </section>

          <section className="rounded-xl border border-neutral-200 bg-white p-4">
            <h2 className="text-sm font-medium text-neutral-700">Trip budget</h2>
            <label className="mt-2 flex flex-col gap-1 text-xs text-neutral-500">
              Total budget ({budget.currency})
              <Input
                type="number"
                min={0}
                step="10"
                placeholder="No budget set"
                disabled={readOnly}
                value={budgetTotal}
                onChange={(e) => setBudgetTotal(e.target.value)}
                onBlur={() =>
                  saveSettings({ budget_total: budgetTotal === "" ? null : Number(budgetTotal) })
                }
              />
            </label>
            {budget.budget_total != null && (
              <div className="mt-3 flex flex-col gap-1">
                <Progress value={pct} aria-label={`${pct}% of budget spent`} />
                <p className={`text-xs ${over ? "font-medium text-error-500" : "text-neutral-500"}`}>
                  {money(budget.spent_total)} of {money(budget.budget_total)} spent ·{" "}
                  {over
                    ? `${money(-(budget.remaining ?? 0))} over`
                    : `${money(budget.remaining ?? 0)} left`}
                </p>
              </div>
            )}
            <ul className="mt-3 flex flex-col gap-1 text-xs text-neutral-600">
              {CATEGORIES.map((c) => (
                <li key={c.value} className="flex justify-between">
                  <span>{c.label}</span>
                  <span>{money(budget.spent_by_category[c.value] ?? 0)}</span>
                </li>
              ))}
              <li className="flex justify-between border-t border-neutral-100 pt-1 font-medium text-neutral-800">
                <span>Total spent</span>
                <span>{money(budget.spent_total)}</span>
              </li>
            </ul>
          </section>
        </div>

        {/* Expenses */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <form
            hidden={readOnly}
            onSubmit={addExpense}
            className="flex flex-wrap items-end gap-2 rounded-xl border border-neutral-200 bg-white p-4"
          >
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              Category
              <select
                className={selectClass}
                value={category}
                onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-28 flex-col gap-1 text-xs text-neutral-500">
              Amount
              <Input
                type="number"
                min={0}
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="flex min-w-32 flex-1 flex-col gap-1 text-xs text-neutral-500">
              Note
              <Input
                maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional"
              />
            </label>
            {days.length > 0 && (
              <label className="flex flex-col gap-1 text-xs text-neutral-500">
                Day
                <select
                  className={selectClass}
                  value={dayId}
                  onChange={(e) => setDayId(e.target.value)}
                >
                  <option value="">Any</option>
                  {days.map((d) => (
                    <option key={d.id} value={d.id}>
                      Day {d.day_number}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button type="submit">Add expense</Button>
          </form>

          {expenses.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-200 bg-white p-8 text-center text-sm text-neutral-400">
              No expenses yet. Add what you spend as you go.
            </p>
          ) : (
            orderedKeys.map((key) => (
              <section key={key} className="rounded-xl border border-neutral-200 bg-white">
                <h3 className="flex justify-between border-b border-neutral-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  <span>{dayLabel(key || null)}</span>
                  {key && budget.fuel_by_day[key] > 0 && (
                    <span className="font-normal normal-case">
                      Est. fuel {money(budget.fuel_by_day[key])}
                    </span>
                  )}
                </h3>
                <ul className="divide-y divide-neutral-100">
                  {groups.get(key)!.map((x) => (
                    <li key={x.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <span className="w-20 shrink-0 text-xs capitalize text-neutral-500">
                        {x.category}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-neutral-700">
                        {x.note || <span className="text-neutral-300">—</span>}
                      </span>
                      <span className="hidden text-xs text-neutral-400 sm:block">
                        {x.spent_on}
                      </span>
                      <Input
                        key={`${x.id}-${x.amount}`}
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={readOnly}
                        defaultValue={x.amount}
                        onBlur={(e) => updateAmount(x, e.target.value)}
                        className="h-8 w-24 text-right"
                        aria-label={`Amount for ${x.note || x.category}`}
                      />
                      <button
                        hidden={readOnly}
                        onClick={() => removeExpense(x.id)}
                        aria-label="Delete expense"
                        className="text-neutral-300 hover:text-error-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </PageShell>
  );
}
