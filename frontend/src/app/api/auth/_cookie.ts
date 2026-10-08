import type { cookies } from "next/headers";

type CookieJar = Awaited<ReturnType<typeof cookies>>;

/** Mirror a backend Set-Cookie for refresh_token onto the frontend's own domain. */
export function forwardRefreshCookie(jar: CookieJar, setCookieHeader: string | null) {
  if (!setCookieHeader) return;
  const parts = setCookieHeader.split(";").map((s) => s.trim());
  const [name, value] = parts[0].split("=");
  const attrs: Record<string, string | boolean> = {};
  for (const part of parts.slice(1)) {
    const [k, v] = part.split("=");
    attrs[k.trim().toLowerCase()] = v?.trim() ?? true;
  }
  jar.set(name, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge:
      typeof attrs["max-age"] === "string" ? parseInt(attrs["max-age"]) : 60 * 60 * 24 * 30,
    secure: attrs["secure"] === true,
  });
}
