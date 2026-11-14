import Link from "next/link";
import { requireMember } from "@/lib/access";
import { botConfig } from "@/lib/telegram/server";
import { GuildShell } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { ConnectBot } from "@/components/telegram/connect";
import { confirmLink, notifications, unlinkBot } from "./actions";
export const metadata = { title: "Telegram · привязка и уведомления" };
type TelegramStatus = {
  link: null | {
    id: string;
    telegram_id: string;
    username: string | null;
    notifications: boolean;
  };
  request: null | {
    id: string;
    telegram_id: string | null;
    username: string | null;
    expires_at: string;
  };
};
export default async function Page() {
  const { client } = await requireMember();
  const c = botConfig();
  const { data, error } = await client.rpc("telegram_status");
  const status = data as TelegramStatus | null;
  return (
    <GuildShell current="/account">
      <div className="page-heading">
        <p className="eyebrow">ЛИЧНЫЙ КАБИНЕТ</p>
        <h1>Telegram</h1>
        <p className="muted">
          События, начисления и выплаты — в личных сообщениях.
        </p>
      </div>
      <section className="panel section-panel narrow">
        <h2>Бот XD</h2>
        <p className="caption">
          Бот покажет события, вашу статистику и пришлёт уведомления. Привязка
          не меняет способ входа на сайт.
        </p>
        {!c.ready && (
          <p className="notice">
            Бот ещё не подключён администратором. Создать ссылку пока нельзя;
            существующую привязку можно отключить.
          </p>
        )}
        {error ? (
          <p className="notice error" role="alert">
            Не удалось загрузить привязку. Обновите страницу или обратитесь к
            администратору.
          </p>
        ) : status?.link ? (
          <>
            <p>
              Подключён:{" "}
              <strong>
                {status.link.username
                  ? `@${status.link.username}`
                  : "Аккаунт Telegram"}
              </strong>
            </p>
            <p className="caption">Telegram ID: {status.link.telegram_id}</p>
            <ActionForm
              action={notifications}
              label="Сохранить уведомления"
              revision={`${status.link.id}:${status.link.notifications}`}
            >
              <label className="check">
                <input
                  type="checkbox"
                  name="notifications"
                  defaultChecked={status.link.notifications}
                />
                <span>
                  Получать новые события, изменения расписания, начисления,
                  выплаты и их отмены
                </span>
              </label>
            </ActionForm>
            <p className="caption">
              Команды: /events — события и запись; /join ID и /leave ID — запись
              и отмена; /stats week — ваша неделя; /stats month — ваш месяц;
              /cabinet — кабинет; /stop — отключить уведомления; /unlink —
              отвязать бота.
            </p>
            {c.ready && (
              <a
                href={`https://t.me/${c.username}`}
                className="text-button"
                target="_blank"
                rel="noreferrer"
              >
                Открыть бота →
              </a>
            )}
          </>
        ) : (
          <>
            <ol className="telegram-steps">
              <li>Создайте ссылку и откройте бота.</li>
              <li>Нажмите «Начать» в Telegram.</li>
              <li>
                Вернитесь сюда, обновите страницу и подтвердите ваш аккаунт.
              </li>
            </ol>
            {status?.request?.telegram_id && (
              <div className="telegram-candidate">
                <h3>Подтвердите ваш аккаунт</h3>
                <p>
                  {status.request.username
                    ? `@${status.request.username}`
                    : "Telegram без username"}{" "}
                  · ID {status.request.telegram_id}
                </p>
                <p className="caption">
                  Сверьте ID с аккаунтом, из которого открыли бота. Если это не
                  вы, создайте новую ссылку.
                </p>
                <ActionForm
                  action={confirmLink}
                  label="Подтвердить привязку"
                  revision={status.request.id}
                >
                  <input
                    type="hidden"
                    name="requestId"
                    value={status.request.id}
                  />
                  <input
                    type="hidden"
                    name="telegramId"
                    value={status.request.telegram_id}
                  />
                  <label className="check">
                    <input type="checkbox" name="confirm" required />
                    <span>Это мой Telegram-аккаунт</span>
                  </label>
                  <label className="check">
                    <input type="checkbox" name="notifications" />
                    <span>
                      Получать уведомления о событиях, начислениях и выплатах
                    </span>
                  </label>
                </ActionForm>
              </div>
            )}
            {c.ready && <ConnectBot replace={Boolean(status?.request)} />}
            <p>
              <a href="/account/telegram" className="text-button">
                Обновить статус привязки →
              </a>
            </p>
          </>
        )}
      </section>
      {status && (status.link || status.request) && (
        <section className="panel section-panel narrow">
          <h2>{status.link ? "Отвязать бота" : "Отменить привязку"}</h2>
          <ActionForm action={unlinkBot} label="Отключить привязку">
            <label className="check">
              <input type="checkbox" name="confirm" required />
              <span>
                Подтверждаю отключение бота и отмену ожидающей привязки
              </span>
            </label>
          </ActionForm>
        </section>
      )}
      <Link href="/account" className="text-button">
        ← Мой аккаунт
      </Link>
    </GuildShell>
  );
}
