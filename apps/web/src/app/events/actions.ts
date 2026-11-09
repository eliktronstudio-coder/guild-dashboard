"use server";
import { scheduleTelegram } from "@/lib/telegram/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember, requirePermission } from "@/lib/access";
import { checkOrigin, field } from "@/lib/mutations";
import { isUuid } from "@/lib/members";
import { utcInput, eventError } from "@/lib/events";
import { treasuryError } from "@/lib/treasury";
import type { FormState } from "@/lib/identity";
export async function tagEventTreasury(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const a = await requireMember();
  const [events, treasury] = await Promise.all([
    a.permission("events.manage"),
    a.permission("treasury.manage"),
  ]);
  if (!events && !treasury) return { error: "Недостаточно прав." };
  const id = field(form, "eventId"),
    version = Number(field(form, "version")),
    source = field(form, "source");
  if (
    !isUuid(id) ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !["none", "prime", "mini_rb"].includes(source)
  )
    return { error: "Проверьте пометку и обновите страницу." };
  const { error } = await a.client.rpc("tag_event_treasury", {
    p_id: id,
    p_version: version,
    p_source: source,
    p_reason: field(form, "reason"),
  });
  if (error) return { error: treasuryError(error.message) };
  scheduleTelegram();
  revalidatePath("/events", "layout");
  revalidatePath("/treasury");
  return { success: "Пометка активности сохранена." };
}
export async function createEvent(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client } = await requirePermission("events.manage");
  const title = field(form, "title").trim(),
    kind = field(form, "kind"),
    date = field(form, "startsAt");
  const startsAt = utcInput(date);
  const requestId = field(form, "requestId");
  if (
    title.length < 3 ||
    title.length > 120 ||
    !["raid", "pvp", "siege", "farm", "guild"].includes(kind) ||
    !startsAt ||
    !isUuid(requestId)
  )
    return { error: "Проверьте поля события." };
  const banner = field(form, "activityBanner");
  if (banner && !isUuid(banner))
    return { error: "Выберите баннер активности." };
  const { error } = await client.rpc(
    banner ? "create_banner_event" : "create_guild_event",
    {
      ...(banner ? { p_banner: banner } : {}),
      p_request_id: requestId,
      p_title: title,
      p_kind: kind,
      p_starts_at: startsAt,
      p_description: field(form, "description"),
      p_counts: form.get("counts") === "on",
    },
  );
  if (error) return { error: eventError(error.message) };
  scheduleTelegram();
  revalidatePath("/events");
  revalidatePath("/events", "layout");
  revalidatePath("/attendance");
  revalidatePath("/members", "layout");
  revalidatePath("/treasury");
  redirect(`/events/${requestId}`);
}
export async function signupEvent(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client } = await requireMember();
  const eventId = field(form, "eventId");
  if (!isUuid(eventId)) return { error: "Обновите список событий." };
  const join = field(form, "join") === "true";
  const { error } = await client.rpc("set_event_signup", {
    p_event_id: eventId,
    p_join: join,
  });
  if (error)
    return {
      error:
        "Запись недоступна: событие уже началось, закрыто или ваши права изменились.",
    };
  scheduleTelegram();
  revalidatePath("/events");
  revalidatePath("/events", "layout");
  revalidatePath("/attendance");
  revalidatePath("/members", "layout");
  revalidatePath("/treasury");
  return { success: join ? "Вы записаны." : "Запись отменена." };
}

export async function changeEvent(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client } = await requirePermission("events.manage");
  if (form.get("confirm") !== "on")
    return { error: "Подтвердите изменение события." };
  const eventId = field(form, "eventId"),
    version = Number(field(form, "version"));
  if (!isUuid(eventId) || !Number.isSafeInteger(version) || version < 1)
    return { error: "Обновите страницу." };
  const { error } = await client.rpc("change_event", {
    p_id: eventId,
    p_version: version,
    p_title: field(form, "title"),
    p_description: field(form, "description"),
    p_status: field(form, "status"),
    p_reason: field(form, "reason"),
  });
  if (error)
    return {
      error:
        "Изменение не сохранено. Возможно, событие уже изменено или ещё не началось. Обновите страницу и проверьте поля.",
    };
  scheduleTelegram();
  revalidatePath("/events");
  revalidatePath("/events", "layout");
  revalidatePath("/attendance");
  revalidatePath("/members", "layout");
  revalidatePath("/treasury");
  return { success: "Изменение сохранено в журнале." };
}

export async function editEvent(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client } = await requirePermission("events.manage");
  const id = field(form, "eventId"),
    version = Number(field(form, "version")),
    startsAt = utcInput(field(form, "startsAt"));
  if (!isUuid(id) || !Number.isSafeInteger(version) || version < 1 || !startsAt)
    return { error: "Проверьте дату и обновите страницу." };
  const { error } = await client.rpc("edit_event", {
    p_id: id,
    p_version: version,
    p_title: field(form, "title"),
    p_kind: field(form, "kind"),
    p_starts_at: startsAt,
    p_description: field(form, "description"),
    p_counts: form.get("counts") === "on",
    p_reason: field(form, "reason"),
  });
  if (error) return { error: eventError(error.message) };
  scheduleTelegram();
  revalidatePath("/events", "layout");
  return { success: "Событие обновлено." };
}
export async function markAttendance(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client } = await requirePermission("attendance.manage");
  const event = field(form, "eventId"),
    member = field(form, "memberId"),
    version = Number(field(form, "version"));
  if (
    !isUuid(event) ||
    !isUuid(member) ||
    !Number.isSafeInteger(version) ||
    version < 1
  )
    return { error: "Обновите страницу." };
  const { error } = await client.rpc("mark_attendance", {
    p_event_id: event,
    p_membership_id: member,
    p_version: version,
    p_mark: field(form, "mark"),
    p_reason: field(form, "reason"),
  });
  if (error) return { error: eventError(error.message) };
  scheduleTelegram();
  revalidatePath("/events", "layout");
  revalidatePath("/attendance");
  revalidatePath("/members", "layout");
  revalidatePath("/treasury");
  return { success: "Отметка сохранена. Отчёт требует подтверждения." };
}
export async function finalizeAttendance(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client } = await requirePermission("attendance.manage");
  const event = field(form, "eventId"),
    version = Number(field(form, "version"));
  if (
    !isUuid(event) ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    form.get("confirm") !== "on"
  )
    return { error: "Подтвердите проверку состава и всех отметок." };
  const { error } = await client.rpc("finalize_attendance", {
    p_event_id: event,
    p_version: version,
  });
  if (error) return { error: eventError(error.message) };
  scheduleTelegram();
  revalidatePath("/events", "layout");
  revalidatePath("/attendance");
  revalidatePath("/members", "layout");
  revalidatePath("/treasury");
  return { success: "Отчёт подтверждён." };
}
