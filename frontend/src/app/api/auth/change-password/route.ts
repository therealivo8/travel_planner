import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { forwardRefreshCookie } from "../_cookie";

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * Changing the password revokes every older refresh token, and the backend answers with a
 * fresh one for this browser. It has to land on the frontend's own domain, so (like login)
 * this goes through a route handler instead of the plain rewrite.
 */
export async function POST(request: NextRequest) {
  const upstream = await fetch(`${BACKEND}/auth/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: request.headers.get("authorization") ?? "",
    },
    body: await request.text(),
  });
  if (upstream.ok) forwardRefreshCookie(await cookies(), upstream.headers.get("set-cookie"));
  return new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
