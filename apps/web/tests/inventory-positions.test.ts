import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { memberDatabase, guild } from "./support/database";
async function setup(before = false) {
  const c = await memberDatabase();
  await c.db.exec("create role service_role");
  for (const f of (await readdir("supabase/migrations"))
    .sort()
    .filter(
      (f) =>
        f.endsWith(".sql") &&
        f > "202610310002_members.sql" &&
        (!before || f < "202611100037") &&
        !/^20261103001[78]/.test(f),
    ))
    await c.db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  await c.as(1);
  return c;
}
test("general and XD positions conserve received stock and category; only transferred XD units can be sold", async () => {
  const c = await setup(),
    { db } = c;
  try {
    const item = randomUUID(),
      loot = randomUUID(),
      transfer = randomUUID();
    await db.query(
      "select public.save_drop_registry($1,$2,0,'Предмет двух складов','',10000)",
      [guild, item],
    );
    await db.query(
      "select public.add_registry_inventory($1,null,$2,1,'prime',10000,10,'')",
      [loot, item],
    );
    const stock = () =>
      c.scalar<{
        general_quantity: number;
        xd_quantity: number;
        quantity_total: number;
        quantity_remaining: number;
        version: number;
        source: string;
      }>("select to_jsonb(v) from public.treasury_inventory v where id=$1", [
        loot,
      ]);
    assert.equal((await stock()).general_quantity, 10);
    assert.equal((await stock()).xd_quantity, 0);
    await assert.rejects(
      db.query(
        "select public.record_inventory_sale($1,$2,1,1,10000,'Покупатель')",
        [randomUUID(), loot],
      ),
      /USE_XD_INVENTORY/,
    );
    await assert.rejects(
      db.query(
        "select public.sell_treasury_loot($1,$2,1,1,10000,'Обход интерфейса')",
        [randomUUID(), loot],
      ),
      /USE_XD_INVENTORY/,
    );
    await assert.rejects(
      db.query("select public.sell_inventory_auction_now($1,$2,1,1,10000)", [
        randomUUID(),
        loot,
      ]),
      /USE_XD_INVENTORY/,
    );
    await c.as(2);
    await assert.rejects(
      db.query("select public.transfer_inventory_to_xd($1,$2,1,4)", [
        transfer,
        loot,
      ]),
      /FORBIDDEN/,
    );
    await c.as(1);
    await db.query("select public.transfer_inventory_to_xd($1,$2,1,4)", [
      transfer,
      loot,
    ]);
    await db.query("select public.transfer_inventory_to_xd($1,$2,1,4)", [
      transfer,
      loot,
    ]);
    let s = await stock();
    assert.equal(s.general_quantity, 6);
    assert.equal(s.xd_quantity, 4);
    assert.equal(s.quantity_remaining, 10);
    assert.equal(s.quantity_total, 10);
    assert.equal(s.source, "prime");
    assert.equal(
      await c.scalar("select count(*)::int from public.treasury_sales"),
      0,
    );
    await assert.rejects(
      db.query(
        "select public.record_inventory_sale($1,$2,2,5,10000,'Покупатель')",
        [randomUUID(), loot],
      ),
      /USE_XD_INVENTORY/,
    );
    await db.query(
      "select public.record_inventory_sale($1,$2,2,2,200000,'Покупатель')",
      [randomUUID(), loot],
    );
    s = await stock();
    assert.equal(s.general_quantity, 6);
    assert.equal(s.xd_quantity, 2);
    assert.equal(s.quantity_remaining, 8);
    await db.query("select public.transfer_inventory_to_xd($1,$2,3,2)", [
      randomUUID(),
      loot,
    ]);
    const removal = randomUUID();
    await db.query(
      "select public.discard_inventory_position($1,$2,4,1,'general','Удалить из общего')",
      [removal, loot],
    );
    await db.query(
      "select public.discard_inventory_position($1,$2,5,1,'xd','Удалить из ХД')",
      [randomUUID(), loot],
    );
    await db.query(
      "select public.sell_inventory_auction_now($1,$2,6,1,100000)",
      [randomUUID(), loot],
    );
    await db.query(
      "select public.discard_inventory_position($1,$2,4,1,'general','Удалить из общего')",
      [removal, loot],
    );
    s = await stock();
    assert.equal(s.general_quantity, 3);
    assert.equal(s.xd_quantity, 2);
    assert.equal(s.quantity_remaining, 5);
    assert.equal(s.quantity_total, 10);
    assert.equal(
      await c.scalar(
        "select sum(fund_units)::text from public.treasury_sales where source='prime'",
      ),
      "210000",
    );
    assert.equal(
      await c.scalar(
        "select sum(guild_units)::text from public.treasury_sales",
      ),
      "90000",
    );
    const mini = randomUUID();
    await db.query(
      "select public.add_registry_inventory($1,null,$2,1,'mini_rb',10000,2,'')",
      [mini, item],
    );
    assert.equal(
      await c.scalar(
        "select xd_quantity from public.treasury_inventory where id=$1",
        [mini],
      ),
      0,
    );
    await db.query("select public.transfer_inventory_to_xd($1,$2,1,2)", [
      randomUUID(),
      mini,
    ]);
    const miniSale = randomUUID();
    await db.query(
      "select public.sell_inventory_auction_now($1,$2,2,2,10000)",
      [miniSale, mini],
    );
    assert.equal(
      await c.scalar(
        "select fund_units::text from public.treasury_sales where id=$1",
        [miniSale],
      ),
      "20000",
    );
    assert.equal(
      await c.scalar(
        "select guild_units::text from public.treasury_sales where id=$1",
        [miniSale],
      ),
      "0",
    );
  } finally {
    await db.close();
  }
});
test("warehouse migration preserves existing Mini RB stock, reserves and money", async () => {
  const c = await setup(true),
    { db } = c;
  try {
    const item = randomUUID(),
      prime = randomUUID(),
      mini = randomUUID(),
      lot = randomUUID();
    await db.query(
      "select public.save_drop_registry($1,$2,0,'Предмет миграции складов','',10000)",
      [guild, item],
    );
    await db.query(
      "select public.add_registry_inventory($1,null,$2,1,'prime',10000,10,'')",
      [prime, item],
    );
    await db.query(
      "select public.add_registry_inventory($1,null,$2,1,'mini_rb',10000,5,'')",
      [mini, item],
    );
    await db.query("select public.list_inventory_auction($1,$2,1,3,10000)", [
      lot,
      prime,
    ]);
    await db.exec("reset role");
    await db.exec(
      await readFile(
        "supabase/migrations/202611100037_inventory_positions.sql",
        "utf8",
      ),
    );
    await c.as(1);
    assert.equal(
      await c.scalar(
        "select xd_quantity from public.treasury_inventory where id=$1",
        [mini],
      ),
      5,
    );
    assert.equal(
      await c.scalar(
        "select general_quantity from public.treasury_inventory where id=$1",
        [prime],
      ),
      7,
    );
    assert.equal(
      await c.scalar(
        "select xd_quantity from public.treasury_inventory where id=$1",
        [prime],
      ),
      3,
    );
    await db.query("select public.sell_pending_auction_now($1,1)", [lot]);
    assert.equal(
      await c.scalar(
        "select general_quantity from public.treasury_inventory where id=$1",
        [prime],
      ),
      7,
    );
    assert.equal(
      await c.scalar(
        "select xd_quantity from public.treasury_inventory where id=$1",
        [prime],
      ),
      0,
    );
  } finally {
    await db.close();
  }
});
