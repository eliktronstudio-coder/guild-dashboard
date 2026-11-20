import { randomUUID } from "node:crypto";
import Link from "next/link";
import { GuildShell } from "@/components/shell";
import { ActivityForm } from "@/components/activities/activity-form";
import { loadActivityOptions } from "@/lib/activity-options";
export const metadata = { title: "Добавить активность" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ banner?: string }>;
}) {
  const options = await loadActivityOptions(),
    params = await searchParams;
  return (
    <GuildShell current="/events">
      <div className="activity-workspace">
        <div className="activity-page-heading">
          <Link href="/events">← Журнал активностей</Link>
          <h1>Добавить активность</h1>
          <p>Выберите активность, отметьте состав и добавьте дроп.</p>
        </div>
        <ActivityForm
          templates={options.templates}
          members={options.members}
          catalog={options.catalog}
          canRoster={options.canRoster}
          canTreasury={options.canTreasury}
          selectedBanner={params.banner}
          requestId={randomUUID()}
        />
      </div>
    </GuildShell>
  );
}
