"use client";

import { useAuth } from "@/context/AuthContext";
import type { Units } from "@/lib/format";

/** The signed-in user's distance unit (imperial until they choose otherwise). */
export function useUnits(): Units {
  const { user } = useAuth();
  return user?.units ?? "imperial";
}
