import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { memberDatabase, readyForSaleFixture, guild } from "./support/database";
import type { PayrollReport } from "../src/lib/payroll";
import { payrollDue } from "../src/lib/payroll";
import { dashboardPeriod } from "../src/lib/dashboard";
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=";
async function setup(optional = false) {
  const ctx = await memberDatabase();
  await ctx.db.exec("create role service_role");
  for (const file of (await readdir("supabase/migrations"))
    .sort()
    .filter(
      (f) =>
        f.endsWith(".sql") &&
        f > "202610310002_members.sql" &&
        (optional || !/^20261103001[78]/.test(f)),
    ))
    await ctx.db.exec(await readFile("supabase/migrations/" + file, "utf8"));
  await readyForSaleFixture(ctx.db);
  await ctx.db.exec("update public.memberships set joined_at='2020-01-01'");
  const period = dashboardPeriod({ period: "current" });
  async function event(present: string[], source = "prime", kind = "raid") {
    const id = randomUUID();
    await ctx.as(1);
    await ctx.db.query("select public.record_activity($1,$2::jsonb)", [
      id,
      JSON.stringify({
        title: "Тестовая активность",
        starts_at: new Date(Date.now() - 3600000).toISOString(),
        status: "completed",
        kind,
        source,
        weight: 100,
        reward_units: null,
        difficulty: "normal",
        night: false,
        counts: true,
        members: present,
        confirm_roster: true,
        guests: [],
        evidence: [],
        loot: [],
        facts: {},
      }),
    ]);
    return id;
  }
  async function sale(source = "prime", amount = 10000) {
    await ctx.as(1);
    const item = randomUUID(),
      request = randomUUID(),
      sale = randomUUID();
    await ctx.db.query(
      "select public.save_drop_registry($1,$2,0,$3,'',10000)",
      [guild, item, "Предмет " + item],
    );
    await ctx.db.query(
      "select public.add_registry_inventory($1,null,$2,1,$3,10000,1,'')",
      [request, item, source],
    );
    await ctx.db.query(
      "select public.sell_treasury_loot($1,$2,1,1,$3,'Продажа для расчёта')",
      [sale, request, amount],
    );
    return { sale, loot: request };
  }
  const report = () =>
    ctx.scalar<PayrollReport>("select public.period_payroll_report($1)", [
      period.from,
    ]);
  return { ...ctx, period, event, sale, report };
}
test("period payroll: 20% threshold, exact redistribution, coefficients, both funds, frozen payouts and retry", async () => {
  const c = await setup();
  const { db, members: m } = c;
  try {
    await c.as(1);
    await db.query("select public.set_member_weight($1,1,125)", [m[1]]);
    for (let i = 0; i < 6; i++)
      await c.event(
        i === 0 ? [m[1], m[2]] : [m[1]],
        i === 5 ? "mini_rb" : "prime",
        i === 4 ? "pvp" : "raid",
      );
    const sales = [await c.sale(), await c.sale("mini_rb", 10001)];
    let r = await c.report();
    let owner = r.rows.find((x) => x.id === m[1])!,
      member = r.rows.find((x) => x.id === m[2])!;
    assert.equal(member.eligible, false);
    assert.equal(member.percentage, 17);
    assert.equal(member.prime_projection, "0");
    assert.equal(owner.prime_projection, "7000");
    assert.equal(owner.mini_projection, "10001");
    assert.equal(owner.pvp_percentage, 100);
    const claimEvent = await c.event([m[1], m[2]]);
    r = await c.report();
    member = r.rows.find((x) => x.id === m[2])!;
    owner = r.rows.find((x) => x.id === m[1])!;
    assert.equal(member.eligible, true);
    assert.equal(member.percentage, 29);
    assert.ok(BigInt(member.prime_projection) > 0n);
    assert.ok(BigInt(owner.prime_projection) < 7000n);
    assert.equal(
      r.rows.reduce((sum, x) => sum + BigInt(x.prime_projection), 0n),
      7000n,
    );
    assert.equal(
      r.rows.reduce((sum, x) => sum + BigInt(x.mini_projection), 0n),
      10001n,
    );
    assert.ok(
      BigInt(owner.prime_projection) > BigInt(member.prime_projection) * 4n,
    );
    const request = randomUUID();
    const signature = r.signature;
    const expected = payrollDue(member, "prime");
    await c.as(2);
    await assert.rejects(
      db.query(
        "select public.pay_period_member($1,$2,$3,'prime',$4,'Выдано в игре')",
        [request, c.period.from, m[2], signature],
      ),
      /FORBIDDEN/,
    );
    assert.equal((await c.report()).signature, null);
    await assert.rejects(
      db.query("select * from public.payroll_requests"),
      /permission denied/,
    );
    await c.as(1);
    await db.query(
      "select public.pay_period_member($1,$2,$3,'prime',$4,'Выдано в игре')",
      [request, c.period.from, m[2], signature],
    );
    await db.query(
      "select public.pay_period_member($1,$2,$3,'prime',$4,'Выдано в игре')",
      [request, c.period.from, m[2], signature],
    );
    await db.exec("reset role");
    assert.equal(
      await c.scalar("select count(*)::int from public.payroll_requests"),
      1,
    );
    await c.as(1);
    r = await c.report();
    member = r.rows.find((x) => x.id === m[2])!;
    owner = r.rows.find((x) => x.id === m[1])!;
    assert.equal(member.prime_paid, expected);
    assert.equal(payrollDue(member, "prime"), "0");
    const fixed = owner.prime_fixed;
    await db.query("select public.set_member_weight($1,1,20)", [m[2]]);
    await c.event([m[1]]);
    r = await c.report();
    assert.equal(r.rows.find((x) => x.id === m[2])!.prime_paid, expected);
    assert.equal(r.rows.find((x) => x.id === m[1])!.prime_fixed, fixed);
    await c.sale();
    r = await c.report();
    assert.equal(
      r.rows.reduce((sum, x) => sum + BigInt(x.prime_projection), 0n),
      7000n,
    );
    await assert.rejects(
      db.query(
        "select public.pay_period_member($1,$2,$3,'prime',$4,'Старый расчёт')",
        [randomUUID(), c.period.from, m[1], signature],
      ),
      /CALCULATION_CHANGED/,
    );
    await assert.rejects(
      db.query(
        "select public.delete_activity($1,(select version from public.events where id=$1),'Удаление')",
        [sales[0].loot],
      ),
      /LOOT_HAS_HISTORY/,
    );
    await c.as(2);
    await assert.rejects(
      db.query("select public.set_member_weight($1,2,125)", [m[2]]),
      /FORBIDDEN/,
    );
    await c.as(1);
    await assert.rejects(
      db.query("select public.set_member_weight($1,2,126)", [m[2]]),
      /INVALID_WEIGHT/,
    );
    assert.ok(claimEvent);
  } finally {
    await db.close();
  }
});
test("participation claims: private evidence, owner review, acceptance corrects attendance, delete hides journal", async () => {
  const c = await setup();
  const { db, members: m } = c;
  try {
    const event = await c.event([m[1]]);
    await c.as(2);
    const claim = randomUUID();
    await db.query("select public.submit_participation_claim($1,$2,$3)", [
      claim,
      event,
      image,
    ]);
    await db.query("select public.submit_participation_claim($1,$2,$3)", [
      randomUUID(),
      event,
      image,
    ]);
    assert.equal(
      await c.scalar("select count(*)::int from public.participation_claims"),
      1,
    );
    await assert.rejects(
      db.query("select public.review_participation_claim($1,true)", [claim]),
      /FORBIDDEN/,
    );
    await c.as(3);
    assert.equal(
      await c.scalar("select count(*)::int from public.participation_claims"),
      0,
    );
    await c.as(1);
    await db.query("select public.review_participation_claim($1,true)", [
      claim,
    ]);
    await db.query("select public.review_participation_claim($1,true)", [
      claim,
    ]);
    assert.equal(
      await c.scalar(
        "select mark from public.attendance where event_id=$1 and membership_id=$2",
        [event, m[2]],
      ),
      "present",
    );
    assert.equal(
      await c.scalar(
        "select attendance_finalized_at is not null from public.events where id=$1",
        [event],
      ),
      true,
    );
    await assert.rejects(
      db.query("select public.review_participation_claim($1,false)", [claim]),
      /ALREADY_REVIEWED/,
    );
    await db.query(
      "select public.delete_activity($1,(select version from public.events where id=$1),'Ошибочная активность')",
      [event],
    );
    assert.equal(
      await c.scalar("select status from public.events where id=$1", [event]),
      "cancelled",
    );
    const report = await c.scalar<{ total: number }>(
      "select public.activity_journal(now()-interval '1 day',now()+interval '1 day')",
    );
    assert.equal(report.total, 0);
    const rejected = await c.event([m[1]]);
    await c.as(3);
    const decline = randomUUID();
    await db.query("select public.submit_participation_claim($1,$2,$3)", [
      decline,
      rejected,
      image,
    ]);
    await c.as(1);
    await db.query("select public.review_participation_claim($1,false)", [
      decline,
    ]);
    assert.equal(
      await c.scalar(
        "select mark from public.attendance where event_id=$1 and membership_id=$2",
        [rejected, m[3]],
      ),
      "absent",
    );
  } finally {
    await db.close();
  }
});
test("new migrations also work with optional legacy weighted-pool schema", async () => {
  const c = await setup(true);
  try {
    await c.event([c.members[1]]);
    await c.sale("mini_rb");
    const r = await c.report();
    await c.db.query(
      "select public.pay_period_member($1,$2,$3,'mini_rb',$4,'Оплата мини РБ')",
      [randomUUID(), c.period.from, c.members[1], r.signature],
    );
    assert.equal(
      (await c.report()).rows.find((r) => r.id === c.members[1])!.mini_paid,
      "10000",
    );
  } finally {
    await c.db.close();
  }
});

test("exactly 20% qualifies, zero attendance keeps funds unallocated, registry versions and payment permission cannot be bypassed", async () => {
  const c = await setup();
  try {
    const { db, members: m } = c;
    await c.sale();
    let r = await c.report();
    assert.equal(
      r.rows.reduce((sum, x) => sum + BigInt(x.prime_projection), 0n),
      0n,
    );
    for (let i = 0; i < 5; i++) await c.event(i === 0 ? [m[1], m[2]] : [m[1]]);
    r = await c.report();
    assert.equal(r.rows.find((x) => x.id === m[2])!.percentage, 20);
    assert.equal(r.rows.find((x) => x.id === m[2])!.eligible, true);
    const signature = r.signature;
    await c.sale("mini_rb", 1);
    await assert.rejects(
      db.query(
        "select public.pay_period_member($1,$2,$3,'prime',$4,'Устаревший расчёт')",
        [randomUUID(), c.period.from, m[1], signature],
      ),
      /CALCULATION_CHANGED/,
    );
    const catalog = randomUUID();
    await db.query(
      "select public.save_drop_registry($1,$2,0,'Предмет версии','',10000)",
      [guild, catalog],
    );
    await assert.rejects(
      db.query(
        "select public.add_registry_inventory($1,null,$2,2,'prime',10000,1,'')",
        [randomUUID(), catalog],
      ),
      /STALE_VERSION/,
    );
    await c.as(2);
    await assert.rejects(
      db.query(
        "select public.add_registry_inventory($1,null,$2,1,'prime',10000,1,'')",
        [randomUUID(), catalog],
      ),
      /FORBIDDEN/,
    );
    await assert.rejects(
      db.query(
        "select public.allocate_treasury_sale($1,$2,array[$3::uuid],'Обход порога')",
        [randomUUID(), randomUUID(), m[2]],
      ),
      /permission denied/,
    );
  } finally {
    await c.db.close();
  }
});
