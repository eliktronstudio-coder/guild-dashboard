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
    treasury_source?: string;
    deleted_at?: string | null;
    inventory_receipt?: boolean;
    boss_name: string | null;
    boss_weight: number | null;
    activity_weight?: number | null;
    activity_banner_name?: string | null;
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
  primePresent: number;
  primeAvailable: number;
  miniPresent: number;
  miniAvailable: number;
};

export function summarizeAttendance(
  facts: AttendanceFact[],
  members: { id: string; nickname: string; character_class?: string | null }[],
  category = "",
  now = new Date(),
  catalog: AttendanceFact["event"][] = facts.map((f) => f.event),
) {
  const nameOf = (e: AttendanceFact["event"]) =>
    e.activity_banner_name || e.boss_name || e.title;
  const fundOf = (e: AttendanceFact["event"]) =>
    resolveAttendanceFund(nameOf(e), e.kind === "pvp" ? "PvP" : "PvE");
  const weightOf = (e: AttendanceFact["event"]) =>
    e.activity_weight != null
      ? e.activity_weight / 100
      : e.boss_weight != null
        ? e.boss_weight / 100
        : activityAttendanceWeight(nameOf(e), e.kind === "pvp" ? "PvP" : "PvE");
  const events = new Map(
    catalog
      .filter(
        (e) =>
          e.status === "completed" &&
          e.counts_for_attendance &&
          !e.deleted_at &&
          !e.inventory_receipt &&
          new Date(e.starts_at) <= now &&
          (!category ||
            category === fundOf(e) ||
            category === (e.kind === "pvp" ? "PvP" : "PvE")),
      )
      .map((e) => [e.id, e]),
  );
  const primeAvailable = [...events.values()].filter(
      (e) => fundOf(e) === "Прайм",
    ).length,
    miniAvailable = events.size - primeAvailable;
  const primeWeight = [...events.values()]
    .filter((e) => fundOf(e) === "Прайм")
    .reduce((sum, e) => sum + weightOf(e), 0);
  const totals = new Map(
    members.map((m) => [
      m.id,
      { present: 0, primePresent: 0, miniPresent: 0, pvp: 0, primeWeight: 0 },
    ]),
  );
  const seen = new Set<string>(),
    unique = new Set<string>();
  const daily = new Map<
    string,
    { label: string; prime: number; mini: number; pvp: number }
  >();
  for (const fact of facts) {
    const e = events.get(fact.event.id),
      row = totals.get(fact.membership_id),
      key = fact.event.id + ":" + fact.membership_id;
    if (!e || !row || fact.mark !== "present" || seen.has(key)) continue;
    seen.add(key);
    row.present++;
    unique.add(fact.membership_id);
    const prime = fundOf(e) === "Прайм";
    if (prime) {
      row.primePresent++;
      row.primeWeight += weightOf(e);
    } else row.miniPresent++;
    if (e.kind === "pvp") row.pvp++;
    const day = e.starts_at.slice(0, 10),
      d = daily.get(day) ?? { label: day, prime: 0, mini: 0, pvp: 0 };
    d[prime ? "prime" : "mini"]++;
    if (e.kind === "pvp") d.pvp++;
    daily.set(day, d);
  }
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const rows: AnalyticsRow[] = members.map((m) => {
    const t = totals.get(m.id)!;
    return {
      id: m.id,
      nickname: m.nickname,
      characterClass: m.character_class || "Без роли",
      present: t.present,
      available: events.size,
      percentage: pct(t.present, events.size),
      prime: pct(t.primeWeight, primeWeight),
      mini: pct(t.miniPresent, miniAvailable),
      pvp: t.pvp,
      primePresent: t.primePresent,
      primeAvailable,
      miniPresent: t.miniPresent,
      miniAvailable,
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
