import Link from "next/link";
import { requirePermission } from "@/lib/access";
import { botConfig } from "@/lib/telegram/server";
import { GuildShell } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { dispatch, connectWebhook, retryFailed } from "./actions";
export const metadata = { title: "Telegram · управление" };
export const maxDuration = 60;
export default async function Page() {
  const { client } = await requirePermission("telegram.manage");
  const c = botConfig();
  const { data, error } = await client.rpc("telegram_delivery_status");
  const stats = data as {
    pending: number;
    failed: number;
    sent: number;
    subscribers: number;
  } | null;
  return (
    <GuildShell current="/admin">
      <div className="page-heading">
        <p className="eyebrow">УПРАВЛЕНИЕ</p>
        <h1>Telegram-бот</h1>
        <p className="muted">Подключение и очередь уведомлений XD.</p>
      </div>
      <section className="panel section-panel">
        <h2>{c.ready ? "Настройки бота заполнены" : "Бот не настроен"}</h2>
        <p className="caption">
          Наличие настроек не подтверждает доступность Telegram или регистрацию
          webhook. Секреты задаются в серверном окружении по инструкции
          docs/TELEGRAM.md.
        </p>
        {c.ready && (
          <ActionForm action={connectWebhook} label="Подключить webhook">
            <label className="check">
              <input type="checkbox" name="confirm" required />
              <span>Подключить указанного бота XD к этому сайту</span>
            </label>
          </ActionForm>
        )}
        {error ? (
          <p role="alert">
            Не удалось загрузить очередь. Проверьте миграцию 009.
          </p>
        ) : (
          stats && (
            <div className="personal-finance">
              <div>
                Подписчиков<strong>{stats.subscribers}</strong>
              </div>
              <div>
                Ожидает отправки<strong>{stats.pending}</strong>
              </div>
              <div>
                Не доставлено<strong>{stats.failed}</strong>
              </div>
              <div>
                Доставлено за срок хранения<strong>{stats.sent}</strong>
              </div>
            </div>
          )
        )}
        <p>
          Сообщения ставятся в очередь при записи событий и начислений. После
          действий на сайте и команд боту приложение отправляет до 20 сообщений
          за один запуск. Для оставшейся очереди и повторных попыток используйте
          запуск ниже или настроенный планировщик.
        </p>
        {c.ready && (
          <ActionForm action={dispatch} label="Обработать очередь">
            <label className="check">
              <input type="checkbox" name="confirm" required />
              <span>
                Отправить ожидающие сообщения подписавшимся участникам
              </span>
            </label>
          </ActionForm>
        )}
        {c.ready && stats && stats.failed > 0 && (
          <ActionForm
            action={retryFailed}
            label="Повторить неудавшиеся отправки"
          >
            <label className="check">
              <input type="checkbox" name="confirm" required />
              <span>
                Причина сбоя устранена. Повторить отправки за последние сутки;
                получатель может получить дубликат
              </span>
            </label>
          </ActionForm>
        )}
        <p className="caption">
          При сетевом сбое Telegram иногда может получить сообщение повторно.
          Отключение подписки отменяет ожидающие уведомления; уже отправляемое
          сообщение может дойти. Без планировщика автоматические повторы при
          отсутствии новых действий не гарантированы.
        </p>
      </section>
      <Link href="/account/telegram">Моя привязка Telegram →</Link>
    </GuildShell>
  );
}
