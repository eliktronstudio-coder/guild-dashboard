import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { memberDatabase, readyForSaleFixture, guild } from "./support/database";
import type { LifetimePayrollReport } from "../src/lib/payroll";
async function setup() {
  const c = await memberDatabase();
  await c.db.exec("create role service_role");
  for (const f of (await readdir("supabase/migrations"))
    .sort()
    .filter((f) => f.endsWith(".sql") && f > "202610310002_members.sql"))
    await c.db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  await readyForSaleFixture(c.db);
  await c.as(1);
  async function event(
    date: string,
    title = "Анталлон",
    members = [c.members[2]],
  ) {
    const id = randomUUID();
    await c.db.query("select public.record_activity($1,$2::jsonb)", [
      id,
      JSON.stringify({
        title,
        starts_at: date,
        status: "completed",
        kind: "raid",
        source: title === "АГЛ" ? "mini_rb" : "prime",
        weight: 100,
        reward_units: null,
        difficulty: "normal",
        night: false,
        counts: true,
        members,
        guests: [],
        evidence: [],
        loot: [],
        facts: {},
      }),
    ]);
    return id;
  }
  const report = () =>
    c.scalar<LifetimePayrollReport>("select public.lifetime_payroll_report()");
  const archive = (id: string, from = "2026-11-01", through = "2026-11-02") =>
    c.scalar<number>("select public.archive_activities($1,$2,$3)", [
      id,
      from,
      through,
    ]);
  const journal = (archived = false) =>
    c.scalar<{ total: number; rows: { id: string }[] }>(
      "select public.activity_journal($1,$2,$3,1)",
      [
        "2026-11-01T00:00:00Z",
        "2026-12-01T00:00:00Z",
        JSON.stringify({ archive: archived ? "1" : "" }),
      ],
    );
  return { ...c, event, report, archive, journal };
}
test("archive excludes selected dates from current readers, retains details and restarts attendance", async () => {
  const c = await setup();
  try {
    const first = await c.event("2026-11-01T00:00:00Z"),
      second = await c.event("2026-11-02T23:59:59Z", "АГЛ");
    const later = await c.event("2026-11-03T00:00:00Z", "Анталлон", [
      c.members[3],
    ]);
    let r = await c.report();
    assert.equal(
      r.rows.find((r) => r.id === c.members[2])!.attendance_total,
      3,
    );
    const request = randomUUID();
    assert.equal(await c.archive(request), 2);
    assert.equal(await c.archive(request), 2);
    assert.equal((await c.journal()).total, 1);
    assert.deepEqual(
      new Set((await c.journal(true)).rows.map((r) => r.id)),
      new Set([first, second]),
    );
    r = await c.report();
    assert.equal(
      r.rows.find((r) => r.id === c.members[2])!.attendance_total,
      1,
    );
    assert.equal(r.rows.find((r) => r.id === c.members[2])!.percentage, 0);
    const snap = await c.scalar<{ events: { id: string }[] }>(
      "select public.command_attendance_data($1,$2)",
      ["2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"],
    );
    assert.deepEqual(
      snap.events.map((r) => r.id),
      [later],
    );
    const dash = await c.scalar<{ completed_events: number }>(
      "select public.dashboard_report($1,$2)",
      ["2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"],
    );
    assert.equal(dash.completed_events, 1);
    const detail = await c.scalar<{ event: { id: string } }>(
      "select public.activity_detail($1)",
      [first],
    );
    assert.equal(detail.event.id, first);
    await c.archive(randomUUID(), "2026-11-03", "2026-11-03");
    r = await c.report();
    assert.ok(r.rows.every((r) => r.attendance_total === 0 && !r.eligible));
    const counts = await c.db.query<{ attendance_total: number }>(
      "select attendance_total from public.all_time_attendance_report()",
    );
    assert.ok(counts.rows.every((r) => r.attendance_total === 0));
    await c.event("2026-11-04T12:00:00Z");
    r = await c.report();
    assert.equal(r.rows.find((r) => r.id === c.members[2])!.percentage, 100);
    assert.equal((await c.journal()).total, 1);
    await assert.rejects(
      c.archive(request, "2026-11-01", "2026-11-03"),
      /REQUEST_CONFLICT/,
    );
    await c.db.exec("reset role");
    assert.equal(
      await c.scalar<number>(
        "select (attendance_snapshot->0->>'total_count')::integer from public.activity_archives where id=$1",
        [request],
      ),
      2,
    );
    await assert.rejects(
      c.db.query(
        "update public.attendance set mark='absent' where event_id=$1",
        [first],
      ),
      /ACTIVITY_ARCHIVED/,
    );
    await assert.rejects(
      c.db.query("delete from public.activity_reports where event_id=$1", [
        first,
      ]),
      /ACTIVITY_ARCHIVED/,
    );
  } finally {
    await c.db.close();
  }
});
test("archive preserves stock, sales and paid money; authorization and invalid dates cannot bypass it", async () => {
  const c = await setup();
  try {
    await c.event("2026-11-01T12:00:00Z");
    const item = randomUUID(),
      receipt = randomUUID();
    await c.db.query(
      "select public.save_drop_registry($1,$2,0,'Предмет','',10000)",
      [guild, item],
    );
    await c.db.query(
      "select public.add_registry_inventory($1,null,$2,1,'prime',10000,2,'')",
      [receipt, item],
    );
    await c.db.query(
      "select public.sell_treasury_loot($1,$2,1,1,100000,'Продано')",
      [randomUUID(), receipt],
    );
    let r = await c.report();
    await c.db.query("select public.pay_lifetime_salary($1,$2,'prime',$3)", [
      randomUUID(),
      c.members[2],
      r.signature,
    ]);
    const before = await c.scalar("select public.treasury_lifetime_summary()"),
      payouts = await c.db.query(
        "select id,amount_units::text from public.treasury_payouts",
      );
    await c.as(2);
    await assert.rejects(c.archive(randomUUID()), /FORBIDDEN/);
    await assert.rejects(
      c.db.query("select attendance_snapshot from public.activity_archives"),
      /permission denied/,
    );
    await c.as(1);
    await assert.rejects(
      c.archive(randomUUID(), "2026-11-03", "2026-11-01"),
      /INVALID_PERIOD/,
    );
    await assert.rejects(
      c.archive(randomUUID(), "2099-01-01", "2099-01-02"),
      /INVALID_PERIOD/,
    );
    await assert.rejects(
      c.archive(randomUUID(), "2026-10-01", "2026-10-01"),
      /NO_ACTIVITIES/,
    );
    await c.archive(randomUUID());
    assert.deepEqual(
      await c.scalar("select public.treasury_lifetime_summary()"),
      before,
    );
    assert.deepEqual(
      (
        await c.db.query(
          "select id,amount_units::text from public.treasury_payouts",
        )
      ).rows,
      payouts.rows,
    );
    r = await c.report();
    assert.equal(
      r.rows.find((r) => r.id === c.members[2])!.prime_paid,
      "70000",
    );
    assert.equal(
      r.rows.find((r) => r.id === c.members[2])!.attendance_total,
      0,
    );
    await c.db.exec("reset role;set role anon");
    await assert.rejects(c.archive(randomUUID()), /permission denied/);
  } finally {
    await c.db.close();
  }
});

test("archive metadata can move a closed-period activity without changing its immutable financial archive", async () => {
  const c = await setup();
  try {
    const event = await c.event("2026-11-01T12:00:00Z");
    const preview = await c.scalar<{ signature: string }>(
      "select public.period_payroll_report($1)",
      ["2026-10-15"],
    );
    await c.db.query("select public.close_payroll_period($1,$2)", [
      "2026-10-15",
      preview.signature,
    ]);
    const before = await c.db.query(
      "select id,snapshot from public.period_archives",
    );
    assert.equal(await c.archive(randomUUID()), 1);
    assert.deepEqual(
      (await c.db.query("select id,snapshot from public.period_archives")).rows,
      before.rows,
    );
    assert.equal((await c.journal(true)).rows[0].id, event);
  } finally {
    await c.db.close();
  }
});

test("bulk archive has its own bounded timeout, keeps ACL and processes 218 activities atomically", async () => {
  const c = await setup();
  try {
    const configuration = await c.scalar<string[]>(
      "select proconfig from pg_proc where oid='public.archive_activities(uuid,date,date)'::regprocedure",
    );
    assert.ok(configuration.includes("statement_timeout=30s"));
    assert.ok(configuration.includes("lock_timeout=2s"));
    // Seed historical activities without calling the public mutation 218 times.
    await c.db.exec("reset role");
    await c.db.query(
      `insert into public.events(id,guild_id,title,starts_at,status,kind,organizer_id)
      select gen_random_uuid(),$1,'Анталлон','2026-11-01T12:00:00Z'::timestamptz,'completed','raid',$2 from generate_series(1,218)`,
      [guild, c.members[1]],
    );
    await c.as(1);
    const request = randomUUID();
    assert.equal(await c.archive(request), 218);
    assert.equal(await c.archive(request), 218);
    assert.equal((await c.journal()).total, 0);
    assert.equal((await c.journal(true)).total, 218);
    await c.as(3);
    await assert.rejects(c.archive(randomUUID()), /FORBIDDEN/);
  } finally {
    await c.db.close();
  }
});
