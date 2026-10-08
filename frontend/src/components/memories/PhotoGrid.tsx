/* eslint-disable @next/next/no-img-element -- presigned R2 URLs are used as-is */
import { Trash2 } from "lucide-react";
import type { TripPhoto } from "@/types";

export function PhotoGrid({
  photos,
  onDelete,
}: {
  photos: TripPhoto[];
  onDelete?: (photo: TripPhoto) => void;
}) {
  if (photos.length === 0) return null;
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {photos.map((p) => (
        <li key={p.id} className="group relative overflow-hidden rounded-lg bg-neutral-100">
          <img
            src={p.url}
            alt={p.caption ?? "Trip photo"}
            loading="lazy"
            width={p.width}
            height={p.height}
            className="aspect-square h-full w-full object-cover"
          />
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(p)}
              aria-label="Delete photo"
              className="absolute right-1 top-1 rounded-full bg-black/60 p-1.5 text-white"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {p.caption && (
            <p className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-2 py-1 text-[11px] text-white">
              {p.caption}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
