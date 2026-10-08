"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageShell } from "@/components/layout/PageShell";
import type { PackingItem, PackingSuggestion, PackingTemplate, Trip } from "@/types";

function readDismissed(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export default function PackingPage({ params }: { params: Promise<{ trip_id: string }> }) {
  usePageTitle("Packing list");
  const { trip_id } = use(params);
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const dismissKey = `packing-dismissed-${trip_id}`;

  const [trip, setTrip] = useState<Trip | null>(null);
  const [items, setItems] = useState<PackingItem[]>([]);
  const [templates, setTemplates] = useState<PackingTemplate[]>([]);
  const [suggestions, setSuggestions] = useState<PackingSuggestion[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("Other");

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?next=/trips/${trip_id}/packing`);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only
    setDismissed(readDismissed(dismissKey));
    (async () => {
      try {
        const [t, i, tpl] = await Promise.all([
          api.get<Trip>(`/trips/${trip_id}`),
          api.get<PackingItem[]>(`/trips/${trip_id}/packing`),
          api.get<PackingTemplate[]>(`/trips/${trip_id}/packing/templates`),
        ]);
        setTrip(t);
        setItems(i);
        setTemplates(tpl);
        // Suggestions may call the weather service; never block the list on them.
        api
          .get<PackingSuggestion[]>(`/trips/${trip_id}/packing/suggestions`)
          .then(setSuggestions)
          .catch(() => setSuggestions([]));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load packing list");
      }
    })();
  }, [authLoading, user, router, trip_id, dismissKey]);

  const grouped = useMemo(() => {
    const map = new Map<string, PackingItem[]>();
    for (const item of items) map.set(item.category, [...(map.get(item.category) ?? []), item]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const packedCount = items.filter((i) => i.packed).length;

  async function toggle(item: PackingItem) {
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, packed: !x.packed } : x)));
    try {
      await api.patch(`/trips/${trip_id}/packing/${item.id}`, { packed: !item.packed });
    } catch (err) {
      setItems((prev) => prev.map((x) => (x.id === item.id ? item : x)));
      setError(err instanceof Error ? err.message : "Could not update item");
    }
  }

  async function remove(id: string) {
    const before = items;
    setItems((prev) => prev.filter((x) => x.id !== id));
    try {
      await api.delete(`/trips/${trip_id}/packing/${id}`);
    } catch (err) {
      setItems(before);
      setError(err instanceof Error ? err.message : "Could not delete item");
    }
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    try {
      const created = await api.post<PackingItem>(`/trips/${trip_id}/packing`, {
        label: label.trim(),
        category: category.trim() || "Other",
      });
      setItems((prev) => [...prev, created]);
      setLabel("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add item");
    }
  }

  async function addTemplate(name: string) {
    try {
      setItems(await api.post<PackingItem[]>(`/trips/${trip_id}/packing/templates/${encodeURIComponent(name)}`));
      setSuggestions((prev) => prev.filter((s) => s.template !== name));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add template");
    }
  }

  function dismiss(template: string) {
    const next = [...dismissed, template];
    setDismissed(next);
    try {
      localStorage.setItem(dismissKey, JSON.stringify(next));
    } catch {
      // Private mode etc.: the prompt just comes back next visit.
    }
  }

  if (!trip) {
    return (
      <PageShell>
        {error ? <p className="text-sm text-neutral-600">{error}</p> : <Skeleton className="h-96 w-full rounded-xl" />}
      </PageShell>
    );
  }

  const visibleSuggestions = suggestions.filter((s) => !dismissed.includes(s.template));
  const pct = items.length ? Math.round((packedCount / items.length) * 100) : 0;

  return (
    <PageShell>
      <div className="mb-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/trips/${trip_id}`} aria-label="Back to trip">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">{trip.title} · Packing</h1>
          <p className="text-xs text-neutral-500">
            {packedCount} / {items.length} packed
          </p>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-error-500">
          {error}
        </p>
      )}

      {visibleSuggestions.map((s) => (
        <div
          key={s.template}
          className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-900"
        >
          <p className="flex-1">
            {s.reason}. Add the <strong>{s.template}</strong> list?
          </p>
          <Button size="sm" onClick={() => addTemplate(s.template)}>
            Add
          </Button>
          <button onClick={() => dismiss(s.template)} aria-label="Dismiss suggestion">
            <X className="h-4 w-4 text-primary-700" />
          </button>
        </div>
      ))}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {items.length > 0 && <Progress value={pct} aria-label={`${pct}% packed`} />}
          {grouped.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-200 bg-white p-8 text-center text-sm text-neutral-400">
              Nothing to pack yet. Add a template or your own items.
            </p>
          ) : (
            grouped.map(([cat, list]) => (
              <section key={cat} className="rounded-xl border border-neutral-200 bg-white">
                <h2 className="border-b border-neutral-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  {cat} · {list.filter((i) => i.packed).length}/{list.length}
                </h2>
                <ul className="divide-y divide-neutral-100">
                  {list.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 px-4 py-2">
                      <label className="flex flex-1 cursor-pointer items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={item.packed}
                          onChange={() => toggle(item)}
                          className="h-4 w-4 accent-primary-500"
                        />
                        <span className={item.packed ? "text-neutral-400 line-through" : "text-neutral-800"}>
                          {item.label}
                        </span>
                      </label>
                      <button
                        onClick={() => remove(item.id)}
                        aria-label={`Delete ${item.label}`}
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

        <div className="flex flex-col gap-4">
          <form
            onSubmit={addItem}
            className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4"
          >
            <h2 className="text-sm font-medium text-neutral-700">Add an item</h2>
            <Input
              value={label}
              maxLength={120}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Sunglasses"
              aria-label="Item"
            />
            <Input
              value={category}
              maxLength={40}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Category"
              aria-label="Category"
            />
            <Button type="submit" className="gap-1.5">
              <Plus className="h-4 w-4" /> Add
            </Button>
          </form>

          <section className="rounded-xl border border-neutral-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-medium text-neutral-700">Templates</h2>
            <ul className="flex flex-col gap-1">
              {templates.map((t) => (
                <li key={t.name} className="flex items-center justify-between text-sm">
                  <span className="text-neutral-700">
                    {t.name} <span className="text-xs text-neutral-400">({t.item_count})</span>
                  </span>
                  <Button size="sm" variant="outline" onClick={() => addTemplate(t.name)}>
                    Add
                  </Button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-neutral-400">Items already on your list are skipped.</p>
          </section>
        </div>
      </div>
    </PageShell>
  );
}
