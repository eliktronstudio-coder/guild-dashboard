import type { Loot } from "./treasury";
export type InventoryWarehouse = "general" | "xd";
export function inventoryPosition(
  item: Loot,
  warehouse: InventoryWarehouse,
): Loot {
  const xd =
      item.xd_quantity ??
      (item.source === "mini_rb" ? item.quantity_remaining : 0),
    general = item.general_quantity ?? item.quantity_remaining - xd;
  const quantity = warehouse === "general" ? general : xd,
    reserved = warehouse === "xd" ? (item.auction_quantity ?? 0) : 0;
  return {
    ...item,
    warehouse,
    quantity_remaining: quantity,
    available_quantity: quantity - reserved,
    auction_quantity: reserved,
    estimated_total_units:
      item.estimated_unit_units === null
        ? null
        : String(BigInt(item.estimated_unit_units) * BigInt(quantity)),
  };
}

export function groupInventory(items: Loot[], warehouse: InventoryWarehouse) {
  const groups = new Map<string, { item: Loot; batches: Loot[] }>();
  for (const raw of items) {
    const item = inventoryPosition(raw, warehouse);
    if (item.quantity_remaining <= 0) continue;
    const key = JSON.stringify([
      item.source,
      item.category,
      item.name
        .normalize("NFKC")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("ru"),
    ]);
    const group = groups.get(key);
    if (!group) groups.set(key, { item: { ...item }, batches: [raw] });
    else {
      group.batches.push(raw);
      group.item.quantity_remaining += item.quantity_remaining;
      group.item.available_quantity =
        (group.item.available_quantity ?? 0) + (item.available_quantity ?? 0);
      group.item.auction_quantity =
        (group.item.auction_quantity ?? 0) + (item.auction_quantity ?? 0);
      // Different receipt prices must never appear as one unit price.
      if (group.item.estimated_unit_units !== item.estimated_unit_units)
        group.item.estimated_unit_units = null;
      group.item.estimated_total_units =
        group.item.estimated_total_units !== null &&
        item.estimated_total_units !== null
          ? String(
              BigInt(group.item.estimated_total_units) +
                BigInt(item.estimated_total_units),
            )
          : null;
    }
  }
  return [...groups.values()];
}
