import { formatGold } from "@/lib/treasury";
import {
  attendanceLabel,
  payrollDue,
  type PayrollRow,
  type AttendanceSummary,
} from "@/lib/payroll";
export function AttendanceLines({ row }: { row?: AttendanceSummary }) {
  const items = [
    {
      label: "Прайм",
      value: row?.prime_percentage,
      present: row?.prime_present,
      total: row?.prime_total,
    },
    {
      label: "Мини РБ",
      value: row?.mini_percentage,
      present: row?.mini_present,
      total: row?.mini_total,
    },
    {
      label: "Общая",
      value: row?.percentage,
      present: row?.attendance_present,
      total: row?.attendance_total,
    },
  ];
  return (
    <div className="attendance-cell">
      {items.map((item) => (
        <div className="attendance-cell-row" key={item.label}>
          <div className="attendance-cell-label">
            <span>{item.label}</span>
            <strong>{item.value == null ? "—" : `${item.value}%`}</strong>
          </div>
          <div
            className="attendance-track"
            role="progressbar"
            aria-label={`Посещаемость: ${item.label}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={item.value ?? undefined}
            aria-valuetext={
              item.value == null
                ? "Нет данных"
                : attendanceLabel(item.value, item.present, item.total)
            }
          >
            <span
              style={{
                width: `${Math.max(0, Math.min(100, item.value ?? 0))}%`,
              }}
            />
          </div>
          {item.present != null && item.total != null && (
            <small>
              {item.present} из {item.total}
            </small>
          )}
        </div>
      ))}
      <small className="caption">
        Прайм — с коэффициентами · PvP:{" "}
        {row
          ? attendanceLabel(row.pvp_percentage, row.pvp_present, row.pvp_total)
          : "—"}
      </small>
    </div>
  );
}
export function SalaryLines({ row }: { row?: PayrollRow }) {
  if (!row) return <span className="muted">Нет расчёта</span>;
  const prime = payrollDue(row, "prime"),
    mini = payrollDue(row, "mini"),
    total = String(BigInt(prime) + BigInt(mini));
  return (
    <div className="salary-cell">
      <div>
        <span>Прайм</span>
        <strong>
          {formatGold(prime)} <small>зол.</small>
        </strong>
      </div>
      <div>
        <span>Мини РБ</span>
        <strong>
          {formatGold(mini)} <small>зол.</small>
        </strong>
      </div>
      <div className="salary-total">
        <span>Всего</span>
        <strong>
          {formatGold(total)} <small>зол.</small>
        </strong>
      </div>
      <small className="caption">
        {row.eligible
          ? `Коэффициент: ${row.payout_weight / 100}`
          : "Общая посещаемость ниже 20% или нет данных"}
      </small>
      {BigInt(row.prime_fixed) + BigInt(row.mini_fixed) > 0n && (
        <small className="caption">Включая зафиксированные начисления</small>
      )}
    </div>
  );
}
