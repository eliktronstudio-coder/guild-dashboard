import Link from "next/link";
import { requirePermission } from "@/lib/access";
import { GUILD_ID } from "@/lib/config";
import { GuildShell } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { reviewClaim } from "@/app/events/claim-actions";
export const metadata = { title: "Заявки на участие" };
export default async function Page() {
  const a = await requirePermission("attendance.manage");
  const { data: claims, error } = await a.client
    .from("participation_claims")
    .select("id,event_id,created_at,membership_id")
    .eq("guild_id", GUILD_ID)
    .eq("status", "pending")
    .order("created_at")
    .limit(100);
  if (error) throw new Error("CLAIMS_READ_FAILED");
  const ids = [...new Set((claims ?? []).map((c) => c.membership_id))];
  const eventIds = [...new Set((claims ?? []).map((c) => c.event_id))];
  const [memberResult, eventResult] = await Promise.all([
    ids.length
      ? a.client
          .from("memberships")
          .select("id,nickname")
          .eq("guild_id", GUILD_ID)
          .in("id", ids)
      : Promise.resolve({ data: [], error: null }),
    eventIds.length
      ? a.client
          .from("events")
          .select("id,title,starts_at")
          .eq("guild_id", GUILD_ID)
          .in("id", eventIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (memberResult.error || eventResult.error)
    throw new Error("CLAIM_DETAILS_READ_FAILED");
  const members = memberResult.data,
    activities = new Map(eventResult.data?.map((e) => [e.id, e]));
  const names = new Map(members?.map((m) => [m.id, m.nickname]));
  return (
    <GuildShell current="/admin">
      <section className="panel section-panel">
        <h1>Заявки на участие</h1>
        <p>
          Проверьте наличие ника на скрине и в составе активности. Первые 100
          ожидающих заявок.
        </p>
        {!claims?.length && <p>Новых заявок нет.</p>}
        {claims?.map((c) => (
          <article key={c.id} className="panel section-panel">
            <h2>{names.get(c.membership_id) ?? "Участник"}</h2>
            <Link href={`/events/${c.event_id}`}>
              {activities.get(c.event_id)?.title ?? "Активность"} — открыть
              состав →
            </Link>
            <p>{new Date(c.created_at).toLocaleString("ru-RU")}</p>
            <a
              href={`/events/${c.event_id}/claim-image?claim=${c.id}`}
              target="_blank"
              rel="noreferrer"
            >
              <img
                src={`/events/${c.event_id}/claim-image?claim=${c.id}`}
                width={640}
                alt="Скрин активности из заявки"
                style={{ maxWidth: "100%", height: "auto" }}
              />
            </a>
            {(["accept", "reject"] as const).map((decision) => (
              <ActionForm
                key={decision}
                action={reviewClaim}
                label={decision === "accept" ? "Принять" : "Отказать"}
              >
                <input type="hidden" name="claimId" value={c.id} />
                <input type="hidden" name="decision" value={decision} />
              </ActionForm>
            ))}
          </article>
        ))}
      </section>
    </GuildShell>
  );
}
