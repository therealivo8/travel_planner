"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, apiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { CommentKind, TripComment } from "@/types";

interface Props {
  tripId: string;
  kind: CommentKind;
  targetId?: string;
  /** Shown in the sheet header, e.g. the stop's name. */
  title: string;
  count: number;
  /** Called after any change so the badge counts refresh. */
  onChanged: () => void;
  className?: string;
}

/** A comment-count badge that opens the thread in a side sheet. Bodies are plain text only. */
export function CommentBadge({ tripId, kind, targetId, title, count, onChanged, className }: Props) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<TripComment[]>([]);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const path = `/trips/${tripId}/comments`;
  const query = `target_kind=${kind}${targetId ? `&target_id=${targetId}` : ""}`;

  const load = useCallback(async () => {
    try {
      setComments(await api.get<TripComment[]>(`${path}?${query}`));
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't load comments"));
    }
  }, [path, query]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .get<TripComment[]>(`${path}?${query}`)
      .then((c) => {
        if (!cancelled) setComments(c);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, path, query]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      if (editing) await api.patch(`${path}/${editing}`, { body });
      else await api.post(path, { target_kind: kind, target_id: targetId, body });
      setDraft("");
      setEditing(null);
      await load();
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't post the comment"));
    } finally {
      setSending(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.delete(`${path}/${id}`);
      await load();
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't delete the comment"));
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={`Comments on ${title} (${count})`}
          className={
            className ??
            "inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600 hover:border-neutral-400"
          }
        >
          <MessageSquare className="h-3.5 w-3.5" aria-hidden />
          {count}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-[360px] max-w-full flex-col gap-4">
        <SheetHeader>
          <SheetTitle className="truncate">{title}</SheetTitle>
          <SheetDescription>Everyone on the trip can read and add comments.</SheetDescription>
        </SheetHeader>

        <ul className="flex flex-1 flex-col gap-3 overflow-y-auto">
          {comments.length === 0 && <li className="text-sm text-neutral-400">No comments yet.</li>}
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg bg-neutral-50 p-3 text-sm">
              <div className="mb-1 flex items-center gap-2 text-xs text-neutral-500">
                <span className="font-semibold text-neutral-700">{c.author}</span>
                <span>{new Date(c.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                {c.edited_at && !c.deleted && <span>(edited)</span>}
                {c.mine && !c.deleted && (
                  <span className="ml-auto flex gap-2">
                    <button
                      aria-label="Edit comment"
                      onClick={() => {
                        setEditing(c.id);
                        setDraft(c.body);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button aria-label="Delete comment" onClick={() => remove(c.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </div>
              {/* Rendered as a text node: React escapes it, so a comment can never inject HTML. */}
              {c.deleted ? (
                <p className="italic text-neutral-400">This comment was deleted.</p>
              ) : (
                <p className="whitespace-pre-line break-words text-neutral-800">{c.body}</p>
              )}
            </li>
          ))}
        </ul>

        <form onSubmit={send} className="flex flex-col gap-2">
          <Textarea
            aria-label={editing ? "Edit comment" : "Add a comment"}
            rows={3}
            maxLength={1000}
            placeholder={editing ? "Edit your comment…" : "Add a comment…"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={sending || !draft.trim()}>
              {editing ? "Save" : "Post"}
            </Button>
            {editing && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setDraft("");
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
