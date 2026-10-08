"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Activity } from "@/types";

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

/** The trip's latest 20 changes, loaded when opened. */
export function ActivityMenu({ tripId }: { tripId: string }) {
  const [items, setItems] = useState<Activity[] | null>(null);

  return (
    <DropdownMenu onOpenChange={(open) => open && api.get<Activity[]>(`/trips/${tripId}/activity`).then(setItems).catch(() => setItems([]))}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
          <History className="h-3.5 w-3.5" aria-hidden />
          Activity
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-80 overflow-y-auto">
        <DropdownMenuLabel className="text-xs">Recent changes</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items === null ? (
          <p className="px-2 py-3 text-xs text-neutral-400">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-2 py-3 text-xs text-neutral-400">Nothing yet.</p>
        ) : (
          <ul>
            {items.map((a) => (
              <li key={a.id} className="px-2 py-1.5 text-xs">
                <p className="text-neutral-800">{a.summary}</p>
                <p className="text-neutral-400">{ago(a.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
