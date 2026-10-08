"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthCard } from "@/components/layout/AuthCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiErrorMessage } from "@/lib/api";
import { usePageTitle } from "@/hooks/usePageTitle";

export default function ForgotPasswordPage() {
  usePageTitle("Reset password");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) throw new Error("Too many requests. Please try again later.");
      if (!res.ok && res.status !== 202) throw new Error(`API ${res.status}: ${await res.text()}`);
      // Same message whether or not the address has an account.
      setSent(true);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not send the reset email"));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard title="Forgot your password?" subtitle="We'll email you a link to choose a new one.">
      {sent ? (
        <p role="status" className="text-sm text-neutral-700">
          If an account exists for <strong>{email}</strong>, a reset link is on its way. It expires
          in 1 hour.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-neutral-700" htmlFor="email">
              Email
            </label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          {error && (
            <p className="text-sm text-error-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
      <p className="text-sm text-center text-neutral-500 mt-6">
        <Link href="/login" className="text-primary-600 hover:underline font-medium">
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}
