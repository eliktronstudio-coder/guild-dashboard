import { historyAttendance } from "@/lib/history-report";
import { PERIOD_CLOSING_ENABLED } from "@/lib/config";
import { AttendanceLines } from "@/components/members/payroll-cells";
import type { AttendanceSummary } from "@/lib/payroll";
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
    PERIOD_CLOSING_ENABLED
      ? a.client
          .rpc(
            "attendance_category_report",
            { p_from: range.from, p_until: range.until },
            { count: "exact" },
          )
          .range((page - 1) * 25, page * 25 - 1)
      : historyAttendance()
          .then(async (allRows) => {
            const full = await a.permission("attendance.manage");
            const visible = allRows.filter(
              (r) => full || r.id === a.membership!.id,
            );
            return {
              error: null,
              count: visible.length,
              data: visible.slice((page - 1) * 25, page * 25).map((r) => ({
                ...r,
                membership_id: r.id,
                present: r.attendance_present ?? 0,
                total: r.attendance_total ?? 0,
              })),
            };
          })
          .catch(() => ({ data: null, error: true, count: 0 })),
    a.permission("attendance.manage"),
  ]);
  if (error) redirect("/setup?problem=database");
  const pages = Math.max(1, Math.ceil((count ?? 0) / 25));
  if (page > pages) redirect(`/attendance?month=${range.month}&page=${pages}`);
  const rows = (data ?? []) as (AttendanceSummary & {
    membership_id: string;
    nickname: string;
    present: number;
    absent: number;
    excused: number;
    excluded: number;
    percentage: number | null;
    total: number;
  })[];
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
          {PERIOD_CLOSING_ENABLED
            ? "Сохранённый состав завершённых учитываемых событий. Календарный месяц UTC."
            : "Посещаемость по всем сохранённым активностям, без ограничения по датам."}
        </p>
      </div>
      {PERIOD_CLOSING_ENABLED && (
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
      )}
      <section className="panel section-panel">
        <p className="notice">
          Посещаемость = число посещённых / все проведённые учитываемые
          активности периода × 100%. Прайм включает PvP; Мини РБ считается
          отдельно. Мини РБ считается по количеству, Прайм — с коэффициентами
          активностей. Категория определяется по названию: АГЛ, АГЛ Т2 и Кошка —
          Мини РБ; PvP всегда входит в Прайм.
        </p>
        <div className="attendance-grid">
          {rows.map((r) => (
            <article className="character-card" key={r.membership_id}>
              <h2>{r.nickname}</h2>

              <AttendanceLines
                row={{
                  ...r,
                  attendance_present: r.present,
                  attendance_total: r.total,
                }}
              />
              <dl className="character-details">
                <dt>Присутствовал</dt>
                <dd>{r.present}</dd>
                {!PERIOD_CLOSING_ENABLED ? (
                  <>
                    <dt>Всего активностей</dt>
                    <dd>{r.total}</dd>
                  </>
                ) : (
                  <>
                    <dt>Отсутствовал</dt>
                    <dd>{r.absent}</dd>
                    <dt>Уважительная причина</dt>
                    <dd>{r.excused}</dd>
                    <dt>Не учитывается</dt>
                    <dd>{r.excluded}</dd>
                  </>
                )}
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
