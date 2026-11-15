import { test } from "node:test";
import assert from "node:assert/strict";
import { groupInventory } from "../src/lib/inventory-position";
import type { Loot } from "../src/lib/treasury";
const item = (id: string, changes: Partial<Loot> = {}): Loot => ({
  id,
  event_id: id,
  source: "prime",
  name: "Эссенция кошмара",
  category: "Дроп",
  quantity_total: 5,
  quantity_remaining: 5,
  general_quantity: 3,
  xd_quantity: 2,
  auction_quantity: 1,
  estimated_unit_units: "100",
  estimated_total_units: "500",
  note: "",
  version: 1,
  event_title: id,
  ...changes,
});
test("groups receipts before pagination, totals each warehouse and retains original action IDs", () => {
  const rows = Array.from({ length: 25 }, (_, n) => item(String(n)));
  const general = groupInventory(rows, "general");
  assert.equal(general.length, 1);
  assert.equal(general[0].item.quantity_remaining, 75);
  assert.equal(general[0].item.available_quantity, 75);
  assert.equal(general[0].item.estimated_total_units, "7500");
  assert.deepEqual(
    general[0].batches.map((x) => x.id),
    rows.map((x) => x.id),
  );
  const xd = groupInventory(rows, "xd")[0];
  assert.equal(xd.item.quantity_remaining, 50);
  assert.equal(xd.item.available_quantity, 25);
  assert.equal(xd.item.auction_quantity, 25);
  assert.equal(rows[0].quantity_remaining, 5);
});
test("separates names, accounting sources and item types; excludes empty positions", () => {
  assert.equal(
    groupInventory(
      [
        item("1"),
        item("2", { name: "  эссенция   кошмара " }),
        item("3", { source: "mini_rb" }),
        item("4", { category: "Другое" }),
        item("5", { name: "Эссенция ужаса" }),
        item("6", { general_quantity: 0 }),
      ],
      "general",
    ).length,
    4,
  );
});
test("does not misrepresent different receipt prices or combine their mutations", () => {
  const a = item("a"),
    b = item("b", { estimated_unit_units: "200", archived_period: "2026-10" });
  const group = groupInventory([a, b], "general")[0];
  assert.equal(group.item.estimated_unit_units, null);
  assert.equal(group.item.estimated_total_units, "900");
  assert.equal(group.batches[1].archived_period, "2026-10");
  assert.equal(group.batches[1].estimated_unit_units, "200");
});
