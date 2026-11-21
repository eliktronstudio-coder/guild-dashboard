import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getConfig } from "@/lib/config";
export async function GET(request: NextRequest) {
  const c = getConfig(),
    token_hash = request.nextUrl.searchParams.get("token_hash"),
    type = request.nextUrl.searchParams.get("type");
  if (
    c.configured &&
    c.emailDelivery &&
    token_hash &&
    (type === "signup" || type === "recovery")
  ) {
    const client = await createClient();
    const { error } = await client.auth.verifyOtp({ token_hash, type });
    if (!error)
      return NextResponse.redirect(
        new URL(
          type === "recovery" ? "/account/password" : "/onboarding",
          c.origin,
        ),
      );
  }
  return NextResponse.redirect(new URL("/login?notice=callback", c.origin));
}
