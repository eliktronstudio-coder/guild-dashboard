import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { telegramLoginUrl } from "@/lib/telegram-login";
export async function POST(request: Request) {
  const c = getConfig();
  if (request.headers.get("origin") !== new URL(c.origin).origin)
    return Response.json(
      { error: "Недопустимый источник запроса." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  const url = await telegramLoginUrl();
  // 303 turns this form POST into a GET to the OAuth authorization endpoint.
  const response = NextResponse.redirect(
    url ?? new URL("/login?notice=provider", c.origin),
    303,
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
