import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/access";
import { GUILD_ID } from "@/lib/config";
import { GuildShell } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { manageMember } from "@/app/actions";
export const metadata = { title: "Состав гильдии" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const a = await requirePermission("members.read");
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 64);
  const page = Math.max(
    1,
    Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1),
  );
  let query = a.client
    .from("memberships")
    .select(
      "id,user_id,nickname,joined_at,membership_roles(roles(code,name))",
      { count: "exact" },
    )
    .eq("guild_id", GUILD_ID)
    .eq("status", "active");
  if (q) query = query.ilike("nickname", `%${q.replace(/[\\%_]/g, "\\$&")}%`);
  const { data, error, count } = await query
    .order("nickname")
    .order("id")
    .range((page - 1) * 25, page * 25 - 1);
  if (error) redirect("/setup?problem=database");
  const manage = await a.permission("members.manage"),
    assign = await a.permission("roles.assign");
  const profiles = manage
    ? await a.client
        .from("profiles")
        .select("id,blocked")
        .in(
          "id",
          (data ?? []).map((m) => m.user_id),
        )
    : null;
  if (profiles?.error) redirect("/setup?problem=database");
  const blocked = new Map((profiles?.data ?? []).map((p) => [p.id, p.blocked]));
  const roles = [
    ["admin", "Администратор"],
    ["officer", "Офицер"],
    ["treasurer", "Казначей"],
    ["member", "Участник"],
    ["guest", "Гость"],
  ];
  return (
    <GuildShell current="/members">
      <div className="page-heading">
        <p className="eyebrow">XD · ЛЮДИ ГИЛЬДИИ</p>
        <h1>Состав гильдии</h1>
        <p className="muted">
          {count ?? 0} участников · Профили персонажей появятся на следующем
          этапе.
        </p>
      </div>
      <section className="panel section-panel">
        <form className="search-form">
          <label htmlFor="member-search" className="sr-only">
            Поиск по нику
          </label>
          <input
            id="member-search"
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Найти игрока по нику"
            maxLength={64}
          />
          <button className="button secondary">Найти</button>
          {q && (
            <Link href="/members" className="text-button">
              Сбросить
            </Link>
          )}
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Участник</th>
                <th>Роль</th>
                <th>Дата вступления</th>
                <th>Статус</th>
                {manage && <th>Управление</th>}
              </tr>
            </thead>
            <tbody>
              {data?.map((m) => {
                const rowRoles = (m.membership_roles ?? []).flatMap((mr) =>
                  Array.isArray(mr.roles)
                    ? mr.roles
                    : mr.roles
                      ? [mr.roles]
                      : [],
                );
                const owner = rowRoles.some((r) => r.code === "owner");
                return (
                  <tr key={m.id}>
                    <td>
                      <div className="member-name">
                        <span className="avatar">{m.nickname[0]}</span>
                        <strong>{m.nickname}</strong>
                      </div>
                    </td>
                    <td>
                      {rowRoles.map((r) => r.name).join(", ") || "Без роли"}
                    </td>
                    <td>
                      {new Date(m.joined_at).toLocaleDateString("ru-RU", {
                        timeZone: "UTC",
                      })}
                    </td>
                    <td>
                      <span
                        className={`badge ${blocked.get(m.user_id) ? "red" : "green"}`}
                      >
                        {blocked.get(m.user_id) ? "Заблокирован" : "В составе"}
                      </span>
                    </td>
                    {manage && (
                      <td>
                        {!owner && m.user_id !== a.user.id ? (
                          <details>
                            <summary>Изменить</summary>
                            <ActionForm
                              action={manageMember}
                              label={
                                blocked.get(m.user_id)
                                  ? "Снять блокировку"
                                  : "Заблокировать"
                              }
                            >
                              <input
                                type="hidden"
                                name="memberId"
                                value={m.id}
                              />
                              <input
                                type="hidden"
                                name="action"
                                value="block"
                              />
                              <input
                                type="hidden"
                                name="blocked"
                                value={
                                  blocked.get(m.user_id) ? "false" : "true"
                                }
                              />
                              <label className="check">
                                <input
                                  type="checkbox"
                                  name="confirm"
                                  required
                                />
                                <span>Подтверждаю изменение доступа</span>
                              </label>
                            </ActionForm>
                            {assign && (
                              <ActionForm
                                action={manageMember}
                                label="Назначить роль"
                              >
                                <input
                                  type="hidden"
                                  name="memberId"
                                  value={m.id}
                                />
                                <input
                                  type="hidden"
                                  name="action"
                                  value="role"
                                />
                                <label>
                                  Роль
                                  <select
                                    name="role"
                                    defaultValue={rowRoles[0]?.code ?? "member"}
                                  >
                                    {roles.map(([v, l]) => (
                                      <option key={v} value={v}>
                                        {l}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="check">
                                  <input
                                    type="checkbox"
                                    name="confirm"
                                    required
                                  />
                                  <span>Подтверждаю назначение</span>
                                </label>
                              </ActionForm>
                            )}
                          </details>
                        ) : (
                          <span className="caption">Защищённый аккаунт</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!data?.length && (
          <div className="empty-state">
            <h3>Игроки не найдены</h3>
            <p>Попробуйте другой ник или сбросьте поиск.</p>
          </div>
        )}
        <nav className="pagination" aria-label="Страницы состава">
          {page > 1 && (
            <Link href={`/members?q=${encodeURIComponent(q)}&page=${page - 1}`}>
              ← Назад
            </Link>
          )}
          <span>Страница {page}</span>
          {page * 25 < (count ?? 0) && (
            <Link href={`/members?q=${encodeURIComponent(q)}&page=${page + 1}`}>
              Далее →
            </Link>
          )}
        </nav>
      </section>
    </GuildShell>
  );
}
