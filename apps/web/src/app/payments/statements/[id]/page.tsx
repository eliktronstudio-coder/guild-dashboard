import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/access";
import { isUuid } from "@/lib/members";
import { GuildShell } from "@/components/shell";
import { payrollDue, formatSalaryGold, type PayrollRow } from "@/lib/payroll";
import { formatGold } from "@/lib/treasury";
export const metadata = { title: "Зафиксированная ведомость" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const a = await requirePermission("treasury.allocate"),
    { id } = await params;
  if (!isUuid(id)) notFound();
  const { data, error } = await a.client.rpc("salary_statement_report", {
    p_id: id,
  });
  const d = data as {
    status: "locked" | "completed" | "cancelled";
    created_at: string;
    closed_at: string | null;
    reason: string | null;
    creator: string;
    closer: string | null;
    rows: PayrollRow[];
  } | null;
  if (error || !d)
    return (
      <GuildShell current="/payments">
        <h1>Ведомость недоступна</h1>
        <p role="alert">
          Не удалось загрузить ведомость. Проверьте доступ и обновите страницу.
        </p>
      </GuildShell>
    );
  const rows = d.rows.filter(
    (r) => BigInt(payrollDue(r, "prime")) + BigInt(payrollDue(r, "mini")) > 0n,
  );
  const sum = (source: "prime" | "mini") =>
    rows.reduce((n, r) => n + BigInt(payrollDue(r, source)), 0n).toString();
  return (
    <GuildShell current="/payments">
      <div className="page-heading">
        <Link className="text-button" href="/payments/history">
          ← История изменений
        </Link>
        <h1>Зафиксированная ведомость</h1>
        <p>
          {d.status === "locked"
            ? "Идёт выдача"
            : d.status === "completed"
              ? "Завершена"
              : "Фиксация снята"}{" "}
          ·{" "}
          {new Date(d.created_at).toLocaleString("ru-RU", { timeZone: "UTC" })}{" "}
          UTC · {d.creator}
        </p>
        {d.closed_at && (
          <p>
            {new Date(d.closed_at).toLocaleString("ru-RU", { timeZone: "UTC" })}{" "}
            UTC · {d.closer}. {d.reason}
          </p>
        )}
      </div>
      <section className="panel section-panel">
        <h2>К выдаче на момент фиксации</h2>
        <p>
          Прайм: {formatSalaryGold(sum("prime"))} зол. · Мини РБ:{" "}
          {formatSalaryGold(sum("mini"))} зол.
        </p>
        <p className="caption">
          Сохранённые суммы и посещаемость не меняются. Это снимок перед
          выдачей, а не текущий остаток. Фактические выплаты записаны в разделе
          «Выплаты».
        </p>
        <div
          className="table-wrap"
          role="region"
          aria-label="Сохранённая ведомость"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>Игрок</th>
                <th>Прайм · посещаемость</th>
                <th>Мини РБ · посещаемость</th>
                <th>Коэффициент</th>
                <th>К выдаче Прайм</th>
                <th>К выдаче Мини РБ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.nickname}</th>
                  <td>{r.prime_percentage ?? 0}%</td>
                  <td>{r.mini_percentage ?? 0}%</td>
                  <td>{r.payout_weight / 100}</td>
                  {(["prime", "mini"] as const).map((source) => (
                    <td
                      key={source}
                      title={formatGold(payrollDue(r, source)) + " зол."}
                    >
                      {formatSalaryGold(payrollDue(r, source))} зол.
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Link className="text-button" href="/payments/salary">
          К текущей выплате ЗП →
        </Link>
      </section>
    </GuildShell>
  );
}
