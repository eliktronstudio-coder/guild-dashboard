import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { memberDatabase, guild, id } from "./support/database";
import type { TreasuryTotals } from "../src/lib/treasury";
test("treasury: source routing, exact funds, stock, reversals and permissions", async (t) => {
  const { db, as, scalar, members: m } = await memberDatabase();
  try {
    for (const f of [
      "202610310003_events.sql",
      "202610310004_event_lifecycle.sql",
      "202610310005_attendance.sql",
      "202610310006_treasury.sql",
    ])
      await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
    for (const [n, role] of [
      [3, "treasurer"],
      [4, "officer"],
    ] as const)
      await db.query(
        "insert into public.membership_roles select $1,$2,id from public.roles where guild_id=$1 and code=$3",
        [guild, m[n], role],
      );
    const summary = () =>
      scalar<TreasuryTotals>("select public.treasury_summary()");
    const stock = (loot: string) =>
      scalar<number>(
        "select quantity_remaining from public.treasury_loot where id=$1",
        [loot],
      );
    const version = (loot: string) =>
      scalar<number>("select version from public.treasury_loot where id=$1", [
        loot,
      ]);
    async function event(source: string, status = "completed") {
      await db.exec("reset role");
      const e = randomUUID();
      await db.query(
        "insert into public.events(id,guild_id,title,kind,starts_at,organizer_id) values($1,$2,'Источник дропа','raid',now()-interval '1 day',$3)",
        [e, guild, m[1]],
      );
      await as(1);
      if (source !== "none")
        await db.query(
          "select public.tag_event_treasury($1,1,$2,'Пометка источника')",
          [e, source],
        );
      if (status !== "scheduled")
        await db.query(
          "select public.change_event($1,$2,'Источник дропа','',$3,'Событие закрыто')",
          [e, source === "none" ? 1 : 2, status],
        );
      return e;
    }
    const add = async (
      e: string,
      qty = 10,
      estimate: string | null = "200000",
      request: string = randomUUID(),
    ) => {
      await db.query(
        "select public.add_treasury_loot($1,$2,'Драконий кристалл','Материалы',$3,$4,'')",
        [request, e, qty, estimate],
      );
      return request;
    };
    const sell = async (
      l: string,
      qty: number,
      amount: string,
      request: string = randomUUID(),
      v?: number,
    ) => {
      await db.query(
        "select public.sell_treasury_loot($1,$2,$3,$4,$5,'Продажа')",
        [request, l, v ?? (await version(l)), qty, amount],
      );
      return request;
    };
    let prime: string,
      mini: string,
      loot: string,
      miniLoot: string,
      sale: string;
    await t.test(
      "empty summary, completed tagged events route loot; untagged/cancelled/scheduled rejected",
      async () => {
        await as(1);
        const s = await summary();
        assert.equal(s.prime_units, "0");
        assert.equal(s.inventory_units, "0");
        for (const [tag, state, error] of [
          ["none", "completed", /SOURCE_REQUIRED/],
          ["prime", "cancelled", /EVENT_NOT_COMPLETED/],
          ["mini_rb", "scheduled", /EVENT_NOT_COMPLETED/],
        ] as const) {
          const e = await event(tag, state);
          await assert.rejects(() => add(e), error);
        }
        prime = await event("prime");
        mini = await event("mini_rb");
        loot = await add(prime);
        miniLoot = await add(mini, 5, "300000");
        assert.equal(
          await scalar(
            "select source from public.treasury_inventory where id=$1",
            [loot],
          ),
          "prime",
        );
        assert.equal(
          await scalar(
            "select source from public.treasury_inventory where id=$1",
            [miniLoot],
          ),
          "mini_rb",
        );
        assert.equal((await summary()).inventory_units, "3500000");
        assert.equal(
          await scalar("select count(*)::int from public.memberships"),
          4,
        );
      },
    );
    await t.test(
      "member and officer cannot mutate money; treasurer can read/manage; anonymous and pending denied",
      async () => {
        await as(2);
        assert.equal((await summary()).inventory_units, "3500000");
        await assert.rejects(() => add(prime), /FORBIDDEN/);
        await assert.rejects(() => sell(loot, 1, "10000"), /FORBIDDEN/);
        await assert.rejects(
          () =>
            db.query("update public.treasury_loot set quantity_remaining=100"),
          /permission denied/,
        );
        await assert.rejects(
          () =>
            db.query("insert into public.treasury_sales(id) values($1)", [
              randomUUID(),
            ]),
          /permission denied/,
        );
        await as(4);
        await assert.rejects(() => sell(loot, 1, "10000"), /FORBIDDEN/);
        await as(3);
        assert.equal(
          await scalar("select public.has_permission($1,'treasury.manage')", [
            guild,
          ]),
          true,
        );
        assert.equal((await summary()).stock_count, 2);
        await as(6);
        await assert.rejects(() => summary(), /FORBIDDEN/);
        assert.equal(
          await scalar("select count(*)::int from public.treasury_inventory"),
          0,
        );
        await db.exec("reset role; set role anon");
        await assert.rejects(() => summary(), /permission denied/);
        await as(1);
      },
    );
    await t.test(
      "duplicate loot request is harmless; source cannot be moved after inventory exists",
      async () => {
        await add(prime, 10, "200000", loot);
        assert.equal(await stock(loot), 10);
        await assert.rejects(
          () => add(prime, 11, "200000", loot),
          /REQUEST_CONFLICT/,
        );
        await assert.rejects(
          () =>
            db.query(
              "select public.tag_event_treasury($1,3,'mini_rb','Изменить источник')",
              [prime],
            ),
          /SOURCE_LOCKED/,
        );
      },
    );
    await t.test(
      "100000 gold sale gives prime 70000 and guild 30000 exactly; partial stock remains",
      async () => {
        await as(3);
        sale = await sell(loot, 4, "1000000000");
        const s = await summary();
        assert.equal(s.prime_gross_units, "1000000000");
        assert.equal(s.prime_units, "700000000");
        assert.equal(s.guild_units, "300000000");
        assert.equal(s.mini_units, "0");
        assert.equal(await stock(loot), 6);
        assert.equal(s.inventory_units, "2700000");
        const row = await db.query(
          "select gross_units::text,guild_units::text,fund_units::text from public.treasury_sales where id=$1",
          [sale],
        );
        const r = row.rows[0] as Record<string, string>;
        assert.equal(
          BigInt(r.gross_units),
          BigInt(r.guild_units) + BigInt(r.fund_units),
        );
      },
    );
    await t.test(
      "sale retry and stale second seller cannot double deduct or allocate; invalid sale rolls back",
      async () => {
        await sell(loot, 4, "1000000000", sale, 1);
        assert.equal(await stock(loot), 6);
        assert.equal((await summary()).sales_count, 1);
        await assert.rejects(
          () => sell(loot, 3, "1000000000", sale, 1),
          /REQUEST_CONFLICT/,
        );
        await assert.rejects(
          () => sell(loot, 1, "100000", randomUUID(), 1),
          /STALE_VERSION/,
        );
        await assert.rejects(
          () => sell(loot, 7, "100000"),
          /INSUFFICIENT_STOCK/,
        );
        await assert.rejects(() => sell(loot, 1, "0"), /INVALID_AMOUNT/);
        const before = await summary();
        await assert.rejects(
          () =>
            db.query("select public.sell_treasury_loot($1,$2,$3,1,10000,$4)", [
              randomUUID(),
              loot,
              2,
              "x".repeat(501),
            ]),
          /check constraint/,
        );
        assert.deepEqual(await summary(), before);
        assert.equal(await stock(loot), 6);
      },
    );
    await t.test(
      "mini RB sale credits only mini treasury; no guild withholding",
      async () => {
        await sell(miniLoot, 2, "500000000");
        const s = await summary();
        assert.equal(s.mini_units, "500000000");
        assert.equal(s.guild_units, "300000000");
        assert.equal(s.inventory_units, "2100000");
        assert.equal(await stock(miniLoot), 3);
      },
    );
    await t.test(
      "quantity and valuation correction preserves sold count and audits before/after",
      async () => {
        await db.query(
          "select public.revise_treasury_loot($1,$2,'Драконий кристалл','Материалы',12,400000,'','Уточнили партию')",
          [loot, await version(loot)],
        );
        assert.equal(await stock(loot), 8);
        assert.equal((await summary()).inventory_units, "4100000");
        await assert.rejects(
          () =>
            db.query(
              "select public.revise_treasury_loot($1,$2,'Драконий кристалл','Материалы',3,400000,'','Ошибка количества')",
              [loot, 3],
            ),
          /QUANTITY_BELOW_SOLD/,
        );
        await as(1);
        const detail = await scalar<{
          before: { quantity_total: number };
          after: { quantity_total: number };
          reason: string;
        }>(
          "select detail from public.audit_log where target_id=$1 and action='treasury.loot_revised'",
          [loot],
        );
        assert.equal(detail.before.quantity_total, 10);
        assert.equal(detail.after.quantity_total, 12);
        assert.equal(detail.reason, "Уточнили партию");
      },
    );
    await t.test(
      "void restores stock and all original allocations once, preserves reason/actor; old retry cannot resurrect",
      async () => {
        await as(3);
        await db.query(
          "select public.void_treasury_sale($1,'Ошибка продажи')",
          [sale],
        );
        await db.query("select public.void_treasury_sale($1,'Повтор отмены')", [
          sale,
        ]);
        assert.equal(await stock(loot), 12);
        const s = await summary();
        assert.equal(s.prime_units, "0");
        assert.equal(s.guild_units, "0");
        assert.equal(s.mini_units, "500000000");
        assert.equal(s.inventory_units, "5700000");
        const row = await db.query(
          "select void_reason,voided_by from public.treasury_sales where id=$1",
          [sale],
        );
        assert.deepEqual(row.rows[0], {
          void_reason: "Ошибка продажи",
          voided_by: id(3),
        });
        await assert.rejects(
          () => sell(loot, 4, "1000000000", sale, 1),
          /SALE_VOIDED/,
        );
      },
    );
    await t.test(
      "unpriced items stay explicit; exact inventory valuation exceeds Number safe integer",
      async () => {
        await as(1);
        const unknown = await add(prime, 2, null),
          huge = await add(prime, 1000000, "100000000000000");
        const s = await summary();
        assert.equal(s.unpriced_count, 1);
        assert.equal(s.inventory_units, "100000000000005700000");
        assert.equal(
          await scalar(
            "select estimated_total_units from public.treasury_inventory where id=$1",
            [huge],
          ),
          "100000000000000000000",
        );
        await db.query(
          "select public.revise_treasury_loot($1,1,'Драконий кристалл','Материалы',0,null,'','Убрать ошибочную партию')",
          [unknown],
        );
        assert.equal((await summary()).unpriced_count, 0);
      },
    );
    await t.test(
      "rounding to 0.0001 gold conserves every unit; selling last item removes inventory estimate",
      async () => {
        const tiny = await add(prime, 1, "7");
        const before = await summary();
        const tinySale = await sell(tiny, 1, "7");
        const after = await summary();
        assert.equal(
          BigInt(after.guild_units) - BigInt(before.guild_units),
          2n,
        );
        assert.equal(
          BigInt(after.prime_units) - BigInt(before.prime_units),
          5n,
        );
        assert.equal(
          BigInt(before.inventory_units) - BigInt(after.inventory_units),
          7n,
        );
        await db.query(
          "select public.void_treasury_sale($1,'Отмена тестовой продажи')",
          [tinySale],
        );
        assert.deepEqual(await summary(), before);
      },
    );
    await t.test(
      "foreign guild objects remain invisible and UUID injection cannot change them",
      async () => {
        await db.exec("reset role");
        const other = randomUUID(),
          member = randomUUID(),
          e = randomUUID(),
          l = randomUUID();
        await db.query(
          "insert into public.guilds(id,slug,name) values($1,'other','Other')",
          [other],
        );
        await db.query(
          "insert into public.memberships(id,guild_id,user_id,nickname) values($1,$2,$3,'Иной')",
          [member, other, id(6)],
        );
        await db.query(
          "insert into public.events(id,guild_id,title,kind,starts_at,organizer_id,status,treasury_source) values($1,$2,'Чужое событие','raid',now()-interval '1 day',$3,'completed','prime')",
          [e, other, member],
        );
        await db.query(
          "insert into public.treasury_loot(id,guild_id,event_id,source,name,quantity_total,quantity_remaining,created_by) values($1,$2,$3,'prime','Чужой дроп',2,2,$4)",
          [l, other, e, id(6)],
        );
        await as(1);
        assert.equal(
          await scalar(
            "select count(*)::int from public.treasury_inventory where id=$1",
            [l],
          ),
          0,
        );
        await assert.rejects(
          () => sell(l, 1, "10000", randomUUID(), 1),
          /FORBIDDEN/,
        );
        await assert.rejects(() => add(e), /FORBIDDEN/);
      },
    );
    await t.test(
      "revoking treasury permission and blocking account take effect in existing session",
      async () => {
        await db.exec("reset role");
        await db.query(
          "delete from public.membership_roles where membership_id=$1 and role_id in (select id from public.roles where code='treasurer')",
          [m[3]],
        );
        await as(3);
        await assert.rejects(() => sell(loot, 1, "10000"), /FORBIDDEN/);
        await as(1);
        await db.query("select public.set_member_blocked($1,true)", [m[2]]);
        await as(2);
        await assert.rejects(() => summary(), /FORBIDDEN/);
        assert.equal(
          await scalar("select count(*)::int from public.treasury_sales_log"),
          0,
        );
      },
    );
  } finally {
    await db.close();
  }
});
