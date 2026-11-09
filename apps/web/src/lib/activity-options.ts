import "server-only";
import { requirePermission } from "./access";
import { GUILD_ID } from "./config";
import type {
  ActivityMember,
  ActivityTemplate,
  DropOption,
} from "./activity-workspace";
export async function loadActivityOptions() {
  const access = await requirePermission("events.manage");
  const [canRoster, canTreasury, canCatalog] = await Promise.all([
    access.permission("attendance.manage"),
    access.permission("treasury.manage"),
    access.permission("drops.manage"),
  ]);
  const [templates, members, catalog] = await Promise.all([
    access.client
      .from("guild_activity_banners")
      .select("id,name,weight,version")
      .eq("guild_id", GUILD_ID)
      .order("name")
      .limit(500),
    canRoster
      ? access.client
          .from("member_directory")
          .select("id,nickname,character_class,status")
          .eq("guild_id", GUILD_ID)
          .eq("status", "active")
          .order("nickname")
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
    canTreasury && canCatalog
      ? access.client
          .from("guild_drop_registry")
          .select("id,name,price_units::text,version")
          .eq("guild_id", GUILD_ID)
          .order("name")
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (templates.error || members.error || catalog.error)
    throw new Error("Не удалось загрузить реестры активности.");
  return {
    access,
    canRoster,
    canTreasury,
    templates: (templates.data ?? []) as ActivityTemplate[],
    members: (members.data ?? []) as ActivityMember[],
    catalog: (catalog.data ?? []) as DropOption[],
  };
}
