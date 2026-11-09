import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/access";
import { GUILD_ID } from "@/lib/config";
import { isUuid } from "@/lib/members";
import { GuildShell } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { deleteActivity } from "../../claim-actions";
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
    .select("id,title,version")
    .eq("guild_id", GUILD_ID)
    .eq("id", id)
    .maybeSingle();
  if (!e) notFound();
  return (
    <GuildShell current="/events">
      <section className="panel section-panel">
        <h1>Удалить активность «{e.title}»?</h1>
        <p>
          Активность исчезнет из журнала и расчётов посещаемости. История
          действий сохранится. Активности с дропом или продажами защищены от
          удаления.
        </p>
        <ActionForm action={deleteActivity} label="Удалить активность">
          <input type="hidden" name="eventId" value={id} />
          <input type="hidden" name="version" value={e.version} />
          <label>
            Причина
            <textarea name="reason" required minLength={3} maxLength={500} />
          </label>
          <label>
            <input name="confirm" type="checkbox" required /> Подтверждаю
            удаление
          </label>
        </ActionForm>
      </section>
    </GuildShell>
  );
}
