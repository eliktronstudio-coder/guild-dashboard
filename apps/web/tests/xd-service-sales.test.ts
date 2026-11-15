import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { memberDatabase } from "./support/database";
async function setup() {
  const c = await memberDatabase();
  await c.db.exec("create role service_role");
  for (const file of (await readdir("supabase/migrations"))
    .sort()
    .filter(
      (f) =>
        f.endsWith(".sql") &&
        f > "202610310002_members.sql" &&
        !/^20261103001[78]/.test(f),
    ))
    await c.db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await c.as(1);
  return c;
}
test("XD experience and trash sales credit only Mini RB, preserve exact units, history, retries and attendance", async () => {
  const c = await setup();
  try {
    const ids = [randomUUID(), randomUUID()];
    for (const [index, kind] of ["rb_experience", "trash"].entries()) {
      const args = [ids[index], kind, "1500001", "Покупатель", "500 000 ед."];
      await c.db.query(
        "select public.record_xd_service_sale($1,$2,$3,$4,$5)",
        args,
      );
      await c.db.query(
        "select public.record_xd_service_sale($1,$2,$3,$4,$5)",
        args,
      );
      await assert.rejects(
        c.db.query("select public.record_xd_service_sale($1,$2,$3,$4,$5)", [
          args[0],
          args[1],
          "1500002",
          args[3],
          args[4],
        ]),
        /REQUEST_CONFLICT/,
      );
      const stock = await c.scalar<{
        quantity_remaining: number;
        xd_quantity: number;
        source: string;
      }>("select to_jsonb(v) from public.treasury_inventory v where id=$1", [
        ids[index],
      ]);
      assert.equal(stock.quantity_remaining, 0);
      assert.equal(stock.xd_quantity, 0);
      assert.equal(stock.source, "mini_rb");
    }
    assert.equal(
      await c.scalar("select count(*)::int from public.treasury_sales"),
      2,
    );
    assert.equal(
      await c.scalar("select sum(fund_units)::text from public.treasury_sales"),
      "3000002",
    );
    assert.equal(
      await c.scalar(
        "select sum(guild_units)::text from public.treasury_sales",
      ),
      "0",
    );
    assert.equal(
      await c.scalar(
        "select count(*)::int from public.events where counts_for_attendance or not inventory_receipt",
      ),
      0,
    );
    assert.equal(
      await c.scalar("select count(*)::int from public.attendance"),
      0,
    );
    assert.equal(
      await c.scalar("select count(*)::int from public.guild_drop_registry"),
      0,
    );
    assert.equal(
      await c.scalar(
        "select count(*)::int from public.treasury_sales where note like '%500 000 ед.%'",
      ),
      2,
    );
    await c.db.query(
      "select public.void_treasury_sale($1,'Ошибка суммы продажи')",
      [ids[0]],
    );
    assert.equal(
      await c.scalar(
        "select sum(fund_units)::text from public.treasury_sales where voided_at is null",
      ),
      "1500001",
    );
    await assert.rejects(
      c.db.query(
        "select public.record_xd_service_sale($1,'rb_experience',1500001,'Покупатель','500 000 ед.')",
        [ids[0]],
      ),
      /SALE_VOIDED/,
    );
  } finally {
    await c.db.close();
  }
});
test("XD service sales reject unauthorized users and invalid input atomically", async () => {
  const c = await setup();
  try {
    await c.as(2);
    await assert.rejects(
      c.db.query(
        "select public.record_xd_service_sale($1,'trash',10000,'Торговец','')",
        [randomUUID()],
      ),
      /FORBIDDEN/,
    );
    await c.as(1);
    for (const [kind, amount, buyer, note] of [
      [null, 10000, "Торговец", ""],
      ["prime", 10000, "Торговец", ""],
      ["trash", 0, "Торговец", ""],
      ["trash", 10000, "", ""],
      ["trash", 10000, "Торговец", "x".repeat(401)],
    ])
      await assert.rejects(
        c.db.query("select public.record_xd_service_sale($1,$2,$3,$4,$5)", [
          randomUUID(),
          kind,
          amount,
          buyer,
          note,
        ]),
        /INVALID_INPUT/,
      );
    assert.equal(
      await c.scalar("select count(*)::int from public.treasury_sales"),
      0,
    );
    assert.equal(await c.scalar("select count(*)::int from public.events"), 0);
    assert.equal(
      await c.scalar("select count(*)::int from public.treasury_loot"),
      0,
    );
  } finally {
    await c.db.close();
  }
});
