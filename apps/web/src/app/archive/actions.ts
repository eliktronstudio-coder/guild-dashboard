"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/access";
import { checkOrigin, field } from "@/lib/mutations";
import type { FormState } from "@/lib/identity";
export async function closePeriod(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("periods.close"),
    from = field(form, "from"),
    signature = field(form, "signature");
  if (
    !/^20\d{2}-\d{2}-15$/.test(from) ||
    !/^[a-f0-9]{32}$/.test(signature) ||
    form.get("confirm") !== "on"
  )
    return { error: "Проверьте состав, суммы и подтвердите закрытие." };
  const { error } = await a.client.rpc("close_payroll_period", {
    p_from: from,
    p_signature: signature,
  });
  if (error)
    return {
      error:
        (
          {
            PERIOD_NOT_ENDED: "Закрыть период можно 14-го числа или позже.",
            PENDING_CLAIMS: "Сначала разберите заявки на участие за период.",
            CALCULATION_CHANGED:
              "Расчёт изменился. Обновите страницу и проверьте суммы.",
            NO_RECIPIENTS:
              "Есть выручка, но нет игроков с допуском к зарплате. Проверьте состав.",
          } as Record<string, string>
        )[error.message] ??
        "Период не закрыт. Проверьте баланс, права и расчёт.",
    };
  revalidatePath("/", "layout");
  return {
    success:
      "Период закрыт. Состав и начисления сохранены. Выплаты доступны ниже; новый период начинается 15-го.",
  };
}
