"use server";
import { revalidatePath } from "next/cache";
import { archiveErrorMessage } from "@/lib/activity-archive-errors";
import { requirePermission } from "@/lib/access";
import { checkOrigin, field } from "@/lib/mutations";
import { isUuid } from "@/lib/members";
import { activityFilters } from "@/lib/activity-workspace";
import type { FormState } from "@/lib/identity";
export async function archiveActivities(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("periods.close");
  if (!(await a.permission("events.manage")))
    return { error: "Недостаточно прав." };
  const from = field(form, "from"),
    through = field(form, "through"),
    request = field(form, "requestId");
  const range = activityFilters({ from, through });
  if (
    !from ||
    !through ||
    range.error ||
    through > new Date().toISOString().slice(0, 10) ||
    !isUuid(request) ||
    form.get("confirm") !== "on"
  )
    return { error: "Проверьте даты и подтвердите архивацию." };
  const { data, error } = await a.client.rpc("archive_activities", {
    p_request: request,
    p_from: from,
    p_through: through,
  });
  if (error) return { error: archiveErrorMessage(error) };
  revalidatePath("/", "layout");
  return {
    success: `Архивировано активностей: ${data}. Текущая статистика пересчитана.`,
  };
}
