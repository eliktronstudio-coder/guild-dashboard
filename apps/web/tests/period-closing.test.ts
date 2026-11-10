import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { memberDatabase, guild } from "./support/database";
import type { PayrollReport } from "../src/lib/payroll";
test("closing freezes composition, reserves awards, retains stock; late sales and payments preserve immutable snapshot", async () => {
  const c = await memberDatabase(),
    { db, members: m } = c;
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
    await db.exec("update public.memberships set joined_at='2020-01-01'");
    const d = new Date();
    d.setUTCDate(15);
    d.setUTCMonth(d.getUTCMonth() - 2);
    const from = d.toISOString().slice(0, 10),
      event = randomUUID(),
      loot = randomUUID(),
      item = randomUUID();
    await c.as(1);
    await db.query("select public.record_activity($1,$2::jsonb)", [
      event,
      JSON.stringify({
        title: "Архивный рейд",
        starts_at: from + "T12:00:00Z",
        status: "completed",
        kind: "raid",
        source: "prime",
        weight: 100,
        reward_units: null,
        difficulty: "normal",
        night: false,
        counts: true,
        members: [m[1], m[2]],
        confirm_roster: true,
        guests: [],
        evidence: [],
        loot: [],
        facts: {},
      }),
    ]);
    await db.query(
      "select public.save_drop_registry($1,$2,0,'Дроп для архива','',10000)",
      [guild, item],
    );
    await db.query(
      "select public.add_registry_inventory($1,null,$2,1,'prime',10000,10,'')",
      [loot, item],
    );
    await db.exec("reset role");
    await db.query(
      "update public.treasury_loot set archived_period=$1,created_at=$2 where id=$3",
      [from, from + "T13:00:00Z", loot],
    );
    await c.as(1);
    await db.query(
      "select public.sell_treasury_loot($1,$2,1,2,100000,'Продажа до закрытия')",
      [randomUUID(), loot],
    );
    const report = () =>
      c.scalar<PayrollReport>("select public.period_payroll_report($1)", [
        from,
      ]);
    let r = await report();
    assert.equal(r.rows.find((x) => x.id === m[1])?.prime_projection, "35000");
    await c.as(2);
    await assert.rejects(
      db.query("select public.close_payroll_period($1,$2)", [
        from,
        r.signature,
      ]),
      /FORBIDDEN/,
    );
    await c.as(1);
    await assert.rejects(
      db.query("select public.close_payroll_period($1,$2)", [
        from,
        "0".repeat(32),
      ]),
      /CALCULATION_CHANGED/,
    );
    const archive = await c.scalar<string>(
      "select public.close_payroll_period($1,$2)",
      [from, r.signature],
    );
    assert.equal(
      await c.scalar("select public.close_payroll_period($1,$2)", [
        from,
        r.signature,
      ]),
      archive,
    );
    const snapshot = await c.scalar(
      "select snapshot from public.period_archives where id=$1",
      [archive],
    );
    await db.exec("reset role");
    await assert.rejects(
      db.query(
        "update public.events set title='Подмена закрытого рейда' where id=$1",
        [event],
      ),
      /PERIOD_CLOSED/,
    );
    await assert.rejects(
      db.query(
        "update public.activity_reports set difficulty='hard' where event_id=$1",
        [event],
      ),
      /PERIOD_CLOSED/,
    );
    await assert.rejects(
      db.query(
        "insert into public.activity_evidence(id,guild_id,event_id,kind,image) values($1,$2,$3,'roster','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=')",
        [randomUUID(), guild, event],
      ),
      /PERIOD_CLOSED/,
    );
    await c.as(1);
    r = await report();
    assert.equal(r.rows.find((x) => x.id === m[1])?.prime_projection, "0");
    assert.equal(r.rows.find((x) => x.id === m[1])?.prime_fixed, "35000");
    await db.exec("reset role");
    await db.query(
      "update public.memberships set nickname='Переименован',payout_weight=20 where id=$1",
      [m[1]],
    );
    await c.as(1);
    await assert.rejects(
      db.query("update public.events set title='Подмена' where id=$1", [event]),
    );
    await db.query(
      "select public.sell_treasury_loot($1,$2,2,1,100000,'Поздняя продажа')",
      [randomUUID(), loot],
    );
    r = await report();
    assert.equal(r.rows.find((x) => x.id === m[1])?.prime_projection, "35000");
    assert.equal(r.rows.find((x) => x.id === m[1])?.nickname, "Владелец");
    await db.query(
      "select public.pay_period_member($1,$2,$3,'prime',$4,'Передано в игре')",
      [randomUUID(), from, m[1], r.signature],
    );
    r = await report();
    assert.equal(r.rows.find((x) => x.id === m[1])?.prime_paid, "70000");
    assert.equal(r.rows.find((x) => x.id === m[2])?.prime_fixed, "70000");
    assert.deepEqual(
      await c.scalar(
        "select snapshot from public.period_archives where id=$1",
        [archive],
      ),
      snapshot,
    );
    assert.equal(
      await c.scalar(
        "select quantity_remaining from public.treasury_loot where id=$1",
        [loot],
      ),
      7,
    );
    await db.exec("reset role");
    assert.equal(
      await c.scalar(
        "select accounting_period::text from public.treasury_sales order by created_at desc limit 1",
      ),
      from,
    );
  } finally {
    await db.close();
  }
});
