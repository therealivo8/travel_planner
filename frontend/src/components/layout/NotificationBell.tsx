"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { api } from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Notifications } from "@/types";

/**
 * In-app notifications: other people's changes and comments on the user's trips since they
 * last looked. Fetched on load and whenever the tab becomes visible again — no polling timer,
 * no push or email.
 */
export function NotificationBell() {
  const [data, setData] = useState<Notifications | null>(null);

  const load = useCallback(() => {
    api.get<Notifications>("/notifications").then(setData).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  function onOpenChange(open: boolean) {
    // Opening the menu is "looking": mark everything read once it has been shown.
    if (open && data && data.unread > 0) {
      api.post("/notifications/seen").then(() => setData((d) => (d ? { ...d, unread: 0 } : d))).catch(() => undefined);
    }
  }

  const unread = data?.unread ?? 0;
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100"
        >
          <Bell className="h-4 w-4" aria-hidden />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error-500 px-1 text-[10px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-80 overflow-y-auto">
        <DropdownMenuLabel className="text-xs">Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!data || data.items.length === 0 ? (
          <p className="px-2 py-3 text-xs text-neutral-400">Nothing new.</p>
        ) : (
          <ul>
            {data.items.map((n) => (
              <li key={n.id}>
                <Link href={`/trips/${n.trip_id}`} className="block px-2 py-1.5 text-xs hover:bg-neutral-50">
                  <p className="text-neutral-800">{n.summary}</p>
                  <p className="text-neutral-400">{n.trip_title}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
