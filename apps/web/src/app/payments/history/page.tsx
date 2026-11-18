import Link from "next/link";
import { requirePermission } from "@/lib/access";
import { GuildShell } from "@/components/shell";
import { formatGold } from "@/lib/treasury";
import { formatSalaryGold } from "@/lib/payroll";
const labels: Record<string, string> = {
  "salary.calculation_changed": "Изменились начисления",
  "salary.statement_locked": "Ведомость зафиксирована",
  "salary.statement_completed": "Ведомость завершена",
  "salary.statement_cancelled": "Фиксация снята",
  "salary.member_paid": "Выплата зарплаты",
  "salary.pending_recalculated": "Пересчёт невыплаченных начислений",
  "member.guild_join_date": "Изменена дата вступления",
  "member.coefficient": "Изменён личный коэффициент",
  "activity.report_saved": "Изменён состав или параметры активности",
  "attendance.changed": "Изменено участие",
  "event.changed": "Изменена активность",
  "event.edited": "Изменена активность",
  "event.created": "Создана активность",
  "treasury.sold": "Продажа дропа",
  "treasury.sale_voided": "Отмена продажи",
  "treasury.service_sold": "Продажа опыта РБ или мусора",
  "activities.archived": "Архивированы активности",
};
type Entry = {
  statement_id?: string | null;
  changes?: {
    member_id: string;
    nickname: string;
    prime_before: string;
    prime_after: string;
    mini_before: string;
    mini_after: string;
    prime_percent_before: number;
    prime_percent_after: number;
    mini_percent_before: number;
    mini_percent_after: number;
  }[];
  deferred?: boolean;
  operation?: string;
  id: string;
  at: string;
  action: string;
  target: string | null;
  actor: string;
  reason: string;
  source: string | null;
  amount_units: string | null;
  before: string | number | null;
  after: string | number | null;
  coefficient: number | null;
  previous_coefficient: number | null;
};
export const metadata = { title: "История изменений зарплаты" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  const a = await requirePermission("treasury.allocate"),
    p = await searchParams;
  const before = p.before && /^\d{1,18}$/.test(p.before) ? p.before : null;
  const { data, error } = await a.client.rpc("salary_change_history", {
    p_before: before,
  });
  const d = data as { entries: Entry[]; next_before: string | null } | null;
  return (
    <GuildShell current="/payments">
      <div className="page-heading">
        <Link href="/payments/salary" className="text-button">
          ← Выплата ЗП
        </Link>
        <h1>История изменений</h1>
        <p>
          Кто менял состав, продажи, коэффициенты, даты вступления и ведомости.
          Изменения учитываются в открытом расчёте; зафиксированная ведомость
          сохраняет суммы.
        </p>
      </div>
      {error || !d ? (
        <p role="alert">Не удалось загрузить историю. Обновите страницу.</p>
      ) : (
        <section className="panel section-panel">
          {!d.entries.length ? (
            <p>Записей пока нет.</p>
          ) : (
            <div
              className="table-wrap"
              tabIndex={0}
              role="region"
              aria-label="История изменений"
            >
              <table>
                <thead>
                  <tr>
                    <th>Дата · UTC</th>
                    <th>Кто</th>
                    <th>Изменение</th>
                    <th>Подробности</th>
                  </tr>
                </thead>
                <tbody>
                  {d.entries.map((e) => (
                    <tr key={e.id}>
                      <td>
                        {new Date(e.at).toLocaleString("ru-RU", {
                          timeZone: "UTC",
                        })}
                      </td>
                      <td>{e.actor}</td>
                      <td>
                        {labels[e.action] || e.action}
                        {e.target && <div>{e.target}</div>}
                      </td>
                      <td>
                        {e.amount_units && /^-?\d+$/.test(e.amount_units) && (
                          <div>
                            {formatGold(e.amount_units)} зол.{" "}
                            {e.source === "prime"
                              ? "Прайм"
                              : e.source === "mini_rb"
                                ? "Мини РБ"
                                : ""}
                          </div>
                        )}
                        {(e.action === "member.guild_join_date" ||
                          e.action === "member.coefficient") && (
                          <div>
                            {e.before ?? "не указано"} →{" "}
                            {e.after ?? "не указано"}
                          </div>
                        )}
                        {e.coefficient != null && (
                          <div>
                            Сложность:{" "}
                            {e.previous_coefficient == null
                              ? "—"
                              : e.previous_coefficient / 100}{" "}
                            → {e.coefficient / 100}
                          </div>
                        )}
                        {e.deferred && (
                          <p className="caption">
                            Изменения следующего открытого расчёта.
                            Зафиксированная ведомость не изменена.
                          </p>
                        )}
                        {e.changes && e.changes.length > 0 && (
                          <details>
                            <summary>
                              Изменение зарплаты · {e.changes.length} игроков
                            </summary>
                            {e.changes.map((c) => (
                              <div
                                key={c.member_id}
                                className="panel section-panel"
                              >
                                <strong>{c.nickname}</strong>
                                <p
                                  title={`Точно: ${formatGold(c.prime_before)} → ${formatGold(c.prime_after)} зол.`}
                                >
                                  Прайм: {formatSalaryGold(c.prime_before)} →{" "}
                                  {formatSalaryGold(c.prime_after)} зол. ·{" "}
                                  {c.prime_percent_before ?? 0}% →{" "}
                                  {c.prime_percent_after ?? 0}%
                                </p>
                                <p
                                  title={`Точно: ${formatGold(c.mini_before)} → ${formatGold(c.mini_after)} зол.`}
                                >
                                  Мини РБ: {formatSalaryGold(c.mini_before)} →{" "}
                                  {formatSalaryGold(c.mini_after)} зол. ·{" "}
                                  {c.mini_percent_before ?? 0}% →{" "}
                                  {c.mini_percent_after ?? 0}%
                                </p>
                              </div>
                            ))}
                          </details>
                        )}
                        {e.statement_id && (
                          <Link
                            href={`/payments/statements/${e.statement_id}`}
                            className="text-button"
                          >
                            Открыть ведомость →
                          </Link>
                        )}
                        {e.reason && <p>{e.reason}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {d.next_before && (
            <Link
              href={"/payments/history?before=" + d.next_before}
              className="text-button"
            >
              Более ранние изменения →
            </Link>
          )}
        </section>
      )}
    </GuildShell>
  );
}
