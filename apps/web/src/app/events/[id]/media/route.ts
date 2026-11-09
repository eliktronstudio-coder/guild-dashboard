import { requireMember } from "@/lib/access";
import { GUILD_ID } from "@/lib/config";
import { isUuid } from "@/lib/members";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUuid(id)) return new Response(null, { status: 404 });
  const a = await requireMember(),
    url = new URL(request.url),
    kind = url.searchParams.get("kind");
  let image: string | null = null;
  if (kind === "banner") {
    const { data } = await a.client
      .from("events")
      .select("activity_banner_photo")
      .eq("guild_id", GUILD_ID)
      .eq("id", id)
      .maybeSingle();
    image = data?.activity_banner_photo ?? null;
  } else if (kind === "item") {
    const item = url.searchParams.get("item");
    if (!item || !isUuid(item) || !(await a.permission("treasury.read")))
      return new Response(null, { status: 404 });
    const { data } = await a.client
      .from("treasury_loot")
      .select("catalog_photo")
      .eq("guild_id", GUILD_ID)
      .eq("event_id", id)
      .eq("id", item)
      .maybeSingle();
    image = data?.catalog_photo ?? null;
  } else if (kind === "roster" || kind === "loot") {
    const evidence = url.searchParams.get("evidence");
    if (
      !evidence ||
      !isUuid(evidence) ||
      !(await a.permission(
        kind === "roster" ? "attendance.manage" : "treasury.read",
      ))
    )
      return new Response(null, { status: 404 });
    const { data } = await a.client
      .from("activity_evidence")
      .select("image")
      .eq("guild_id", GUILD_ID)
      .eq("event_id", id)
      .eq("id", evidence)
      .eq("kind", kind)
      .maybeSingle();
    image = data?.image ?? null;
  }
  if (!image || !/^data:image\/(png|jpeg);base64,/.test(image))
    return new Response(null, { status: 404 });
  return new Response(Buffer.from(image.split(",")[1], "base64"), {
    headers: {
      "Content-Type": image.startsWith("data:image/png")
        ? "image/png"
        : "image/jpeg",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
