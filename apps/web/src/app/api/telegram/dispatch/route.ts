import { botConfig, dispatchTelegram } from "@/lib/telegram/server";
import { sameSecret } from "@/lib/telegram/protocol";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  const c = botConfig();
  if (!c.ready || c.cronSecret.length < 32)
    return new Response("Unavailable", { status: 503 });
  if (
    !sameSecret(request.headers.get("authorization"), `Bearer ${c.cronSecret}`)
  )
    return new Response("Unauthorized", { status: 401 });
  try {
    return Response.json(await dispatchTelegram(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("Try again", { status: 503 });
  }
}
