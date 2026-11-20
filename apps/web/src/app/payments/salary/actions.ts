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

const statementErrors: Record<string, string> = {
  CALCULATION_CHANGED: "Расчёт изменился. Обновите страницу и проверьте суммы.",
  STATEMENT_ALREADY_LOCKED:
    "Уже есть зафиксированная ведомость. Обновите страницу.",
  STATEMENT_UNPAID: "В ведомости ещё есть невыплаченные суммы.",
  STATEMENT_CLOSED: "Ведомость уже закрыта. Обновите страницу.",
  NOTHING_TO_PAY: "Нет начислений для фиксации.",
  INSUFFICIENT_FUNDS: "В казне недостаточно золота для этой ведомости.",
};
export async function lockStatement(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("treasury.allocate");
  if (!(await a.permission("treasury.pay")))
    return { error: "Недостаточно прав." };
  const id = field(form, "requestId"),
    signature = field(form, "signature");
  if (
    !isUuid(id) ||
    !/^[a-f0-9]{32}$/.test(signature) ||
    form.get("confirm") !== "on"
  )
    return { error: "Проверьте подтверждение и обновите страницу." };
  const { error } = await a.client.rpc("lock_salary_statement", {
    p_request: id,
    p_signature: signature,
  });
  if (error)
    return {
      error:
        statementErrors[error.message] ??
        "Не удалось зафиксировать ведомость. Обновите страницу.",
    };
  revalidatePath("/", "layout");
  return { success: "Суммы зафиксированы. Выплаты ещё не записаны." };
}
export async function closeStatement(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("treasury.allocate");
  if (!(await a.permission("treasury.pay")))
    return { error: "Недостаточно прав." };
  const id = field(form, "statementId"),
    action = field(form, "action"),
    reason = field(form, "reason");
  if (
    !isUuid(id) ||
    !["completed", "cancelled"].includes(action) ||
    form.get("confirm") !== "on" ||
    (action === "cancelled" && (reason.length < 3 || reason.length > 500))
  )
    return { error: "Проверьте подтверждение и причину изменения." };
  const { error } = await a.client.rpc("close_salary_statement", {
    p_id: id,
    p_action: action,
    p_reason: reason,
  });
  if (error)
    return {
      error:
        statementErrors[error.message] ??
        "Не удалось изменить ведомость. Обновите страницу.",
    };
  revalidatePath("/", "layout");
  return {
    success:
      action === "completed"
        ? "Ведомость завершена. Новые начисления рассчитываются отдельно."
        : "Фиксация снята. Проведённые выплаты сохранены, невыплаченные суммы пересчитаны.",
  };
}
