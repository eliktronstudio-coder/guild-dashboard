import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requirePermission } from "@/lib/access";
import { GUILD_ID } from "@/lib/config";
import { activityFilters } from "@/lib/activity-workspace";
import { GuildShell } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { archiveActivities } from "./actions";
export const metadata = { title: "Архивировать активности" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const a = await requirePermission("periods.close");
  await requirePermission("events.manage");
  const range = activityFilters(await searchParams),
    today = new Date().toISOString().slice(0, 10);
  const error =
    range.error ||
    (range.through > today ? "Будущие даты архивировать нельзя." : null);
  const preview = error
    ? null
    : await a.client
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("guild_id", GUILD_ID)
        .is("activity_archive_id", null)
        .is("deleted_at", null)
        .eq("inventory_receipt", false)
        .gte("starts_at", range.from + "T00:00:00Z")
        .lt("starts_at", range.until)
        .lte("starts_at", new Date().toISOString());
  return (
    <GuildShell current="/events">
      <Link href="/events">← Активности</Link>
      <h1>Архивировать активности</h1>
      <p className="notice">
        Обе даты включаются в диапазон, время — UTC, как в журнале активностей.
        Активности, составы и скриншоты сохранятся в архиве. Они перестанут
        учитываться в текущей посещаемости и новом расчёте ЗП. Казна, инвентарь
        и уже зафиксированные начисления и выплаты сохранятся.
      </p>
      <form className="panel section-panel form-stack">
        <label>
          Дата с
          <input
            type="date"
            name="from"
            required
            max={today}
            defaultValue={range.from}
          />
        </label>
        <label>
          Дата по
          <input
            type="date"
            name="through"
            required
            max={today}
            defaultValue={range.through}
          />
        </label>
        <button className="button secondary">Показать количество</button>
      </form>
      {error || preview?.error ? (
        <p role="alert" className="notice error">
          {error || "Не удалось проверить выбранные активности."}
        </p>
      ) : (
        <section className="panel section-panel">
          <h2>К архивации: {preview?.count ?? 0}</h2>
          <p>
            {range.from} — {range.through} включительно. Если архивировать все
            учитываемые активности, посещаемость станет 0%. Новые активности
            начнут формировать её заново.
          </p>
          {!!preview?.count && (
            <ActionForm
              action={archiveActivities}
              label="Архивировать активности"
              revision={range.from + range.through}
            >
              <input type="hidden" name="requestId" value={randomUUID()} />
              <input type="hidden" name="from" value={range.from} />
              <input type="hidden" name="through" value={range.through} />
              <label>
                <input type="checkbox" name="confirm" required /> Подтверждаю
                исключение выбранных активностей из текущей статистики
              </label>
            </ActionForm>
          )}
          <Link
            href={
              "/events?" +
              new URLSearchParams({
                archive: "1",
                from: range.from,
                through: range.through,
              })
            }
          >
            Открыть архив за эти даты →
          </Link>
        </section>
      )}
    </GuildShell>
  );
}
