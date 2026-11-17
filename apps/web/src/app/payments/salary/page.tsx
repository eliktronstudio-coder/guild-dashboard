import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requirePermission } from "@/lib/access";
import { historyPayroll } from "@/lib/history-report";
import { GuildShell } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { NavIcon } from "@/components/navigation/nav-icon";
import {
  attendanceLabel,
  formatSalaryGold,
  payrollDue,
  type PayrollRow,
} from "@/lib/payroll";
import { formatGold } from "@/lib/treasury";
import { paySalary } from "./actions";
export const metadata = { title: "Выплата ЗП" };
function SourcePayment({
  row,
  source,
  signature,
}: {
  row: PayrollRow;
  source: "prime" | "mini";
  signature: string | null;
}) {
  const due = payrollDue(row, source),
    amount = BigInt(due),
    paid = BigInt(row[`${source}_paid`]),
    name = source === "prime" ? "Прайм" : "Мини РБ";
  const displayed = amount === 0n && paid > 0n ? paid : amount;
  return (
    <div
      className="salary-payment-cell"
      role="group"
      aria-label={`${row.nickname} · ${name}`}
    >
      <span className="salary-source-label caption">{name}</span>
      <strong title={`Точно: ${formatGold(String(displayed))} зол.`}>
        {displayed > 0n && displayed < 10000n
          ? "< 1"
          : formatSalaryGold(String(displayed))}{" "}
        зол.
      </strong>
      {amount === 0n ? (
        paid > 0n ? (
          <span className="badge green">
            <NavIcon name="check" /> Выплачено
          </span>
        ) : (
          <span className="caption">Нет начислений</span>
        )
      ) : (
        <>
          {paid > 0n && (
            <span className="caption">
              Доплата · ранее выплачено {formatSalaryGold(String(paid))} зол.
            </span>
          )}
          {signature && (
            <ActionForm
              action={paySalary}
              label={`Выплата ${name}`}
              className="salary-payout-form"
              revision={signature}
            >
              <input type="hidden" name="requestId" value={randomUUID()} />
              <input type="hidden" name="memberId" value={row.id} />
              <input
                type="hidden"
                name="source"
                value={source === "prime" ? "prime" : "mini_rb"}
              />
              <input type="hidden" name="signature" value={signature} />
              <input type="hidden" name="confirm" value="on" />
            </ActionForm>
          )}
        </>
      )}
    </div>
  );
}
export default async function Page() {
  await requirePermission("treasury.pay");
  await requirePermission("treasury.allocate");
  const result = await historyPayroll()
    .then((data) => ({ data, error: false }))
    .catch(() => ({ data: null, error: true }));
  const rows =
    result.data?.rows
      .filter((r) => r.eligible)
      .sort((a, b) => a.nickname.localeCompare(b.nickname, "ru")) ?? [];
  return (
    <GuildShell current="/payments">
      <div className="page-heading">
        <Link href="/payments" className="text-button">
          ← Выплаты
        </Link>
        <h1>Выплата ЗП</h1>
        <p className="muted">
          Участники с общей посещаемостью от 20% по текущим неархивированным
          активностям.
        </p>
      </div>
      <p className="notice salary-payout-notice">
        Нажимайте кнопку после передачи золота игроку в игре. На сайте будет
        записана выплата и уменьшен остаток казны. Первая выплата фиксирует
        текущие начисления; новые продажи образуют доплату.
      </p>
      {result.error ? (
        <p className="notice error" role="alert">
          Расчёт зарплаты недоступен. Обновите страницу.
        </p>
      ) : (
        <section className="panel section-panel">
          <div className="section-heading">
            <h2>Зарплата участников</h2>
            <span className="caption">Допущено: {rows.length}</span>
          </div>
          <p className="caption">
            Суммы показаны с округлением до целого золота. Точная сумма доступна
            при наведении; выплаты учитываются без округления.
          </p>
          {!rows.length ? (
            <p>Пока нет участников с посещаемостью от 20%.</p>
          ) : (
            <div
              className="table-wrap salary-payout-wrap"
              tabIndex={0}
              role="region"
              aria-label="Зарплата участников"
            >
              <table className="salary-payout-table">
                <thead>
                  <tr>
                    <th>Игрок</th>
                    <th>Посещаемость · коэффициент</th>
                    <th>Прайм</th>
                    <th>Мини РБ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <th scope="row">{row.nickname}</th>
                      <td>
                        <div>
                          Прайм:{" "}
                          {attendanceLabel(
                            row.prime_percentage,
                            row.prime_present,
                            row.prime_total,
                          )}
                        </div>
                        <div>
                          Мини РБ:{" "}
                          {attendanceLabel(
                            row.mini_percentage,
                            row.mini_present,
                            row.mini_total,
                          )}
                        </div>
                        <p className="caption">
                          Коэффициент: {row.payout_weight / 100}
                        </p>
                      </td>
                      <td>
                        <SourcePayment
                          row={row}
                          source="prime"
                          signature={result.data!.signature}
                        />
                      </td>
                      <td>
                        <SourcePayment
                          row={row}
                          source="mini"
                          signature={result.data!.signature}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </GuildShell>
  );
}
