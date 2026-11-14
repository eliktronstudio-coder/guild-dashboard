import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { memberDatabase, readyForSaleFixture, guild } from "./support/database";
test("posting immediately sells exact quantity × unit price, with no outstanding reservation or duplicate cash", async () => {
  const c = await memberDatabase(),
    { db } = c;
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
    await readyForSaleFixture(db);
    await c.as(1);
    const loot = randomUUID(),
      catalog = randomUUID(),
      request = randomUUID();
    await db.query(
      "select public.save_drop_registry($1,$2,0,'Предмет мгновенного аукциона','',10000)",
      [guild, catalog],
    );
    await db.query(
      "select public.add_registry_inventory($1,null,$2,1,'prime',10000,10,'')",
      [loot, catalog],
    );
    await c.as(2);
    await assert.rejects(
      db.query("select public.sell_inventory_auction_now($1,$2,1,3,1000000)", [
        request,
        loot,
      ]),
      /FORBIDDEN/,
    );
    await c.as(1);
    await db.query(
      "select public.sell_inventory_auction_now($1,$2,1,3,1000000)",
      [request, loot],
    );
    assert.equal(
      await c.scalar(
        "select quantity_remaining from public.treasury_inventory where id=$1",
        [loot],
      ),
      7,
    );
    assert.equal(
      await c.scalar(
        "select auction_quantity from public.treasury_inventory where id=$1",
        [loot],
      ),
      0,
    );
    assert.equal(
      await c.scalar(
        "select available_quantity from public.treasury_inventory where id=$1",
        [loot],
      ),
      7,
    );
    assert.equal(
      await c.scalar(
        "select status from public.inventory_auctions where id=$1",
        [request],
      ),
      "sold",
    );
    assert.equal(
      await c.scalar(
        "select gross_units::text from public.treasury_sales where id=$1",
        [request],
      ),
      "3000000",
    );
    assert.equal(
      await c.scalar(
        "select fund_units::text from public.treasury_sales where id=$1",
        [request],
      ),
      "2100000",
    );
    assert.equal(
      await c.scalar(
        "select guild_units::text from public.treasury_sales where id=$1",
        [request],
      ),
      "900000",
    );
    assert.equal(
      await c.scalar(
        "select buyer_name from public.treasury_sales where id=$1",
        [request],
      ),
      "Аукцион",
    );
    await db.query(
      "select public.sell_inventory_auction_now($1,$2,1,3,1000000)",
      [request, loot],
    );
    assert.equal(
      await c.scalar(
        "select count(*)::int from public.treasury_sales where loot_id=$1",
        [loot],
      ),
      1,
    );
    await assert.rejects(
      db.query("select public.sell_inventory_auction_now($1,$2,3,4,1000000)", [
        request,
        loot,
      ]),
      /REQUEST_CONFLICT/,
    );
    const stale = randomUUID();
    await assert.rejects(
      db.query("select public.sell_inventory_auction_now($1,$2,1,1,1000000)", [
        stale,
        loot,
      ]),
      /STALE_VERSION/,
    );
    assert.equal(
      await c.scalar(
        "select count(*)::int from public.inventory_auctions where id=$1",
        [stale],
      ),
      0,
    );
    await assert.rejects(
      db.query("select public.sell_inventory_auction_now($1,$2,3,8,1000000)", [
        randomUUID(),
        loot,
      ]),
      /INSUFFICIENT_STOCK/,
    );
    await assert.rejects(
      db.query(
        "select public.sell_inventory_auction_now($1,$2,3,2,100000000000000)",
        [randomUUID(), loot],
      ),
      /INVALID_AMOUNT/,
    );
    assert.equal(
      await c.scalar(
        "select quantity_remaining from public.treasury_inventory where id=$1",
        [loot],
      ),
      7,
    );
    const mini = randomUUID();
    await db.query(
      "select public.add_registry_inventory($1,null,$2,1,'mini_rb',10000,2,'')",
      [mini, catalog],
    );
    const sale = randomUUID();
    await db.query(
      "select public.sell_inventory_auction_now($1,$2,1,2,12345)",
      [sale, mini],
    );
    assert.equal(
      await c.scalar(
        "select fund_units::text from public.treasury_sales where id=$1",
        [sale],
      ),
      "24690",
    );
    assert.equal(
      await c.scalar(
        "select guild_units::text from public.treasury_sales where id=$1",
        [sale],
      ),
      "0",
    );
    const oldLot = randomUUID();
    await db.query("select public.list_inventory_auction($1,$2,3,2,10000)", [
      oldLot,
      loot,
    ]);
    await c.as(2);
    await assert.rejects(
      db.query("select public.sell_pending_auction_now($1,1)", [oldLot]),
      /FORBIDDEN/,
    );
    await c.as(1);
    await db.query("select public.sell_pending_auction_now($1,1)", [oldLot]);
    await db.query("select public.sell_pending_auction_now($1,1)", [oldLot]);
    assert.equal(
      await c.scalar(
        "select gross_units::text from public.treasury_sales where id=$1",
        [oldLot],
      ),
      "20000",
    );
    assert.equal(
      await c.scalar(
        "select quantity_remaining from public.treasury_inventory where id=$1",
        [loot],
      ),
      5,
    );
    assert.equal(
      await c.scalar(
        "select auction_quantity from public.treasury_inventory where id=$1",
        [loot],
      ),
      0,
    );
  } finally {
    await db.close();
  }
});
