"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/access";
import { checkOrigin, field } from "@/lib/mutations";
import { botConfig } from "@/lib/telegram/server";
import { hashLink } from "@/lib/telegram/protocol";
import type { FormState } from "@/lib/identity";
export type LinkState = FormState & { url?: string };
function errorText(message: string) {
  return (
    (
      {
        ALREADY_LINKED:
          "Этот Telegram или аккаунт уже привязан. Чужие профили не объединяются.",
        RATE_LIMIT: "Подождите 30 секунд перед созданием новой ссылки.",
        LINK_EXPIRED:
          "Заявка истекла или изменилась. Обновите страницу и создайте новую ссылку.",
        NOT_LINKED: "Бот не привязан. Обновите страницу.",
      } as Record<string, string>
    )[message] ??
    "Не удалось сохранить изменение. Проверьте подключение и обновите страницу."
  );
}
export async function beginLink(_: LinkState): Promise<LinkState> {
  await checkOrigin();
  const { client } = await requireMember();
  const c = botConfig();
  if (!c.ready) return { error: "Бот пока не настроен администратором." };
  const token = randomBytes(32).toString("base64url");
  const { error } = await client.rpc("begin_telegram_link", {
    p_hash: hashLink(token),
  });
  if (error) return { error: errorText(error.message) };
  revalidatePath("/account/telegram");
  return {
    url: `https://t.me/${c.username}?start=link_${token}`,
    success:
      "Ссылка действует 10 минут. Откройте бота, нажмите «Начать», затем вернитесь сюда и обновите страницу.",
  };
}
export async function confirmLink(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client } = await requireMember();
  if (form.get("confirm") !== "on")
    return { error: "Подтвердите, что это ваш Telegram-аккаунт." };
  const telegram = field(form, "telegramId");
  if (
    !/^[1-9]\d{0,15}$/.test(telegram) ||
    BigInt(telegram) > BigInt(Number.MAX_SAFE_INTEGER)
  )
    return { error: "Обновите страницу." };
  const { error } = await client.rpc("confirm_telegram_link", {
    p_request: field(form, "requestId"),
    p_telegram_id: telegram,
    p_notifications: form.get("notifications") === "on",
  });
  if (error) return { error: errorText(error.message) };
  revalidatePath("/account/telegram");
  return { success: "Бот привязан к вашему аккаунту XD." };
}
export async function notifications(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client } = await requireMember();
  const { error } = await client.rpc("set_telegram_notifications", {
    p_enabled: form.get("notifications") === "on",
  });
  if (error) return { error: errorText(error.message) };
  revalidatePath("/account/telegram");
  return { success: "Настройки уведомлений сохранены." };
}
export async function unlinkBot(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client } = await requireMember();
  if (form.get("confirm") !== "on")
    return { error: "Подтвердите отвязку бота." };
  const { error } = await client.rpc("unlink_telegram");
  if (error) return { error: errorText(error.message) };
  revalidatePath("/account/telegram");
  return { success: "Бот отвязан. Способ входа на сайт сохранён." };
}
