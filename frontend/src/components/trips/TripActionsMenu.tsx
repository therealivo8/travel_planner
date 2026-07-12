"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical, Copy, Share2, Calendar, Archive, Trash2 } from "lucide-react";

interface TripActionsMenuProps {
  tripId: string;
  onDuplicate: () => void;
  onDelete: () => void;
  onArchive: () => void;
}

export function TripActionsMenu({ tripId, onDuplicate, onDelete, onArchive }: TripActionsMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function handle(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div
      ref={menuRef}
      className="absolute top-2 right-2 z-10"
      onClick={(e) => e.preventDefault()}
    >
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        className="h-8 w-8 rounded-lg flex items-center justify-center bg-white/90 backdrop-blur-sm shadow-sm border border-neutral-200 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white"
        aria-label="Trip options"
      >
        <MoreVertical className="h-4 w-4 text-neutral-600" />
      </button>

      {open && (
        <div className="absolute right-0 top-9 w-44 bg-white rounded-xl shadow-lg border border-neutral-200 py-1 text-sm">
          <button
            onClick={(e) => { e.stopPropagation(); handle(() => router.push(`/trips/${tripId}`)); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-neutral-50 text-neutral-700"
          >
            <Calendar className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handle(() => router.push(`/trips/${tripId}/itinerary`)); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-neutral-50 text-neutral-700"
          >
            <Calendar className="h-3.5 w-3.5" />
            Itinerary
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handle(onDuplicate); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-neutral-50 text-neutral-700"
          >
            <Copy className="h-3.5 w-3.5" />
            Duplicate
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handle(() => router.push(`/trips/${tripId}#share`)); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-neutral-50 text-neutral-700"
          >
            <Share2 className="h-3.5 w-3.5" />
            Share
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handle(onArchive); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-neutral-50 text-neutral-700"
          >
            <Archive className="h-3.5 w-3.5" />
            Archive
          </button>
          <div className="h-px bg-neutral-100 my-1" />
          <button
            onClick={(e) => { e.stopPropagation(); handle(onDelete); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-red-50 text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
