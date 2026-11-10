import { randomUUID } from "node:crypto";
import { requireMember } from "@/lib/access";
import { dashboardPeriod } from "@/lib/dashboard";
import { formatGold } from "@/lib/treasury";
import {
  payrollDue,
  attendancePercent,
  type PayrollReport,
} from "@/lib/payroll";
import { ActionForm } from "@/components/action-form";
import { payPeriodMember } from "@/app/treasury/payroll-actions";
export async function PeriodPayroll() {
  const a = await requireMember(),
    range = dashboardPeriod({ period: "current" });
  const { data, error } = await a.client.rpc("period_payroll_report", {
    p_from: range.from,
  });
  if (error) return <p role="alert">Расчёт зарплаты временно недоступен.</p>;
  const report = data as PayrollReport;
  const pay = await a.permission("treasury.pay"),
    allocate = await a.permission("treasury.allocate");
  return (
    <section className="panel section-panel" id="period-payroll">
      <h2>
        Зарплата: {report.from} → {report.until}
      </h2>
      <p>
        Общая посещаемость от 20% по завершённым активностям с сохранённым
        составом. Доля = вес посещённых активностей × коэффициент участника.
        Прайм: 70% выручки, Мини РБ: 100%. Продажи относятся к периоду по дате
        продажи (UTC).
      </p>
      <p>
        До первой выплаты доли пересчитываются после каждой продажи и изменения
        состава. При выплате распределение текущей выручки фиксируется для всех
        получателей. Новые продажи образуют новую пересчитываемую часть;
        проведённые выплаты сохраняются.
      </p>
      <p className="caption">
        Суммы обновляются при загрузке страницы. «Записать выплату» используется
        после передачи золота в игре.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Игрок</th>
              <th>Общая посещаемость</th>
              <th>Коэффициент</th>
              <th>Прайм — к выплате</th>
              <th>Мини РБ — к выплате</th>
              <th>Выплачено</th>
            </tr>
          </thead>
          <tbody>
            {report.rows
              .filter(
                (r) =>
                  r.status === "active" ||
                  BigInt(payrollDue(r, "prime")) +
                    BigInt(payrollDue(r, "mini")) >
                    0n,
              )
              .map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.nickname}
                    {!row.eligible && (
                      <p className="caption">Новые начисления: 0</p>
                    )}
                  </td>
                  <td>{attendancePercent(row.percentage)}</td>
                  <td>{row.payout_weight / 100}</td>
                  {(["prime", "mini"] as const).map((source) => (
                    <td key={source}>
                      {formatGold(payrollDue(row, source))} зол.
                      {pay &&
                        allocate &&
                        report.signature &&
                        BigInt(payrollDue(row, source)) > 0n && (
                          <details>
                            <summary>Записать выплату</summary>
                            <ActionForm
                              action={payPeriodMember}
                              label="Подтвердить выплату"
                            >
                              <input
                                type="hidden"
                                name="requestId"
                                value={randomUUID()}
                              />
                              <input
                                type="hidden"
                                name="memberId"
                                value={row.id}
                              />
                              <input
                                type="hidden"
                                name="from"
                                value={range.from}
                              />
                              <input
                                type="hidden"
                                name="source"
                                value={source === "prime" ? "prime" : "mini_rb"}
                              />
                              <input
                                type="hidden"
                                name="signature"
                                value={report.signature}
                              />
                              <label>
                                Комментарий / подтверждение передачи
                                <textarea
                                  name="reference"
                                  required
                                  minLength={3}
                                  maxLength={500}
                                />
                              </label>
                              <label>
                                <input
                                  name="confirm"
                                  type="checkbox"
                                  required
                                />{" "}
                                Золото передано игроку. Зафиксировать текущий
                                расчёт для всех получателей.
                              </label>
                            </ActionForm>
                          </details>
                        )}
                    </td>
                  ))}
                  <td>
                    Прайм: {formatGold(row.prime_paid)}
                    <br />
                    Мини РБ: {formatGold(row.mini_paid)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
