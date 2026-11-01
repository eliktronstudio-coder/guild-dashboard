import { createHash, timingSafeEqual } from "node:crypto";
import { formatGold } from "../treasury";
export function sameSecret(received: string | null, expected: string) {
  if (!received || !expected) return false;
  const a = Buffer.from(received),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const hashLink = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
const positive = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
export function parseUpdate(input: unknown, botName: string, now = Date.now()) {
  const u = record(input),
    m = record(u?.message),
    from = record(m?.from),
    chat = record(m?.chat);
  if (
    !u ||
    typeof u.update_id !== "number" ||
    !Number.isSafeInteger(u.update_id) ||
    u.update_id < 0 ||
    !m ||
    !from ||
    !chat ||
    from.is_bot !== false ||
    chat.type !== "private" ||
    !positive(from.id) ||
    chat.id !== from.id ||
    typeof m.text !== "string" ||
    m.text.length > 512 ||
    typeof m.date !== "number" ||
    !Number.isSafeInteger(m.date) ||
    m.date * 1000 < now - 600000 ||
    m.date * 1000 > now + 120000
  )
    return null;
  const match =
    /^\/(start|help|events|cabinet|stop|unlink)(?:@([A-Za-z0-9_]+))?(?:\s+(\S+))?\s*$/.exec(
      m.text,
    );
  if (!match || (match[2] && match[2].toLowerCase() !== botName.toLowerCase()))
    return null;
  let command = match[1],
    hash: string | null = null;
  if (command === "start" && match[3]) {
    if (!/^link_[A-Za-z0-9_-]{43}$/.test(match[3])) return null;
    command = "link";
    hash = hashLink(match[3].slice(5));
  } else if (match[3]) return null;
  return {
    p_update: String(u.update_id),
    p_telegram: String(from.id),
    p_username:
      typeof from.username === "string" &&
      /^[A-Za-z0-9_]{1,32}$/.test(from.username)
        ? from.username
        : null,
    p_command: command,
    p_hash: hash,
  };
}
export async function boundedJson(
  request: Request,
  limit = 65536,
): Promise<unknown> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw Error("INVALID_BODY");
  if (Number(request.headers.get("content-length")) > limit || !request.body)
    throw Error("INVALID_BODY");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw Error("INVALID_BODY");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export type DeliveryBody = {
  code: string;
  telegram_id?: string;
  amount_units?: string;
  id?: string;
  title?: string;
  starts_at?: string;
  status?: string;
  events?: { id: string; title: string; starts_at: string }[];
};
const when = (v: string) =>
  new Date(v).toLocaleString("ru-RU", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }) + " UTC";
export function messageText(body: DeliveryBody, origin: string): string {
  const account = `${origin}/account/telegram`;
  let text: string;
  switch (body.code) {
    case "link_received":
      text = `Ваш Telegram ID: ${body.telegram_id}. Telegram подтверждён ботом. Вернитесь в кабинет, обновите страницу и подтвердите привязку: ${account}`;
      break;
    case "link_invalid":
      text = `Ссылка истекла или уже использована. Создайте новую в кабинете: ${account}`;
      break;
    case "not_linked":
      text = `Для доступа к событиям привяжите Telegram в кабинете участника XD: ${account}`;
      break;
    case "stopped":
      text = `Уведомления отключены. Включить их снова можно в кабинете: ${account}`;
      break;
    case "unlinked":
      text = `Бот отвязан. Способ входа на сайт не изменён. ${account}`;
      break;
    case "cabinet":
      text = `Личный кабинет XD: ${origin}/account\nПри необходимости войдите своим обычным способом.`;
      break;
    case "events":
      text = body.events?.length
        ? "Ближайшие события XD:\n\n" +
          body.events
            .map(
              (e) =>
                `${e.title}\n${when(e.starts_at)}\n${origin}/events/${e.id}`,
            )
            .join("\n\n")
        : "Предстоящих событий XD пока нет.";
      break;
    case "event":
      text = `Событие XD · ${body.status === "cancelled" ? "отменено" : body.status === "completed" ? "завершено" : "в расписании"}\n${body.title}\n${when(body.starts_at!)}\n${origin}/events/${body.id}`;
      break;
    case "award":
      text = `Вам начислено ${formatGold(body.amount_units!)} золота за прайм. Это начисление, выплата отмечается отдельно.\n${origin}/treasury#settlements`;
      break;
    case "award_cancelled":
      text = `Начисление ${formatGold(body.amount_units!)} золота отменено. История и текущий долг — в кабинете:\n${origin}/treasury#settlements`;
      break;
    default:
      text =
        "XD · команды бота\n/events — ближайшие события\n/cabinet — личный кабинет\n/stop — отключить уведомления\n/unlink — отвязать бота\n/help — помощь";
  }
  return text.slice(0, 4000);
}
export type SendResult = {
  result: "sent" | "retry" | "blocked" | "failed";
  retry: number;
};
export async function sendMessage(
  token: string,
  chat: string,
  body: DeliveryBody,
  origin: string,
  fetcher: typeof fetch = fetch,
): Promise<SendResult> {
  try {
    const response = await fetcher(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chat,
          text: messageText(body, origin),
          link_preview_options: { is_disabled: true },
        }),
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
        redirect: "error",
      },
    );
    const data = (await response.json()) as {
      ok?: boolean;
      error_code?: number;
      parameters?: { retry_after?: number };
    };
    if (response.ok && data.ok === true) return { result: "sent", retry: 0 };
    const code = data.error_code ?? response.status;
    if (code === 403) return { result: "blocked", retry: 0 };
    if (code === 429 || code >= 500)
      return {
        result: "retry",
        retry: Number.isSafeInteger(data.parameters?.retry_after)
          ? Math.min(3600, Math.max(1, data.parameters!.retry_after!))
          : 30,
      };
    return { result: "failed", retry: 0 };
  } catch {
    return { result: "retry", retry: 30 };
  }
}
/** Never overwrite a webhook belonging to another deployment/bot integration. */
export async function registerBotWebhook(
  c: { token: string; username: string; origin: string; webhookSecret: string },
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  async function call(method: string, args = {}) {
    const r = await fetcher(
      `https://api.telegram.org/bot${c.token}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
        redirect: "error",
      },
    );
    const value = await r.json();
    if (!r.ok || value.ok !== true) throw Error("BOT_API_FAILED");
    return value.result;
  }
  try {
    const me = await call("getMe");
    if (
      me.is_bot !== true ||
      typeof me.username !== "string" ||
      me.username.toLowerCase() !== c.username.toLowerCase()
    )
      return "BOT_MISMATCH";
    const current = await call("getWebhookInfo");
    const url = `${c.origin}/api/telegram/webhook`;
    if (typeof current.url !== "string") return "BOT_API_FAILED";
    if (current.url && current.url !== url) return "WEBHOOK_IN_USE";
    const set = await call("setWebhook", {
      url,
      secret_token: c.webhookSecret,
      allowed_updates: ["message"],
      max_connections: 5,
      drop_pending_updates: false,
    });
    return set === true ? null : "BOT_API_FAILED";
  } catch {
    return "BOT_API_FAILED";
  }
}
