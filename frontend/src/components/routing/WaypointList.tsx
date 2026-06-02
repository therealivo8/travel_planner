"use client";

import { useCallback, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2, Plus, Clock, Milestone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddressAutocomplete, type AddressSelection } from "./AddressAutocomplete";
import type { Waypoint } from "@/types";

interface Props {
  waypoints: Waypoint[];
  onAdd: (wp: AddressSelection) => Promise<void>;
  onDelete: (waypointId: string) => Promise<void>;
  onReorder: (orderedIds: string[]) => Promise<void>;
  onUpdateLabel: (waypointId: string, label: string) => Promise<void>;
  onUpdateStopDuration: (waypointId: string, minutes: number | null) => Promise<void>;
  loading?: boolean;
}

function formatLeg(seconds: number | null, meters: number | null): string | null {
  if (seconds == null && meters == null) return null;
  const parts: string[] = [];
  if (meters != null) {
    const miles = meters / 1609.34;
    parts.push(miles >= 10 ? `${Math.round(miles)} mi` : `${miles.toFixed(1)} mi`);
  }
  if (seconds != null) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    parts.push(h > 0 ? `${h} h ${m} min` : `${m} min`);
  }
  return parts.join(" · ");
}

interface SortableItemProps {
  waypoint: Waypoint;
  index: number;
  onDelete: (id: string) => void;
  onUpdateLabel: (id: string, label: string) => void;
  onUpdateStopDuration: (id: string, minutes: number | null) => void;
}

function SortableWaypointItem({
  waypoint,
  index,
  onDelete,
  onUpdateLabel,
  onUpdateStopDuration,
}: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: waypoint.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const legInfo = formatLeg(waypoint.drive_seconds_from_prev, waypoint.distance_meters_from_prev);

  return (
    <div ref={setNodeRef} style={style} className="group">
      {legInfo && (
        <div className="flex items-center gap-1.5 pl-8 py-1 text-xs text-neutral-400">
          <Milestone className="h-3 w-3" />
          <span>{legInfo}</span>
        </div>
      )}
      <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2.5">
        <button
          {...attributes}
          {...listeners}
          type="button"
          className="cursor-grab text-neutral-300 hover:text-neutral-500 touch-none"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700">
          {index + 1}
        </div>

        <div className="flex flex-1 flex-col gap-1 min-w-0">
          <p className="text-sm text-neutral-700 truncate">{waypoint.address}</p>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Label (optional)"
              defaultValue={waypoint.label ?? ""}
              onBlur={(e) => onUpdateLabel(waypoint.id, e.target.value)}
              className="h-6 text-xs border-none px-0 focus-visible:ring-0 shadow-none bg-transparent"
            />
            <div className="flex items-center gap-1 shrink-0">
              <Clock className="h-3 w-3 text-neutral-400" />
              <input
                type="number"
                min={0}
                placeholder="0"
                defaultValue={waypoint.stop_duration_minutes ?? ""}
                onBlur={(e) => {
                  const v = e.target.value === "" ? null : parseInt(e.target.value, 10);
                  onUpdateStopDuration(waypoint.id, v);
                }}
                className="w-10 text-xs border-none bg-transparent focus:outline-none text-neutral-500"
                aria-label="Stop duration in minutes"
              />
              <span className="text-xs text-neutral-400">min</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onDelete(waypoint.id)}
          className="shrink-0 text-neutral-300 hover:text-error-500 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Remove waypoint"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function WaypointList({
  waypoints,
  onAdd,
  onDelete,
  onReorder,
  onUpdateLabel,
  onUpdateStopDuration,
  loading,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [pendingAdd, setPendingAdd] = useState<AddressSelection | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = waypoints.findIndex((w) => w.id === active.id);
      const newIndex = waypoints.findIndex((w) => w.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = [...waypoints];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);
      await onReorder(reordered.map((w) => w.id));
    },
    [waypoints, onReorder]
  );

  async function handleConfirmAdd() {
    if (!pendingAdd) return;
    await onAdd(pendingAdd);
    setPendingAdd(null);
    setAdding(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={waypoints.map((w) => w.id)} strategy={verticalListSortingStrategy}>
          {waypoints.map((wp, i) => (
            <SortableWaypointItem
              key={wp.id}
              waypoint={wp}
              index={i}
              onDelete={onDelete}
              onUpdateLabel={onUpdateLabel}
              onUpdateStopDuration={onUpdateStopDuration}
            />
          ))}
        </SortableContext>
      </DndContext>

      {adding ? (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 flex flex-col gap-2">
          <AddressAutocomplete
            value={pendingAdd?.address ?? ""}
            placeholder="Search for a stop…"
            onSelect={(r) => setPendingAdd(r)}
          />
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setAdding(false);
                setPendingAdd(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!pendingAdd || loading}
              onClick={handleConfirmAdd}
            >
              Add stop
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start gap-1.5 text-primary-600 hover:text-primary-700"
          onClick={() => setAdding(true)}
          disabled={loading}
        >
          <Plus className="h-4 w-4" />
          Add stop
        </Button>
      )}
    </div>
  );
}
