import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function POST() {
  const jar = await cookies();
  const refreshToken = jar.get("refresh_token");

  await fetch(`${BACKEND}/auth/logout`, {
    method: "POST",
    headers: refreshToken ? { cookie: `refresh_token=${refreshToken.value}` } : {},
  }).catch(() => {
    /* clear the local cookie regardless of backend reachability */
  });

  jar.delete("refresh_token");

  return new NextResponse(null, { status: 204 });
}
