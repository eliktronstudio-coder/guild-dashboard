import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requirePermission } from "@/lib/access";
import { GUILD_ID } from "@/lib/config";
import { GuildShell } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { formatGold } from "@/lib/treasury";
import { isUuid } from "@/lib/members";
import { poolError, type PoolPreview } from "@/lib/pools";
import { allocatePool } from "./actions";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ event?: string | string[]; month?: string }>;
}) {
  const a = await requirePermission("treasury.allocate");
  const p = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(p.month ?? "")
    ? p.month!
    : new Date().toISOString().slice(0, 7);
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const ids = (Array.isArray(p.event) ? p.event : p.event ? [p.event] : [])
    .filter(isUuid)
    .slice(0, 100);
  const {
    data: events,
    error,
    count,
  } = await a.client
    .from("events")
    .select("id,title,boss_name,boss_weight,starts_at", { count: "exact" })
    .eq("guild_id", GUILD_ID)
    .eq("status", "completed")
    .eq("treasury_source", "prime")
    .not("boss_id", "is", null)
    .not("attendance_finalized_at", "is", null)
    .gte("starts_at", start.toISOString())
    .lt("starts_at", end.toISOString())
    .order("starts_at")
    .order("id")
    .limit(100);
  if (error) throw new Error("POOL_EVENTS_FAILED");
  const preview = ids.length
    ? await a.client.rpc("treasury_pool_preview", { p_events: ids })
    : null;
  const calc = preview?.data as PoolPreview | null;
  return (
    <GuildShell current="/treasury">
      <Link href="/treasury">← Казна</Link>
      <div className="page-heading">
        <h1>Распределить фонд по РБ</h1>
        <p>
          Фонд — нераспределённые 70% продаж выбранных событий «Прайм». Баллы
          игрока = его коэффициент × сумма весов РБ, где он присутствовал. Доля
          = фонд × баллы игрока / баллы всех игроков.
        </p>
        <p className="caption">
          Округление до 0,0001 золота, остаток — по наибольшей дробной части,
          затем по ID. Мини РБ учитываются отдельно.
        </p>
      </div>
      <form className="panel section-panel">
        <label>
          Месяц событий (UTC)
          <input type="month" name="month" defaultValue={month} />
        </label>
        <button className="button secondary">Показать события</button>
      </form>
      <form className="panel section-panel">
        <input type="hidden" name="month" value={month} />
        {events?.map((e) => (
          <label className="check" key={e.id}>
            <input
              type="checkbox"
              name="event"
              value={e.id}
              defaultChecked={ids.includes(e.id)}
            />
            <span>
              {e.title} · {e.boss_name} · вес {e.boss_weight / 100} ·{" "}
              {new Date(e.starts_at).toLocaleDateString("ru-RU", {
                timeZone: "UTC",
              })}
            </span>
          </label>
        ))}
        {!events?.length && (
          <p>
            Нет подходящих событий. Укажите РБ в событии и подтвердите
            посещаемость.
          </p>
        )}
        {(count ?? 0) > 100 && <p>Показаны первые 100 событий месяца.</p>}
        <button className="button primary" disabled={!events?.length}>
          Предварительный расчёт
        </button>
      </form>
      {preview?.error && (
        <p className="notice error" role="alert">
          {poolError(preview.error.message)}
        </p>
      )}
      {calc && (
        <section className="panel section-panel">
          <h2>К начислению: {formatGold(calc.amount_units)} зол.</h2>
          <p>
            {calc.events.length} событий · {calc.sales.length} продаж
          </p>
          <ul className="allocation-preview">
            {calc.recipients.map((r) => (
              <li key={r.id}>
                <span>
                  {r.nickname} · баллы {Number(r.weight) / 10000}
                </span>
                <strong>{formatGold(r.amount_units)} зол.</strong>
              </li>
            ))}
          </ul>
          <ActionForm action={allocatePool} label="Подтвердить начисление">
            <input type="hidden" name="id" value={randomUUID()} />
            <input type="hidden" name="events" value={JSON.stringify(ids)} />
            <input type="hidden" name="expected" value={JSON.stringify(calc)} />
            <label>
              Основание
              <textarea name="reason" required minLength={3} maxLength={500} />
            </label>
            <label className="check">
              <input type="checkbox" name="confirm" required />
              Проверил события, участников и суммы
            </label>
          </ActionForm>
        </section>
      )}
    </GuildShell>
  );
}
