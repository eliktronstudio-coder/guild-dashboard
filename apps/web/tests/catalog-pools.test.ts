import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { memberDatabase, guild } from "./support/database";
import { parseWeight } from "../src/lib/catalog";
import type { PoolPreview } from "../src/lib/pools";
test("coefficient input accepts exact hundredths and rejects invalid range", () => {
  for (const [s, v] of [
    ["0,2", 20],
    ["1", 100],
    ["1.25", 125],
    ["0.19", null],
    ["1.26", null],
    ["1.001", null],
    ["NaN", null],
    ["1e0", null],
  ] as const)
    assert.equal(parseWeight(s, true), v);
});
test("catalog and pooled awards: ACL, defaults, weights, snapshots, exact fund and retries", async () => {
  const { db, as, scalar, members: m } = await memberDatabase();
  try {
    await db.exec("create role service_role;");
    // Historical settlement behavior is tested before migration 025; member-payroll.test covers the replacement on both schemas.
    for (const f of (await readdir("supabase/migrations"))
      .sort()
      .filter(
        (f) =>
          f.endsWith(".sql") &&
          f < "202611090025" &&
          !f.includes("0001_") &&
          !f.includes("0002_"),
      )) {
      await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
    }
    assert.equal(
      await scalar("select min(payout_weight) from public.memberships"),
      100,
    );
    await as(2);
    await assert.rejects(
      db.query("select public.set_member_weight($1,1,125)", [m[2]]),
      /FORBIDDEN/,
    );
    await as(1);
    await assert.rejects(
      db.query("select public.set_member_weight($1,1,126)", [m[2]]),
      /INVALID_WEIGHT/,
    );
    await db.query("select public.set_member_weight($1,1,125)", [m[2]]);
    await assert.rejects(
      db.query("select public.set_member_weight($1,1,100)", [m[2]]),
      /STALE_VERSION/,
    );
    const boss = randomUUID(),
      lootItem = randomUUID();
    await db.query(
      "select public.save_catalog($1,'boss',0,'Кракен','',0,200,false)",
      [boss],
    );
    await db.query(
      "select public.save_catalog($1,'loot',0,'Предмет','',12345,100,false)",
      [lootItem],
    );
    await as(2);
    assert.equal(
      await scalar("select count(*)::int from public.guild_catalog"),
      0,
    );
    await assert.rejects(
      db.query(
        "select public.save_catalog($1,'boss',1,'Нельзя','',0,100,false)",
        [boss],
      ),
      /FORBIDDEN/,
    );
    await db.exec("reset role");
    await db.exec(
      "update public.memberships set joined_at=now()-interval '10 days'",
    );
    const events: string[] = [];
    const sales: string[] = [];
    async function event(present: string[], gross: number) {
      await db.exec("reset role");
      const e = randomUUID(),
        l = randomUUID(),
        s = randomUUID();
      events.push(e);
      sales.push(s);
      await db.query(
        "insert into public.events(id,guild_id,title,kind,starts_at,organizer_id,treasury_source) values($1,$2,'Рейд','raid',now()-interval '1 day',$3,'prime')",
        [e, guild, m[1]],
      );
      await as(1);
      await db.query("select public.set_event_boss($1,1,$2)", [e, boss]);
      await db.query(
        "select public.change_event($1,2,'Рейд','','completed','Завершён рейд')",
        [e],
      );
      for (const member of Object.values(m))
        await db.query(
          "select public.mark_attendance($1,$2,1,$3,'Проверен состав')",
          [e, member, present.includes(member) ? "present" : "excluded"],
        );
      await db.query(
        "select public.finalize_attendance($1,(select version from public.events where id=$1))",
        [e],
      );
      await db.query(
        "select public.add_treasury_loot($1,$2,'Трофей','',1,10000,'')",
        [l, e],
      );
      await db.query("select public.sell_treasury_loot($1,$2,1,1,$3,'')", [
        s,
        l,
        gross,
      ]);
    }
    await event([m[2], m[3]], 101);
    await event([m[2]], 103);
    const preview = () =>
      scalar<PoolPreview>("select public.treasury_pool_preview($1)", [events]);
    await assert.rejects(
      db.query("select public.treasury_allocation_preview($1)", [sales[0]]),
      /USE_POOL/,
    );
    const old = await preview();
    assert.equal(old.amount_units, "144"); // 71 + 73 from two 70% funds
    assert.equal(old.recipients.find((x) => x.id === m[2])?.weight, "50000");
    assert.equal(old.recipients.find((x) => x.id === m[3])?.weight, "20000");
    assert.equal(
      old.recipients.find((x) => x.id === m[2])?.amount_units,
      "103",
    );
    assert.equal(old.recipients.find((x) => x.id === m[3])?.amount_units, "41");
    await db.query("select public.set_member_weight($1,2,100)", [m[2]]);
    const request = randomUUID();
    await assert.rejects(
      db.query(
        "select public.allocate_treasury_pool($1,$2,$3,'Расчёт рейдов')",
        [request, events, old],
      ),
      /CALCULATION_CHANGED/,
    );
    const calc = await preview();
    await db.query(
      "select public.allocate_treasury_pool($1,$2,$3,'Расчёт рейдов')",
      [request, events, calc],
    );
    await db.query(
      "select public.allocate_treasury_pool($1,$2,$3,'Расчёт рейдов')",
      [request, events, calc],
    );
    assert.equal(
      await scalar("select count(*)::int from public.treasury_pools"),
      1,
    );
    assert.equal(
      await scalar(
        "select sum(amount_units)::text from public.treasury_awards",
      ),
      "144",
    );
    for (const recipient of calc.recipients)
      assert.equal(
        await scalar(
          "select sum(amount_units)::text from public.treasury_awards where membership_id=$1",
          [recipient.id],
        ),
        recipient.amount_units,
      );
    assert.equal(
      await scalar(
        "select count(*)::int from (select a.id from public.treasury_allocations a join public.treasury_awards w on w.allocation_id=a.id join public.treasury_sales s on s.id=a.sale_id group by a.id,s.fund_units having sum(w.amount_units)<>s.fund_units) q",
      ),
      0,
    );
    await assert.rejects(preview(), /NO_FREE_SALES/);
    // Later coefficient edits must not rewrite existing obligations or stop valid payouts.
    await db.query("select public.set_member_weight($1,3,20)", [m[2]]);
    const award = await scalar<string>(
      "select id from public.treasury_awards order by id limit 1",
    );
    const payout = randomUUID();
    await db.query(
      "select public.pay_treasury_award($1,$2,1,1,'Выдано в игре')",
      [payout, award],
    );
    const allocation = await scalar<string>(
      "select allocation_id from public.treasury_awards where id=$1",
      [award],
    );
    await assert.rejects(
      db.query("select public.void_treasury_allocation($1,'Отмена фонда')", [
        allocation,
      ]),
      /HAS_PAYOUTS/,
    );
    await db.query("select public.void_treasury_payout($1,'Отмена выплаты')", [
      payout,
    ]);
    await db.query(
      "select public.void_treasury_allocation($1,'Отмена фонда')",
      [allocation],
    );
    assert.equal(
      await scalar(
        "select count(*)::int from public.treasury_allocations where pool_id=$1 and voided_at is null",
        [request],
      ),
      0,
    );
    await assert.rejects(
      db.query(
        "select public.allocate_treasury_pool($1,$2,$3,'Расчёт рейдов')",
        [request, events, calc],
      ),
      /ALLOCATION_VOIDED/,
    );
    assert.equal(
      await scalar(
        "select sum(amount_units)::text from public.treasury_awards",
      ),
      "144",
    );
    await as(1);
    await event([m[2], m[3]], 600);
    const ordinaryEvent = events.at(-1)!,
      ordinarySale = sales.at(-1)!;
    await db.query(
      "select public.set_event_boss($1,(select version from public.events where id=$1),null)",
      [ordinaryEvent],
    );
    const single = await scalar<PoolPreview & { sale_id: string }>(
      "select public.treasury_allocation_preview($1)",
      [ordinarySale],
    );
    assert.equal(
      single.recipients.find((x) => x.id === m[2])?.amount_units,
      "70",
    );
    assert.equal(
      single.recipients.find((x) => x.id === m[3])?.amount_units,
      "350",
    );
    const singleRequest = randomUUID();
    const singleArgs = [
      singleRequest,
      ordinarySale,
      single.recipients.map((x) => x.id),
      single,
    ];
    await db.query(
      "select public.allocate_weighted_sale($1,$2,$3,'Обычная продажа',$4)",
      singleArgs,
    );
    await db.query(
      "select public.allocate_weighted_sale($1,$2,$3,'Обычная продажа',$4)",
      singleArgs,
    );
    assert.equal(
      await scalar(
        "select sum(amount_units)::text from public.treasury_awards where allocation_id=$1",
        [singleRequest],
      ),
      "420",
    );
    await as(2);
    await assert.rejects(preview(), /FORBIDDEN/);
    await assert.rejects(
      db.query("update public.memberships set payout_weight=125 where id=$1", [
        m[2],
      ]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
