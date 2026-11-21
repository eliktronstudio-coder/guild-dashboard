import { requireMember } from "@/lib/access";
import { GUILD_ID } from "@/lib/config";
export async function GET(request: Request) {
  const a = await requireMember();
  if (
    !(await a.permission("treasury.allocate")) &&
    !(await a.permission("periods.close"))
  )
    return new Response("Forbidden", { status: 403 });
  const from = new URL(request.url).searchParams.get("from");
  if (!from || !/^20\d{2}-\d{2}-15$/.test(from))
    return new Response("Invalid period", { status: 400 });
  const { data, error } = await a.client
    .from("period_archives")
    .select("period_from,closed_at,closed_by,snapshot")
    .eq("guild_id", GUILD_ID)
    .eq("period_from", from)
    .maybeSingle();
  if (error || !data) return new Response("Not found", { status: 404 });
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="XD-archive-${from}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
