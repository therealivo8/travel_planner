"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/common/StatusPage";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <StatusPage
      heading="Something went wrong"
      message="An unexpected error occurred. Your trips are safe — try again, or head back to your list."
      action={<Button onClick={() => retry()}>Try again</Button>}
    />
  );
}
