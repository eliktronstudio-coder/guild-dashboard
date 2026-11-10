"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/access";
import { checkOrigin, field } from "@/lib/mutations";
import { isUuid } from "@/lib/members";
import { parseGold, treasuryError } from "@/lib/treasury";
import type { FormState } from "@/lib/identity";
const integer = (f: FormData, key: string) =>
  /^\d{1,10}$/.test(field(f, key)) ? Number(field(f, key)) : NaN;
export async function transferInventoryToXd(
  _: FormState,
  f: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("treasury.manage");
  const request = field(f, "requestId"),
    loot = field(f, "lootId"),
    version = integer(f, "version"),
    quantity = integer(f, "quantity");
  if (
    !isUuid(request) ||
    !isUuid(loot) ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 1000000
  )
    return { error: "Укажите доступное количество для переноса." };
  const { error } = await a.client.rpc("transfer_inventory_to_xd", {
    p_request: request,
    p_loot: loot,
    p_version: version,
    p_quantity: quantity,
  });
  if (error) return { error: treasuryError(error.message) };
  revalidatePath("/", "layout");
  redirect("/treasury#inventory");
}
export async function settlePendingAuctions(
  pending: { id: string; version: number }[],
): Promise<{ settled: number; error?: string }> {
  await checkOrigin();
  const a = await requirePermission("treasury.manage");
  if (
    !Array.isArray(pending) ||
    pending.length > 20 ||
    pending.some(
      (x) =>
        !x ||
        !isUuid(x.id) ||
        !Number.isSafeInteger(x.version) ||
        x.version < 1,
    )
  )
    return {
      settled: 0,
      error: "Не удалось проверить ранее выставленные лоты.",
    };
  let settled = 0;
  for (const lot of pending) {
    const { error } = await a.client.rpc("sell_pending_auction_now", {
      p_auction: lot.id,
      p_version: lot.version,
    });
    if (error) {
      if (settled) revalidatePath("/", "layout");
      return { settled, error: treasuryError(error.message) };
    }
    settled++;
  }
  if (settled) revalidatePath("/", "layout");
  return { settled };
}
async function mutate(
  name: string,
  payload: Record<string, unknown>,
  success: string,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("treasury.manage");
  const { error } = await a.client.rpc(name, payload);
  if (error) return { error: treasuryError(error.message) };
  revalidatePath("/", "layout");
  return { success };
}
export async function recordInventorySale(
  _: FormState,
  f: FormData,
): Promise<FormState> {
  const request = field(f, "requestId"),
    loot = field(f, "lootId"),
    version = integer(f, "version"),
    quantity = integer(f, "quantity"),
    amount = parseGold(field(f, "amount")),
    buyer = field(f, "buyer").trim();
  if (
    !isUuid(request) ||
    !isUuid(loot) ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 1000000 ||
    !amount ||
    BigInt(amount) <= 0n ||
    buyer.length < 2 ||
    buyer.length > 80 ||
    f.get("confirm") !== "on"
  )
    return {
      error:
        "Укажите количество, покупателя, полученную сумму и подтвердите продажу.",
    };
  return mutate(
    "record_inventory_sale",
    {
      p_request: request,
      p_loot: loot,
      p_version: version,
      p_quantity: quantity,
      p_gross: amount,
      p_buyer: buyer,
    },
    "Продажа записана. Покупатель сохранён, остаток и казны обновлены.",
  );
}
export async function listInventoryAuction(
  _: FormState,
  f: FormData,
): Promise<FormState> {
  const request = field(f, "requestId"),
    loot = field(f, "lootId"),
    version = integer(f, "version"),
    quantity = integer(f, "quantity"),
    price = parseGold(field(f, "unitPrice"));
  if (
    !isUuid(request) ||
    !isUuid(loot) ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 1000000 ||
    !price ||
    BigInt(price) <= 0n ||
    (price !== null &&
      Number.isSafeInteger(quantity) &&
      BigInt(price) * BigInt(quantity) > 100000000000000n) ||
    f.get("confirm") !== "on"
  )
    return {
      error:
        "Укажите количество и цену за единицу. Общая сумма должна быть не больше 10 000 000 000 золота. Подтвердите запись продажи.",
    };
  return mutate(
    "sell_inventory_auction_now",
    {
      p_request: request,
      p_loot: loot,
      p_version: version,
      p_quantity: quantity,
      p_unit_price: price,
    },
    "Аукционная продажа записана автоматически. Количество списано, золото начислено в казны.",
  );
}
export async function completeInventoryAuction(
  _: FormState,
  f: FormData,
): Promise<FormState> {
  const request = field(f, "requestId"),
    auction = field(f, "auctionId"),
    version = integer(f, "auctionVersion"),
    lootVersion = integer(f, "version"),
    quantity = integer(f, "quantity"),
    amount = parseGold(field(f, "amount")),
    buyer = field(f, "buyer").trim();
  if (
    !isUuid(request) ||
    !isUuid(auction) ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !Number.isSafeInteger(lootVersion) ||
    lootVersion < 1 ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 1000000 ||
    !amount ||
    BigInt(amount) <= 0n ||
    buyer.length < 2 ||
    buyer.length > 80 ||
    f.get("confirm") !== "on"
  )
    return {
      error: "Проверьте количество, покупателя и фактически полученное золото.",
    };
  return mutate(
    "complete_inventory_auction",
    {
      p_request: request,
      p_auction: auction,
      p_version: version,
      p_loot_version: lootVersion,
      p_quantity: quantity,
      p_gross: amount,
      p_buyer: buyer,
    },
    "Продажа с аукциона записана. Остаток и казны обновлены.",
  );
}
export async function cancelInventoryAuction(
  _: FormState,
  f: FormData,
): Promise<FormState> {
  const auction = field(f, "auctionId"),
    version = integer(f, "auctionVersion");
  if (
    !isUuid(auction) ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    f.get("confirm") !== "on"
  )
    return {
      error:
        "Подтвердите, что непроданные предметы сняты с аукциона и возвращены.",
    };
  return mutate(
    "cancel_inventory_auction",
    { p_auction: auction, p_version: version },
    "Лот снят. Его непроданное количество снова доступно на складе.",
  );
}
export async function discardInventoryStock(
  _: FormState,
  f: FormData,
): Promise<FormState> {
  const request = field(f, "requestId"),
    loot = field(f, "lootId"),
    version = integer(f, "version"),
    quantity = integer(f, "quantity"),
    reason = field(f, "reason").trim(),
    warehouse = field(f, "warehouse");
  if (
    !isUuid(request) ||
    !isUuid(loot) ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 1000000 ||
    reason.length < 3 ||
    reason.length > 500 ||
    !["general", "xd"].includes(warehouse) ||
    f.get("confirm") !== "on"
  )
    return {
      error:
        "Укажите количество и причину удаления, затем подтвердите списание.",
    };
  return mutate(
    "discard_inventory_position",
    {
      p_request: request,
      p_loot: loot,
      p_version: version,
      p_quantity: quantity,
      p_reason: reason,
      p_warehouse: warehouse,
    },
    "Количество списано со склада. Причина и история сохранены; золото не начислено.",
  );
}
