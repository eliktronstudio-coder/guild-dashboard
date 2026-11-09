"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/access";
import { checkOrigin, field } from "@/lib/mutations";
import { isUuid, parseVersion } from "@/lib/members";
import { parseWeight } from "@/lib/catalog";
import { catalogError } from "@/lib/catalog";
import { GUILD_ID } from "@/lib/config";
import type { FormState } from "@/lib/identity";
import { parseDropPhoto } from "@/lib/drop-registry";
export async function saveActivityBanner(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("activity_banners.manage");
  const id = field(form, "id"),
    version = parseVersion(field(form, "version"), true);
  const name = field(form, "name").trim(),
    weight = parseWeight(field(form, "weight"));
  const photo = parseDropPhoto(
    field(form, "photoData"),
    form.get("removePhoto") === "on",
    true,
  );
  if (
    !isUuid(id) ||
    version === null ||
    !name ||
    name.length < 3 ||
    name.length > 120 ||
    weight === null
  )
    return {
      error:
        "Укажите название от 3 до 120 символов и коэффициент от 0,01 до 1000 (до двух знаков после запятой).",
    };
  if (photo === false)
    return {
      error:
        "Дождитесь подготовки фото или выберите PNG, JPEG или WebP до 10 МБ.",
    };
  const { error } = await a.client.rpc("save_activity_banner", {
    p_guild: GUILD_ID,
    p_id: id,
    p_version: version,
    p_name: name,
    p_photo: photo,
    p_weight: weight,
  });
  if (error) return { error: catalogError(error.message) };
  revalidatePath("/admin/activity-banners");
  revalidatePath("/events", "layout");
  return { success: "Баннер активности сохранён." };
}
export async function deleteActivityBanner(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("activity_banners.manage");
  const id = field(form, "id"),
    version = parseVersion(field(form, "version"));
  if (!isUuid(id) || version === null || form.get("confirm") !== "on")
    return { error: "Подтвердите удаление записи." };
  const { error } = await a.client.rpc("delete_activity_banner", {
    p_guild: GUILD_ID,
    p_id: id,
    p_version: version,
  });
  if (error) return { error: catalogError(error.message) };
  revalidatePath("/admin/activity-banners");
  revalidatePath("/events", "layout");
  return { success: "Баннер активности удалён." };
}
