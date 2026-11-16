import "server-only";
import { cache } from "react";
import { requireMember } from "./access";
import { GUILD_ID } from "./config";
import {
  combineHistoryPayroll,
  historyMonths,
  type HistoricalAttendance,
} from "./history-payroll";
import type { DashboardPeriod, DashboardReport } from "./dashboard";
export const historyRange = cache(async (): Promise<DashboardPeriod> => {
  const a = await requireMember();
  const { data, error } = await a.client
    .from("events")
    .select("starts_at")
    .eq("guild_id", GUILD_ID)
    .is("deleted_at", null)
    .eq("inventory_receipt", false)
    .lte("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(1);
  if (error)
    throw new Error("Не удалось загрузить начало истории активностей.");
  const today = new Date().toISOString().slice(0, 10);
  return {
    period: "all",
    from: data?.[0]?.starts_at.slice(0, 10) ?? today,
    to: today,
    until: new Date(
      new Date(today + "T00:00:00Z").getTime() + 86400000,
    ).toISOString(),
  };
});
export const historyAttendance = cache(async () => {
  const a = await requireMember(),
    rows: HistoricalAttendance[] = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    const { data, error } = await a.client
      .rpc("all_time_attendance_report")
      .order("id")
      .range(offset, offset + 499);
    if (error || !data || (offset === 9500 && data.length >= 500))
      throw new Error("Посещаемость за всю историю временно недоступна.");
    rows.push(...(data as HistoricalAttendance[]));
    if (data.length < 500) break;
  }
  return rows;
});
export const historyPayroll = cache(async () => {
  const a = await requireMember(),
    range = await historyRange(),
    reports: import("./payroll").PayrollReport[] = [];
  const months = historyMonths(range.from);
  // Bounded concurrency and the existing authorized API; no service-role bypass.
  for (let i = 0; i < months.length; i += 2) {
    const results = await Promise.all(
      months
        .slice(i, i + 2)
        .map((p_from) => a.client.rpc("period_payroll_report", { p_from })),
    );
    for (const result of results) {
      if (result.error || !result.data)
        throw new Error("Не удалось загрузить полную историю посещаемости.");
      reports.push(result.data as import("./payroll").PayrollReport);
    }
  }
  return combineHistoryPayroll(reports, await historyAttendance());
});
export async function historyDashboard(range: DashboardPeriod) {
  const a = await requireMember();
  let from = range.from + "T00:00:00.000Z";
  const reports: DashboardReport[] = [];
  while (from < range.until) {
    const until = new Date(
      Math.min(Date.parse(from) + 365 * 86400000, Date.parse(range.until)),
    ).toISOString();
    const { data, error } = await a.client.rpc("dashboard_report", {
      p_from: from,
      p_until: until,
    });
    if (error || !data)
      return { data: null, error: error ?? new Error("INCOMPLETE_HISTORY") };
    reports.push(data as DashboardReport);
    from = until;
  }
  const first = reports[0],
    last = reports.at(-1)!;
  const finance = last.finance && {
    ...last.finance,
    opening_units: first.finance?.opening_units ?? "0",
    sales_units: String(
      reports.reduce((n, r) => n + BigInt(r.finance?.sales_units ?? "0"), 0n),
    ),
    reversed_units: String(
      reports.reduce(
        (n, r) => n + BigInt(r.finance?.reversed_units ?? "0"),
        0n,
      ),
    ),
    weeks: reports.flatMap((r) => r.finance?.weeks ?? []),
  };
  return {
    error: null,
    data: {
      ...last,
      finance,
      weeks: reports.flatMap((r) => r.weeks),
      own_earned_units: String(
        reports.reduce((n, r) => n + BigInt(r.own_earned_units), 0n),
      ),
    },
  };
}
