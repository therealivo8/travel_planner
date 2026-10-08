import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? "";
  const upstream = await fetch(`${BACKEND}/auth/me`, {
    headers: { authorization: auth },
  });

  const data = await upstream.text();
  return new NextResponse(data, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Profile and preference updates (Route Handlers shadow the /api rewrite for this path). */
export async function PATCH(request: NextRequest) {
  const upstream = await fetch(`${BACKEND}/auth/me`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: request.headers.get("authorization") ?? "",
    },
    body: await request.text(),
  });
  return new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Account deletion: forward the password confirmation, then drop the local session cookie. */
export async function DELETE(request: Request) {
  const upstream = await fetch(`${BACKEND}/auth/me`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: request.headers.get("authorization") ?? "",
    },
    body: await request.text(),
  });
  if (upstream.ok) (await cookies()).delete("refresh_token");
  return new Response(upstream.status === 204 ? null : await upstream.text(), {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
