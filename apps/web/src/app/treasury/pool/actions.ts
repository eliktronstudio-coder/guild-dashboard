"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/access";
import { checkOrigin, field } from "@/lib/mutations";
import { isUuid } from "@/lib/members";
import { scheduleTelegram } from "@/lib/telegram/server";
import { poolError } from "@/lib/pools";
import type { FormState } from "@/lib/identity";
export async function allocatePool(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("treasury.allocate");
  const id = field(form, "id");
  let events: unknown, expected: unknown;
  try {
    events = JSON.parse(field(form, "events"));
    expected = JSON.parse(field(form, "expected"));
  } catch {
    return { error: "Обновите расчёт." };
  }
  if (
    !isUuid(id) ||
    !Array.isArray(events) ||
    events.length < 1 ||
    events.length > 100 ||
    !events.every((x) => typeof x === "string" && isUuid(x)) ||
    form.get("confirm") !== "on"
  )
    return { error: "Проверьте события и подтвердите начисление." };
  const { error } = await a.client.rpc("allocate_treasury_pool", {
    p_id: id,
    p_events: events,
    p_expected: expected,
    p_reason: field(form, "reason"),
  });
  if (error) return { error: poolError(error.message) };
  scheduleTelegram();
  revalidatePath("/treasury", "layout");
  revalidatePath("/account");
  redirect("/treasury#settlements");
}
