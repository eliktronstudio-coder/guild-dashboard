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
  const [response, canManageAttendance] = await Promise.all([
    access.client.rpc("dashboard_report", {
      p_from: range.from + "T00:00:00.000Z",
      p_until: range.until,
    }),
    access.permission("attendance.manage"),
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
  const facts: AttendanceFact[] = [];
  const selection =
    "id,title,kind,starts_at,status,counts_for_attendance,attendance_finalized_at,treasury_source,activity_weight,activity_banner_name,deleted_at,inventory_receipt";
  const catalog: AttendanceFact["event"][] = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    const { data, error } = await access.client
      .from("events")
      .select(selection)
      .eq("guild_id", GUILD_ID)
      .eq("status", "completed")
      .eq("counts_for_attendance", true)
      .eq("inventory_receipt", false)
      .is("deleted_at", null)
      .gte("starts_at", range.from + "T00:00:00.000Z")
      .lt("starts_at", range.until)
      .lte("starts_at", new Date().toISOString())
      .order("id")
      .range(offset, offset + 499);
    if (error || (offset === 9500 && (data?.length ?? 0) >= 500))
      return {
        access,
        range,
        category,
        summary: null,
        report,
        error:
          "Не удалось загрузить полный список активностей. Уточните период или повторите попытку.",
      };
    catalog.push(
      ...((data ?? []).map((e) => ({
        ...e,
        boss_name: null,
        boss_weight: null,
      })) as AttendanceFact["event"][]),
    );
    if ((data?.length ?? 0) < 500) break;
  }
  type RawFact = {
    membership_id: string;
    mark: string | null;
    events: AttendanceFact["event"] | AttendanceFact["event"][];
  };
  const loadPage = async (offset: number) =>
    (await access.client
      .from("attendance")
      .select("membership_id,mark,events!inner(" + selection + ")")
      .eq("guild_id", GUILD_ID)
      .eq("events.status", "completed")
      .eq("events.counts_for_attendance", true)
      .eq("events.inventory_receipt", false)
      .is("events.deleted_at", null)
      .gte("events.starts_at", range.from + "T00:00:00.000Z")
      .lt("events.starts_at", range.until)
      .order("event_id")
      .order("membership_id")
      .range(offset, offset + 499)) as unknown as {
      data: RawFact[] | null;
      error: { code: string } | null;
    };
  for (let offset = 0; offset < 100000; offset += 500) {
    const result = await loadPage(offset);
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
  if (canManageAttendance) {
    members = [];
    for (let offset = 0; offset < 10000; offset += 500) {
      const { data, error } = await access.client
        .from("member_directory")
        .select("id,nickname,character_class")
        .eq("guild_id", GUILD_ID)
        .eq("status", "active")
        .order("id")
        .range(offset, offset + 499);
      if (error || (offset === 9500 && (data?.length ?? 0) >= 500))
        return {
          access,
          range,
          category,
          summary: null,
          report,
          error: "Не удалось загрузить полный состав гильдии.",
        };
      members.push(...(data ?? []));
      if ((data?.length ?? 0) < 500) break;
    }
  }
  return {
    access,
    range,
    category,
    summary: summarizeAttendance(facts, members, category, new Date(), catalog),
    report,
    error: null,
  };
}
