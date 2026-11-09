"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/access";
import { checkOrigin, field } from "@/lib/mutations";
import { isUuid } from "@/lib/members";
import type { FormState } from "@/lib/identity";
export async function payPeriodMember(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("treasury.pay");
  const request = field(form, "requestId"),
    member = field(form, "memberId"),
    from = field(form, "from"),
    source = field(form, "source"),
    signature = field(form, "signature"),
    reference = field(form, "reference").trim();
  if (
    !isUuid(request) ||
    !isUuid(member) ||
    !/^20\d{2}-\d{2}-15$/.test(from) ||
    !["prime", "mini_rb"].includes(source) ||
    !/^[a-f0-9]{32}$/.test(signature) ||
    reference.length < 3 ||
    reference.length > 500 ||
    form.get("confirm") !== "on"
  )
    return { error: "Проверьте расчёт и подтвердите выплату." };
  const { error } = await a.client.rpc("pay_period_member", {
    p_request: request,
    p_from: from,
    p_member: member,
    p_source: source,
    p_signature: signature,
    p_reference: reference,
  });
  if (error)
    return {
      error:
        error.message === "CALCULATION_CHANGED"
          ? "Расчёт изменился. Обновите страницу и проверьте новые суммы перед выплатой."
          : "Выплата не записана. Проверьте баланс, права и начисления; обновите страницу.",
    };
  revalidatePath("/", "layout");
  return {
    success:
      "Выплата записана. Расчёт проданных предметов зафиксирован; история сохранена.",
  };
}
