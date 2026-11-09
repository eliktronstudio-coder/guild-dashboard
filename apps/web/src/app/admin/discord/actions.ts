"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/access";
import { checkOrigin, field } from "@/lib/mutations";
import type { FormState } from "@/lib/identity";
import {
  discordReady,
  discordAdmin,
  encryptDiscordToken,
} from "@/lib/discord/server";
export async function saveSettings(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client, user } = await requirePermission("discord.manage");
  const server = field(form, "server").trim(),
    channel = field(form, "channel").trim(),
    token = field(form, "token").trim();
  if (!/^\d{17,22}$/.test(server) || !/^\d{17,22}$/.test(channel))
    return { error: "Укажите ID Discord-сервера и канала: только цифры." };
  if (!discordReady())
    return { error: "Служба бота ещё не настроена на сервере." };
  if (token) {
    if (
      token.length < 40 ||
      token.length > 256 ||
      !/^[A-Za-z0-9_.-]+$/.test(token)
    )
      return { error: "Проверьте токен бота." };
    try {
      const r = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bot ${token}` },
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
      });
      if (!r.ok || !(await r.json()).bot)
        return { error: "Discord не принял токен бота." };
    } catch {
      return {
        error: "Не удалось проверить токен в Discord. Повторите позже.",
      };
    }
  }
  const { error } = await client.rpc("save_discord_settings", {
    p_server: server,
    p_channel: channel,
    p_enabled: form.get("enabled") === "on",
  });
  if (error) return { error: "Настройки не сохранены." };
  if (token) {
    const saved = await discordAdmin().rpc("set_discord_credential", {
      p_encrypted: encryptDiscordToken(token),
      p_actor: user.id,
    });
    if (saved.error)
      return {
        error: "Канал сохранён, токен не сохранён. Повторите ввод токена.",
      };
  }
  revalidatePath("/admin/discord");
  return { success: "Настройки сохранены. Бот подключится в течение минуты." };
}
