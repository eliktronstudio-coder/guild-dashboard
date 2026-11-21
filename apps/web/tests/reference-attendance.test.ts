import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { memberDatabase, guild } from "./support/database";
import { dashboardPeriod } from "../src/lib/dashboard";
import { resolveAttendanceFund } from "../src/lib/activity-weights";
import type { PayrollReport } from "../src/lib/payroll";

test("reference logic: overall 5/10 is 50%, Prime is weighted, Mini follows names, and registration does not erase absences", async () => {
  const c = await memberDatabase();
  const { db, as, members: m, scalar } = c;
  try {
    await db.exec("create role service_role");
    for (const f of (await readdir("supabase/migrations"))
      .sort()
      .filter(
        (f) =>
          f.endsWith(".sql") &&
          f > "202610310002_members.sql" &&
          !/^20261103001[78]/.test(f),
      ))
      await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
    const period = dashboardPeriod({ period: "current" }),
      when = new Date(Date.now() - 3600000).toISOString();
    await as(1);
    const events: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = randomUUID();
      events.push(id);
      await db.query("select public.record_activity($1,$2::jsonb)", [
        id,
        JSON.stringify({
          title: (i < 4 ? "Кракен " : "АГЛ ") + i,
          starts_at: when,
          status: "completed",
          kind: i === 4 || i === 5 ? "pvp" : "raid",
          source: i < 6 ? "mini_rb" : "prime",
          weight: i < 5 ? 50 : 150,
          reward_units: "0",
          difficulty: "normal",
          night: false,
          counts: true,
          members: [
            ...(i < 5 ? [m[1], m[2]] : [m[1]]),
            ...(i < 2 ? [m[4]] : []),
          ],
          guests: [],
          evidence: [],
          loot: [],
          facts: {},
        }),
      ]);
    }
    assert.equal(
      await scalar(
        "select count(*)::int from public.attendance where membership_id=$1",
        [m[2]],
      ),
      5,
    );
    assert.equal(
      await scalar(
        "select count(*)::int from public.attendance where membership_id=$1",
        [m[3]],
      ),
      0,
    );
    const from = period.from + "T00:00:00.000Z",
      until = period.until;
    const r = await scalar<any>(
      "select to_jsonb(r) from public.attendance_category_report($1,$2) r where membership_id=$3",
      [from, until, m[2]],
    );
    assert.equal(Number(r.percentage), 50);
    assert.equal(Number(r.total), 10);
    assert.equal(Number(r.prime_percentage), 63);
    assert.equal(Number(r.prime_total), 6);
    assert.equal(Number(r.prime_present), 5);
    assert.equal(Number(r.mini_percentage), 0);
    assert.equal(Number(r.mini_total), 4);
    assert.equal(Number(r.pvp_percentage), 50);
    const missing = await scalar<any>(
      "select to_jsonb(r) from public.attendance_category_report($1,$2) r where membership_id=$3",
      [from, until, m[3]],
    );
    assert.equal(Number(missing.percentage), 0);
    assert.equal(Number(missing.absent), 10);
    const payroll = await scalar<PayrollReport>(
      "select public.period_payroll_report($1)",
      [period.from],
    );
    const player = payroll.rows.find((r) => r.id === m[2])!;
    assert.equal(Number(player.percentage), 50);
    assert.equal(Number(player.prime_percentage), 63);
    assert.equal(player.attendance_total, 10);
    assert.equal(player.attendance_present, 5);
    assert.equal(player.prime_total, 6);
    assert.equal(player.mini_total, 4);
    assert.equal(player.eligible, true);
    const threshold = payroll.rows.find((r) => r.id === m[4])!;
    assert.equal(Number(threshold.percentage), 20);
    assert.equal(
      threshold.eligible,
      true,
      "two of ten qualifies even when weighted share is below 20%",
    );
    assert.equal(payroll.rows.find((r) => r.id === m[3])!.eligible, false);
    const rb = await scalar<any>("select public.rb_purchase_candidates($1)", [
      period.from,
    ]);
    assert.ok(!rb.participants.some((p: any) => p.id === m[2]));
    // User-facing legacy export and dashboard must use the same denominator.
    const old = await scalar<any>(
      "select to_jsonb(r) from public.attendance_report($1,$2) r where membership_id=$3",
      [from, until, m[2]],
    );
    assert.equal(Number(old.percentage), 50);
    await as(2);
    const dashboard = await scalar<any>(
      "select public.dashboard_report($1,$2)",
      [from, until],
    );
    assert.equal(Number(dashboard.own_attendance), 50);
    assert.equal(Number(dashboard.own_total), 10);
    const own = await db.query<any>(
      "select * from public.attendance_category_report($1,$2)",
      [from, until],
    );
    assert.equal(own.rows.length, 1);
    assert.equal(own.rows[0].membership_id, m[2]);
    await db.exec("reset role");
    for (const [name, kind] of [
      ["АГЛ", "raid"],
      ["АГЛ Т2", "raid"],
      ["Кошка (вечер)", "raid"],
      ["Кошка", "pvp"],
      ["багл", "raid"],
      ["Суперкошка", "raid"],
      ["АГЛ_Т2", "raid"],
      ["Фесаникс", "raid"],
    ]) {
      const category = await scalar<string>(
        "select private.attendance_bucket($1,$2)",
        [name, kind],
      );
      assert.equal(
        category,
        resolveAttendanceFund(name, kind === "pvp" ? "PvP" : "PvE") === "Прайм"
          ? "prime"
          : "mini_rb",
      );
    }
    await db.query("update public.events set deleted_at=now() where id=$1", [
      events[9],
    ]);
    await as(1);
    const after = await scalar<any>(
      "select to_jsonb(r) from public.attendance_category_report($1,$2) r where membership_id=$3",
      [from, until, m[2]],
    );
    assert.equal(Number(after.total), 9);
    assert.equal(Number(after.percentage), 56);
  } finally {
    await db.close();
  }
});
