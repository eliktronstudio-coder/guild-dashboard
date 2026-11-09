import { formatGold } from "@/lib/treasury";
import { attendancePercent, payrollDue, type PayrollRow } from "@/lib/payroll";
export function AttendanceLines({ row }: { row?: PayrollRow }) {
  return (
    <div>
      <div>Прайм: {row ? attendancePercent(row.prime_percentage) : "—"}</div>
      <div>Мини РБ: {row ? attendancePercent(row.mini_percentage) : "—"}</div>
      <div>PvP: {row ? attendancePercent(row.pvp_percentage) : "—"}</div>
      <small>Общая: {row ? attendancePercent(row.percentage) : "—"}</small>
    </div>
  );
}
export function SalaryLines({ row }: { row?: PayrollRow }) {
  if (!row) return <span>Нет расчёта</span>;
  return (
    <div>
      <div>Прайм: {formatGold(payrollDue(row, "prime"))} зол.</div>
      <div>Мини РБ: {formatGold(payrollDue(row, "mini"))} зол.</div>
      <small>
        {row.eligible
          ? `Коэффициент: ${row.payout_weight / 100}`
          : "Общая посещаемость ниже 20% или нет данных"}
      </small>
      {BigInt(row.prime_fixed) + BigInt(row.mini_fixed) > 0n && (
        <div className="caption">Включая зафиксированные начисления</div>
      )}
    </div>
  );
}
