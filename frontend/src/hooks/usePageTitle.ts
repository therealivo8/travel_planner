"use client";

import { useEffect } from "react";

const SUFFIX = "Road Trip Planner";

/** Sets the tab title on client-rendered pages (which can't export `metadata`). */
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · ${SUFFIX}`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
