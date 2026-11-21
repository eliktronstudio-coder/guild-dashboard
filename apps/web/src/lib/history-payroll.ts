import type { AttendanceSummary, PayrollReport, PayrollRow } from "./payroll";
export type HistoricalAttendance = AttendanceSummary & {
  id: string;
  nickname: string;
  status: string;
  eligible: boolean;
  excused: number;
  excluded: number;
  absent: number;
};
/** Attendance comes from unbounded source counts. Existing monetary obligations
 * are added as exact integers; this does not reallocate or reverse paid gold. */
export function combineHistoryPayroll(
  reports: PayrollReport[],
  attendance: HistoricalAttendance[],
): PayrollReport {
  if (!reports.length) throw new Error("EMPTY_HISTORY");
  const entries = new Map<string, PayrollRow>();
  const money = [
    "prime_projection",
    "mini_projection",
    "prime_fixed",
    "mini_fixed",
    "prime_paid",
    "mini_paid",
  ] as const;
  for (const report of reports)
    for (const row of report.rows) {
      const previous = entries.get(row.id),
        next = { ...row };
      if (previous)
        for (const key of money)
          next[key] = String(BigInt(previous[key]) + BigInt(row[key]));
      entries.set(row.id, next);
    }
  const rows = [...entries.values()].map((row) => {
    const counts = attendance.find((a) => a.id === row.id);
    if (!counts) throw new Error("INCOMPLETE_ATTENDANCE_HISTORY");
    return { ...row, ...counts };
  });
  return {
    from: reports[0].from,
    until: reports.at(-1)!.until,
    signature: null,
    prime_units: String(
      reports.reduce((n, r) => n + BigInt(r.prime_units), 0n),
    ),
    mini_units: String(reports.reduce((n, r) => n + BigInt(r.mini_units), 0n)),
    rows,
  };
}
export function historyMonths(from: string, now = new Date()) {
  const first = new Date(from + "T00:00:00Z");
  if (
    !Number.isFinite(first.getTime()) ||
    first < new Date("2020-01-15T00:00:00Z") ||
    first > now
  )
    throw new Error("INVALID_HISTORY_START");
  const month = new Date(
      Date.UTC(
        first.getUTCFullYear(),
        first.getUTCMonth() - (first.getUTCDate() < 15 ? 1 : 0),
        15,
      ),
    ),
    result: string[] = [];
  while (month <= now) {
    result.push(month.toISOString().slice(0, 10));
    month.setUTCMonth(month.getUTCMonth() + 1);
  }
  return result;
}
