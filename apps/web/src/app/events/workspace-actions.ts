"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/access";
import { checkOrigin, field } from "@/lib/mutations";
import { isUuid, parseVersion } from "@/lib/members";
import { activityError, parseActivityPayload } from "@/lib/activity-workspace";
import type { FormState } from "@/lib/identity";
function refresh(id: string) {
  revalidatePath("/events", "layout");
  revalidatePath("/attendance");
  revalidatePath("/statistics");
  revalidatePath("/dashboard");
  revalidatePath("/treasury", "layout");
  revalidatePath("/events/" + id);
}
export async function recordActivity(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("events.manage");
  const request = field(form, "requestId"),
    parsed = parseActivityPayload(field(form, "payload"));
  if ("error" in parsed) return { error: parsed.error };
  if (!isUuid(request)) return { error: "Обновите форму и повторите попытку." };
  const { error } = await a.client.rpc("record_activity", {
    p_request: request,
    p_payload: parsed.payload,
  });
  if (error) return { error: activityError(error.message) };
  refresh(request);
  redirect("/events/" + request);
}
export async function saveActivity(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("events.manage");
  const id = field(form, "eventId"),
    version = parseVersion(field(form, "version")),
    parsed = parseActivityPayload(field(form, "payload"));
  if ("error" in parsed) return { error: parsed.error };
  if (!isUuid(id) || version === null) return { error: "Обновите страницу." };
  const { error } = await a.client.rpc("save_activity_details", {
    p_event: id,
    p_version: version,
    p_payload: parsed.payload,
    p_reason: field(form, "reason"),
  });
  if (error) return { error: activityError(error.message) };
  refresh(id);
  redirect("/events/" + id);
}
export async function cancelActivity(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("events.manage");
  const id = field(form, "eventId"),
    version = parseVersion(field(form, "version"));
  if (!isUuid(id) || version === null || form.get("confirm") !== "on")
    return { error: "Подтвердите отмену активности." };
  const { error } = await a.client.rpc("cancel_activity", {
    p_event: id,
    p_version: version,
    p_reason: field(form, "reason"),
  });
  if (error) return { error: activityError(error.message) };
  refresh(id);
  redirect("/events");
}
export async function addActivityDrop(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("treasury.manage");
  const id = field(form, "eventId"),
    catalog = field(form, "catalog"),
    request = field(form, "requestId"),
    version = parseVersion(field(form, "catalogVersion")),
    quantity = Number(field(form, "quantity"));
  if (
    !isUuid(id) ||
    !isUuid(catalog) ||
    !isUuid(request) ||
    version === null ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 1000000
  )
    return { error: "Выберите предмет и целое количество от 1 до 1 000 000." };
  const { error } = await a.client.rpc("add_activity_drop", {
    p_event: id,
    p_catalog: catalog,
    p_catalog_version: version,
    p_quantity: quantity,
    p_request: request,
  });
  if (error) return { error: activityError(error.message) };
  refresh(id);
  return { success: "Предмет добавлен в дроп и инвентарь казны." };
}
export async function removeActivityDrop(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("treasury.manage");
  const id = field(form, "eventId"),
    loot = field(form, "lootId"),
    version = parseVersion(field(form, "version"));
  if (
    !isUuid(id) ||
    !isUuid(loot) ||
    version === null ||
    form.get("confirm") !== "on"
  )
    return { error: "Подтвердите удаление предмета." };
  const { error } = await a.client.rpc("remove_activity_drop", {
    p_id: loot,
    p_version: version,
    p_reason: field(form, "reason"),
  });
  if (error) return { error: activityError(error.message) };
  refresh(id);
  return { success: "Предмет удалён из дропа." };
}
