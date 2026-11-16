import "server-only";
import { requireMember } from "@/lib/access";
import { historyRange, historyDashboard } from "./history-report";
import { PERIOD_CLOSING_ENABLED } from "@/lib/config";
import { dashboardPeriod, type DashboardReport } from "@/lib/dashboard";
import {
  summarizeAttendance,
  type AttendanceFact,
} from "@/lib/command-analytics";
export async function loadCommandReport(
  params: Record<string, string | string[] | undefined>,
) {
  const access = await requireMember(),
    range = !PERIOD_CLOSING_ENABLED
      ? await historyRange()
      : dashboardPeriod({
          ...params,
          period: typeof params.period === "string" ? params.period : "current",
        });
  const category =
    typeof params.category === "string" &&
    ["Прайм", "Мини-РБ", "PvE", "PvP"].includes(params.category)
      ? params.category
      : "";
  if (range.error)
    return {
      access,
      range,
      category,
      summary: null,
      report: null,
      error: range.error,
    };
  const attendanceSnapshot = access.client.rpc("command_attendance_data", {
    p_from: range.from + "T00:00:00.000Z",
    p_until: range.until,
  });
  const [response, canManageAttendance, snapshot] = await Promise.all([
    !PERIOD_CLOSING_ENABLED
      ? historyDashboard(range)
      : access.client.rpc("dashboard_report", {
          p_from: range.from + "T00:00:00.000Z",
          p_until: range.until,
        }),
    access.permission("attendance.manage"),
    attendanceSnapshot,
  ]);
  if (response.error)
    return {
      access,
      range,
      category,
      summary: null,
      report: null,
      error: "Не удалось загрузить сводку. Повторите попытку.",
    };
  const report = response.data as DashboardReport;
  if (snapshot.error || !snapshot.data)
    return {
      access,
      range,
      category,
      summary: null,
      report,
      error: "Подробная посещаемость недоступна. Сводные показатели сохранены.",
    };
  const payload = snapshot.data as {
    events: AttendanceFact["event"][];
    members: { id: string; nickname: string; character_class: string | null }[];
    marks: { event_id: string; membership_id: string; mark: string }[];
  };
  const catalog = payload.events.map((e) => ({
    ...e,
    boss_name: null,
    boss_weight: null,
  }));
  const byEvent = new Map(catalog.map((e) => [e.id, e]));
  const facts: AttendanceFact[] = payload.marks.flatMap((mark) => {
    const event = byEvent.get(mark.event_id);
    return event
      ? [{ membership_id: mark.membership_id, mark: mark.mark, event }]
      : [];
  });
  const members = payload.members;
  const summary = summarizeAttendance(
    facts,
    members,
    category,
    new Date(),
    catalog,
  );
  const own = summary.rows.find((r) => r.id === access.membership!.id);
  if (!PERIOD_CLOSING_ENABLED) {
    report.completed_events = summary.events;
    if (canManageAttendance) {
      report.attendance =
        summary.rows.length && summary.events
          ? Math.round(
              (summary.participations * 100) /
                (summary.rows.length * summary.events),
            )
          : 0;
      report.active_members = summary.unique;
    }
    report.own_attendance = own?.percentage ?? 0;
    report.own_present = own?.present ?? 0;
    report.own_total = own?.available ?? 0;
    report.own_prime_percentage = own?.prime ?? 0;
    report.own_mini_percentage = own?.mini ?? 0;
  }
  return {
    access,
    range,
    category,
    summary,
    personalSummary: summarizeAttendance(
      facts.filter((f) => f.membership_id === access.membership!.id),
      [
        {
          id: access.membership!.id,
          nickname: access.membership!.nickname,
          character_class: null,
        },
      ],
      category,
      new Date(),
      catalog,
    ),
    report,
    error: null,
  };
}
