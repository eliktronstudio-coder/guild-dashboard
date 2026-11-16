import { test } from "node:test";
import assert from "node:assert/strict";
import {
  combineHistoryPayroll,
  historyMonths,
  type HistoricalAttendance,
} from "../src/lib/history-payroll";
import type { PayrollReport, PayrollRow } from "../src/lib/payroll";
const attendance: HistoricalAttendance = {
  id: "a",
  nickname: "Player",
  status: "active",
  percentage: 50,
  prime_percentage: 25,
  mini_percentage: 50,
  pvp_percentage: 0,
  attendance_total: 10,
  attendance_present: 5,
  prime_total: 2,
  prime_present: 1,
  mini_total: 8,
  mini_present: 4,
  pvp_total: 0,
  pvp_present: 0,
  eligible: true,
  excused: 0,
  excluded: 0,
  absent: 5,
};
const report = (): PayrollReport => ({
  from: "2026-10-15",
  until: "2026-11-15",
  prime_units: "9007199254740993",
  mini_units: "0",
  signature: "old",
  rows: [
    {
      id: "a",
      nickname: "Player",
      status: "active",
      payout_weight: 100,
      available: "0",
      present: "0",
      percentage: 0,
      prime_percentage: 0,
      mini_percentage: 0,
      pvp_percentage: 0,
      eligible: false,
      prime_projection: "9007199254740993",
      mini_projection: "0",
      prime_fixed: "7",
      mini_fixed: "0",
      prime_paid: "3",
      mini_paid: "0",
    } satisfies PayrollRow,
  ],
});
test("unbounded attendance replaces empty current-period zeros while historical money and paid amounts remain exact", () => {
  const r = combineHistoryPayroll([report(), report()], [attendance]);
  assert.equal(r.rows[0].percentage, 50);
  assert.equal(r.rows[0].prime_percentage, 25);
  assert.equal(r.rows[0].attendance_total, 10);
  assert.equal(r.rows[0].attendance_present, 5);
  assert.equal(r.rows[0].prime_projection, "18014398509481986");
  assert.equal(r.rows[0].prime_fixed, "14");
  assert.equal(r.rows[0].prime_paid, "6");
  assert.equal(r.signature, null);
  assert.throws(() => combineHistoryPayroll([report()], []), /INCOMPLETE/);
});
test("historical financial partitions have no skipped month across year boundaries", () => {
  assert.deepEqual(
    historyMonths("2025-12-14", new Date("2026-02-16T00:00:00Z")),
    ["2025-11-15", "2025-12-15", "2026-01-15", "2026-02-15"],
  );
});
test("real all-time SQL API counts pre-15th raids, preserves weighted Prime, enforces own/member ACL and blocks anonymous or blocked callers", async () => {
  const { readFile, readdir } = await import("node:fs/promises"),
    { randomUUID } = await import("node:crypto"),
    { memberDatabase, readyForSaleFixture } =
      await import("./support/database"),
    { dashboardPeriod } = await import("../src/lib/dashboard");
  const c = await memberDatabase();
  try {
    await c.db.exec("create role service_role");
    for (const f of (await readdir("supabase/migrations"))
      .sort()
      .filter((f) => f.endsWith(".sql") && f > "202610310002_members.sql"))
      await c.db.exec(await readFile("supabase/migrations/" + f, "utf8"));
    await readyForSaleFixture(c.db);
    await c.as(1);
    const previous = dashboardPeriod({ period: "previous" }),
      current = dashboardPeriod({ period: "current" });
    async function raid(mini: boolean, i: number, weight = 100) {
      await c.db.query("select public.record_activity($1,$2::jsonb)", [
        randomUUID(),
        JSON.stringify({
          title: mini ? "АГЛ" : "Анталлон",
          starts_at: previous.from + "T12:00:00Z",
          status: "completed",
          kind: "raid",
          source: mini ? "mini_rb" : "prime",
          weight,
          reward_units: null,
          difficulty: "normal",
          night: false,
          counts: true,
          members: [c.members[i]],
          guests: [],
          evidence: [],
          loot: [],
          facts: {},
        }),
      ]);
    }
    for (let i = 0; i < 10; i++) await raid(true, i < 5 ? 2 : 3);
    let rows = (
      await c.db.query<HistoricalAttendance>(
        "select * from public.all_time_attendance_report()",
      )
    ).rows;
    let own = rows.find((r) => r.id === c.members[2])!;
    assert.equal(Number(own.percentage), 50);
    assert.equal(Number(own.attendance_total), 10);
    assert.equal(Number(own.mini_percentage), 50);
    const empty = await c.scalar<PayrollReport>(
      "select public.period_payroll_report($1)",
      [current.from],
    );
    assert.equal(
      Number(empty.rows.find((r) => r.id === c.members[2])!.percentage),
      0,
    );
    await raid(false, 2, 100);
    await raid(false, 3, 300);
    rows = (
      await c.db.query<HistoricalAttendance>(
        "select * from public.all_time_attendance_report()",
      )
    ).rows;
    own = rows.find((r) => r.id === c.members[2])!;
    assert.equal(Number(own.percentage), 50);
    assert.equal(Number(own.prime_percentage), 25);
    assert.equal(Number(own.attendance_total), 12);
    await c.db.exec(
      "reset role;delete from public.role_permissions where permission='members.read' and role_id in (select id from public.roles where code='member')",
    );
    await c.as(2);
    const restricted = await c.db.query<HistoricalAttendance>(
      "select * from public.all_time_attendance_report()",
    );
    assert.deepEqual(
      restricted.rows.map((r) => r.id),
      [c.members[2]],
    );
    await c.db.exec("reset role");
    await c.db.query(
      "update public.profiles set blocked=true where id=(select user_id from public.memberships where id=$1)",
      [c.members[2]],
    );
    await c.as(2);
    await assert.rejects(
      c.db.query("select * from public.all_time_attendance_report()"),
      /FORBIDDEN/,
    );
    await c.db.exec("reset role;set role anon");
    await assert.rejects(
      c.db.query("select * from public.all_time_attendance_report()"),
      /permission denied/,
    );
  } finally {
    await c.db.close();
  }
});
