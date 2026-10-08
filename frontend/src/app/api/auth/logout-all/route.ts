import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function POST(request: NextRequest) {
  const upstream = await fetch(`${BACKEND}/auth/logout-all`, {
    method: "POST",
    headers: { Authorization: request.headers.get("authorization") ?? "" },
  });
  if (upstream.ok) (await cookies()).delete("refresh_token");
  return new NextResponse(null, { status: upstream.status });
}
