import Link from "next/link";
import { GuildShell } from "@/components/shell";
import { loadCommandReport } from "@/lib/command-report";
import { PeriodFilter } from "@/components/dashboard/period-filter";
import { StatCard } from "@/components/dashboard/stat-card";
import { SeriesChart } from "@/components/dashboard/series-chart";
import { formatGold } from "@/lib/treasury";
import { dashboardDate } from "@/lib/dashboard";
export const metadata = { title: "Статистика гильдии" };
const pct = (v: number | null) => (v === null ? "Нет данных" : v + "%");
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams,
    { range, category, summary, report, error } =
      await loadCommandReport(params);
  const value = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : "";
  const sort = ["prime", "mini", "pvp", "present"].includes(value("sort"))
    ? (value("sort") as "prime" | "mini" | "pvp" | "present")
    : "percentage";
  const query = new URLSearchParams();
  for (const [key, item] of Object.entries(params))
    if (typeof item === "string") query.set(key, item);
  const rows = (summary?.rows ?? [])
    .filter(
      (r) =>
        (!value("q") ||
          r.nickname
            .toLocaleLowerCase("ru")
            .includes(value("q").toLocaleLowerCase("ru"))) &&
        (!value("class") || r.characterClass === value("class")),
    )
    .sort(
      (a, b) =>
        (b[sort] ?? -1) - (a[sort] ?? -1) ||
        a.nickname.localeCompare(b.nickname, "ru"),
    );
  const pages = Math.max(1, Math.ceil(rows.length / 25)),
    requested = Number(value("page") || 1),
    page = Number.isSafeInteger(requested)
      ? Math.max(1, Math.min(pages, requested))
      : 1;
  const href = (number: number) => {
    const next = new URLSearchParams(query);
    next.set("page", String(number));
    return "/statistics?" + next;
  };
  return (
    <GuildShell current="/statistics">
      <div className="page-heading">
        <p className="eyebrow">XD · АНАЛИТИЧЕСКИЙ ЦЕНТР</p>
        <h1>Статистика гильдии</h1>
        <p className="muted">
          Общий процент — по количеству активностей. Прайм — с коэффициентами и
          включает PvP, Мини РБ считается отдельно.
        </p>
        <a
          className="button secondary inline"
          href={"/statistics/export?" + query}
        >
          Скачать CSV
        </a>
      </div>
      <PeriodFilter range={range} category={category} detailed />
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {summary && (
        <>
          <div className="stats-grid command-stats">
            <StatCard
              title="Состоявшихся событий"
              value={summary.events}
              note="Все проведённые учитываемые активности"
            />
            <StatCard
              title="Уникальных участников"
              value={summary.unique}
              note="Игроки с присутствием в доступных данных"
            />
            <StatCard
              title="Всего участий"
              value={summary.participations}
              note="Игрок может участвовать в нескольких событиях"
            />
            <StatCard
              title="Среднее участников"
              value={summary.average ?? "Нет данных"}
              note="Присутствия / состоявшиеся события"
            />
          </div>
          <SeriesChart
            title="Прайм, Мини-РБ и PvP"
            description="PvP — отдельный признак, он входит в Прайм и не суммируется с категориями как отдельный фонд."
            points={summary.daily.map((d) => ({
              label: dashboardDate(d.label),
              values: [String(d.prime), String(d.mini), String(d.pvp)],
              display: [String(d.prime), String(d.mini), String(d.pvp)],
            }))}
            series={[
              { label: "Прайм", color: "var(--gold)" },
              { label: "Мини-РБ", color: "var(--info)" },
              { label: "PvP", color: "var(--red)" },
            ]}
          />
          <section className="panel section-panel">
            <h2>Рейтинг участников</h2>
            <form className="command-filters">
              <input type="hidden" name="period" value={range.period} />
              <input type="hidden" name="from" value={range.from} />
              <input type="hidden" name="to" value={range.to} />
              <input type="hidden" name="category" value={category} />
              <label>
                Ник
                <input name="q" maxLength={64} defaultValue={value("q")} />
              </label>
              <label>
                Класс
                <select name="class" defaultValue={value("class")}>
                  <option value="">Все классы</option>
                  {[...new Set(summary.rows.map((r) => r.characterClass))]
                    .sort()
                    .map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                </select>
              </label>
              <label>
                Сортировать по
                <select name="sort" defaultValue={sort}>
                  <option value="percentage">Общей посещаемости</option>
                  <option value="prime">Прайму</option>
                  <option value="mini">Мини-РБ</option>
                  <option value="pvp">PvP</option>
                  <option value="present">Количеству участий</option>
                </select>
              </label>
              <button className="button secondary">Применить</button>
            </form>
            <p className="caption">
              Присутствия / (присутствия + отсутствия). Уважительные причины и
              неприменимые события исключены. Прайм учитывает веса боссов;
              финансовая категория события остаётся независимой. Доступ к чужим
              отметкам определяется вашими правами.
            </p>
            {rows.length ? (
              <div className="table-scroll">
                <table className="command-table">
                  <thead>
                    <tr>
                      {[
                        "Участник",
                        "Класс",
                        "Посещено / доступно",
                        "Общая",
                        "Прайм",
                        "Мини-РБ",
                        "PvP · участий в Прайме",
                      ].map((label) => (
                        <th scope="col" key={label}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice((page - 1) * 25, page * 25).map((row) => (
                      <tr key={row.id}>
                        <th scope="row">
                          <Link href={"/members/" + row.id}>
                            {row.nickname}
                          </Link>
                        </th>
                        <td>{row.characterClass}</td>
                        <td>
                          {row.present} / {row.available}
                        </td>
                        <td>{pct(row.percentage)}</td>
                        <td>
                          {pct(row.prime)} · {row.primePresent}/
                          {row.primeAvailable}
                        </td>
                        <td>
                          {pct(row.mini)} · {row.miniPresent}/
                          {row.miniAvailable}
                        </td>
                        <td>{row.pvp}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">
                Нет проведённых активностей по выбранным фильтрам.
              </p>
            )}
            <nav className="pagination" aria-label="Страницы рейтинга">
              {page > 1 && <Link href={href(page - 1)}>← Назад</Link>}
              <span>
                {page} / {pages}
              </span>
              {page < pages && <Link href={href(page + 1)}>Далее →</Link>}
            </nav>
          </section>
        </>
      )}
      {report?.finance && (
        <section className="panel section-panel">
          <h2>Финансы</h2>
          <div className="stats-grid">
            <StatCard
              title="Продажи за период"
              value={formatGold(report.finance.sales_units) + " зол."}
              note="Записанные продажи до отмен"
            />
            <StatCard
              title="Отмены продаж"
              value={formatGold(report.finance.reversed_units) + " зол."}
              note="Обратные операции в дату их записи"
            />
            <StatCard
              title="Ваша задолженность"
              value={formatGold(report.own_finance.pending_units) + " зол."}
              note="Текущий остаток к выплате"
            />
          </div>
          <Link href="/treasury">Казна, склады, начисления и выплаты →</Link>
          <br />
          <Link href="/exports">Выгрузить финансовую историю CSV →</Link>
        </section>
      )}
    </GuildShell>
  );
}
