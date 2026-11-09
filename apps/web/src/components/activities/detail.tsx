import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireMember } from "@/lib/access";
import { GUILD_ID } from "@/lib/config";
import {
  DIFFICULTIES,
  JOURNAL_STATUSES,
  type ActivityDetail,
  type DropOption,
} from "@/lib/activity-workspace";
import { formatGold } from "@/lib/treasury";
import { ActionForm } from "@/components/action-form";
import { removeActivityDrop } from "@/app/events/workspace-actions";
import { AddDropForm } from "./add-drop-form";
export async function ActivityDetailPanel({ id }: { id: string }) {
  const a = await requireMember();
  const [{ data, error }, manage, treasury, catalogPermission] =
    await Promise.all([
      a.client.rpc("activity_detail", { p_event: id }),
      a.permission("events.manage"),
      a.permission("treasury.manage"),
      a.permission("drops.manage"),
    ]);
  if (error || !data)
    return (
      <p className="notice error" role="alert">
        Не удалось загрузить карточку активности.
      </p>
    );
  const d = data as ActivityDetail,
    e = d.event,
    r = d.report;
  const [catalog, directory] = await Promise.all([
    treasury && catalogPermission
      ? a.client
          .from("guild_drop_registry")
          .select("id,name,price_units::text,version")
          .eq("guild_id", GUILD_ID)
          .order("name")
          .limit(500)
      : Promise.resolve({ data: [] }),
    d.can_view_roster
      ? a.client
          .from("member_directory")
          .select("id,nickname")
          .eq("guild_id", GUILD_ID)
          .limit(500)
      : Promise.resolve({ data: [] }),
  ]);
  const names = new Map((directory.data ?? []).map((m) => [m.id, m.nickname]));
  const classes = new Map<string, number>();
  for (const m of d.roster) {
    const name = m.character_class || "Без роли";
    classes.set(name, (classes.get(name) ?? 0) + 1);
  }
  const status =
    e.journal_status ??
    (e.status === "completed"
      ? e.finalized
        ? "completed"
        : "unconfirmed"
      : e.status);
  return (
    <div className="activity-workspace activity-detail">
      <header className="activity-page-heading">
        <Link href="/events">← Журнал активностей</Link>
        <time dateTime={e.starts_at}>
          {new Date(e.starts_at).toLocaleString("ru-RU", { timeZone: "UTC" })}{" "}
          UTC {r.night ? "· Ночная активность" : ""}
        </time>
      </header>
      <div className="activity-detail-grid">
        <div className="activity-detail-main">
          <section className="activity-hero-card">
            <div
              className={"activity-cover " + (!e.has_banner ? "no-image" : "")}
            >
              {e.has_banner && (
                <img
                  src={`/events/${id}/media?kind=banner&v=${e.version}`}
                  alt={e.title}
                  width={960}
                  height={360}
                />
              )}
              <div className="activity-cover-shade" />
            </div>
            <div className="activity-hero-info">
              <div className="activity-hero-title">
                <h1>{e.title}</h1>
                <span className="activity-tag">
                  {e.source === "mini_rb"
                    ? "Мини-РБ"
                    : e.source === "prime"
                      ? "Прайм"
                      : "Без пометки"}
                </span>
                <span
                  className={
                    "activity-tag " + (e.kind === "pvp" ? "pvp" : "pve")
                  }
                >
                  {e.kind === "pvp" ? "PvP" : "PvE"}
                </span>
                <span className={"activity-status " + status}>
                  {JOURNAL_STATUSES[status] ?? e.status}
                </span>
                {manage && e.status !== "cancelled" && (
                  <Link
                    className="button secondary inline"
                    href={"/events/" + id + "/edit"}
                  >
                    ✎ Редактировать
                  </Link>
                )}
              </div>
              <div className="activity-hero-metrics">
                {[
                  { value: d.participants ?? "—", label: "участников" },
                  {
                    value:
                      d.loot_total_units === null
                        ? "—"
                        : formatGold(d.loot_total_units),
                    label: "оценка дропа",
                    gold: true,
                  },
                  {
                    value:
                      r.reward_units === null
                        ? "—"
                        : formatGold(r.reward_units),
                    label: "за посещение · план",
                  },
                  {
                    value: (e.weight / 100).toLocaleString("ru-RU"),
                    label: "коэффициент",
                  },
                ].map((m) => (
                  <div key={m.label} className={m.gold ? "gold" : ""}>
                    <strong>{m.value}</strong>
                    <span>{m.label}</span>
                  </div>
                ))}
              </div>
              {e.description && <p>{e.description}</p>}
              <p className="caption">
                {DIFFICULTIES[r.difficulty]} ·{" "}
                {e.finalized
                  ? "Посещаемость подтверждена"
                  : e.status === "scheduled"
                    ? "Ожидается проведение"
                    : "Посещаемость ожидает проверки"}
              </p>
            </div>
          </section>
          <section className="activity-detail-panel">
            <header>
              <h2>Дроп</h2>
              {treasury && e.status === "completed" && (
                <Link
                  href={`/treasury?eventMonth=${e.starts_at.slice(0, 7)}&inventory=${e.source}`}
                  className="text-button"
                >
                  Казна и продажи →
                </Link>
              )}
            </header>
            {treasury &&
              e.status === "completed" &&
              (catalog.data?.length ?? 0) > 0 && (
                <details className="activity-add-drop">
                  <summary>＋ Добавить предмет</summary>
                  <AddDropForm
                    eventId={id}
                    requestId={randomUUID()}
                    catalog={(catalog.data ?? []) as DropOption[]}
                  />
                </details>
              )}
            <div className="activity-loot-grid">
              {d.loot.map((l) => (
                <article className="activity-loot-card" key={l.id}>
                  <div className="activity-loot-title">
                    {l.has_photo && (
                      <img
                        src={`/events/${id}/media?kind=item&item=${l.id}`}
                        width={32}
                        height={32}
                        alt=""
                        loading="lazy"
                      />
                    )}
                    <h3>{l.name}</h3>
                  </div>
                  <p>
                    ×{l.quantity.toLocaleString("ru-RU")} ·{" "}
                    {l.unit_units === null
                      ? "Без оценки"
                      : formatGold(l.unit_units) + " зол. / ед."}
                  </p>
                  <strong>
                    {l.total_units === null ? "—" : formatGold(l.total_units)}
                  </strong>
                  {l.remaining !== l.quantity && (
                    <p className="caption">
                      Осталось в инвентаре: {l.remaining}
                    </p>
                  )}
                  {treasury && !l.has_history && e.status !== "cancelled" && (
                    <details className="activity-loot-remove">
                      <summary aria-label={"Удалить " + l.name}>⌫</summary>
                      <ActionForm
                        action={removeActivityDrop}
                        label="Удалить предмет"
                      >
                        <input type="hidden" name="eventId" value={id} />
                        <input type="hidden" name="lootId" value={l.id} />
                        <input type="hidden" name="version" value={l.version} />
                        <label>
                          Причина
                          <textarea
                            name="reason"
                            minLength={3}
                            maxLength={500}
                            required
                          />
                        </label>
                        <label className="check">
                          <input type="checkbox" name="confirm" required />
                          Подтверждаю удаление
                        </label>
                      </ActionForm>
                    </details>
                  )}
                </article>
              ))}
            </div>
            {!d.loot.length && (
              <p className="activity-empty">Дроп ещё не добавлен.</p>
            )}
            {!!d.unpriced_count && (
              <p className="caption">
                Без оценки: {d.unpriced_count}. Они не включены в сумму.
              </p>
            )}
          </section>
          <section className="activity-detail-panel">
            <header>
              <h2>
                {d.can_view_roster
                  ? `Участники (${d.participants ?? 0})`
                  : "Участники"}
              </h2>
              {manage && e.status !== "cancelled" && (
                <div className="activity-panel-actions">
                  <Link href={"/events/" + id + "/edit#guests"}>
                    ＋ Незарегистрированный
                  </Link>
                  <Link href={"/events/" + id + "/edit#roster"}>
                    ✎ Редактировать
                  </Link>
                </div>
              )}
            </header>
            <div className="activity-chips">
              {d.roster.map((m, i) => (
                <Link
                  className={
                    "activity-person role-" +
                    (Array.from(m.character_class ?? "").reduce(
                      (n, c) => n + c.charCodeAt(0),
                      0,
                    ) %
                      6)
                  }
                  href={"/members/" + m.id}
                  key={m.id}
                >
                  {m.nickname}
                </Link>
              ))}
            </div>
            {!d.can_view_roster && (
              <p className="caption">
                Полный состав доступен ответственным за посещаемость. Своя
                отметка — в разделе учёта ниже.
              </p>
            )}
            {r.guests.length > 0 && (
              <>
                <h3 className="activity-guests-label">
                  Незарегистрированные · не учитываются в статистике
                </h3>
                <div className="activity-chips">
                  {r.guests.map((name, i) => (
                    <span key={i} className="activity-person guest">
                      {name}
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
        <aside className="activity-detail-aside">
          <section className="activity-detail-panel">
            <header>
              <h2>♜ Для достижений</h2>
              {manage && e.status === "completed" && (
                <Link href={"/events/" + id + "/edit#facts"}>✎ Отметить</Link>
              )}
            </header>
            <p className="caption">
              Подтверждённые факты: убийство босса, результат PvP, организатор,
              рейд-лидер и полное участие.
            </p>
            <div className="activity-facts">
              {r.facts.boss_defeated && <p>✓ Босс побеждён</p>}
              {r.facts.pvp_result && r.facts.pvp_result !== "none" && (
                <p>
                  PvP:{" "}
                  {
                    { win: "Победа", loss: "Поражение", draw: "Ничья" }[
                      r.facts.pvp_result
                    ]
                  }
                </p>
              )}
              {r.facts.organizer && (
                <p>
                  Организатор:{" "}
                  {names.get(r.facts.organizer) ?? "Участник архива"}
                </p>
              )}
              {r.facts.raid_leader && (
                <p>
                  Рейд-лидер:{" "}
                  {names.get(r.facts.raid_leader) ?? "Участник архива"}
                </p>
              )}
              {!!r.facts.full_participation?.length && (
                <p>
                  Полное участие:{" "}
                  {r.facts.full_participation
                    .map((member) => names.get(member) ?? "Участник архива")
                    .join(", ")}
                </p>
              )}
            </div>
          </section>
          <section className="activity-detail-panel">
            <h2>Состав</h2>
            {[...classes].map(([name, count]) => (
              <div className="activity-class-bar" key={name}>
                <div>
                  <span>{name}</span>
                  <strong>{count}</strong>
                </div>
                <meter min={0} max={Math.max(1, d.roster.length)} value={count}>
                  {count}
                </meter>
              </div>
            ))}
            {!classes.size && (
              <p className="caption">Нет доступного подтверждённого состава.</p>
            )}
          </section>
          {(["roster", "loot"] as const).map((kind) => (
            <section className="activity-detail-panel" key={kind}>
              <header>
                <h2>{kind === "roster" ? "Скрины состава" : "Скрины дропа"}</h2>
                {manage &&
                  e.status !== "cancelled" &&
                  (kind === "roster" ? d.can_view_roster : treasury) && (
                    <Link href={"/events/" + id + "/edit#evidence"}>
                      ＋ Добавить
                    </Link>
                  )}
              </header>
              <div className="activity-screenshot-list">
                {d.evidence
                  .filter((v) => v.kind === kind)
                  .map((v) => (
                    <a
                      href={`/events/${id}/media?kind=${kind}&evidence=${v.id}`}
                      target="_blank"
                      rel="noreferrer"
                      key={v.id}
                    >
                      <img
                        src={`/events/${id}/media?kind=${kind}&evidence=${v.id}`}
                        alt={
                          kind === "roster" ? "Скрин состава" : "Скрин дропа"
                        }
                        width={320}
                        height={180}
                        loading="lazy"
                      />
                    </a>
                  ))}
              </div>
              {!d.evidence.some((v) => v.kind === kind) && (
                <p className="activity-evidence-empty">Скриншотов нет</p>
              )}
            </section>
          ))}
        </aside>
      </div>
    </div>
  );
}
