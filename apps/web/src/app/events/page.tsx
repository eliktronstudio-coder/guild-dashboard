import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/access";
import { GUILD_ID } from "@/lib/config";
import { GuildShell } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { EventFields } from "@/components/events/fields";
import { EventCalendar } from "@/components/events/calendar";
import {
  EVENT_KINDS,
  EVENT_STATUS,
  monthRange,
  queryValue,
} from "@/lib/events";
import { createEvent } from "./actions";
export const metadata = { title: "Активности" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const a = await requireMember();
  const p = await searchParams;
  const range = monthRange(queryValue(p.month));
  const requested = queryValue(p.status) ?? "";
  const status = Object.hasOwn(EVENT_STATUS, requested) ? requested : "";
  let query = a.client
    .from("events")
    .select("id,title,kind,starts_at,status,attendance_finalized_at", {
      count: "exact",
    })
    .eq("guild_id", GUILD_ID)
    .gte("starts_at", range.from)
    .lt("starts_at", range.until);
  if (status) query = query.eq("status", status);
  const [{ data, error, count }, canManage] = await Promise.all([
    query.order("starts_at").order("id").limit(500),
    a.permission("events.manage"),
  ]);
  if (error) redirect("/setup?problem=database");
  return (
    <GuildShell current="/events">
      <div className="page-heading">
        <h1>Активности гильдии</h1>
        <p className="muted">Календарь и список событий · время UTC</p>
        <Link href="/attendance" className="text-button">
          Отчёт посещаемости →
        </Link>
      </div>
      <form className="panel section-panel directory-filters">
        <label>
          Месяц
          <input
            type="month"
            name="month"
            defaultValue={range.month}
            min="2000-01"
            max="2100-12"
          />
        </label>
        <label>
          Статус
          <select name="status" defaultValue={status}>
            <option value="">Все события</option>
            {Object.entries(EVENT_STATUS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <button className="button secondary">Показать</button>
      </form>
      {canManage && (
        <details className="panel section-panel">
          <summary>Создать событие</summary>
          <ActionForm action={createEvent} label="Создать событие">
            <input type="hidden" name="requestId" value={randomUUID()} />
            <EventFields />
          </ActionForm>
        </details>
      )}
      {(count ?? 0) > 500 && (
        <p className="notice">
          Показаны первые 500 событий месяца. Уточните фильтр статуса.
        </p>
      )}
      <section className="panel section-panel">
        <EventCalendar month={range.month} events={data ?? []} />
      </section>
      {data?.length ? (
        <div className="applications-grid">
          {data.map((e) => (
            <article key={e.id} className="panel section-panel">
              <span className="badge gold">{EVENT_STATUS[e.status]}</span>
              <h2>
                <Link href={`/events/${e.id}`}>{e.title}</Link>
              </h2>
              <p className="caption">
                {EVENT_KINDS.find(([v]) => v === e.kind)?.[1]} ·{" "}
                {new Date(e.starts_at).toLocaleString("ru-RU", {
                  timeZone: "UTC",
                })}{" "}
                UTC
              </p>
              {e.status === "completed" && (
                <p className="caption">
                  {e.attendance_finalized_at
                    ? "Посещаемость подтверждена"
                    : "Ожидает проверки посещаемости"}
                </p>
              )}
              <Link href={`/events/${e.id}`} className="text-button">
                Открыть событие →
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel empty-state">
          <h2>Событий в этом месяце нет</h2>
          <p>Выберите другой месяц или создайте событие.</p>
        </section>
      )}
    </GuildShell>
  );
}
