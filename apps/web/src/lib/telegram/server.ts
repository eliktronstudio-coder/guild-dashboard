import "server-only";
import { createClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { getConfig } from "@/lib/config";
import { sendMessage, type DeliveryBody } from "./protocol";
export function botConfig() {
  const base = getConfig();
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "",
    username = process.env.TELEGRAM_BOT_USERNAME ?? "",
    webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "",
    serviceKey = process.env.SUPABASE_SECRET_KEY ?? "",
    cronSecret = process.env.CRON_SECRET ?? "";
  let validOrigin = false;
  try {
    const origin = new URL(base.origin);
    validOrigin =
      origin.protocol === "https:" &&
      origin.origin === base.origin &&
      !origin.username &&
      !origin.password;
  } catch {
    /* Missing or invalid settings keep the bot disabled. */
  }
  const ready =
    base.configured &&
    process.env.TELEGRAM_BOT_ENABLED === "true" &&
    /^\d+:[A-Za-z0-9_-]{20,}$/.test(token) &&
    /^(?=.{5,32}$)[A-Za-z][A-Za-z0-9_]*bot$/i.test(username) &&
    /^[A-Za-z0-9_-]{32,256}$/.test(webhookSecret) &&
    Boolean(serviceKey) &&
    validOrigin;
  return {
    ...base,
    token,
    username,
    webhookSecret,
    serviceKey,
    cronSecret,
    ready,
  };
}
export function botClient() {
  const c = botConfig();
  if (!c.ready) throw Error("BOT_NOT_CONFIGURED");
  return createClient(c.url, c.serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
export async function dispatchTelegram() {
  if (!botConfig().ready) return { sent: 0, attempted: 0, unavailable: true };
  const c = botConfig(),
    client = botClient();
  const deadline = Date.now() + 20000;
  let sent = 0,
    attempted = 0;
  while (attempted < 20 && Date.now() < deadline) {
    const { data, error } = await client.rpc("claim_telegram_delivery");
    if (error) throw Error("DELIVERY_DATABASE_ERROR");
    if (!data) break;
    if (data.wait_ms) {
      await new Promise((r) => setTimeout(r, Math.min(1000, data.wait_ms)));
      continue;
    }
    const item = data as {
      id: string;
      lease: string;
      chat_id: string;
      body: DeliveryBody;
    };
    const result = await sendMessage(
      c.token,
      item.chat_id,
      item.body,
      c.origin,
      fetch,
      c.username,
    );
    attempted++;
    const done = await client.rpc("finish_telegram_delivery", {
      p_id: item.id,
      p_lease: item.lease,
      p_result: result.result,
      p_retry: result.retry,
    });
    if (done.error || done.data !== true)
      throw Error("DELIVERY_DATABASE_ERROR");
    if (result.result === "sent") sent++;
  }
  return { sent, attempted, unavailable: false };
}
/** Bounded best effort after the response; durable pending jobs remain for scheduled/manual retry. */
export function scheduleTelegram() {
  if (botConfig().ready)
    after(async () => {
      try {
        await dispatchTelegram();
      } catch {
        console.error(
          "Telegram delivery deferred; inspect the delivery queue.",
        );
      }
    });
}
