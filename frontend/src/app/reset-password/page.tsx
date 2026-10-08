"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AuthCard } from "@/components/layout/AuthCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiErrorMessage } from "@/lib/api";
import { usePageTitle } from "@/hooks/usePageTitle";

function ResetForm() {
  usePageTitle("Choose a new password");
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!token) {
    return (
      <AuthCard title="Link not valid">
        <p className="text-sm text-neutral-600">
          This reset link is missing its token.{" "}
          <Link href="/forgot-password" className="text-primary-600 hover:underline">
            Request a new one
          </Link>
          .
        </p>
      </AuthCard>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("Password must be at least 8 characters");
    if (password !== confirm) return setError("Passwords don't match");
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });
      if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
      toast.success("Password updated. Sign in with your new password.");
      router.push("/login");
    } catch (err) {
      setError(apiErrorMessage(err, "Could not reset the password"));
      setPending(false);
    }
  }

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700" htmlFor="password">
            New password
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-neutral-700" htmlFor="confirm">
            Confirm password
          </label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        {error && (
          <p className="text-sm text-error-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}{" "}
            {error.includes("expired") && (
              <Link href="/forgot-password" className="underline">
                Request a new link
              </Link>
            )}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Update password"}
        </Button>
      </form>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  // useSearchParams needs a Suspense boundary for static prerendering.
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
