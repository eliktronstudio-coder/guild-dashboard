import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { memberDatabase, guild, id } from "./support/database";
import {
  dashboardPeriod,
  barWidth,
  type DashboardReport,
} from "../src/lib/dashboard";
test("dashboard periods: UTC Monday, leap year, inclusive dates and invalid requests", () => {
  const now = new Date("2026-11-01T23:50:00Z");
  assert.equal(dashboardPeriod({ period: "week" }, now).from, "2026-10-26");
  assert.equal(dashboardPeriod({}, now).until, "2026-11-02T00:00:00.000Z");
  assert.equal(
    dashboardPeriod({ period: "custom", from: "2024-01-01", to: "2024-12-31" })
      .error,
    undefined,
  );
  for (const [from, to] of [
    ["2025-02-29", "2025-03-01"],
    ["2024-01-01", "2025-01-01"],
    ["2025-02-02", "2025-01-01"],
    ["infinity", "2025-01-01"],
  ])
    assert.ok(dashboardPeriod({ period: "custom", from, to }).error);
  assert.ok(dashboardPeriod({ period: "season" }).error);
  assert.ok(dashboardPeriod({ period: "unknown" }).error);
  assert.equal(
    dashboardPeriod({ period: "custom", from: "2025-01-01", to: "2025-01-01" })
      .until,
    "2025-01-02T00:00:00.000Z",
  );
});
test("chart drawing keeps large gold values exact and handles zero safely", () => {
  assert.equal(
    barWidth("500000000000000000000001", "1000000000000000000000002"),
    50,
  );
  assert.equal(barWidth("0", "0"), 0);
  assert.equal(barWidth("10", "5"), 100);
});
test("dashboard database: real aggregates, dated reversals and authorization", async (t) => {
  const { db, as, scalar, members: m } = await memberDatabase();
  try {
    for (const f of [
      "202610310003_events.sql",
      "202610310004_event_lifecycle.sql",
      "202610310005_attendance.sql",
      "202610310006_treasury.sql",
      "202611010007_settlements.sql",
      "202611010008_dashboard.sql",
    ])
      await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
    await db.exec("update public.memberships set joined_at='2024-01-01'");
    const event = randomUUID(),
      loot = randomUUID(),
      sale = randomUUID();
    await db.query(
      "insert into public.events(id,guild_id,title,kind,starts_at,organizer_id,treasury_source) values($1,$2,'Прайм','raid','2025-01-05',$3,'prime')",
      [event, guild, m[1]],
    );
    await as(1);
    await db.query(
      "select public.change_event($1,1,'Прайм','','completed','Завершён рейд')",
      [event],
    );
    for (const n of [1, 2, 3, 4])
      await db.query(
        "select public.mark_attendance($1,$2,1,$3,'Проверен состав')",
        [event, m[n], n <= 2 ? "present" : n === 3 ? "absent" : "excused"],
      );
    await db.query(
      "select public.finalize_attendance($1,(select version from public.events where id=$1))",
      [event],
    );
    await db.query(
      "select public.add_treasury_loot($1,$2,'Трофей','',2,50000,'')",
      [loot, event],
    );
    await db.query(
      "select public.sell_treasury_loot($1,$2,1,1,1000000000,'')",
      [sale, loot],
    );
    await db.exec("reset role");
    await db.query(
      "update public.treasury_sales set created_at='2025-01-05' where id=$1",
      [sale],
    );
    await db.query(
      "insert into public.events(id,guild_id,title,kind,starts_at,organizer_id) values($1,$2,'Впереди','raid',now()+interval '1 day',$3)",
      [randomUUID(), guild, m[1]],
    );
    await as(1);
    const report = (from = "2025-01-01", until = "2025-02-01") =>
      scalar<DashboardReport>("select public.dashboard_report($1,$2)", [
        from,
        until,
      ]);
    await t.test(
      "confirmed attendance, personal data, inventory and opening cash",
      async () => {
        const r = await report();
        assert.equal(r.members, 4);
        assert.equal(r.active_members, 2);
        assert.equal(r.completed_events, 1);
        assert.equal(r.attendance, 66.7);
        assert.equal(r.own_attendance, 100);
        assert.equal(r.ranking?.length, 2);
        assert.equal(r.upcoming.length, 1);
        assert.equal(r.finance?.sales_units, "1000000000");
        assert.equal(r.finance?.current.prime_units, "700000000");
        assert.equal(r.finance?.current.guild_units, "300000000");
        assert.equal(r.finance?.current.inventory_units, "50000");
        const later = await report("2025-01-06", "2025-01-13");
        assert.equal(later.finance?.opening_units, "1000000000");
        assert.equal(later.finance?.sales_units, "0");
        assert.equal(later.finance?.weeks[0].balance_units, "1000000000");
        assert.equal(later.attendance, null);
      },
    );
    await t.test(
      "empty intervals, future events, exclusive upper bound and invalid RPC periods",
      async () => {
        assert.equal(
          (await report("2025-01-01", "2025-01-05")).completed_events,
          0,
        );
        const empty = await report("2090-01-01", "2090-02-01");
        assert.equal(empty.attendance, null);
        assert.equal(empty.weeks.length, 0);
        assert.equal(empty.finance?.weeks.length, 0);
        assert.equal(empty.completed_events, 0);
        for (const args of [
          ["2025-01-01", "2025-01-01"],
          ["2025-01-01", "2027-01-01"],
          ["-infinity", "infinity"],
          [null, "2025-02-01"],
        ])
          await assert.rejects(
            db.query("select public.dashboard_report($1,$2)", args),
            /INVALID_PERIOD/,
          );
      },
    );
    await t.test(
      "ordinary members cannot read ranking, applications, or finances without permission",
      async () => {
        await as(3);
        const r = await report();
        assert.equal(r.ranking, null);
        assert.equal(r.pending_applications, null);
        assert.equal(r.own_attendance, 0);
        assert.equal(r.own_present, 0);
        assert.equal(r.own_earned_units, "0");
        await db.exec("reset role");
        await db.exec(
          "delete from public.role_permissions where permission='treasury.read' and role_id in (select id from public.roles where code='member')",
        );
        await as(3);
        assert.equal((await report()).finance, null);
        await as(1);
      },
    );
    await t.test(
      "cash includes payouts, guild expenses and their later reversals; own awards stay private",
      async () => {
        const allocation = randomUUID(),
          payout = randomUUID(),
          expense = randomUUID();
        const preview = await scalar<{ recipients: { id: string }[] }>(
          "select public.treasury_allocation_preview($1)",
          [sale],
        );
        await db.query(
          "select public.allocate_treasury_sale($1,$2,$3,'Подтверждён прайм')",
          [allocation, sale, preview.recipients.map((r) => r.id)],
        );
        const award = await scalar<string>(
          "select id from public.treasury_awards where allocation_id=$1 and membership_id=$2",
          [allocation, m[2]],
        );
        await db.query(
          "select public.pay_treasury_award($1,$2,1,123000,'Передано игроку')",
          [payout, award],
        );
        await db.query(
          "select public.record_treasury_expense($1,23000,'Расход гильдии')",
          [expense],
        );
        await db.exec("reset role");
        await db.query(
          "update public.treasury_allocations set created_at='2025-01-06' where id=$1",
          [allocation],
        );
        await db.query(
          "update public.treasury_payouts set created_at='2025-01-07' where id=$1",
          [payout],
        );
        await db.query(
          "update public.treasury_expenses set created_at='2025-01-08' where id=$1",
          [expense],
        );
        await as(1);
        assert.equal(
          (await report("2025-01-06", "2025-01-09")).finance?.weeks.at(-1)
            ?.balance_units,
          "999854000",
        );
        await as(2);
        const own = await report();
        assert.equal(own.own_earned_units, "350000000");
        assert.equal(own.own_finance.paid_units, "123000");
        assert.equal(own.own_finance.pending_units, "349877000");
        await as(3);
        assert.equal((await report()).own_earned_units, "0");
        await as(1);
        await db.query(
          "select public.void_treasury_payout($1,'Ошибочная выплата')",
          [payout],
        );
        await db.query(
          "select public.void_treasury_expense($1,'Возвращён расход')",
          [expense],
        );
        await db.query(
          "select public.void_treasury_allocation($1,'Ошибочное начисление')",
          [allocation],
        );
        await db.exec("reset role");
        await db.query(
          "update public.treasury_payouts set voided_at='2025-01-10' where id=$1",
          [payout],
        );
        await db.query(
          "update public.treasury_expenses set voided_at='2025-01-10' where id=$1",
          [expense],
        );
        await as(1);
        assert.equal(
          (await report("2025-01-06", "2025-01-09")).finance?.weeks.at(-1)
            ?.balance_units,
          "999854000",
        );
        assert.equal(
          (await report("2025-01-06", "2025-01-13")).finance?.weeks.at(-1)
            ?.balance_units,
          "1000000000",
        );
      },
    );
    await t.test(
      "reversal keeps historical sales and cash and restores current stock",
      async () => {
        await db.query(
          "select public.void_treasury_sale($1,'Возврат покупателю')",
          [sale],
        );
        await db.exec("reset role");
        await db.query(
          "update public.treasury_sales set voided_at='2025-01-15' where id=$1",
          [sale],
        );
        await as(1);
        const before = await report("2025-01-01", "2025-01-08");
        assert.equal(before.finance?.sales_units, "1000000000");
        assert.equal(before.finance?.reversed_units, "0");
        assert.equal(before.finance?.weeks.at(-1)?.balance_units, "999877000");
        const after = await report("2025-01-13", "2025-01-20");
        assert.equal(after.finance?.sales_units, "0");
        assert.equal(after.finance?.opening_units, "1000000000");
        assert.equal(after.finance?.reversed_units, "1000000000");
        assert.equal(after.finance?.weeks.at(-1)?.balance_units, "0");
        assert.equal(after.finance?.current.inventory_units, "100000");
      },
    );
    await t.test(
      "correction removes attendance until reconfirmed",
      async () => {
        await db.query(
          "select public.mark_attendance($1,$2,2,'absent','Исправлена отметка')",
          [event, m[2]],
        );
        const r = await report();
        assert.equal(r.attendance, null);
        assert.equal(r.active_members, 0);
        assert.equal(r.ranking?.length, 0);
        assert.equal(r.completed_events, 1);
      },
    );
    await t.test(
      "blocked, non-member and anonymous callers are rejected",
      async () => {
        await db.exec("reset role");
        await db.query("update public.profiles set blocked=true where id=$1", [
          id(3),
        ]);
        await as(3);
        await assert.rejects(report(), /FORBIDDEN/);
        await as(5);
        await assert.rejects(report(), /FORBIDDEN/);
        await db.exec("reset role; set role anon");
        await assert.rejects(report(), /permission denied/);
      },
    );
  } finally {
    await db.close();
  }
});
