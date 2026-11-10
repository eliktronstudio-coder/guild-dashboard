import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/access";
import { GuildShell } from "@/components/shell";
import { monthRange, queryValue } from "@/lib/events";
export const metadata = { title: "Посещаемость" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const a = await requireMember(),
    p = await searchParams,
    range = monthRange(queryValue(p.month));
  const page = Math.max(
    1,
    Math.min(10000, parseInt(queryValue(p.page) ?? "1", 10) || 1),
  );
  const [{ data, error, count }, manage] = await Promise.all([
    a.client
      .rpc(
        "attendance_report",
        { p_from: range.from, p_until: range.until },
        { count: "exact" },
      )
      .range((page - 1) * 25, page * 25 - 1),
    a.permission("attendance.manage"),
  ]);
  if (error) redirect("/setup?problem=database");
  const pages = Math.max(1, Math.ceil((count ?? 0) / 25));
  if (page > pages) redirect(`/attendance?month=${range.month}&page=${pages}`);
  const rows = (data ?? []) as {
    membership_id: string;
    nickname: string;
    present: number;
    absent: number;
    excused: number;
    excluded: number;
    percentage: number | null;
  }[];
  return (
    <GuildShell current="/events">
      <Link href="/events" className="text-button">
        ← Активности
      </Link>
      <div className="page-heading">
        <Link href="/exports" className="text-button">
          Экспорт CSV →
        </Link>
        <h1>{manage ? "Посещаемость гильдии" : "Моя посещаемость"}</h1>
        <p className="muted">
          Сохранённый состав завершённых учитываемых событий. Период —
          календарный месяц UTC.
        </p>
      </div>
      <form className="panel section-panel search-form">
        <label>
          Месяц
          <input
            type="month"
            name="month"
            defaultValue={range.month}
            min="2000-01"
            max="2100-12"
          />
        </label>
        <button className="button secondary">Показать</button>
      </form>
      <section className="panel section-panel">
        <p className="notice">
          Посещаемость = присутствовал / (присутствовал + отсутствовал) × 100%.
          Уважительные причины и «Не учитывается» исключены. Непроверенные
          отчёты не входят в расчёт.
        </p>
        <div className="attendance-grid">
          {rows.map((r) => (
            <article className="character-card" key={r.membership_id}>
              <h2>{r.nickname}</h2>
              <p className="attendance-percent">
                {r.percentage === null ? "Нет данных" : `${r.percentage}%`}
              </p>
              <dl className="character-details">
                <dt>Присутствовал</dt>
                <dd>{r.present}</dd>
                <dt>Отсутствовал</dt>
                <dd>{r.absent}</dd>
                <dt>Уважительная причина</dt>
                <dd>{r.excused}</dd>
                <dt>Не учитывается</dt>
                <dd>{r.excluded}</dd>
              </dl>
            </article>
          ))}
        </div>
        {!rows.length && <p>Нет данных за выбранный период.</p>}
        <nav className="pagination" aria-label="Страницы отчёта">
          {page > 1 && (
            <Link href={`/attendance?month=${range.month}&page=${page - 1}`}>
              ← Назад
            </Link>
          )}
          <span>
            {page} / {pages}
          </span>
          {page < pages && (
            <Link href={`/attendance?month=${range.month}&page=${page + 1}`}>
              Далее →
            </Link>
          )}
        </nav>
      </section>
    </GuildShell>
  );
}
