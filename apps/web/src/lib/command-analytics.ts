import {
  activityAttendanceWeight,
  resolveAttendanceFund,
} from "./activity-weights";
export type AttendanceFact = {
  membership_id: string;
  mark: string | null;
  event: {
    id: string;
    title: string;
    kind: string;
    starts_at: string;
    status: string;
    counts_for_attendance: boolean;
    attendance_finalized_at: string | null;
    boss_name: string | null;
    boss_weight: number | null;
  };
};
export type AnalyticsRow = {
  id: string;
  nickname: string;
  characterClass: string;
  present: number;
  available: number;
  percentage: number | null;
  prime: number | null;
  mini: number | null;
  pvp: number;
};
export function summarizeAttendance(
  facts: AttendanceFact[],
  members: { id: string; nickname: string; character_class?: string | null }[],
  category = "",
  now = new Date(),
) {
  const totals = new Map<
    string,
    {
      present: number;
      available: number;
      primePresent: number;
      primeAvailable: number;
      miniPresent: number;
      miniAvailable: number;
      pvp: number;
    }
  >();
  const seen = new Set<string>(),
    events = new Set<string>(),
    unique = new Set<string>();
  const daily = new Map<
    string,
    { label: string; prime: number; mini: number; pvp: number }
  >();
  for (const fact of facts) {
    const e = fact.event;
    if (
      e.status !== "completed" ||
      !e.counts_for_attendance ||
      !e.attendance_finalized_at ||
      new Date(e.starts_at) > now
    )
      continue;
    const mode = e.kind === "pvp" ? "PvP" : "PvE",
      fund = resolveAttendanceFund(e.boss_name || e.title, mode);
    if (category && category !== fund && category !== mode) continue;
    const key = e.id + ":" + fact.membership_id;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = totals.get(fact.membership_id) ?? {
      present: 0,
      available: 0,
      primePresent: 0,
      primeAvailable: 0,
      miniPresent: 0,
      miniAvailable: 0,
      pvp: 0,
    };
    if (fact.mark === "present" || fact.mark === "absent") {
      row.available++;
      const weight =
        e.boss_weight !== null
          ? e.boss_weight / 100
          : activityAttendanceWeight(e.boss_name || e.title, mode);
      if (fund === "Прайм") row.primeAvailable += weight;
      else row.miniAvailable++;
      events.add(e.id);
      if (fact.mark === "present") {
        row.present++;
        unique.add(fact.membership_id);
        if (fund === "Прайм") row.primePresent += weight;
        else row.miniPresent++;
        if (mode === "PvP") row.pvp++;
        const day = e.starts_at.slice(0, 10),
          d = daily.get(day) ?? { label: day, prime: 0, mini: 0, pvp: 0 };
        d[fund === "Прайм" ? "prime" : "mini"]++;
        if (mode === "PvP") d.pvp++;
        daily.set(day, d);
      }
    }
    totals.set(fact.membership_id, row);
  }
  const pct = (a: number, b: number) =>
    b ? Math.round((a / b) * 1000) / 10 : null;
  const rows: AnalyticsRow[] = members
    .filter((m) => totals.has(m.id))
    .map((m) => {
      const t = totals.get(m.id)!;
      return {
        id: m.id,
        nickname: m.nickname,
        characterClass: m.character_class || "Без роли",
        present: t.present,
        available: t.available,
        percentage: pct(t.present, t.available),
        prime: pct(t.primePresent, t.primeAvailable),
        mini: pct(t.miniPresent, t.miniAvailable),
        pvp: t.pvp,
      };
    });
  const participations = rows.reduce((sum, r) => sum + r.present, 0);
  return {
    rows,
    daily: [...daily.values()].sort((a, b) => a.label.localeCompare(b.label)),
    events: events.size,
    unique: unique.size,
    participations,
    average: events.size
      ? Math.round((participations / events.size) * 10) / 10
      : null,
  };
}
