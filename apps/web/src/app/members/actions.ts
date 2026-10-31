"use server";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/access";
import { GUILD_ID } from "@/lib/config";
import { checkOrigin, field } from "@/lib/mutations";
import {
  nicknameError,
  normalizeNickname,
  messageFor,
  type FormState,
} from "@/lib/identity";
import { isUuid, parseVersion } from "@/lib/members";
async function editable(memberId: string) {
  const access = await requireMember();
  if (!isUuid(memberId)) return null;
  const { data, error } = await access.client
    .from("memberships")
    .select("id,user_id,status,membership_roles(roles(code))")
    .eq("guild_id", GUILD_ID)
    .eq("id", memberId)
    .maybeSingle();
  if (error || !data || data.status !== "active") return null;
  const owner = (data.membership_roles ?? [])
    .flatMap((m) =>
      Array.isArray(m.roles) ? m.roles : m.roles ? [m.roles] : [],
    )
    .some((r) => r.code === "owner");
  if (
    data.user_id !== access.user.id &&
    (owner || !(await access.permission("members.manage")))
  )
    return null;
  return access;
}
function refreshMember(memberId: string) {
  for (const path of [
    `/members/${memberId}`,
    "/members",
    "/account",
    "/dashboard",
    "/admin",
  ])
    revalidatePath(path);
  revalidatePath("/", "layout");
}
export async function updateProfile(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const memberId = field(form, "memberId"),
    version = parseVersion(field(form, "version"));
  const a = await editable(memberId);
  if (!a) return { error: "Нет доступа к изменению этого профиля." };
  if (version === null)
    return { error: "Обновите страницу перед сохранением." };
  const { error } = await a.client.rpc("update_member_profile", {
    p_member_id: memberId,
    p_expected_version: version,
    p_about: field(form, "about"),
    p_avatar_style: field(form, "avatarStyle"),
  });
  if (error) return { error: messageFor(error) };
  refreshMember(memberId);
  return { success: "Профиль обновлён." };
}
export async function changeNickname(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const memberId = field(form, "memberId"),
    version = parseVersion(field(form, "version"));
  const a = await editable(memberId);
  if (!a) return { error: "Нет доступа к изменению этого профиля." };
  if (form.get("confirm") !== "on")
    return { error: "Подтвердите смену игрового ника." };
  const nickname = normalizeNickname(field(form, "nickname")),
    invalid = nicknameError(nickname);
  if (invalid) return { error: invalid };
  if (version === null)
    return { error: "Обновите страницу перед сохранением." };
  const { error } = await a.client.rpc("change_member_nickname", {
    p_member_id: memberId,
    p_expected_version: version,
    p_nickname: nickname,
    p_reason: field(form, "reason"),
  });
  if (error) return { error: messageFor(error) };
  refreshMember(memberId);
  return { success: "Ник изменён. История сохранена." };
}
export async function saveCharacter(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const memberId = field(form, "memberId"),
    characterId = field(form, "characterId"),
    version = parseVersion(field(form, "version"), true);
  const a = await editable(memberId);
  if (!a) return { error: "Нет доступа к персонажам этого участника." };
  if (!isUuid(characterId) || version === null)
    return { error: "Обновите страницу перед сохранением." };
  const name = normalizeNickname(field(form, "name")),
    invalid = nicknameError(name);
  if (invalid) return { error: invalid };
  const { error } = await a.client.rpc("save_character", {
    p_member_id: memberId,
    p_character_id: characterId,
    p_expected_version: version,
    p_name: name,
    p_game_server: field(form, "server"),
    p_character_class: field(form, "characterClass"),
    p_specialization: field(form, "specialization"),
    p_is_main: form.get("main") === "on",
  });
  if (error) return { error: messageFor(error) };
  refreshMember(memberId);
  return { success: "Персонаж сохранён." };
}
export async function archiveCharacter(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const memberId = field(form, "memberId"),
    characterId = field(form, "characterId"),
    version = parseVersion(field(form, "version"));
  const a = await editable(memberId);
  if (!a) return { error: "Нет доступа к персонажам этого участника." };
  if (!isUuid(characterId) || version === null)
    return { error: "Обновите страницу перед сохранением." };
  if (form.get("confirm") !== "on")
    return { error: "Подтвердите перенос персонажа в архив." };
  const { error } = await a.client.rpc("archive_character", {
    p_member_id: memberId,
    p_character_id: characterId,
    p_expected_version: version,
    p_reason: field(form, "reason"),
  });
  if (error) return { error: messageFor(error) };
  refreshMember(memberId);
  return { success: "Персонаж перенесён в архив." };
}
