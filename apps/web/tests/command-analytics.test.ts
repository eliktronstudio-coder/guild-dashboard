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
test("saved analytics counts every completed event once, including missing marks, without a manual confirmation gate", () => {
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
  assert.equal(summary.events, 3);
  assert.equal(summary.unique, 1);
  assert.equal(summary.participations, 2);
  assert.equal(summary.rows[0].percentage, 67);
  assert.equal(summary.rows[1].percentage, 0);
});
test("Prime and Mini use saved coefficients; PvP is included in Prime", () => {
  const summary = summarizeAttendance(
    [
      fact("a", "present"),
      fact("a", "absent", { ...event, id: "light", title: "Кракен" }),
      fact("a", "present", { ...event, id: "mini", title: "АГЛ Т2" }),
      fact("a", "present", { ...event, id: "pvp", title: "АГЛ", kind: "pvp" }),
    ],
    members,
  );
  assert.equal(summary.rows[0].prime, 83);
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

test("event catalog supplies the full denominator even when players have no absence records", () => {
  const events = Array.from({ length: 10 }, (_, i) => ({
    ...event,
    id: "event" + i,
    title: i < 6 ? "Кракен" : "АГЛ",
    treasury_source: i < 6 ? "prime" : "mini_rb",
    activity_weight: i < 5 ? 50 : 150,
  }));
  const summary = summarizeAttendance(
    events.slice(0, 5).map((e) => fact("a", "present", e)),
    members,
    "",
    new Date(),
    events,
  );
  assert.equal(summary.rows[0].percentage, 50);
  assert.equal(summary.rows[0].available, 10);
  assert.equal(summary.rows[1].percentage, 0);
  assert.equal(summary.rows[0].prime, 63);
  assert.equal(summary.rows[0].mini, 0);
});

test("matches the Claude Code reference: weights 1.5 and 0.5 produce Prime 75/25 and overall 50/50", () => {
  const heavy = {
    ...event,
    id: "heavy",
    title: "Разъярённый Левиафан Т1",
    activity_weight: 150,
    treasury_source: "mini_rb",
  };
  const light = {
    ...event,
    id: "light",
    title: "Жук",
    activity_weight: 50,
    treasury_source: "mini_rb",
  };
  const summary = summarizeAttendance(
    [fact("a", "present", heavy), fact("b", "present", light)],
    members,
    "",
    new Date(),
    [heavy, light],
  );
  assert.equal(summary.rows[0].prime, 75);
  assert.equal(summary.rows[1].prime, 25);
  assert.equal(summary.rows[0].percentage, 50);
  assert.equal(summary.rows[1].percentage, 50);
  assert.equal(summary.rows[0].mini, 0);
  assert.equal(summary.rows[1].mini, 0);
});

test("Mini weights differ from event counts and deduplicate attendance", () => {
  const catalog = [50, 100, 150].map((weight, i) => ({
    ...event,
    id: "mini-weight-" + i,
    title: "АГЛ",
    activity_weight: weight,
  }));
  const marks = [
    { membership_id: "a", mark: "present", event: catalog[0] },
    { membership_id: "a", mark: "present", event: catalog[0] },
    { membership_id: "b", mark: "present", event: catalog[1] },
    { membership_id: "b", mark: "present", event: catalog[2] },
  ];
  const rows = summarizeAttendance(
    marks,
    members,
    "",
    new Date(),
    catalog,
  ).rows;
  assert.equal(rows[0].mini, 17);
  assert.equal(rows[0].miniPresent, 1);
  assert.equal(rows[0].miniAvailable, 3);
  assert.equal(rows[1].mini, 83);
  assert.equal(rows[1].miniPresent, 2);
});

test("weighted display rounds exact half-percent like PostgreSQL", () => {
  const catalog = [29, 171].map((weight, i) => ({
    ...event,
    id: "round-" + i,
    title: "АГЛ",
    activity_weight: weight,
  }));
  const row = summarizeAttendance(
    [{ membership_id: "a", mark: "present", event: catalog[0] }],
    members,
    "",
    new Date(),
    catalog,
  ).rows[0];
  assert.equal(row.mini, 15);
});
