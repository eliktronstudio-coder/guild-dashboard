"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/access";
import { checkOrigin, field } from "@/lib/mutations";
import { isUuid } from "@/lib/members";
import type { FormState } from "@/lib/identity";
export async function paySalary(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("treasury.pay");
  if (!(await a.permission("treasury.allocate")))
    return { error: "Недостаточно прав для выплаты ЗП." };
  const request = field(form, "requestId"),
    member = field(form, "memberId"),
    source = field(form, "source"),
    signature = field(form, "signature");
  if (
    !isUuid(request) ||
    !isUuid(member) ||
    !["prime", "mini_rb"].includes(source) ||
    !/^[a-f0-9]{32}$/.test(signature) ||
    form.get("confirm") !== "on"
  )
    return { error: "Обновите страницу и проверьте данные выплаты." };
  const { error } = await a.client.rpc("pay_lifetime_salary", {
    p_request: request,
    p_member: member,
    p_source: source,
    p_signature: signature,
  });
  if (error) {
    if (
      ["CALCULATION_CHANGED", "NOTHING_TO_PAY", "NOT_ELIGIBLE"].includes(
        error.message,
      )
    )
      revalidatePath("/payments/salary");
    return {
      error:
        (
          {
            CALCULATION_CHANGED:
              "Расчёт обновился. Проверьте новую сумму и повторите выплату.",
            NOTHING_TO_PAY: "Эта сумма уже выплачена или начислений нет.",
            NOT_ELIGIBLE: "Участник больше не соответствует порогу 20%.",
            INSUFFICIENT_FUNDS:
              "В казне недостаточно золота. Выплата не записана.",
            REQUEST_CONFLICT: "Этот запрос уже использован. Обновите страницу.",
          } as Record<string, string>
        )[error.message] ??
        "Выплата не записана. Обновите страницу и повторите попытку.",
    };
  }
  revalidatePath("/", "layout");
  return { success: "Выплата записана." };
}
