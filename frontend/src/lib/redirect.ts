/** Only same-site paths are valid post-login destinations (no open redirects). */
export function safeNext(next: string | undefined | null, fallback = "/trips"): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : fallback;
}
