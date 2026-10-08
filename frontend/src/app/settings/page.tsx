"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth, type AuthUser } from "@/context/AuthContext";
import { api, apiErrorMessage, getApiToken } from "@/lib/api";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  GoogleMapsProvider,
  AddressAutocomplete,
  type AddressSelection,
} from "@/components/routing";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-neutral-500">{description}</p>}
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-neutral-700">
        {label}
      </label>
      {children}
    </div>
  );
}

// ── Profile ─────────────────────────────────────────────────────────────────

function ProfileTab({ user, onSaved }: { user: AuthUser; onSaved: (u: AuthUser) => void }) {
  const [name, setName] = useState(user.display_name ?? "");
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      onSaved(await api.patch<AuthUser>("/auth/me", { display_name: name.trim() || null }));
      toast.success("Profile updated");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not save profile"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Profile">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Email">
          <Input value={user.email} disabled readOnly />
        </Field>
        <Field label="Display name" htmlFor="display_name">
          <Input
            id="display_name"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="How should we greet you?"
          />
        </Field>
        <Button type="submit" className="self-start" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
    </Section>
  );
}

// ── Preferences ─────────────────────────────────────────────────────────────

function PreferencesTab({ user, onSaved }: { user: AuthUser; onSaved: (u: AuthUser) => void }) {
  const [units, setUnits] = useState(user.units);
  const [stopMinutes, setStopMinutes] = useState(String(user.default_stop_minutes));
  const [home, setHome] = useState<AddressSelection | null>(
    user.home_address && user.home_lat != null && user.home_lng != null
      ? { address: user.home_address, lat: user.home_lat, lng: user.home_lng, place_id: null }
      : null
  );
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const minutes = Number(stopMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      toast.error("Default stop length must be between 1 and 1440 minutes");
      return;
    }
    setSaving(true);
    try {
      onSaved(
        await api.patch<AuthUser>("/auth/me", {
          units,
          default_stop_minutes: minutes,
          // Coordinates are saved with the address so new trips skip a geocode call.
          home_address: home?.address ?? null,
          home_lat: home?.lat ?? null,
          home_lng: home?.lng ?? null,
        })
      );
      toast.success("Preferences saved");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not save preferences"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Preferences">
      <form onSubmit={save} className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-neutral-700">Distance units</legend>
          <div className="flex gap-4 text-sm">
            {(["imperial", "metric"] as const).map((u) => (
              <label key={u} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="units"
                  checked={units === u}
                  onChange={() => setUnits(u)}
                  className="accent-primary-500"
                />
                {u === "imperial" ? "Miles" : "Kilometres"}
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="Home address">
          <GoogleMapsProvider>
            <AddressAutocomplete
              value={home?.address ?? ""}
              placeholder="Pre-fills the start of new trips"
              onSelect={setHome}
            />
          </GoogleMapsProvider>
          {home && (
            <button
              type="button"
              onClick={() => setHome(null)}
              className="self-start text-xs text-neutral-500 hover:underline"
            >
              Clear home address
            </button>
          )}
        </Field>

        <Field label="Default stop length (minutes)" htmlFor="stop_minutes">
          <Input
            id="stop_minutes"
            type="number"
            min={1}
            max={1440}
            className="w-32"
            value={stopMinutes}
            onChange={(e) => setStopMinutes(e.target.value)}
          />
        </Field>

        <Button type="submit" className="self-start" disabled={saving}>
          {saving ? "Saving…" : "Save preferences"}
        </Button>
      </form>
    </Section>
  );
}

// ── Security ────────────────────────────────────────────────────────────────

function SecurityTab() {
  const router = useRouter();
  const ask = useConfirm();
  const { setToken, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [saving, setSaving] = useState(false);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 8) return toast.error("New password must be at least 8 characters");
    if (next !== again) return toast.error("New passwords don't match");
    setSaving(true);
    try {
      const res = await api.post<{ access_token: string }>("/auth/change-password", {
        current_password: current,
        new_password: next,
      });
      setToken(res.access_token); // this browser stays signed in; every other session is revoked
      setCurrent("");
      setNext("");
      setAgain("");
      toast.success("Password changed. Other devices have been signed out.");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not change password"));
    } finally {
      setSaving(false);
    }
  }

  async function signOutEverywhere() {
    const ok = await ask({
      title: "Sign out everywhere?",
      description: "Every device, including this one, will need to sign in again.",
      confirmLabel: "Sign out everywhere",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.post("/auth/logout-all");
      await logout();
      router.push("/login");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not sign out"));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Section title="Change password">
        <form onSubmit={changePassword} className="flex flex-col gap-4">
          <Field label="Current password" htmlFor="current_password">
            <Input
              id="current_password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field label="New password" htmlFor="new_password">
            <Input
              id="new_password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm_password">
            <Input
              id="confirm_password"
              type="password"
              autoComplete="new-password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          </Field>
          <Button type="submit" className="self-start" disabled={saving || !current}>
            {saving ? "Saving…" : "Change password"}
          </Button>
        </form>
      </Section>
      <Section
        title="Sessions"
        description="Sign out of every browser and device where you're logged in."
      >
        <Button variant="outline" className="self-start" onClick={signOutEverywhere}>
          Sign out everywhere
        </Button>
      </Section>
    </div>
  );
}

// ── Data ────────────────────────────────────────────────────────────────────

function DataTab({ user }: { user: AuthUser }) {
  const router = useRouter();
  const { logout } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [typedEmail, setTypedEmail] = useState("");
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function exportData() {
    setExporting(true);
    try {
      const res = await fetch("/api/auth/me/export", {
        headers: { Authorization: `Bearer ${getApiToken() ?? ""}` },
      });
      if (res.status === 429) throw new Error("You can export your data 3 times a day.");
      if (!res.ok) throw new Error("Export failed");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "road-trip-planner-export.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    try {
      await api.delete("/auth/me", { body: { password } });
      await logout();
      toast.success("Your account has been deleted.");
      router.push("/");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not delete account"));
      setDeleting(false);
    }
  }

  const emailMatches = typedEmail.trim().toLowerCase() === user.email.toLowerCase();

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Export your data"
        description="A JSON file with your profile, trips, stops, itineraries, expenses and packing lists."
      >
        <Button variant="outline" className="self-start" onClick={exportData} disabled={exporting}>
          {exporting ? "Preparing…" : "Download my data"}
        </Button>
      </Section>

      <Section
        title="Delete account"
        description="Permanently removes your account and every trip. This can't be undone."
      >
        <Button variant="destructive" className="self-start" onClick={() => setDialogOpen(true)}>
          Delete my account
        </Button>
      </Section>

      <Dialog open={dialogOpen} onOpenChange={(open) => !deleting && setDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              All your trips and data will be permanently deleted. Type your email address{" "}
              <strong>{user.email}</strong> and your password to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              aria-label="Type your email to confirm"
              placeholder={user.email}
              value={typedEmail}
              onChange={(e) => setTypedEmail(e.target.value)}
            />
            <Input
              aria-label="Password"
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={deleteAccount}
              disabled={!emailMatches || !password || deleting}
            >
              {deleting ? "Deleting…" : "Delete account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  usePageTitle("Settings");
  const router = useRouter();
  const { user, isLoading, setUser } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login?next=/settings");
  }, [isLoading, user, router]);

  return (
    <PageShell title="Settings">
      {!user ? (
        <Skeleton className="h-64 w-full max-w-2xl rounded-xl" />
      ) : (
        <Tabs defaultValue="profile" className="max-w-2xl">
          <TabsList className="mb-4 w-full justify-start overflow-x-auto">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="preferences">Preferences</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
          </TabsList>
          <TabsContent value="profile">
            <ProfileTab user={user} onSaved={setUser} />
          </TabsContent>
          <TabsContent value="preferences">
            <PreferencesTab user={user} onSaved={setUser} />
          </TabsContent>
          <TabsContent value="security">
            <SecurityTab />
          </TabsContent>
          <TabsContent value="data">
            <DataTab user={user} />
          </TabsContent>
        </Tabs>
      )}
    </PageShell>
  );
}
