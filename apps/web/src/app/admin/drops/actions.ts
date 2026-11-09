"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/access";
import { checkOrigin, field } from "@/lib/mutations";
import { isUuid, parseVersion } from "@/lib/members";
import { parseGold } from "@/lib/treasury";
import { catalogError } from "@/lib/catalog";
import { GUILD_ID } from "@/lib/config";
import type { FormState } from "@/lib/identity";
import { parseDropPhoto } from "@/lib/drop-registry";
export async function saveDrop(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("drops.manage");
  const id = field(form, "id"),
    version = parseVersion(field(form, "version"), true);
  const name = field(form, "name").trim(),
    price = parseGold(field(form, "price"));
  const photo = parseDropPhoto(
    field(form, "photoData"),
    form.get("removePhoto") === "on",
  );
  if (
    !isUuid(id) ||
    version === null ||
    !name ||
    name.length > 120 ||
    price === null
  )
    return {
      error:
        "Укажите название до 120 символов и неотрицательную цену с точностью до двух знаков.",
    };
  if (photo === false)
    return {
      error:
        "Дождитесь подготовки фото или выберите PNG, JPEG или WebP до 10 МБ.",
    };
  const { error } = await a.client.rpc("save_drop_registry", {
    p_guild: GUILD_ID,
    p_id: id,
    p_version: version,
    p_name: name,
    p_photo: photo,
    p_price: price,
  });
  if (error) return { error: catalogError(error.message) };
  revalidatePath("/admin/drops");
  return { success: "Дроп сохранён." };
}
export async function deleteDrop(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("drops.manage");
  const id = field(form, "id"),
    version = parseVersion(field(form, "version"));
  if (!isUuid(id) || version === null || form.get("confirm") !== "on")
    return { error: "Подтвердите удаление записи." };
  const { error } = await a.client.rpc("delete_drop_registry", {
    p_guild: GUILD_ID,
    p_id: id,
    p_version: version,
  });
  if (error) return { error: catalogError(error.message) };
  revalidatePath("/admin/drops");
  return { success: "Дроп удалён из реестра." };
}
