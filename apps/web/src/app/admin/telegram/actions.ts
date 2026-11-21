"use server";
import { requirePermission } from "@/lib/access";
import { checkOrigin } from "@/lib/mutations";
import { registerBotWebhook } from "@/lib/telegram/protocol";
import {
  botConfig,
  dispatchTelegram,
  scheduleTelegram,
} from "@/lib/telegram/server";
import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/identity";
export async function dispatch(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  await requirePermission("telegram.manage");
  if (form.get("confirm") !== "on")
    return { error: "Подтвердите отправку ожидающих сообщений." };
  try {
    const r = await dispatchTelegram();
    revalidatePath("/admin/telegram");
    return r.unavailable
      ? { error: "Бот пока не настроен." }
      : {
          success: `Отправлено: ${r.sent}. Попыток: ${r.attempted}. Остаток очереди показан ниже; отложенные попытки требуют следующего запуска.`,
        };
  } catch {
    return { error: "Обработка прервана. Очередь сохранена; повторите позже." };
  }
}
export async function connectWebhook(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  await requirePermission("telegram.manage");
  if (form.get("confirm") !== "on")
    return { error: "Подтвердите подключение бота к этому сайту." };
  const c = botConfig();
  if (!c.ready) return { error: "Сначала заполните серверные настройки бота." };
  const error = await registerBotWebhook(c);
  if (error)
    return {
      error:
        error === "WEBHOOK_IN_USE"
          ? "Этот бот уже подключён к другому адресу. Используйте отдельного бота XD; чужой webhook не изменён."
          : error === "BOT_MISMATCH"
            ? "Токен относится к другому боту. Проверьте имя бота в настройках."
            : "Telegram не подтвердил подключение. Проверьте доступность сайта и серверные настройки.",
    };
  return {
    success:
      "Telegram принял webhook. Теперь проверьте привязку и команду /events из вашего Telegram.",
  };
}
export async function retryFailed(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client } = await requirePermission("telegram.manage");
  if (form.get("confirm") !== "on")
    return { error: "Подтвердите повторные попытки доставки." };
  const { data, error } = await client.rpc("retry_telegram_failures");
  if (error) return { error: "Не удалось обновить очередь." };
  scheduleTelegram();
  revalidatePath("/admin/telegram");
  return {
    success: `Возвращено в очередь: ${data}. После устранения причины сбоя повторите обработку очереди.`,
  };
}
