import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getConfig, GUILD_ID } from "@/lib/config";
export const getAccess = cache(async () => {
  if (!getConfig().configured) redirect("/setup");
  const client = await createClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) redirect("/login");
  const [
    { data: profile, error: profileError },
    { data: membership, error: memberError },
  ] = await Promise.all([
    client
      .from("profiles")
      .select("id,blocked")
      .eq("id", user.id)
      .maybeSingle(),
    client
      .from("memberships")
      .select(
        "id,nickname,status,joined_at,avatar_style,player_class,class_selected_at",
      )
      .eq("guild_id", GUILD_ID)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  if (profileError || memberError) {
    console.error("ACCESS_DATABASE_FAILURE", {
      profile: profileError?.code,
      membership: memberError?.code,
    });
    throw new Error("ACCESS_DATABASE_UNAVAILABLE");
  }
  if (!profile || profile.blocked) redirect("/login?notice=access");
  const permissions = new Map<string, Promise<boolean>>();
  const loadPermission = async (key: string) => {
    const { data, error } = await client.rpc("has_permission", {
      guild: GUILD_ID,
      permission: key,
    });
    if (error) {
      console.error("PERMISSION_DATABASE_FAILURE", { code: error.code });
      throw new Error("ACCESS_DATABASE_UNAVAILABLE");
    }
    return data === true;
  };
  // Share in-flight checks only inside this request. Role changes and revoked
  // sessions are checked again on the next request, including every mutation.
  const permission = (key: string) => {
    let result = permissions.get(key);
    if (!result) {
      result = loadPermission(key);
      permissions.set(key, result);
    }
    return result;
  };
  return { client, user, profile, membership, permission };
});
export async function requireMember() {
  const a = await getAccess();
  if (a.membership?.status !== "active") redirect("/application");
  return a;
}
export async function requirePermission(key: string) {
  const a = await requireMember();
  if (!(await a.permission(key))) redirect("/dashboard?notice=forbidden");
  return a;
}
