"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/access";
import { checkOrigin, field } from "@/lib/mutations";
import { isUuid, parseVersion } from "@/lib/members";
import { parseGold } from "@/lib/treasury";
import { parseWeight, catalogError } from "@/lib/catalog";
import type { FormState } from "@/lib/identity";
export async function saveCatalog(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("catalog.manage");
  const id = field(form, "id"),
    kind = field(form, "kind"),
    version = parseVersion(field(form, "version"), true);
  const price = kind === "loot" ? parseGold(field(form, "price")) : "0";
  const weight = kind === "boss" ? parseWeight(field(form, "weight")) : 100;
  const name = field(form, "name").trim();
  if (
    !isUuid(id) ||
    !["loot", "boss"].includes(kind) ||
    version === null ||
    price === null ||
    weight === null ||
    !name ||
    name.length > 120
  )
    return { error: "Проверьте название, цену и коэффициент." };
  let photo: string | null = form.get("removePhoto") === "on" ? "" : null;
  const photoData = field(form, "photoData");
  if (photoData) {
    if (
      !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(photoData) ||
      photoData.length > 100000
    )
      return {
        error: "Дождитесь подготовки фото или выберите другое изображение.",
      };
    const bytes = Buffer.from(photoData.split(",")[1], "base64");
    if (
      bytes.length < 24 ||
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.readUInt32BE(16) !== 100 ||
      bytes.readUInt32BE(20) !== 100
    )
      return { error: "Некорректное фото." };
    photo = photoData;
  }
  const { error } = await a.client.rpc("save_catalog", {
    p_id: id,
    p_kind: kind,
    p_version: version,
    p_name: name,
    p_photo: photo,
    p_price: price,
    p_weight: weight,
    p_archived: form.get("archived") === "on",
  });
  if (error) return { error: catalogError(error.message) };
  revalidatePath("/admin/catalog", "layout");
  revalidatePath("/events", "layout");
  return { success: "Запись сохранена." };
}
export async function setMemberWeight(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("members.coefficient");
  const id = field(form, "id"),
    version = parseVersion(field(form, "version")),
    weight = parseWeight(field(form, "weight"), true);
  if (!isUuid(id) || version === null || weight === null)
    return {
      error: "Коэффициент: от 0,2 до 1,25, не более двух знаков после запятой.",
    };
  const { error } = await a.client.rpc("set_member_weight", {
    p_id: id,
    p_version: version,
    p_weight: weight,
  });
  if (error) return { error: catalogError(error.message) };
  revalidatePath("/members", "layout");
  revalidatePath("/treasury", "layout");
  return { success: "Коэффициент сохранён." };
}
export async function setEventBoss(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requirePermission("events.manage");
  const id = field(form, "id"),
    boss = field(form, "boss"),
    version = parseVersion(field(form, "version"));
  if (!isUuid(id) || (boss && !isUuid(boss)) || version === null)
    return { error: "Выберите рейд-босса и обновите страницу." };
  const { error } = await a.client.rpc("set_event_boss", {
    p_id: id,
    p_version: version,
    p_boss: boss || null,
  });
  if (error) return { error: catalogError(error.message) };
  revalidatePath(`/events/${id}`);
  return { success: "Рейд-босс и его коэффициент сохранены для события." };
}
