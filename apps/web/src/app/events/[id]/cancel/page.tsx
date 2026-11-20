import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/access";
import { isUuid } from "@/lib/members";
import { GUILD_ID } from "@/lib/config";
import { GuildShell } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { cancelActivity } from "../../workspace-actions";
export const metadata = { title: "Отменить активность" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const a = await requirePermission("events.manage");
  const { data: e } = await a.client
    .from("events")
    .select("id,title,version,status")
    .eq("guild_id", GUILD_ID)
    .eq("id", id)
    .maybeSingle();
  if (!e) notFound();
  return (
    <GuildShell current="/events">
      <div className="activity-workspace">
        <Link href={"/events/" + id}>← К активности</Link>
        <section className="panel section-panel">
          <h1>Отменить активность</h1>
          <p>
            «{e.title}» останется в журнале со статусом «Отменена» и перестанет
            учитываться в посещаемости.
          </p>
          <ActionForm action={cancelActivity} label="Отменить активность">
            <input type="hidden" name="eventId" value={id} />
            <input type="hidden" name="version" value={e.version} />
            <label>
              Причина
              <textarea name="reason" required minLength={3} maxLength={500} />
            </label>
            <label className="check">
              <input type="checkbox" name="confirm" required />
              Подтверждаю отмену
            </label>
          </ActionForm>
        </section>
      </div>
    </GuildShell>
  );
}
