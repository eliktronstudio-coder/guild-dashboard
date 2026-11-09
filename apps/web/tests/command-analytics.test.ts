import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeAttendance,
  type AttendanceFact,
} from "../src/lib/command-analytics";
import { dashboardPeriod } from "../src/lib/dashboard";
const event = {
  id: "event",
  title: "Разъярённый Левиафан",
  kind: "raid",
  starts_at: "2026-01-01T12:00:00Z",
  status: "completed",
  counts_for_attendance: true,
  attendance_finalized_at: "2026-01-01T13:00:00Z",
  boss_name: null,
  boss_weight: null,
};
const members = [
  { id: "a", nickname: "A", character_class: "Маг" },
  { id: "b", nickname: "B" },
];
const fact = (id: string, mark: string, e = event): AttendanceFact => ({
  membership_id: id,
  mark,
  event: e,
});
test("confirmed analytics excludes scheduled, cancelled, future, duplicate and excused marks", () => {
  const summary = summarizeAttendance(
    [
      fact("a", "present"),
      fact("a", "present"),
      fact("b", "absent"),
      fact("a", "present", { ...event, id: "future", starts_at: "2099-01-01" }),
      fact("a", "present", { ...event, id: "cancel", status: "cancelled" }),
      fact("a", "present", {
        ...event,
        id: "unconfirmed",
        attendance_finalized_at: "",
      }),
      fact("a", "excused", { ...event, id: "excused" }),
    ],
    members,
  );
  assert.equal(summary.events, 1);
  assert.equal(summary.unique, 1);
  assert.equal(summary.participations, 1);
  assert.equal(summary.rows[0].percentage, 100);
  assert.equal(summary.rows[1].percentage, 0);
});
test("weighted Prime and Mini attendance use the complete original category rules independently of finances", () => {
  const summary = summarizeAttendance(
    [
      fact("a", "present"),
      fact("a", "absent", { ...event, id: "light", title: "Кракен" }),
      fact("a", "present", { ...event, id: "mini", title: "АГЛ Т2" }),
      fact("a", "present", { ...event, id: "pvp", title: "АГЛ", kind: "pvp" }),
    ],
    members,
  );
  assert.equal(summary.rows[0].prime, 83.3);
  assert.equal(summary.rows[0].mini, 100);
  assert.equal(summary.rows[0].pvp, 1);
  assert.equal(summary.daily[0].prime, 2);
  assert.equal(summary.daily[0].mini, 1);
});
test("category filters select real facts without duplicating PvP into a new financial fund", () => {
  const data = [
    fact("a", "present"),
    fact("a", "present", { ...event, id: "mini", title: "АГЛ" }),
    fact("a", "present", { ...event, id: "pvp", kind: "pvp" }),
  ];
  assert.equal(summarizeAttendance(data, members, "Мини-РБ").events, 1);
  assert.equal(summarizeAttendance(data, members, "Прайм").events, 2);
  assert.equal(summarizeAttendance(data, members, "PvP").participations, 1);
  assert.equal(summarizeAttendance([], members).average, null);
});
test("accounting ranges span the 15th, year boundaries, prior periods and recent days", () => {
  const now = new Date("2026-01-08T10:00:00Z");
  assert.equal(dashboardPeriod({ period: "current" }, now).from, "2025-12-15");
  assert.equal(
    dashboardPeriod({ period: "current" }, now).until,
    "2026-01-15T00:00:00.000Z",
  );
  assert.equal(dashboardPeriod({ period: "previous" }, now).from, "2025-11-15");
  assert.equal(dashboardPeriod({ period: "7" }, now).from, "2026-01-02");
  assert.equal(dashboardPeriod({ period: "30" }, now).from, "2025-12-10");
});
