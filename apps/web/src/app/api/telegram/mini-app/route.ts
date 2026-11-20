import { botConfig, botClient } from "@/lib/telegram/server";
import { boundedJson } from "@/lib/telegram/protocol";
import {
  verifyMiniAppData,
  MINI_APP_TTL_SECONDS,
} from "@/lib/telegram/mini-app";
export const runtime = "nodejs";
export const maxDuration = 15;
const reply = (
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", ...extra },
  });

export async function POST(request: Request) {
  const c = botConfig();
  if (!c.ready || process.env.TELEGRAM_MINI_APP_ENABLED !== "true")
    return reply({ error: "unavailable" }, 503);
  if (request.headers.get("origin") !== c.origin)
    return reply({ error: "forbidden" }, 403);
  let input: {
    initData?: unknown;
    period?: unknown;
    event?: unknown;
    join?: unknown;
    request?: unknown;
  };
  try {
    input = (await boundedJson(request, 16384)) as typeof input;
    if (
      !input ||
      Array.isArray(input) ||
      typeof input !== "object" ||
      Object.keys(input).some(
        (key) =>
          !["initData", "period", "event", "join", "request"].includes(key),
      ) ||
      typeof input.period !== "string" ||
      !["week", "month"].includes(input.period)
    )
      return reply({ error: "invalid_request" }, 400);
  } catch {
    return reply({ error: "invalid_request" }, 400);
  }
  const mutation =
    input.event !== undefined ||
    input.join !== undefined ||
    input.request !== undefined;
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    mutation &&
    (typeof input.event !== "string" ||
      !uuid.test(input.event) ||
      typeof input.request !== "string" ||
      !uuid.test(input.request) ||
      typeof input.join !== "boolean")
  )
    return reply({ error: "invalid_request" }, 400);
  const verified = verifyMiniAppData(input.initData, c.token);
  if (!verified.ok) return reply({ error: verified.code }, 401);
  try {
    const { data, error } = await botClient()
      .rpc(
        mutation ? "telegram_mini_app_signup" : "telegram_mini_app_report",
        mutation
          ? {
              p_telegram: verified.telegramId,
              p_event: input.event,
              p_join: input.join,
              p_request: input.request,
              p_auth_date: verified.authDate,
            }
          : { p_telegram: verified.telegramId, p_period: input.period },
      )
      .abortSignal(AbortSignal.timeout(8000));
    if (error || !data) return reply({ error: "unavailable" }, 503);
    if (data.error === "forbidden") return reply({ error: "forbidden" }, 403);
    if (data.error === "rate_limited")
      return reply({ error: "rate_limited" }, 429, { "Retry-After": "60" });
    if (data.error === "expired") return reply({ error: "expired" }, 401);
    if (data.error === "event_unavailable" || data.error === "invalid_request")
      return reply({ error: data.error }, 409);
    if (data.error) return reply({ error: "unavailable" }, 503);
    return reply({
      ...data,
      expires_at: verified.authDate + MINI_APP_TTL_SECONDS,
    });
  } catch {
    return reply({ error: "unavailable" }, 503);
  }
}
