import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { memberDatabase, readyForSaleFixture, guild } from "./support/database";
import { payrollDue, type LifetimePayrollReport } from "../src/lib/payroll";
import { dashboardPeriod } from "../src/lib/dashboard";
async function setup() {
  const c = await memberDatabase();
  await c.db.exec("create role service_role");
  for (const f of (await readdir("supabase/migrations"))
    .sort()
    .filter((f) => f.endsWith(".sql") && f > "202610310002_members.sql"))
    await c.db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  await readyForSaleFixture(c.db);
  await c.db.query(
    "update public.memberships set joined_at='2020-01-01',payout_weight=case when id=$1 then 125 else 100 end",
    [c.members[2]],
  );
  const date = dashboardPeriod({ period: "previous" }).from;
  async function event(present: string[], weight = 100, source = "prime") {
    await c.as(1);
    await c.db.query("select public.record_activity($1,$2::jsonb)", [
      randomUUID(),
      JSON.stringify({
        title: source === "prime" ? "Анталлон" : "АГЛ",
        starts_at: date + "T12:00:00Z",
        status: "completed",
        kind: "raid",
        source,
        weight,
        reward_units: null,
        difficulty: "normal",
        night: false,
        counts: true,
        members: present,
        guests: [],
        evidence: [],
        loot: [],
        facts: {},
      }),
    ]);
  }
  async function sale(source = "prime", amount = 300003) {
    await c.as(1);
    const item = randomUUID(),
      receipt = randomUUID();
    await c.db.query("select public.save_drop_registry($1,$2,0,$3,'',10000)", [
      guild,
      item,
      "Предмет " + item,
    ]);
    await c.db.query(
      "select public.add_registry_inventory($1,null,$2,1,$3,10000,1,'')",
      [receipt, item, source],
    );
    const saleId = randomUUID();
    await c.db.query(
      "select public.sell_treasury_loot($1,$2,1,1,$3,'Продажа для ЗП')",
      [saleId, receipt, amount],
    );
    return saleId;
  }
  const report = () =>
    c.scalar<LifetimePayrollReport>("select public.lifetime_payroll_report()");
  const pay = (
    request: string,
    member: string,
    source: string,
    signature: string | null,
  ) =>
    c.db.query("select public.pay_lifetime_salary($1,$2,$3,$4)", [
      request,
      member,
      source,
      signature,
    ]);
  const count = async (table: string) => {
    await c.db.exec("reset role");
    const n = await c.scalar<number>(
      `select count(*)::int from public.${table}`,
    );
    await c.as(1);
    return n;
  };
  async function seed() {
    for (const source of ["prime", "mini_rb"])
      for (let i = 0; i < 10; i++)
        await event(
          [
            ...(i < 2 ? [c.members[2]] : []),
            ...(i < 5 ? [c.members[3]] : []),
            ...(i < 1 ? [c.members[4]] : []),
          ],
          100,
          source,
        );
    await sale();
    await sale("mini_rb", 100007);
    // Historical receipts fixture only. No production guard is changed by the feature.
    await c.db.exec(
      "reset role;alter table public.treasury_sales disable trigger sale_period",
    );
    await c.db.query(
      "update public.treasury_sales set accounting_period=$1,created_at=$2",
      [date, date + "T13:00:00Z"],
    );
    await c.db.exec(
      "alter table public.treasury_sales enable trigger sale_period",
    );
    await c.as(1);
  }
  return { ...c, event, sale, report, pay, count, seed };
}
test("lifetime salary: exact 20% qualification, coefficients, both sources, durable separate paid state, retries and new-sale topups", async () => {
  const c = await setup();
  try {
    await c.seed();
    let r = await c.report();
    let m = r.rows.find((r) => r.id === c.members[2])!;
    assert.equal(m.percentage, 20);
    assert.equal(m.eligible, true);
    assert.equal(r.rows.find((r) => r.id === c.members[4])!.eligible, false);
    assert.equal(m.prime_projection, "70001");
    assert.equal(m.mini_projection, "33336");
    assert.equal(
      r.rows.reduce((n, r) => n + BigInt(r.prime_projection), 0n),
      210003n,
    );
    assert.equal(
      r.rows.reduce((n, r) => n + BigInt(r.mini_projection), 0n),
      100007n,
    );
    const request = randomUUID(),
      old = r.signature!;
    await c.pay(request, m.id, "prime", old);
    r = await c.report();
    m = r.rows.find((r) => r.id === m.id)!;
    assert.equal(payrollDue(m, "prime"), "0");
    assert.equal(m.prime_paid, "70001");
    assert.equal(payrollDue(m, "mini"), "33336");
    assert.equal(m.mini_paid, "0");
    const cash = await c.scalar<Record<string, string>>(
      "select public.treasury_lifetime_summary()",
    );
    assert.equal(cash.prime_units, "140002");
    assert.equal(cash.mini_units, "100007");
    assert.equal(cash.guild_units, "90000");
    await c.pay(request, m.id, "prime", old);
    assert.equal(await c.count("salary_payment_requests"), 1);
    assert.equal(await c.count("treasury_payouts"), 1);
    await assert.rejects(
      c.pay(randomUUID(), m.id, "prime", old),
      /CALCULATION_CHANGED/,
    );
    await assert.rejects(
      c.pay(request, c.members[3], "prime", old),
      /REQUEST_CONFLICT/,
    );
    await assert.rejects(
      c.pay(randomUUID(), m.id, "prime", r.signature),
      /NOTHING_TO_PAY/,
    );
    await c.pay(randomUUID(), m.id, "mini_rb", r.signature);
    r = await c.report();
    m = r.rows.find((r) => r.id === m.id)!;
    assert.equal(payrollDue(m, "mini"), "0");
    assert.equal(m.mini_paid, "33336");
    assert.equal(m.prime_paid, "70001");
    const otherBefore = r.rows.find((r) => r.id === c.members[3])!.prime_fixed;
    await c.sale("prime", 300000);
    r = await c.report();
    m = r.rows.find((r) => r.id === m.id)!;
    assert.equal(m.prime_paid, "70001");
    assert.ok(BigInt(payrollDue(m, "prime")) > 0n);
    assert.equal(
      r.rows.find((r) => r.id === c.members[3])!.prime_fixed,
      otherBefore,
    );
    await c.pay(randomUUID(), m.id, "prime", r.signature);
    r = await c.report();
    m = r.rows.find((r) => r.id === m.id)!;
    assert.equal(payrollDue(m, "prime"), "0");
    assert.ok(BigInt(m.prime_paid) > 70001n);
    const paidBefore = BigInt(m.prime_paid);
    const firstPayout = await c.scalar<string>(
      "select p.id from public.treasury_payouts p join public.treasury_awards w on w.id=p.award_id join public.treasury_allocations a on a.id=w.allocation_id join public.treasury_sales s on s.id=a.sale_id where w.membership_id=$1 and s.source='prime' and p.amount_units=70001 limit 1",
      [m.id],
    );
    await c.db.query(
      "select public.void_treasury_payout($1,'Исправление выплаты')",
      [firstPayout],
    );
    r = await c.report();
    m = r.rows.find((r) => r.id === m.id)!;
    assert.equal(payrollDue(m, "prime"), "70001");
    assert.equal(BigInt(m.prime_paid), paidBefore - 70001n);
    const countBefore = await c.count("treasury_payouts");
    await c.pay(request, m.id, "prime", old);
    assert.equal(await c.count("treasury_payouts"), countBefore);
    await c.pay(randomUUID(), m.id, "prime", r.signature);
    r = await c.report();
    m = r.rows.find((r) => r.id === m.id)!;
    assert.equal(payrollDue(m, "prime"), "0");
    assert.equal(BigInt(m.prime_paid), paidBefore);
  } finally {
    await c.db.close();
  }
});
test("lifetime salary: stale snapshots, wrong source/member and missing permissions create no payments", async () => {
  const c = await setup();
  try {
    await c.seed();
    let r = await c.report();
    await assert.rejects(
      c.pay(randomUUID(), c.members[4], "prime", r.signature),
      /NOT_ELIGIBLE/,
    );
    await assert.rejects(
      c.pay(randomUUID(), randomUUID(), "prime", r.signature),
      /NOT_ELIGIBLE/,
    );
    await assert.rejects(
      c.pay(randomUUID(), c.members[2], "guild", r.signature),
      /INVALID_INPUT/,
    );
    const old = r.signature;
    await c.sale("prime", 10000);
    await assert.rejects(
      c.pay(randomUUID(), c.members[2], "prime", old),
      /CALCULATION_CHANGED/,
    );
    assert.equal(await c.count("salary_payment_requests"), 0);
    assert.equal(await c.count("treasury_payouts"), 0);
    assert.equal(await c.count("treasury_allocations"), 0);
    r = await c.report();
    await c.as(2);
    await assert.rejects(
      c.pay(randomUUID(), c.members[2], "prime", r.signature),
      /FORBIDDEN/,
    );
    await c.db.exec(
      "reset role;delete from public.role_permissions where permission='members.read' and role_id in(select id from public.roles where code='member')",
    );
    await c.as(2);
    const own = await c.report();
    assert.deepEqual(
      own.rows.map((r) => r.id),
      [c.members[2]],
    );
    assert.equal(own.signature, null);
    assert.ok(!("points" in own) && !("sales" in own));
    await assert.rejects(
      c.db.query("select * from public.salary_payment_requests"),
      /permission denied/,
    );
    await c.db.exec("reset role;set role anon");
    await assert.rejects(c.report(), /permission denied/);
  } finally {
    await c.db.close();
  }
});
test("lifetime salary: failed payment rolls back allocations, awards, batch, request and cash; retry succeeds", async () => {
  const c = await setup();
  try {
    await c.seed();
    const r = await c.report(),
      request = randomUUID();
    await c.db.exec(
      "reset role;create function private.fixture_reject_salary() returns trigger language plpgsql as $$begin raise exception 'SIMULATED_PAYOUT_FAILURE';end$$;create trigger fixture_reject_salary before insert on public.treasury_payouts for each row execute function private.fixture_reject_salary()",
    );
    await c.as(1);
    await assert.rejects(
      c.pay(request, c.members[2], "prime", r.signature),
      /SIMULATED_PAYOUT_FAILURE/,
    );
    for (const table of [
      "salary_payment_requests",
      "treasury_payouts",
      "treasury_allocations",
      "treasury_awards",
      "payroll_batches",
    ])
      assert.equal(await c.count(table), 0, table);
    assert.equal(
      (
        await c.scalar<Record<string, string>>(
          "select public.treasury_lifetime_summary()",
        )
      ).prime_units,
      "210003",
    );
    await c.db.exec(
      "reset role;drop trigger fixture_reject_salary on public.treasury_payouts",
    );
    await c.as(1);
    await c.pay(request, c.members[2], "prime", r.signature);
    assert.equal(await c.count("salary_payment_requests"), 1);
  } finally {
    await c.db.close();
  }
});
test("lifetime salary: rounded 20% below exact threshold is not eligible; funds stay unallocated when nobody qualifies", async () => {
  const c = await setup();
  try {
    for (let i = 0; i < 51; i++) await c.event(i < 10 ? [c.members[2]] : []);
    await c.sale();
    const r = await c.report(),
      m = r.rows.find((r) => r.id === c.members[2])!;
    assert.equal(m.percentage, 20);
    assert.equal(m.eligible, false);
    assert.equal(m.prime_projection, "0");
    await assert.rejects(
      c.pay(randomUUID(), m.id, "prime", r.signature),
      /NOT_ELIGIBLE/,
    );
    assert.equal(await c.count("treasury_allocations"), 0);
  } finally {
    await c.db.close();
  }
});

test("lifetime salary preserves payments recorded by the existing period workflow", async () => {
  const c = await setup();
  try {
    await c.seed();
    const previous = dashboardPeriod({ period: "previous" });
    const old = await c.scalar<import("../src/lib/payroll").PayrollReport>(
      "select public.period_payroll_report($1)",
      [previous.from],
    );
    await c.db.query(
      "select public.pay_period_member($1,$2,$3,'prime',$4,'Ранее проведённая выплата')",
      [randomUUID(), previous.from, c.members[2], old.signature],
    );
    const original = await c.db.query<{ id: string; amount_units: string }>(
      "select id,amount_units::text from public.treasury_payouts order by id",
    );
    let r = await c.report(),
      m = r.rows.find((r) => r.id === c.members[2])!;
    assert.equal(m.prime_paid, "70001");
    assert.equal(payrollDue(m, "prime"), "0");
    await assert.rejects(
      c.pay(randomUUID(), m.id, "prime", r.signature),
      /NOTHING_TO_PAY/,
    );
    assert.equal(await c.count("salary_payment_requests"), 0);
    await c.pay(randomUUID(), m.id, "mini_rb", r.signature);
    r = await c.report();
    m = r.rows.find((r) => r.id === m.id)!;
    assert.equal(m.prime_paid, "70001");
    assert.equal(m.mini_paid, "33336");
    for (const originalRow of original.rows) {
      const current = await c.db.query(
        "select id,amount_units::text from public.treasury_payouts where id=$1",
        [originalRow.id],
      );
      assert.deepEqual(current.rows[0], originalRow);
    }
  } finally {
    await c.db.close();
  }
});

test("category salary: independent eligibility and automatic sale/void recalculation", async () => {
  const c = await setup();
  try {
    for (let i = 0; i < 10; i++) {
      await c.event([
        ...(i < 1 ? [c.members[2]] : []),
        ...(i < 5 ? [c.members[3]] : []),
      ]);
      await c.event(
        [...(i < 5 ? [c.members[2]] : []), ...(i < 1 ? [c.members[3]] : [])],
        100,
        "mini_rb",
      );
    }
    const prime = await c.sale("prime", 100000);
    await c.sale("mini_rb", 100000);
    let r = await c.report();
    const a = r.rows.find((r) => r.id === c.members[2])!,
      b = r.rows.find((r) => r.id === c.members[3])!;
    assert.equal(a.prime_eligible, false);
    assert.equal(a.mini_eligible, true);
    assert.equal(b.prime_eligible, true);
    assert.equal(b.mini_eligible, false);
    assert.equal(payrollDue(a, "prime"), "0");
    assert.equal(payrollDue(a, "mini"), "100000");
    assert.equal(payrollDue(b, "prime"), "70000");
    assert.equal(payrollDue(b, "mini"), "0");
    await assert.rejects(
      c.pay(randomUUID(), a.id, "prime", r.signature),
      /NOT_ELIGIBLE/,
    );
    const extra = await c.sale("mini_rb", 50000);
    r = await c.report();
    assert.equal(
      payrollDue(
        r.rows.find((r) => r.id === a.id)!,
        "mini",
      ),
      "150000",
    );
    await c.db.query(
      "select public.void_treasury_sale($1,'Отмена ошибочной продажи')",
      [extra],
    );
    r = await c.report();
    assert.equal(
      payrollDue(
        r.rows.find((r) => r.id === a.id)!,
        "mini",
      ),
      "100000",
    );
    await c.pay(randomUUID(), b.id, "prime", r.signature);
    await assert.rejects(
      c.db.query(
        "select public.void_treasury_sale($1,'Уже выплаченная продажа')",
        [prime],
      ),
      /FUNDS_SPENT/,
    );
    await c.as(2);
    await assert.rejects(
      c.db.query("select public.recalculate_category_salary()"),
      /FORBIDDEN/,
    );
  } finally {
    await c.db.close();
  }
});

test("category salary: repair frozen awards preserves payouts and recalculates attendance changes", async () => {
  const c = await setup();
  try {
    await c.seed();
    await c.db.exec("reset role");
    await c.db.query(
      "select private.freeze_lifetime_sales($1,private.lifetime_payroll_before_categories($1))",
      [guild],
    );
    await c.as(1);
    const w = (
      await c.db.query<{ id: string; version: number }>(
        "select id,version from public.treasury_awards where membership_id=$1 order by id limit 1",
        [c.members[3]],
      )
    ).rows[0];
    await c.db.query(
      "select public.pay_treasury_award($1,$2,$3,10000,'Сохранённая выплата')",
      [randomUUID(), w.id, w.version],
    );
    const before = (
      await c.db.query("select * from public.treasury_payouts order by id")
    ).rows;
    await c.db.exec("reset role");
    await c.db.query(
      "update public.attendance set mark='present' where membership_id=$1",
      [c.members[4]],
    );
    await c.as(1);
    let r = await c.report();
    let m = r.rows.find((r) => r.id === c.members[4])!;
    assert.ok(BigInt(payrollDue(m, "prime")) > 0n);
    assert.ok(BigInt(payrollDue(m, "mini")) > 0n);
    const quote = r.rows.map((r) => [
      r.id,
      payrollDue(r, "prime"),
      payrollDue(r, "mini"),
    ]);
    assert.ok(
      (await c.scalar<number>("select public.recalculate_category_salary()")) >
        0,
    );
    assert.equal(
      await c.scalar<number>("select public.recalculate_category_salary()"),
      0,
    );
    assert.deepEqual(
      (await c.db.query("select * from public.treasury_payouts order by id"))
        .rows,
      before,
    );
    r = await c.report();
    assert.deepEqual(
      r.rows.map((r) => [r.id, payrollDue(r, "prime"), payrollDue(r, "mini")]),
      quote,
    );
    assert.equal(
      r.rows.reduce(
        (n, r) => n + BigInt(payrollDue(r, "prime")) + BigInt(r.prime_paid),
        0n,
      ),
      210003n,
    );
    assert.equal(
      r.rows.reduce(
        (n, r) => n + BigInt(payrollDue(r, "mini")) + BigInt(r.mini_paid),
        0n,
      ),
      100007n,
    );
    await c.pay(randomUUID(), m.id, "prime", r.signature);
    r = await c.report();
    assert.equal(
      payrollDue(
        r.rows.find((r) => r.id === m.id)!,
        "prime",
      ),
      "0",
    );
    await c.db.exec("reset role");
    await c.db.query(
      "update public.attendance set mark='absent' where membership_id=$1",
      [m.id],
    );
    await c.as(1);
    r = await c.report();
    m = r.rows.find((r) => r.id === m.id)!;
    assert.equal(m.prime_eligible, false);
    assert.equal(payrollDue(m, "prime"), "0");
    assert.ok(BigInt(m.prime_paid) > 0n);
    assert.equal(
      r.rows.reduce(
        (n, r) => n + BigInt(payrollDue(r, "prime")) + BigInt(r.prime_paid),
        0n,
      ),
      210003n,
    );
  } finally {
    await c.db.close();
  }
});

test("weighted Prime and Mini RB use 0.5/1/1.5 difficulty consistently and preserve payouts", async () => {
  const c = await setup();
  try {
    for (const source of ["prime", "mini_rb"]) {
      await c.event([c.members[2]], 50, source);
      await c.event([c.members[2]], 100, source);
      await c.event([c.members[3]], 150, source);
    }
    await c.sale("mini_rb", 100000);
    let r = await c.report();
    const a = r.rows.find((r) => r.id === c.members[2])!,
      b = r.rows.find((r) => r.id === c.members[3])!;
    assert.equal(a.prime_percentage, 50);
    assert.equal(a.mini_percentage, 50);
    assert.equal(a.mini_present, 2);
    assert.equal(a.mini_total, 3);
    assert.equal(a.mini_eligible, true);
    assert.equal(a.mini_projection, "55556");
    assert.equal(b.mini_projection, "44444");
    const lifetime = await c.db.query<any>(
      "select * from public.all_time_attendance_report() where id=$1",
      [a.id],
    );
    assert.equal(Number(lifetime.rows[0].mini_percentage), 50);
    const when = dashboardPeriod({ period: "previous" });
    const category = await c.db.query<any>(
      "select * from public.attendance_category_report($1,$2) where membership_id=$3",
      [when.from + "T00:00:00Z", when.until, a.id],
    );
    assert.equal(Number(category.rows[0].mini_percentage), 50);
    await c.pay(randomUUID(), a.id, "mini_rb", r.signature);
    const paid = (
      await c.db.query("select * from public.treasury_payouts order by id")
    ).rows;
    await c.event([], 150, "mini_rb");
    r = await c.report();
    assert.equal(r.rows.find((r) => r.id === a.id)!.mini_percentage, 33);
    assert.deepEqual(
      (await c.db.query("select * from public.treasury_payouts order by id"))
        .rows,
      paid,
    );
  } finally {
    await c.db.close();
  }
});
test("weighted Mini RB uses exact 20% threshold rather than rounded display or event count", async () => {
  const c = await setup();
  try {
    await c.event([c.members[2]], 100, "mini_rb");
    await c.event([], 410, "mini_rb");
    await c.sale("mini_rb");
    const r = await c.report(),
      m = r.rows.find((r) => r.id === c.members[2])!;
    assert.equal(m.mini_percentage, 20);
    assert.equal(m.mini_eligible, false);
    assert.equal(m.mini_projection, "0");
    await assert.rejects(
      c.pay(randomUUID(), m.id, "mini_rb", r.signature),
      /NOT_ELIGIBLE/,
    );
  } finally {
    await c.db.close();
  }
});
