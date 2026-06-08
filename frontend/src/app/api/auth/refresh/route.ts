import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function parseSetCookie(header: string) {
  const parts = header.split(";").map((s) => s.trim());
  const [name, value] = parts[0].split("=");
  const attrs: Record<string, string | boolean> = {};
  for (const part of parts.slice(1)) {
    const [k, v] = part.split("=");
    attrs[k.trim().toLowerCase()] = v?.trim() ?? true;
  }
  return { name, value, attrs };
}

export async function POST() {
  const jar = await cookies();
  const refreshToken = jar.get("refresh_token");

  const upstream = await fetch(`${BACKEND}/auth/refresh`, {
    method: "POST",
    headers: refreshToken ? { cookie: `refresh_token=${refreshToken.value}` } : {},
  });

  const data = await upstream.text();

  const setCookieHeader = upstream.headers.get("set-cookie");
  if (setCookieHeader) {
    const { name, value, attrs } = parseSetCookie(setCookieHeader);
    jar.set(name, value, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: typeof attrs["max-age"] === "string" ? parseInt(attrs["max-age"]) : 60 * 60 * 24 * 30,
      secure: attrs["secure"] === true,
    });
  }

  return new NextResponse(data, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
