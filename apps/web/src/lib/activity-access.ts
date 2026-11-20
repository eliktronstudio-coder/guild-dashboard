import "server-only";
import { redirect } from "next/navigation";
import { requireMember } from "./access";
export async function canManageActivityLoot(
  access: Awaited<ReturnType<typeof requireMember>>,
) {
  const [treasury, activity] = await Promise.all([
    access.permission("treasury.manage"),
    access.permission("activities.loot"),
  ]);
  return treasury || activity;
}
export async function requireActivityLoot() {
  const access = await requireMember();
  if (!(await canManageActivityLoot(access)))
    redirect("/dashboard?notice=forbidden");
  return access;
}
