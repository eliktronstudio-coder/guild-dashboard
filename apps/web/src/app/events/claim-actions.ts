"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember, requirePermission } from "@/lib/access";
import { checkOrigin, field } from "@/lib/mutations";
import { isUuid } from "@/lib/members";
import { validEvidence } from "@/lib/activity-workspace";
import type { FormState } from "@/lib/identity";
const messages: Record<string, string> = {
  ALREADY_PRESENT: "Ваше участие уже отмечено.",
  RATE_LIMITED: "До 10 заявок в сутки.",
  ALREADY_REVIEWED: "Заявка уже рассмотрена. Обновите страницу.",
  LOOT_HAS_HISTORY:
    "У активности есть дроп или продажи. Сначала разберите связанные предметы; финансовая история сохраняется.",
};
export async function submitClaim(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requireMember();
  const id = field(form, "requestId"),
    event = field(form, "eventId"),
    image = field(form, "screenshot");
  if (!isUuid(id) || !isUuid(event) || !validEvidence(image))
    return { error: "Выберите скриншот активности." };
  const { error } = await a.client.rpc("submit_participation_claim", {
    p_id: id,
    p_event: event,
    p_screenshot: image,
  });
  if (error)
    return {
      error:
        messages[error.message] ??
        "Заявка не отправлена. Проверьте активность и повторите.",
    };
  revalidatePath("/events", "layout");
  revalidatePath("/admin/participation");
  return {
    success: "Заявка отправлена администратору. Решение появится здесь.",
  };
}
export async function reviewClaim(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("attendance.manage");
  const id = field(form, "claimId"),
    decision = field(form, "decision");
  if (!isUuid(id) || !["accept", "reject"].includes(decision))
    return { error: "Обновите заявку." };
  const { error } = await a.client.rpc("review_participation_claim", {
    p_id: id,
    p_accept: decision === "accept",
  });
  if (error)
    return {
      error:
        messages[error.message] ??
        "Не удалось рассмотреть заявку. Обновите страницу.",
    };
  revalidatePath("/", "layout");
  return {
    success:
      decision === "accept" ? "Участие подтверждено." : "Заявка отклонена.",
  };
}
export async function deleteActivity(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("events.manage");
  const id = field(form, "eventId"),
    version = Number(field(form, "version")),
    reason = field(form, "reason").trim();
  if (
    !isUuid(id) ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    reason.length < 3 ||
    reason.length > 500 ||
    form.get("confirm") !== "on"
  )
    return { error: "Укажите причину и подтвердите удаление." };
  const { error } = await a.client.rpc("delete_activity", {
    p_event: id,
    p_version: version,
    p_reason: reason,
  });
  if (error)
    return {
      error:
        messages[error.message] ??
        "Удаление не выполнено. Обновите страницу и проверьте связанные данные.",
    };
  revalidatePath("/", "layout");
  redirect("/events");
}
