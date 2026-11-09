import { AdminTabs } from "@/components/admin-tabs";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/access";
import { GUILD_ID } from "@/lib/config";
import { GuildShell } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { reviewApplication } from "@/app/actions";
export const metadata = { title: "Управление гильдией" };
const labels: Record<string, string> = {
  "activity_banner.saved": "Баннер активности сохранён",
  "activity_banner.deleted": "Баннер активности удалён",
  "event.banner_selected": "Для события выбран баннер активности",
  "drop_registry.saved": "Дроп сохранён в реестре",
  "drop_registry.deleted": "Дроп удалён из реестра",
  "event.signup_changed": "Изменена запись на событие",
  "telegram.linked": "Привязан Telegram-бот",
  "telegram.unlinked": "Отвязан Telegram-бот",
  "telegram.unlinked_via_bot": "Бот отвязан через Telegram",
  "telegram.preferences": "Изменены Telegram-уведомления",
  "member.profile_changed": "Обновлён профиль",
  "member.nickname_changed": "Изменён игровой ник",
  "character.created": "Добавлен персонаж",
  "character.updated": "Изменён персонаж",
  "character.archived": "Персонаж перенесён в архив",
  "application.submitted": "Подана заявка",
  "application.approved": "Заявка одобрена",
  "application.rejected": "Заявка отклонена",
  "owner.bootstrapped": "Назначен владелец",
  "member.block_changed": "Изменена блокировка",
  "member.role_changed": "Изменена роль",
};
export default async function Page() {
  const a = await requirePermission("applications.review");
  const manageTelegram = await a.permission("telegram.manage");
  const { data, error, count } = await a.client
    .from("applications")
    .select("id,nickname,created_at,user_id", { count: "exact" })
    .eq("guild_id", GUILD_ID)
    .eq("status", "pending")
    .order("created_at")
    .limit(50);
  if (error) redirect("/setup?problem=database");
  const canAudit = await a.permission("audit.read");
  const audit = canAudit
    ? await a.client
        .from("audit_log")
        .select("id,action,created_at,actor_id,target_id,detail")
        .eq("guild_id", GUILD_ID)
        .order("id", { ascending: false })
        .limit(20)
    : null;
  if (audit?.error) redirect("/setup?problem=database");
  return (
    <GuildShell current="/admin">
      {(await a.permission("members.manage")) && (
        <p>
          <Link href="/admin/drops" className="button secondary inline">
            Реестр дропа →
          </Link>
          <Link
            href="/admin/activity-banners"
            className="button secondary inline"
          >
            Баннеры активностей →
          </Link>
        </p>
      )}
      {(await a.permission("catalog.manage")) && <AdminTabs current="/admin" />}
      <div className="page-heading">
        <p className="eyebrow">XD · УПРАВЛЕНИЕ</p>
        <h1>Заявки на вступление</h1>
        <p className="muted">
          Ожидают решения: {count ?? 0}. Проверьте игрока в гильдии перед
          одобрением.
        </p>
      </div>
      {manageTelegram && (
        <p>
          <Link href="/admin/telegram" className="button secondary inline">
            Telegram-бот и очередь →
          </Link>
        </p>
      )}
      {(await a.permission("discord.manage")) && (
        <p>
          <Link href="/admin/discord" className="button secondary inline">
            Discord-бот: импорт активностей →
          </Link>
        </p>
      )}
      <div className="applications-grid">
        {data?.map((application) => (
          <article className="panel section-panel" key={application.id}>
            <div className="section-heading">
              <h2>{application.nickname}</h2>
              <span className="badge gold">Ожидает</span>
            </div>
            <p className="caption">
              {new Date(application.created_at).toLocaleString("ru-RU", {
                timeZone: "UTC",
              })}{" "}
              UTC
            </p>
            <details className="identity-details">
              <summary>Идентификатор аккаунта</summary>
              <code>{application.user_id}</code>
            </details>
            <ActionForm action={reviewApplication} label="Сохранить решение">
              <input
                type="hidden"
                name="applicationId"
                value={application.id}
              />
              <label>
                Решение
                <select name="decision" required defaultValue="">
                  <option value="" disabled>
                    Выберите решение
                  </option>
                  <option value="approved">Одобрить</option>
                  <option value="rejected">Отклонить</option>
                </select>
              </label>
              <label>
                Комментарий
                <textarea
                  name="reason"
                  maxLength={500}
                  rows={2}
                  placeholder="При отказе укажите причину"
                />
              </label>
              <label className="check">
                <input name="confirm" type="checkbox" required />
                <span>Я проверил игровой ник и подтверждаю решение</span>
              </label>
            </ActionForm>
          </article>
        ))}
      </div>
      {!data?.length && (
        <section className="panel empty-state">
          <span className="empty-icon">◇</span>
          <h2>Все заявки рассмотрены</h2>
          <p>
            Новые игроки появятся здесь после подтверждения аккаунта и отправки
            игрового ника.
          </p>
        </section>
      )}
      {(count ?? 0) > 50 && (
        <p className="notice">
          Показаны первые 50 заявок. После решения появятся следующие.
        </p>
      )}
      {canAudit && (
        <section className="panel section-panel">
          <h2>Последние действия</h2>
          <p className="caption">
            Журнал записывается вместе с изменениями. Отображаются последние 20
            операций.
          </p>
          {audit?.data?.length ? (
            <ul className="audit-list">
              {audit.data.map((row) => (
                <li key={row.id}>
                  <div>
                    <strong>{labels[row.action] ?? row.action}</strong>
                    <p className="caption">
                      {typeof row.detail?.nickname === "string"
                        ? row.detail.nickname
                        : `Операция #${row.id}`}
                    </p>
                  </div>
                  <time className="caption">
                    {new Date(row.created_at).toLocaleString("ru-RU", {
                      timeZone: "UTC",
                    })}{" "}
                    UTC
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Действий пока нет.</p>
          )}
        </section>
      )}
    </GuildShell>
  );
}
