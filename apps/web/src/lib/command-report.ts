import "server-only";
import { requireMember } from "@/lib/access";
import { GUILD_ID } from "@/lib/config";
import { dashboardPeriod, type DashboardReport } from "@/lib/dashboard";
import {
  summarizeAttendance,
  type AttendanceFact,
} from "@/lib/command-analytics";
export async function loadCommandReport(
  params: Record<string, string | string[] | undefined>,
) {
  const access = await requireMember(),
    range = dashboardPeriod({
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
  const response = await access.client.rpc("dashboard_report", {
    p_from: range.from + "T00:00:00.000Z",
    p_until: range.until,
  });
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
  const facts: AttendanceFact[] = [];
  let weightedSchema = true;
  type RawFact = {
    membership_id: string;
    mark: string | null;
    events: AttendanceFact["event"] | AttendanceFact["event"][];
  };
  const loadPage = async (offset: number, weights: boolean) => {
    const selection = weights
      ? "membership_id,mark,events!inner(id,title,kind,starts_at,status,counts_for_attendance,attendance_finalized_at,boss_name,boss_weight)"
      : "membership_id,mark,events!inner(id,title,kind,starts_at,status,counts_for_attendance,attendance_finalized_at)";
    return (await access.client
      .from("attendance")
      .select(selection)
      .eq("guild_id", GUILD_ID)
      .eq("events.status", "completed")
      .eq("events.counts_for_attendance", true)
      .not("events.attendance_finalized_at", "is", null)
      .gte("events.starts_at", range.from + "T00:00:00.000Z")
      .lt("events.starts_at", range.until)
      .order("event_id")
      .order("membership_id")
      .range(offset, offset + 499)) as unknown as {
      data: RawFact[] | null;
      error: { code: string } | null;
    };
  };
  for (let offset = 0; offset < 100000; offset += 500) {
    let result = await loadPage(offset, weightedSchema);
    if (result.error?.code === "42703" && weightedSchema) {
      weightedSchema = false;
      result = await loadPage(offset, false);
    }
    if (result.error)
      return {
        access,
        range,
        category,
        summary: null,
        report,
        error:
          "Подробная посещаемость недоступна. Сводные показатели сохранены.",
      };
    for (const item of result.data ?? []) {
      const related = Array.isArray(item.events) ? item.events[0] : item.events;
      if (related)
        facts.push({
          membership_id: item.membership_id,
          mark: item.mark,
          event: {
            ...related,
            boss_name: related.boss_name ?? null,
            boss_weight: related.boss_weight ?? null,
          },
        } as AttendanceFact);
    }
    if ((result.data?.length ?? 0) < 500) break;
    if (offset === 99500)
      return {
        access,
        range,
        category,
        summary: null,
        report,
        error: "Уточните диапазон: отчёт превышает 100 000 отметок.",
      };
  }
  let members = [
    {
      id: access.membership!.id,
      nickname: access.membership!.nickname,
      character_class: null as string | null,
    },
  ];
  if (await access.permission("members.read")) {
    members = [];
    const ids = [...new Set(facts.map((f) => f.membership_id))];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await access.client
        .from("member_directory")
        .select("id,nickname,character_class")
        .eq("guild_id", GUILD_ID)
        .in("id", ids.slice(i, i + 200));
      if (error)
        return {
          access,
          range,
          category,
          summary: null,
          report,
          error: "Не удалось загрузить имена участников.",
        };
      members.push(...(data ?? []));
    }
  }
  return {
    access,
    range,
    category,
    summary: summarizeAttendance(facts, members, category),
    report,
    error: null,
  };
}
