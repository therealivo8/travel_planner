"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, LogOut, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, apiErrorMessage } from "@/lib/api";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Invite, InviteCreated, Member, TripRole } from "@/types";

const ROLE_LABEL: Record<TripRole, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };

interface Props {
  tripId: string;
  myRole: TripRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the member list changes (or the user leaves), so the page can refresh. */
  onChanged: (opts?: { left?: boolean }) => void;
}

export function MembersModal({ tripId, myRole, open, onOpenChange, onChanged }: Props) {
  const ask = useConfirm();
  const isOwner = myRole === "owner";
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [email, setEmail] = useState("");
  const [created, setCreated] = useState<InviteCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setMembers(await api.get<Member[]>(`/trips/${tripId}/members`));
      if (isOwner) setInvites(await api.get<Invite[]>(`/trips/${tripId}/invites`));
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't load members"));
    }
  }, [tripId, isOwner]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [open, load]);

  async function createInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const invite = await api.post<InviteCreated>(`/trips/${tripId}/invites`, {
        role,
        email: email.trim() || undefined,
      });
      setCreated(invite);
      setEmail("");
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't create the invite"));
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the link and copy it manually.");
    }
  }

  async function revoke(invite: Invite) {
    try {
      await api.delete(`/trips/${tripId}/invites/${invite.id}`);
      if (created?.id === invite.id) setCreated(null);
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't revoke the invite"));
    }
  }

  async function changeRole(member: Member, next: "editor" | "viewer") {
    try {
      await api.patch(`/trips/${tripId}/members/${member.user_id}`, { role: next });
      await load();
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't change the role"));
    }
  }

  async function remove(member: Member) {
    const leaving = member.is_you;
    const ok = await ask({
      title: leaving ? "Leave this trip?" : `Remove ${member.name}?`,
      description: leaving
        ? "You'll lose access unless you're invited again."
        : "They'll lose access to this trip immediately.",
      confirmLabel: leaving ? "Leave trip" : "Remove",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/trips/${tripId}/members/${member.user_id}`);
      if (leaving) {
        onOpenChange(false);
        onChanged({ left: true });
      } else {
        await load();
        onChanged();
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't update the members"));
    }
  }

  const me = members.find((m) => m.is_you);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Trip members</DialogTitle>
          <DialogDescription>
            Editors can change the plan; viewers can look, vote and comment.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col divide-y divide-neutral-100">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 py-2">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-800"
                aria-hidden
              >
                {m.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-neutral-800">
                {m.name}
                {m.is_you && <span className="text-neutral-400"> (you)</span>}
              </span>
              {isOwner && m.role !== "owner" ? (
                <select
                  aria-label={`Role for ${m.name}`}
                  value={m.role}
                  onChange={(e) => changeRole(m, e.target.value as "editor" | "viewer")}
                  className="h-8 rounded-md border border-neutral-200 bg-white px-1 text-xs"
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              ) : (
                <span className="text-xs text-neutral-500">{ROLE_LABEL[m.role]}</span>
              )}
              {isOwner && m.role !== "owner" && (
                <button
                  onClick={() => remove(m)}
                  aria-label={`Remove ${m.name}`}
                  className="text-neutral-300 hover:text-error-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>

        {me && me.role !== "owner" && (
          <Button variant="outline" className="gap-1.5 self-start" onClick={() => remove(me)}>
            <LogOut className="h-4 w-4" aria-hidden />
            Leave this trip
          </Button>
        )}

        {isOwner && (
          <section className="flex flex-col gap-3 border-t border-neutral-100 pt-4">
            <h3 className="text-sm font-semibold text-neutral-800">Invite someone</h3>
            <form onSubmit={createInvite} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs text-neutral-500">
                Role
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as "editor" | "viewer")}
                  className="h-10 rounded-lg border border-neutral-200 bg-white px-2 text-sm text-neutral-900"
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              </label>
              <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-neutral-500">
                Email (optional)
                <Input
                  type="email"
                  placeholder="friend@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <Button type="submit" disabled={busy}>
                {busy ? "Creating…" : "Create invite link"}
              </Button>
            </form>

            {created && (
              <div className="flex flex-col gap-1 rounded-lg bg-neutral-50 p-3">
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    aria-label="Invite link"
                    value={created.url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 font-mono text-xs text-neutral-700"
                  />
                  <Button size="sm" variant="outline" onClick={() => copy(created.url)} aria-label="Copy invite link">
                    {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <p className="text-xs text-neutral-500">
                  Shown only now — anyone with this link can join as {created.role}. It expires in 14 days
                  {created.emailed ? " and was emailed." : "."}
                </p>
              </div>
            )}

            {invites.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs text-neutral-600">
                {invites.map((i) => (
                  <li key={i.id} className="flex items-center gap-2">
                    <span className="flex-1">
                      {ROLE_LABEL[i.role]} link · {i.uses}/{i.max_uses} used · expires{" "}
                      {new Date(i.expires_at).toLocaleDateString()}
                    </span>
                    <button onClick={() => revoke(i)} className="text-error-500 hover:underline">
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
