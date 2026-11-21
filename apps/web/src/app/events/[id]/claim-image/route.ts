import { requireMember } from "@/lib/access";
import { isUuid } from "@/lib/members";
import { GUILD_ID } from "@/lib/config";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params,
    claim = new URL(request.url).searchParams.get("claim");
  if (!isUuid(id) || !claim || !isUuid(claim))
    return new Response(null, { status: 404 });
  const a = await requireMember();
  const { data } = await a.client
    .from("participation_claims")
    .select("screenshot")
    .eq("guild_id", GUILD_ID)
    .eq("event_id", id)
    .eq("id", claim)
    .maybeSingle();
  if (!data) return new Response(null, { status: 404 });
  return new Response(Buffer.from(data.screenshot.split(",")[1], "base64"), {
    headers: {
      "Content-Type": data.screenshot.startsWith("data:image/png")
        ? "image/png"
        : "image/jpeg",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
