import { historyPayroll, historyAttendance } from "@/lib/history-report";
import { dashboardPeriod } from "@/lib/dashboard";
import type { PayrollReport, LifetimePayrollReport } from "@/lib/payroll";
import { setMemberWeight } from "@/app/admin/catalog/actions";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/access";
import { GUILD_ID, PERIOD_CLOSING_ENABLED } from "@/lib/config";
import { GuildShell } from "@/components/shell";
import { MemberDirectory } from "@/components/members/directory";
import {
  directoryFilters,
  directoryHref,
  literalSearch,
  ROLE_OPTIONS,
  type DirectoryMember,
} from "@/lib/members";
export const metadata = { title: "Состав гильдии" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const a = await requirePermission("members.read");
  const filters = directoryFilters(await searchParams);
  let query = a.client
    .from("member_directory")
    .select("*", { count: "exact" })
    .eq("guild_id", GUILD_ID)
    .eq("status", "active");
  if (filters.q) query = query.ilike("nickname", literalSearch(filters.q));
  if (filters.role) query = query.contains("role_codes", [filters.role]);
  if (filters.characterClass)
    query = query.ilike(
      "character_class",
      literalSearch(filters.characterClass),
    );
  if (filters.server)
    query = query.ilike("game_server", literalSearch(filters.server));
  query =
    filters.sort === "nickname"
      ? query.order("nickname")
      : query.order("guild_joined_on", {
          ascending: filters.sort === "joined_old",
          nullsFirst: false,
        });
  const { data, error, count } = await query
    .order("id")
    .range((filters.page - 1) * 25, filters.page * 25 - 1);
  if (error) redirect("/setup?problem=database");
  const lastPage = Math.max(1, Math.ceil((count ?? 0) / 25));
  if (filters.page > lastPage) redirect(directoryHref(filters, lastPage));
  const period = dashboardPeriod({ period: "current" });
  const payroll = PERIOD_CLOSING_ENABLED
    ? await a.client.rpc("period_payroll_report", { p_from: period.from })
    : await historyPayroll()
        .then((data) => ({ data, error: null }))
        .catch(() => ({ data: null, error: true }));
  const statement = (payroll.data as LifetimePayrollReport | null)?.statement;
  const liveAttendance = statement
    ? await historyAttendance()
        .then((data) => ({ data, error: false }))
        .catch(() => ({ data: [], error: true }))
    : null;
  return (
    <GuildShell current="/members">
      <Link href="/exports" className="text-button">
        Экспорт CSV →
      </Link>
      <div className="page-heading">
        <p className="eyebrow">XD · ЛЮДИ ГИЛЬДИИ</p>
        <h1>Состав гильдии</h1>
        <p className="muted">
          Найдено: {count ?? 0}. Откройте игрока, чтобы посмотреть профиль и
          персонажей.
        </p>
      </div>
      <section className="panel section-panel">
        <form className="directory-filters">
          <label>
            Игровой ник
            <input
              type="search"
              name="q"
              defaultValue={filters.q}
              placeholder="Найти участника"
              maxLength={64}
            />
          </label>
          <label>
            Роль
            <select name="role" defaultValue={filters.role}>
              <option value="">Все роли</option>
              {ROLE_OPTIONS.map(([v, name]) => (
                <option key={v} value={v}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Класс основного персонажа
            <input
              name="characterClass"
              defaultValue={filters.characterClass}
              maxLength={80}
              placeholder="Любой класс"
            />
          </label>
          <label>
            Сервер
            <input
              name="server"
              defaultValue={filters.server}
              maxLength={60}
              placeholder="Все серверы"
            />
          </label>
          <label>
            Сортировка
            <select name="sort" defaultValue={filters.sort}>
              <option value="nickname">По игровому нику</option>
              <option value="joined_new">Сначала новые участники</option>
              <option value="joined_old">Сначала старые участники</option>
            </select>
          </label>
          <div className="filter-actions">
            <button className="button secondary">Применить</button>
            <Link href="/members" className="text-button">
              Сбросить
            </Link>
          </div>
        </form>
        <p className="caption">
          Прайм и Мини РБ рассчитываются отдельно, каждая категория — от 20%
          посещаемости. Зарплата обновляется при изменении продаж и состава;
          проведённые выплаты сохраняются.
        </p>
        {statement && (
          <p className="notice">
            Посещаемость показана по текущим активностям. Зарплата и личный
            коэффициент для неё — из зафиксированной ведомости.
          </p>
        )}
        {liveAttendance?.error && (
          <p role="alert">Текущая посещаемость временно недоступна.</p>
        )}
        {payroll.error && (
          <p role="alert">Посещаемость и зарплата временно недоступны.</p>
        )}
        <MemberDirectory
          payroll={(payroll.data as PayrollReport | null)?.rows}
          attendance={liveAttendance?.data}
          weightAction={
            (await a.permission("members.coefficient"))
              ? setMemberWeight
              : undefined
          }
          members={(data ?? []) as DirectoryMember[]}
        />
        {!data?.length && (
          <div className="empty-state">
            <h2>Игроки не найдены</h2>
            <p>Измените ник или фильтры.</p>
          </div>
        )}
        <nav className="pagination" aria-label="Страницы состава">
          {filters.page > 1 && (
            <Link href={directoryHref(filters, filters.page - 1)}>← Назад</Link>
          )}
          <span>
            {filters.page} / {lastPage}
          </span>
          {filters.page < lastPage && (
            <Link href={directoryHref(filters, filters.page + 1)}>Далее →</Link>
          )}
        </nav>
      </section>
    </GuildShell>
  );
}
