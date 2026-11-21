import { formatGold } from "@/lib/treasury";
import { attendanceLabel, payrollDue, type PayrollReport } from "@/lib/payroll";
export function PeriodRoster({ report }: { report: PayrollReport }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Участник</th>
            <th>Прайм %</th>
            <th>Мини РБ %</th>
            <th>Общая %</th>
            <th>Коэффициент</th>
            <th>Прайм · начислено</th>
            <th>Мини РБ · начислено</th>
            <th>Всего</th>
            <th>Выплачено</th>
            <th>Осталось</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((r) => {
            const prime = BigInt(payrollDue(r, "prime")) + BigInt(r.prime_paid),
              mini = BigInt(payrollDue(r, "mini")) + BigInt(r.mini_paid),
              paid = BigInt(r.prime_paid) + BigInt(r.mini_paid);
            return (
              <tr key={r.id}>
                <td>
                  {r.nickname}
                  {!r.eligible && (
                    <p className="caption">Новые начисления: нет допуска 20%</p>
                  )}
                </td>
                <td>
                  {attendanceLabel(
                    r.prime_percentage,
                    r.prime_present,
                    r.prime_total,
                  )}
                  {r.prime_total != null && (
                    <small className="block">
                      С коэффициентами · PvP: {r.pvp_present ?? 0} участий
                    </small>
                  )}
                </td>
                <td>
                  {attendanceLabel(
                    r.mini_percentage,
                    r.mini_present,
                    r.mini_total,
                  )}
                </td>
                <td>
                  {attendanceLabel(
                    r.percentage,
                    r.attendance_present,
                    r.attendance_total,
                  )}
                </td>
                <td>{r.payout_weight / 100}</td>
                <td>{formatGold(String(prime))}</td>
                <td>{formatGold(String(mini))}</td>
                <td>{formatGold(String(prime + mini))}</td>
                <td>{formatGold(String(paid))}</td>
                <td>{formatGold(String(prime + mini - paid))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
