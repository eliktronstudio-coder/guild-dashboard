import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { memberDatabase, readyForSaleFixture, guild } from "./support/database";
test("auction reservation, partial sale, cancellation, direct buyer and audited quantity deletion conserve stock and cash", async () => {
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
      listing = randomUUID(),
      disposal = randomUUID(),
      direct = randomUUID(),
      auctionSale = randomUUID();
    await db.query(
      "select public.save_drop_registry($1,$2,0,'Адамантовый коготь','',10000)",
      [guild, catalog],
    );
    await db.query(
      "select public.add_registry_inventory($1,null,$2,1,'prime',10000,10,'')",
      [loot, catalog],
    );
    const stock = () =>
      c.scalar<{
        quantity_remaining: number;
        auction_quantity: number;
        available_quantity: number;
        version: number;
      }>("select to_jsonb(v) from public.treasury_inventory v where id=$1", [
        loot,
      ]);
    const cash = () =>
      c.scalar<string>("select private.fund_balance($1,'prime')::text", [
        guild,
      ]);
    await c.as(2);
    await assert.rejects(
      db.query("select public.list_inventory_auction($1,$2,1,6,10000)", [
        listing,
        loot,
      ]),
      /FORBIDDEN/,
    );
    await assert.rejects(
      db.query("select public.discard_inventory_stock($1,$2,1,1,'Нет прав')", [
        disposal,
        loot,
      ]),
      /FORBIDDEN/,
    );
    await c.as(1);
    await db.query("select public.list_inventory_auction($1,$2,1,6,10000)", [
      listing,
      loot,
    ]);
    await db.query("select public.list_inventory_auction($1,$2,1,6,10000)", [
      listing,
      loot,
    ]);
    assert.equal((await stock()).quantity_remaining, 10);
    assert.equal((await stock()).auction_quantity, 6);
    assert.equal((await stock()).available_quantity, 4);
    await db.exec("reset role");
    assert.equal(await cash(), "0");
    await c.as(1);
    await assert.rejects(
      db.query(
        "select public.sell_treasury_loot($1,$2,2,5,10000,'Попытка обойти резерв')",
        [randomUUID(), loot],
      ),
      /STOCK_RESERVED/,
    );
    await assert.rejects(
      db.query(
        "select public.revise_treasury_loot($1,2,'Адамантовый коготь','Прайм',5,10000,'','Обход резерва')",
        [loot],
      ),
      /STOCK_RESERVED/,
    );
    await assert.rejects(
      db.query(
        "select public.discard_inventory_stock($1,$2,2,5,'Слишком много')",
        [randomUUID(), loot],
      ),
      /INSUFFICIENT_STOCK/,
    );
    await db.query(
      "select public.discard_inventory_stock($1,$2,2,2,'Удалены ошибочные предметы')",
      [disposal, loot],
    );
    await db.query(
      "select public.discard_inventory_stock($1,$2,2,2,'Удалены ошибочные предметы')",
      [disposal, loot],
    );
    assert.equal((await stock()).quantity_remaining, 8);
    assert.equal((await stock()).available_quantity, 2);
    await db.query(
      "select public.record_inventory_sale($1,$2,3,2,40000,'Лиса')",
      [direct, loot],
    );
    await db.query(
      "select public.record_inventory_sale($1,$2,3,2,40000,'Лиса')",
      [direct, loot],
    );
    assert.equal((await stock()).quantity_remaining, 6);
    assert.equal((await stock()).available_quantity, 0);
    assert.equal(
      await c.scalar(
        "select buyer_name from public.treasury_sales_log where id=$1",
        [direct],
      ),
      "Лиса",
    );
    await db.query(
      "select public.complete_inventory_auction($1,$2,1,4,3,90000,'Аукцион')",
      [auctionSale, listing],
    );
    await db.query(
      "select public.complete_inventory_auction($1,$2,1,4,3,90000,'Аукцион')",
      [auctionSale, listing],
    );
    assert.equal((await stock()).quantity_remaining, 3);
    assert.equal((await stock()).auction_quantity, 3);
    assert.equal((await stock()).available_quantity, 0);
    assert.equal(
      await c.scalar(
        "select sale_channel from public.treasury_sales_log where id=$1",
        [auctionSale],
      ),
      "auction",
    );
    await db.exec("reset role");
    assert.equal(await cash(), "91000");
    await c.as(1);
    await db.query("select public.cancel_inventory_auction($1,2)", [listing]);
    await db.query("select public.cancel_inventory_auction($1,2)", [listing]);
    assert.equal((await stock()).available_quantity, 3);
    assert.equal((await stock()).version, 6);
    await db.query(
      "select public.discard_inventory_stock($1,$2,6,1,'Списание повреждённого предмета')",
      [randomUUID(), loot],
    );
    assert.equal((await stock()).quantity_remaining, 2);
    assert.equal(
      await c.scalar("select count(*)::int from public.inventory_disposals"),
      2,
    );
    await db.query(
      "select public.void_treasury_sale($1,'Возврат покупателю')",
      [direct],
    );
    assert.equal((await stock()).quantity_remaining, 4);
    await db.exec("reset role");
    assert.equal(await cash(), "63000");
    assert.equal(
      await c.scalar(
        "select has_table_privilege('authenticated','public.inventory_auctions','update')",
      ),
      false,
    );
    assert.equal(
      await c.scalar(
        "select has_function_privilege('authenticated','private.auction_reserved(uuid)','execute')",
      ),
      false,
    );
  } finally {
    await db.close();
  }
});
