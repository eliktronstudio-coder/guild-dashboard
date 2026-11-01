import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { memberDatabase, guild, id } from "./support/database";
import type { AllocationPreview } from "../src/lib/settlements";
test("settlements: attendance awards, partial payments, expenses and reversal dependencies", async (t) => {
  const { db, as, scalar, members: m } = await memberDatabase();
  try {
    for (const f of [
      "202610310003_events.sql",
      "202610310004_event_lifecycle.sql",
      "202610310005_attendance.sql",
      "202610310006_treasury.sql",
    ])
      await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
    await db.exec(
      "update public.memberships set joined_at=now()-interval '10 days'",
    );
    async function makeSale(
      source = "prime",
      gross = "1000000000",
      confirmed = true,
    ) {
      await db.exec("reset role");
      const event = randomUUID(),
        loot = randomUUID(),
        sale = randomUUID();
      await db.query(
        "insert into public.events(id,guild_id,title,kind,starts_at,organizer_id,treasury_source) values($1,$2,'Прайм для расчёта','raid',now()-interval '1 day',$3,$4)",
        [event, guild, m[1], source],
      );
      await as(1);
      await db.query(
        "select public.change_event($1,1,'Прайм для расчёта','','completed','Завершён рейд')",
        [event],
      );
      for (const [n, member] of Object.entries(m))
        await db.query(
          "select public.mark_attendance($1,$2,1,$3,'Проверен состав')",
          [event, member, ["2", "3"].includes(n) ? "present" : "excluded"],
        );
      if (confirmed)
        await db.query(
          "select public.finalize_attendance($1,(select version from public.events where id=$1))",
          [event],
        );
      await db.query(
        "select public.add_treasury_loot($1,$2,'Трофей','',1,10000,'')",
        [loot, event],
      );
      await db.query("select public.sell_treasury_loot($1,$2,1,1,$3,'')", [
        sale,
        loot,
        gross,
      ]);
      return { event, loot, sale };
    }
    const original = await makeSale(),
      mini = await makeSale("mini_rb", "50000000");
    const before = await scalar<Record<string, string>>(
      "select public.treasury_summary()",
    );
    await db.exec("reset role");
    await db.exec(
      await readFile(
        "supabase/migrations/202611010007_settlements.sql",
        "utf8",
      ),
    );
    await as(1);
    const totals = () =>
      scalar<Record<string, string>>("select public.treasury_summary()");
    const own = () =>
      scalar<Record<string, string>>("select public.my_treasury_summary()");
    const preview = (sale = original.sale) =>
      scalar<AllocationPreview>(
        "select public.treasury_allocation_preview($1)",
        [sale],
      );
    const recipients = [m[2], m[3]].sort();
    const allocate = async (
      sale = original.sale,
      request: string = randomUUID(),
      members = recipients,
    ) => {
      await db.query(
        "select public.allocate_treasury_sale($1,$2,$3,'Подтверждённое присутствие')",
        [request, sale, members],
      );
      return request;
    };
    const awardFor = (allocation: string, member = m[2]) =>
      scalar<string>(
        "select id from public.treasury_awards where allocation_id=$1 and membership_id=$2",
        [allocation, member],
      );
    const version = (award: string) =>
      scalar<number>("select version from public.treasury_awards where id=$1", [
        award,
      ]);
    const pay = async (
      award: string,
      amount: string,
      request: string = randomUUID(),
      v?: number,
    ) => {
      await db.query(
        "select public.pay_treasury_award($1,$2,$3,$4,'Передано в игре')",
        [request, award, v ?? (await version(award)), amount],
      );
      return request;
    };
    let allocation: string, award: string, payout: string;
    await t.test(
      "upgrade preserves existing sales, stock and cash; defaults keep mini RB undistributed",
      async () => {
        const after = await totals();
        for (const key of [
          "prime_units",
          "mini_units",
          "guild_units",
          "inventory_units",
        ])
          assert.equal(after[key], before[key]);
        assert.equal(after.prime_reserved_units, "0");
        await assert.rejects(
          () => preview(mini.sale),
          /SOURCE_NOT_DISTRIBUTED/,
        );
        const s = await makeSale("prime", "10000", false);
        await assert.rejects(() => preview(s.sale), /ATTENDANCE_REQUIRED/);
      },
    );
    await t.test(
      "server selects exactly confirmed present members and detects forged/stale recipients",
      async () => {
        const p = await preview();
        assert.deepEqual(
          p.recipients.map((r) => r.id),
          recipients,
        );
        assert.equal(p.amount_units, "700000000");
        assert.equal(
          p.recipients.every((r) => r.amount_units === "350000000"),
          true,
        );
        await assert.rejects(
          () => allocate(original.sale, randomUUID(), [m[1], m[2]]),
          /ATTENDANCE_CHANGED/,
        );
        await assert.rejects(
          () => allocate(original.sale, randomUUID(), [m[2], m[2]]),
          /INVALID_RECIPIENTS/,
        );
        allocation = await allocate();
        award = await awardFor(allocation);
        assert.equal((await totals()).prime_reserved_units, "700000000");
        assert.equal((await totals()).prime_units, "700007000");
        await allocate(original.sale, allocation, [...recipients].reverse());
        assert.equal(
          await scalar(
            "select count(*)::int from public.treasury_awards where allocation_id=$1",
            [allocation],
          ),
          2,
        );
        await assert.rejects(() => allocate(), /ALREADY_ALLOCATED/);
        await assert.rejects(
          () =>
            db.query("select public.void_treasury_sale($1,'Ошибка продажи')", [
              original.sale,
            ]),
          /ALLOCATION_EXISTS/,
        );
      },
    );
    await t.test(
      "members see only own awards/payments and cannot allocate, pay, spend or write tables",
      async () => {
        await as(2);
        assert.equal(
          await scalar(
            "select count(*)::int from public.treasury_award_accounts",
          ),
          1,
        );
        assert.equal((await own()).allocated_units, "350000000");
        await assert.rejects(() => preview(), /FORBIDDEN/);
        await assert.rejects(
          () => pay(award, "1", randomUUID(), 1),
          /FORBIDDEN/,
        );
        await assert.rejects(
          () =>
            db.query(
              "select public.record_treasury_expense($1,1,'Тестовый расход')",
              [randomUUID()],
            ),
          /FORBIDDEN/,
        );
        await assert.rejects(
          () => db.query("update public.treasury_awards set amount_units=1"),
          /permission denied/,
        );
        await as(4);
        assert.equal(
          await scalar("select count(*)::int from public.treasury_awards"),
          0,
        );
        assert.equal((await own()).pending_units, "0");
        await as(1);
      },
    );
    await t.test(
      "partial payment reduces cash and debt once, cannot overpay or repeat stale form",
      async () => {
        payout = await pay(award, "100000000");
        await pay(award, "100000000", payout, 1);
        assert.equal((await totals()).prime_units, "600007000");
        assert.equal((await totals()).prime_reserved_units, "600000000");
        assert.equal((await totals()).prime_free_units, "7000");
        assert.equal((await totals()).mini_units, "50000000");
        await assert.rejects(
          () => pay(award, "100000000", randomUUID(), 1),
          /STALE_VERSION/,
        );
        await assert.rejects(() => pay(award, "250000001"), /OVERPAYMENT/);
        await as(2);
        assert.deepEqual(await own(), {
          allocated_units: "350000000",
          paid_units: "100000000",
          pending_units: "250000000",
        });
        assert.equal(
          await scalar("select count(*)::int from public.treasury_payout_log"),
          1,
        );
        await as(3);
        assert.equal(
          await scalar("select count(*)::int from public.treasury_payout_log"),
          0,
        );
        await as(1);
        await assert.rejects(
          () =>
            db.query(
              "select public.void_treasury_allocation($1,'Отмена распределения')",
              [allocation],
            ),
          /HAS_PAYOUTS/,
        );
      },
    );
    await t.test(
      "attendance correction pauses new payouts and does not silently rewrite prior debt",
      async () => {
        await db.query(
          "select public.mark_attendance($1,$2,2,'absent','Исправлена явка')",
          [original.event, m[3]],
        );
        await assert.rejects(() => pay(award, "1"), /ATTENDANCE_REQUIRED/);
        await db.query(
          "select public.finalize_attendance($1,(select version from public.events where id=$1))",
          [original.event],
        );
        await assert.rejects(() => pay(award, "1"), /ATTENDANCE_CHANGED/);
        assert.equal(
          await scalar(
            "select amount_units::text from public.treasury_awards where id=$1",
            [award],
          ),
          "350000000",
        );
        await db.query(
          "select public.mark_attendance($1,$2,3,'present','Уточнён первоначальный состав')",
          [original.event, m[3]],
        );
        await db.query(
          "select public.finalize_attendance($1,(select version from public.events where id=$1))",
          [original.event],
        );
      },
    );
    await t.test(
      "void payout restores cash/debt once; then allocation can be cancelled and reissued",
      async () => {
        await db.query(
          "select public.void_treasury_payout($1,'Ошибочная запись передачи')",
          [payout],
        );
        await db.query(
          "select public.void_treasury_payout($1,'Повтор отмены')",
          [payout],
        );
        assert.equal((await totals()).prime_units, "700007000");
        await assert.rejects(
          () => pay(award, "100000000", payout, 1),
          /PAYOUT_VOIDED/,
        );
        await db.query(
          "select public.void_treasury_allocation($1,'Новый расчёт долей')",
          [allocation],
        );
        assert.equal((await totals()).prime_reserved_units, "0");
        await assert.rejects(() => pay(award, "1"), /ALLOCATION_VOIDED/);
        await assert.rejects(
          () => allocate(original.sale, allocation),
          /ALLOCATION_VOIDED/,
        );
        allocation = await allocate();
        award = await awardFor(allocation);
        await as(2);
        assert.equal((await own()).allocated_units, "350000000");
        await as(1);
      },
    );
    await t.test(
      "tiny equal shares preserve every minimal unit and use stable UUID order",
      async () => {
        const s = await makeSale("prime", "10"),
          p = await preview(s.sale);
        assert.deepEqual(
          p.recipients.map((r) => r.amount_units),
          ["4", "3"],
        );
        const a = await allocate(s.sale);
        assert.equal(
          await scalar(
            "select sum(amount_units)::text from public.treasury_awards where allocation_id=$1",
            [a],
          ),
          "7",
        );
        await db.query(
          "select public.void_treasury_allocation($1,'Завершение теста')",
          [a],
        );
        await db.query(
          "select public.void_treasury_sale($1,'Завершение теста')",
          [s.sale],
        );
      },
    );
    await t.test(
      "guild expenses use only guild cash; retries/reversals preserve history and block income reversal",
      async () => {
        const amount = (await totals()).guild_units,
          expense = randomUUID();
        await db.query(
          "select public.record_treasury_expense($1,$2,'Расход гильдии')",
          [expense, amount],
        );
        await db.query(
          "select public.record_treasury_expense($1,$2,'Расход гильдии')",
          [expense, amount],
        );
        assert.equal((await totals()).guild_units, "0");
        assert.equal((await totals()).mini_units, "50000000");
        await assert.rejects(
          () =>
            db.query(
              "select public.record_treasury_expense($1,1,'Лишний расход')",
              [randomUUID()],
            ),
          /INSUFFICIENT_FUNDS/,
        );
        await db.query(
          "select public.void_treasury_allocation($1,'Проверка отмены продажи')",
          [allocation],
        );
        await assert.rejects(
          () =>
            db.query(
              "select public.void_treasury_sale($1,'Отмена потраченной продажи')",
              [original.sale],
            ),
          /FUNDS_SPENT/,
        );
        await db.query(
          "select public.void_treasury_expense($1,'Возврат расхода')",
          [expense],
        );
        await db.query(
          "select public.void_treasury_expense($1,'Повтор возврата')",
          [expense],
        );
        assert.equal((await totals()).guild_units, amount);
        const row = await db.query(
          "select purpose,void_reason,voided_by from public.treasury_expenses where id=$1",
          [expense],
        );
        assert.deepEqual(row.rows[0], {
          purpose: "Расход гильдии",
          void_reason: "Возврат расхода",
          voided_by: id(1),
        });
        await db.query(
          "select public.void_treasury_sale($1,'Отмена исправленной продажи')",
          [original.sale],
        );
        assert.equal((await totals()).prime_units, "7000");
        assert.equal((await totals()).guild_units, "3000");
      },
    );
    await t.test(
      "non-member/blocked sessions lose access and mutation errors roll back",
      async () => {
        const prior = await totals();
        await assert.rejects(
          () =>
            db.query("select public.record_treasury_expense($1,1,'x')", [
              randomUUID(),
            ]),
          /check constraint/,
        );
        assert.deepEqual(await totals(), prior);
        await as(6);
        await assert.rejects(() => own(), /FORBIDDEN/);
        assert.equal(
          await scalar("select count(*)::int from public.treasury_allocations"),
          0,
        );
        await as(1);
        await db.query("select public.set_member_blocked($1,true)", [m[2]]);
        await as(2);
        await assert.rejects(() => own(), /FORBIDDEN/);
        assert.equal(
          await scalar("select count(*)::int from public.treasury_payout_log"),
          0,
        );
      },
    );
  } finally {
    await db.close();
  }
});
