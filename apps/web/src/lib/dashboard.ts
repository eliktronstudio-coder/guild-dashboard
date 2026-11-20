import type { TreasuryTotals } from "./treasury";
export type DashboardPeriod = {
  period: string;
  from: string;
  to: string;
  until: string;
  error?: string;
};
const DAY = 86400000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
function dateValue(value: string | undefined): Date | null {
  if (!value || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(d.getTime()) && iso(d) === value ? d : null;
}
export function dashboardPeriod(
  params: Record<string, string | string[] | undefined>,
  now = new Date(),
): DashboardPeriod {
  const value = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : undefined;
  const period = value("period") ?? "month";
  const today = new Date(iso(now) + "T00:00:00.000Z");
  let start = new Date(today),
    end = new Date(today);
  if (period === "current" || period === "previous") {
    start = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth() - (today.getUTCDate() < 15 ? 1 : 0),
        15,
      ),
    );
    if (period === "previous") start.setUTCMonth(start.getUTCMonth() - 1);
    end = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 15) - DAY,
    );
  } else if (period === "7" || period === "30")
    start.setUTCDate(start.getUTCDate() - Number(period) + 1);
  else if (period === "week")
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  else if (period === "month") start.setUTCDate(1);
  else if (period === "custom") {
    const from = dateValue(value("from")),
      to = dateValue(value("to"));
    if (!from || !to || to < from || to.getTime() - from.getTime() >= 366 * DAY)
      return {
        period,
        from: value("from") ?? "",
        to: value("to") ?? "",
        until: "",
        error: "Укажите корректные даты: от 1 до 366 дней включительно.",
      };
    start = from;
    end = to;
  } else
    return {
      period: period === "season" ? "season" : "month",
      from: "",
      to: "",
      until: "",
      error:
        period === "season"
          ? "Даты сезона пока не заданы. Выберите другой период."
          : "Выберите неделю, месяц или свои даты.",
    };
  return {
    period,
    from: iso(start),
    to: iso(end),
    until: new Date(end.getTime() + DAY).toISOString(),
  };
}
/** Convert only the bounded drawing coordinate to Number; money stays integer-exact. */
export function barWidth(value: string, max: string): number {
  const n = BigInt(value),
    limit = BigInt(max);
  if (n <= 0n || limit <= 0n) return 0;
  return Number(((n > limit ? limit : n) * 10000n) / limit) / 100;
}
export const dashboardDate = (value: string) =>
  new Date(value).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
export type DashboardReport = {
  members: number | null;
  pending_applications: number | null;
  active_members: number;
  completed_events: number;
  attendance: number | null;
  own_attendance: number | null;
  own_present: number;
  own_total?: number;
  own_prime_percentage?: number | null;
  own_mini_percentage?: number | null;
  own_finance: {
    allocated_units: string;
    paid_units: string;
    pending_units: string;
  };
  own_earned_units: string;
  upcoming: { id: string; title: string; starts_at: string }[];
  weeks: {
    from: string;
    until: string;
    active: number;
    attendance: number | null;
  }[];
  ranking:
    | {
        membership_id: string;
        nickname: string;
        present: number;
        percentage: number | null;
      }[]
    | null;
  finance: null | {
    current: TreasuryTotals;
    sales_units: string;
    reversed_units: string;
    opening_units: string;
    weeks: {
      from: string;
      until: string;
      sales_units: string;
      reversed_units: string;
      balance_units: string;
    }[];
  };
};
