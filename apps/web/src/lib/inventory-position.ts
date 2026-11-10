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
