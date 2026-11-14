import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getConfig } from "@/lib/config";
import { safeNext } from "@/lib/identity";
export async function GET(request: NextRequest) {
  const c = getConfig();
  const code = request.nextUrl.searchParams.get("code");
  if (c.configured && code) {
    const client = await createClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(
        new URL(safeNext(request.nextUrl.searchParams.get("next")), c.origin),
      );
  }
  return NextResponse.redirect(new URL("/login?notice=callback", c.origin));
}
