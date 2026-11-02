"use server";
import { poolError } from "@/lib/pools";
import { scheduleTelegram } from "@/lib/telegram/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/access";
import { checkOrigin, field } from "@/lib/mutations";
import { isUuid } from "@/lib/members";
import { parseGold, treasuryError } from "@/lib/treasury";
import { settlementError } from "@/lib/settlements";
import type { FormState } from "@/lib/identity";
const errorText = (s: string) => settlementError(s) ?? treasuryError(s);
const confirmed = (f: FormData) => f.get("confirm") === "on";
const refresh = () => {
  scheduleTelegram();
  revalidatePath("/treasury");
  revalidatePath("/account");
};
export async function allocateSale(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client } = await requirePermission("treasury.allocate");
  const request = field(form, "requestId"),
    sale = field(form, "saleId");
  let ids: unknown;
  let expected: unknown;
  try {
    ids = JSON.parse(field(form, "expectedMembers"));
    expected = JSON.parse(field(form, "expectedCalculation"));
  } catch {
    return { error: "Обновите предварительный расчёт." };
  }
  if (
    !isUuid(request) ||
    !isUuid(sale) ||
    !confirmed(form) ||
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 500 ||
    !ids.every((id) => typeof id === "string" && isUuid(id))
  )
    return { error: "Проверьте расчёт и подтвердите начисление." };
  const { error } = await client.rpc("allocate_weighted_sale", {
    p_request_id: request,
    p_sale_id: sale,
    p_expected_members: ids,
    p_expected: expected,
    p_reason: field(form, "reason"),
  });
  if (error)
    return {
      error:
        error.message === "CALCULATION_CHANGED"
          ? poolError(error.message)
          : errorText(error.message),
    };
  refresh();
  redirect("/treasury#settlements");
}
export async function recordPayout(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client } = await requirePermission("treasury.pay");
  const request = field(form, "requestId"),
    award = field(form, "awardId"),
    version = Number(field(form, "version")),
    amount = parseGold(field(form, "amount"));
  if (
    !isUuid(request) ||
    !isUuid(award) ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !amount ||
    BigInt(amount) <= 0n ||
    !confirmed(form)
  )
    return {
      error: "Проверьте сумму и подтвердите фактическую передачу золота.",
    };
  const { error } = await client.rpc("pay_treasury_award", {
    p_request_id: request,
    p_award_id: award,
    p_version: version,
    p_amount_units: amount,
    p_reference: field(form, "reference"),
  });
  if (error) return { error: errorText(error.message) };
  refresh();
  return {
    success: "Выплата записана. Остаток казны и долг игроку обновлены.",
  };
}
export async function recordExpense(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client } = await requirePermission("treasury.spend");
  const request = field(form, "requestId"),
    amount = parseGold(field(form, "amount"));
  if (!isUuid(request) || !amount || BigInt(amount) <= 0n || !confirmed(form))
    return { error: "Проверьте сумму и подтвердите фактический расход." };
  const { error } = await client.rpc("record_treasury_expense", {
    p_request_id: request,
    p_amount_units: amount,
    p_purpose: field(form, "purpose"),
  });
  if (error) return { error: errorText(error.message) };
  refresh();
  return { success: "Расход записан из казны гильдии." };
}
async function cancel(
  form: FormData,
  permission: string,
  rpc: string,
): Promise<FormState> {
  await checkOrigin();
  const { client } = await requirePermission(permission);
  const id = field(form, "recordId");
  if (!isUuid(id) || !confirmed(form))
    return { error: "Подтвердите исправление записи." };
  const { error } = await client.rpc(rpc, {
    p_id: id,
    p_reason: field(form, "reason"),
  });
  if (error) return { error: errorText(error.message) };
  refresh();
  return {
    success: "Запись отменена, остатки пересчитаны. История сохранена.",
  };
}
export async function cancelAllocation(_: FormState, form: FormData) {
  return cancel(form, "treasury.allocate", "void_treasury_allocation");
}
export async function cancelPayout(_: FormState, form: FormData) {
  return cancel(form, "treasury.pay", "void_treasury_payout");
}
export async function cancelExpense(_: FormState, form: FormData) {
  return cancel(form, "treasury.spend", "void_treasury_expense");
}
