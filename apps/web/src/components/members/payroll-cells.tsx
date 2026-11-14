import { formatGold } from "@/lib/treasury";
import {
  attendanceLabel,
  payrollDue,
  type PayrollRow,
  type AttendanceSummary,
} from "@/lib/payroll";
export function AttendanceLines({ row }: { row?: AttendanceSummary }) {
  return (
    <div>
      <div>
        Прайм:{" "}
        {row
          ? attendanceLabel(
              row.prime_percentage,
              row.prime_present,
              row.prime_total,
            )
          : "—"}
      </div>
      {row?.prime_total != null && (
        <small>С коэффициентами · PvP: {row.pvp_present ?? 0} участий</small>
      )}
      <div>
        Мини РБ:{" "}
        {row
          ? attendanceLabel(
              row.mini_percentage,
              row.mini_present,
              row.mini_total,
            )
          : "—"}
      </div>
      <small>
        Общая:{" "}
        {row
          ? attendanceLabel(
              row.percentage,
              row.attendance_present,
              row.attendance_total,
            )
          : "—"}
      </small>
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
