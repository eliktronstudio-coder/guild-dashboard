import Link from "next/link";
import { requirePermission } from "@/lib/access";
import { GUILD_ID } from "@/lib/config";
import { GuildShell } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { discordReady } from "@/lib/discord/server";
import { saveSettings } from "./actions";
export const metadata = { title: "Discord-бот" };
export default async function Page() {
  const a = await requirePermission("discord.manage");
  const [settings, imports] = await Promise.all([
    a.client
      .from("discord_settings")
      .select("discord_guild_id,channel_id,enabled,connected_at,application_id")
      .eq("guild_id", GUILD_ID)
      .maybeSingle(),
    a.client
      .from("discord_imports")
      .select("event_id,message_id,created_at")
      .eq("guild_id", GUILD_ID)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const s = settings.data,
    connected =
      s?.connected_at &&
      Date.now() - new Date(s.connected_at).getTime() < 180000;
  return (
    <GuildShell current="/admin">
      <div className="page-heading">
        <p className="eyebrow">XD · ИНТЕГРАЦИИ</p>
        <h1>Discord: импорт активностей</h1>
        <p className="muted">
          Скрин рейда и список дропа → проверка в Discord → активность на сайте.
        </p>
      </div>
      {!discordReady() && (
        <p className="notice">
          Служба бота ещё не подключена к сайту. Настройки будут доступны после
          установки службы.
        </p>
      )}
      {[settings, imports].some((r) => r.error) && (
        <p className="notice error" role="alert">
          Не удалось загрузить настройки Discord. Проверьте подключение базы.
        </p>
      )}
      <section className="panel section-panel">
        <h2>Подключение нового бота</h2>
        <p>
          Создайте приложение в{" "}
          <a
            href="https://discord.com/developers/applications"
            target="_blank"
            rel="noreferrer"
          >
            Discord Developer Portal
          </a>
          , откройте Bot и включите Message Content Intent. Скопируйте токен и
          введите его ниже. Не отправляйте токен в чат.
        </p>
        <p>
          В Discord включите режим разработчика, скопируйте ID сервера и канала
          «Активность». Поддерживаются текстовый канал и ветки форума.
        </p>
        <p className="notice">
          Состояние:{" "}
          {connected
            ? "бот в сети"
            : s?.enabled
              ? "ожидает подключения бота"
              : "импорт выключен"}
        </p>
        <ActionForm action={saveSettings} label="Сохранить подключение">
          <label>
            ID Discord-сервера
            <input
              name="server"
              required
              inputMode="numeric"
              pattern="[0-9]{17,22}"
              defaultValue={s?.discord_guild_id ?? ""}
            />
          </label>
          <label>
            ID канала «Активность»
            <input
              name="channel"
              required
              inputMode="numeric"
              pattern="[0-9]{17,22}"
              defaultValue={s?.channel_id ?? ""}
            />
          </label>
          <label>
            Токен нового бота
            <input
              type="password"
              name="token"
              autoComplete="off"
              maxLength={256}
              placeholder="Оставьте пустым, чтобы сохранить текущий"
            />
          </label>
          <p className="caption">
            Токен проверяется в Discord и хранится зашифрованным. После
            сохранения он не показывается.
          </p>
          <label className="check">
            <input
              name="enabled"
              type="checkbox"
              defaultChecked={s?.enabled ?? true}
            />
            Включить импорт из Discord
          </label>
        </ActionForm>
        {s?.application_id && (
          <p>
            <a
              className="button secondary inline"
              target="_blank"
              rel="noreferrer"
              href={`https://discord.com/oauth2/authorize?client_id=${s.application_id}&scope=bot%20applications.commands&permissions=274878024704&guild_id=${s.discord_guild_id}`}
            >
              Добавить бота на Discord-сервер →
            </a>
          </p>
        )}
        <p className="caption">
          При первом подключении добавьте приложение через Installation в
          Discord Portal: Guild Install, bot + applications.commands; View
          Channels, Send Messages, Read Message History, Send Messages in
          Threads, Attach Files, Embed Links. Права администратора боту не
          нужны.
        </p>
      </section>
      <section className="panel section-panel">
        <h2>Кто может создавать активности</h2>
        <p>
          Любой участник Discord с доступом к указанному каналу может отправить
          скрин рейда, разобрать состав и дроп и создать активность. Привязка
          пользователя к сайту и права администратора не нужны.
        </p>
        <p>
          Бот читает только настроенный канал и его ветки. Настройки подключения
          меняет администрация сайта. В истории импорта сохраняется Discord ID
          участника, подтвердившего данные.
        </p>
      </section>
      <section className="panel section-panel">
        <h2>Как пользоваться</h2>
        <ol>
          <li>Отправьте скрин состава и список дропа в канал «Активность».</li>
          <li>
            Нажмите «Разобрать активность». Выберите активность из реестра,
            PvP/PvE и Прайм/Мини-РБ.
          </li>
          <li>
            Укажите, какие изображения содержат состав и дроп. Если дроп в
            отдельном сообщении, используйте «Дроп из сообщения» и его ID.
            Проверьте распознанные ники и количества предметов.
          </li>
          <li>
            Подтвердите полный состав и сохранение. Бот создаст активность и
            пришлёт ссылку.
          </li>
        </ol>
        <p>
          Незарегистрированные ники сохраняются как гости и не увеличивают
          посещаемость. Неизвестный дроп нужно исправить или явно убрать. Цены и
          коэффициент берутся из реестров сайта. Повторная отправка одного
          сообщения не создаёт дубликат. Бот не создаёт выплаты и не
          подтверждает убийство босса автоматически.
        </p>
      </section>
      <section className="panel section-panel">
        <h2>Последние импорты</h2>
        {imports.data?.length ? (
          <ul>
            {imports.data.map((i) => (
              <li key={i.event_id}>
                <Link href={`/events/${i.event_id}`}>Открыть активность</Link> ·
                сообщение {i.message_id}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Импортов пока нет.</p>
        )}
      </section>
    </GuildShell>
  );
}
