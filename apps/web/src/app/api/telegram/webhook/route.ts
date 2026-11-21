import { botConfig, botClient, scheduleTelegram } from "@/lib/telegram/server";
import { sameSecret, boundedJson, parseUpdate } from "@/lib/telegram/protocol";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const c = botConfig();
  if (!c.ready) return new Response("Unavailable", { status: 503 });
  if (
    !sameSecret(
      request.headers.get("x-telegram-bot-api-secret-token"),
      c.webhookSecret,
    )
  )
    return new Response("Unauthorized", { status: 401 });
  let payload: unknown;
  try {
    payload = await boundedJson(request);
  } catch {
    return new Response("Invalid request", { status: 400 });
  }
  const update = parseUpdate(payload, c.username);
  if (!update) return Response.json({ ok: true });
  try {
    const { error } = await botClient().rpc("receive_telegram_update", update);
    if (error) return new Response("Try again", { status: 503 });
    scheduleTelegram();
    return Response.json({ ok: true });
  } catch {
    return new Response("Try again", { status: 503 });
  }
}
