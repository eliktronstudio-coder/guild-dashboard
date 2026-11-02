"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/access";
import { field, checkOrigin } from "@/lib/mutations";
import { isUuid } from "@/lib/members";
import { parseGold, treasuryError } from "@/lib/treasury";
import { settlementError } from "@/lib/settlements";
import type { FormState } from "@/lib/identity";
const integer = (form: FormData, key: string) => {
  const text = field(form, key);
  return /^\d{1,10}$/.test(text) ? Number(text) : NaN;
};
function lootFields(form: FormData) {
  const estimate = field(form, "estimate").trim();
  const name = field(form, "name").trim(),
    category = field(form, "category").trim(),
    note = field(form, "note").trim();
  const units = estimate ? parseGold(estimate) : null;
  if (
    name.length < 2 ||
    name.length > 120 ||
    category.length > 80 ||
    note.length > 1000 ||
    (estimate && units === null)
  )
    return null;
  return {
    p_name: name,
    p_category: category,
    p_quantity: integer(form, "quantity"),
    p_estimated_unit_units: units,
    p_note: note,
  };
}
export async function addLoot(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client } = await requirePermission("treasury.manage");
  const request = field(form, "requestId"),
    event = field(form, "eventId"),
    values = lootFields(form);
  if (
    !isUuid(request) ||
    !isUuid(event) ||
    !values ||
    !Number.isInteger(values.p_quantity) ||
    values.p_quantity < 1 ||
    values.p_quantity > 1000000
  )
    return {
      error:
        "Проверьте событие, название, количество и оценку (до 4 знаков после запятой).",
    };
  const { error } = await client.rpc("add_treasury_loot", {
    p_request_id: request,
    p_event_id: event,
    ...values,
  });
  if (error) return { error: treasuryError(error.message) };
  revalidatePath("/treasury");
  revalidatePath("/events", "layout");
  const { data: item } = await client
    .from("treasury_inventory")
    .select("source,event_starts_at")
    .eq("id", request)
    .maybeSingle();
  if (item)
    redirect(
      `/treasury?inventory=${item.source}&eventMonth=${new Date(item.event_starts_at).toISOString().slice(0, 7)}#inventory`,
    );
  return { success: "Дроп добавлен в инвентарь по пометке события." };
}
export async function reviseLoot(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client } = await requirePermission("treasury.manage");
  const id = field(form, "lootId"),
    version = integer(form, "version"),
    values = lootFields(form);
  if (
    !isUuid(id) ||
    !Number.isInteger(version) ||
    version < 1 ||
    !values ||
    !Number.isInteger(values.p_quantity) ||
    values.p_quantity < 0 ||
    values.p_quantity > 1000000
  )
    return { error: "Проверьте поля партии и обновите страницу." };
  const { error } = await client.rpc("revise_treasury_loot", {
    p_id: id,
    p_version: version,
    ...values,
    p_reason: field(form, "reason"),
  });
  if (error) return { error: treasuryError(error.message) };
  revalidatePath("/treasury");
  return {
    success: "Партия исправлена. Предыдущее состояние сохранено в журнале.",
  };
}
export async function sellLoot(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client } = await requirePermission("treasury.manage");
  const id = field(form, "lootId"),
    request = field(form, "requestId"),
    version = integer(form, "version"),
    quantity = integer(form, "quantity"),
    units = parseGold(field(form, "amount"));
  if (
    !isUuid(id) ||
    !isUuid(request) ||
    !Number.isInteger(version) ||
    version < 1 ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 1000000 ||
    units === null ||
    BigInt(units) <= 0n ||
    form.get("confirm") !== "on"
  )
    return {
      error:
        "Укажите количество и общую сумму продажи, затем подтвердите операцию.",
    };
  const { error } = await client.rpc("sell_treasury_loot", {
    p_request_id: request,
    p_loot_id: id,
    p_version: version,
    p_quantity: quantity,
    p_gross_units: units,
    p_note: field(form, "note"),
  });
  if (error) return { error: treasuryError(error.message) };
  revalidatePath("/treasury");
  return { success: "Продажа записана, остаток и казны обновлены." };
}
export async function voidSale(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client } = await requirePermission("treasury.manage");
  const id = field(form, "saleId");
  if (!isUuid(id) || form.get("confirm") !== "on")
    return { error: "Подтвердите отмену продажи." };
  const { error } = await client.rpc("void_treasury_sale", {
    p_id: id,
    p_reason: field(form, "reason"),
  });
  if (error)
    return {
      error: settlementError(error.message) ?? treasuryError(error.message),
    };
  revalidatePath("/treasury");
  return {
    success:
      "Продажа отменена. Предметы возвращены, поступления сняты; история сохранена.",
  };
}
