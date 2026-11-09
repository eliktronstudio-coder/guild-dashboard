import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import Link from "next/link";
import { GuildShell } from "@/components/shell";
import { ActivityForm } from "@/components/activities/activity-form";
import { loadActivityOptions } from "@/lib/activity-options";
import { isUuid } from "@/lib/members";
import type { ActivityDetail } from "@/lib/activity-workspace";
export const metadata = { title: "Редактировать активность" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const options = await loadActivityOptions();
  const { data, error } = await options.access.client.rpc("activity_detail", {
    p_event: id,
  });
  if (error || !data) notFound();
  const initial = data as ActivityDetail;
  return (
    <GuildShell current="/events">
      <div className="activity-workspace">
        <div className="activity-page-heading">
          <Link href={"/events/" + id}>← К активности</Link>
          <h1>Редактировать активность</h1>
          <p>{initial.event.title}</p>
        </div>
        {initial.event.status === "cancelled" ? (
          <p className="notice">Отменённую активность нельзя редактировать.</p>
        ) : (
          <ActivityForm
            templates={options.templates}
            members={options.members}
            catalog={options.catalog}
            canRoster={options.canRoster}
            canTreasury={options.canTreasury}
            initial={initial}
            requestId={randomUUID()}
          />
        )}
      </div>
    </GuildShell>
  );
}
