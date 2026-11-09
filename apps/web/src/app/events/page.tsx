import Link from "next/link";
import { GuildShell } from "@/components/shell";
import { requireMember } from "@/lib/access";
import { GUILD_ID } from "@/lib/config";
import {
  activityFilters,
  DIFFICULTIES,
  JOURNAL_STATUSES,
  type JournalReport,
} from "@/lib/activity-workspace";
import { EventCalendar } from "@/components/events/calendar";
export const metadata = { title: "Активность" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const a = await requireMember(),
    params = await searchParams,
    range = activityFilters(params);
  const [manage, staff, templates, response] = await Promise.all([
    a.permission("events.manage"),
    a.permission("attendance.manage"),
    a.client
      .from("guild_activity_banners")
      .select("id,name")
      .eq("guild_id", GUILD_ID)
      .order("name")
      .limit(500),
    range.error
      ? Promise.resolve({ data: null, error: null })
      : a.client.rpc("activity_journal", {
          p_from: range.from + "T00:00:00Z",
          p_until: range.until,
          p_filters: range.filters,
          p_page: range.page,
        }),
  ]);
  const report = response.data as JournalReport | null,
    error =
      range.error ||
      (response.error
        ? "Не удалось загрузить журнал. Обновите страницу."
        : null),
    rows = report?.rows ?? [],
    filters = range.filters;
  function pageHref(page: number) {
    const q = new URLSearchParams({
      from: range.from,
      through: range.through,
      ...filters,
      page: String(page),
    });
    return "/events?" + q;
  }
  const calendar = params.view === "calendar";
  return (
    <GuildShell current="/events">
      <div className="activity-workspace">
        <header className="activity-page-heading">
          <div>
            <h1>Активность</h1>
            <p className="eyebrow">Обзор / Активность</p>
          </div>
          <div className="activity-heading-links">
            <Link href="/attendance">Отчёт посещаемости</Link>
            <Link
              href={
                "/events?" +
                new URLSearchParams({
                  from: range.from,
                  through: range.through,
                  ...filters,
                  view: calendar ? "journal" : "calendar",
                })
              }
            >
              {calendar ? "Журнал" : "Календарь"}
            </Link>
            {manage && <Link href="/admin/activity-banners">Баннеры</Link>}
          </div>
        </header>
        <div className="activity-kpis">
          {[
            {
              title: "Активностей за период",
              value: report?.kpis.total,
              note: "в текущей выборке",
            },
            {
              title: "Средняя посещаемость",
              value: report?.kpis.average,
              note: "участников на подтверждённую активность",
            },
            {
              title: "Лучший показатель",
              value: report?.kpis.best,
              note: "максимум участников",
            },
            {
              title: "Отменено",
              value: report?.kpis.cancelled,
              note: "в текущей выборке",
            },
          ].map((k) => (
            <section className="activity-kpi" key={k.title}>
              <h2>{k.title}</h2>
              <strong>
                {k.value == null ? "—" : k.value.toLocaleString("ru-RU")}
              </strong>
              <p>{k.note}</p>
            </section>
          ))}
        </div>
        <form className="activity-filter-panel">
          <h2>⌕ Фильтры</h2>
          <div className="activity-filter-grid">
            <label>
              Дата с
              <input
                type="date"
                name="from"
                defaultValue={range.from}
                required
              />
            </label>
            <label>
              Дата по
              <input
                type="date"
                name="through"
                defaultValue={range.through}
                required
              />
            </label>
            <label>
              Статус
              <select name="status" defaultValue={filters.status}>
                <option value="">Все статусы</option>
                {Object.entries(JOURNAL_STATUSES).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Вид
              <select name="source" defaultValue={filters.source}>
                <option value="">Все</option>
                <option value="prime">Прайм</option>
                <option value="mini_rb">Мини-РБ</option>
              </select>
            </label>
            <label>
              Активность
              <select name="banner" defaultValue={filters.banner}>
                <option value="">Все активности</option>
                {templates.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Игрок
              <input
                type="search"
                name="player"
                placeholder="Ник…"
                defaultValue={filters.player}
                disabled={!staff}
                title={
                  !staff ? "Доступно ответственным за посещаемость" : undefined
                }
              />
            </label>
          </div>
          <div className="activity-filter-actions">
            <button className="button primary">⌕ Найти</button>
            <Link href="/events" className="button secondary">
              ↺ Сбросить
            </Link>
          </div>
        </form>
        {manage && (
          <Link
            className="button primary inline activity-add"
            href="/events/new"
          >
            ＋ Добавить активность
          </Link>
        )}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {calendar && (
          <section className="panel section-panel">
            <EventCalendar month={range.from.slice(0, 7)} events={rows} />
            <p className="caption">
              На календаре показана текущая страница журнала.
            </p>
          </section>
        )}
        <section className="activity-journal">
          <header>
            <h2>Журнал активностей</h2>
            <span>
              {report?.total
                ? `${(range.page - 1) * 15 + 1}–${Math.min(range.page * 15, report.total)} / ${report.total} активностей`
                : "0 активностей"}
            </span>
          </header>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "Дата",
                    "Активность",
                    "Тип",
                    "Сложность",
                    "Игроков",
                    "Посещаемость",
                    "Статус",
                    "",
                  ].map((h, i) => (
                    <th key={i} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <time dateTime={row.starts_at}>
                        {row.starts_at.slice(0, 10)}
                      </time>
                      {row.is_night && (
                        <span title="Ночная активность"> ☾</span>
                      )}
                    </td>
                    <th scope="row">
                      <Link
                        className="activity-row-title"
                        href={"/events/" + row.id}
                      >
                        {row.has_banner && (
                          <img
                            src={`/events/${row.id}/media?kind=banner`}
                            alt=""
                            width={40}
                            height={24}
                            loading="lazy"
                          />
                        )}
                        <span>{row.title}</span>
                      </Link>
                    </th>
                    <td>
                      <span className="activity-tag">
                        {row.treasury_source === "mini_rb"
                          ? "Мини-РБ"
                          : row.treasury_source === "prime"
                            ? "Прайм"
                            : "Без пометки"}
                      </span>{" "}
                      <span
                        className={
                          "activity-tag " + (row.kind === "pvp" ? "pvp" : "pve")
                        }
                      >
                        {row.kind === "pvp" ? "PvP" : "PvE"}
                      </span>
                    </td>
                    <td>{DIFFICULTIES[row.difficulty] ?? "Обычная"}</td>
                    <td>
                      <strong>{row.participants ?? "—"}</strong>
                    </td>
                    <td>
                      {row.percentage == null ? "—" : row.percentage + "%"}
                    </td>
                    <td>
                      <span className={"activity-status " + row.journal_status}>
                        {JOURNAL_STATUSES[row.journal_status]}
                      </span>
                    </td>
                    <td>
                      {manage && row.status !== "cancelled" && (
                        <Link
                          className="activity-row-cancel"
                          href={"/events/" + row.id + "/cancel"}
                          aria-label={"Отменить " + row.title}
                          title="Отменить активность"
                        >
                          ⌫
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && !error && (
            <p className="activity-empty">
              Активностей по выбранным фильтрам нет.
            </p>
          )}
          <nav className="pagination" aria-label="Страницы журнала">
            {range.page > 1 && (
              <Link href={pageHref(range.page - 1)}>← Назад</Link>
            )}
            <span>
              Страница {range.page} из{" "}
              {Math.max(1, Math.ceil((report?.total ?? 0) / 15))}
            </span>
            {range.page * 15 < (report?.total ?? 0) && (
              <Link href={pageHref(range.page + 1)}>Далее →</Link>
            )}
          </nav>
        </section>
      </div>
    </GuildShell>
  );
}
