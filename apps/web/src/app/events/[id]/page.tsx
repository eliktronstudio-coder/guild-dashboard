import { ActivityDetailPanel } from "@/components/activities/detail";
import { setEventBoss } from "@/app/admin/catalog/actions";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireMember } from "@/lib/access";
import { GUILD_ID } from "@/lib/config";
import { isUuid } from "@/lib/members";
import { EVENT_STATUS, ATTENDANCE_MARKS, nicknameOf } from "@/lib/events";
import { TREASURY_SOURCES, sourceName } from "@/lib/treasury";
import { GuildShell } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { EventFields } from "@/components/events/fields";
import {
  signupEvent,
  editEvent,
  changeEvent,
  markAttendance,
  tagEventTreasury,
} from "../actions";
export const metadata = { title: "Событие гильдии" };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const a = await requireMember();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { data: e, error } = await a.client
    .from("events")
    .select("*")
    .eq("guild_id", GUILD_ID)
    .eq("id", id)
    .maybeSingle();
  if (error) redirect("/setup?problem=database");
  if (!e) notFound();
  const page = Math.max(
    1,
    Math.min(10000, parseInt((await searchParams).page ?? "1", 10) || 1),
  );
  const [manage, attendanceManage, treasuryManage, signups, roster, revisions] =
    await Promise.all([
      a.permission("events.manage"),
      a.permission("attendance.manage"),
      a.permission("treasury.manage"),
      a.client
        .from("event_signups")
        .select("membership_id,memberships(nickname)", { count: "exact" })
        .eq("guild_id", GUILD_ID)
        .eq("event_id", id)
        .order("membership_id")
        .range((page - 1) * 50, page * 50 - 1),
      a.client
        .from("attendance")
        .select("membership_id,mark,version,memberships(nickname,status)", {
          count: "exact",
        })
        .eq("guild_id", GUILD_ID)
        .eq("event_id", id)
        .order("membership_id")
        .range((page - 1) * 50, page * 50 - 1),
      a.client
        .from("attendance_revisions")
        .select("id,old_mark,new_mark,reason,created_at,membership_id,actor_id")
        .eq("event_id", id)
        .order("id", { ascending: false })
        .limit(20),
    ]);
  if (signups.error || roster.error || revisions.error)
    redirect("/setup?problem=database");
  const catalogEnabled = await a.permission("catalog.manage");
  const bosses =
    manage && catalogEnabled
      ? await a.client
          .from("guild_catalog")
          .select("id,name,weight")
          .eq("guild_id", GUILD_ID)
          .eq("kind", "boss")
          .eq("archived", false)
          .order("name")
          .limit(500)
      : { data: [], error: null };
  if (bosses.error) throw new Error("BOSS_READ_FAILED");
  const changes = revisions.data ?? [];
  const [affectedMembers, editors] = changes.length
    ? await Promise.all([
        a.client
          .from("memberships")
          .select("id,nickname")
          .eq("guild_id", GUILD_ID)
          .in("id", [...new Set(changes.map((r) => r.membership_id))]),
        a.client
          .from("memberships")
          .select("user_id,nickname")
          .eq("guild_id", GUILD_ID)
          .in("user_id", [...new Set(changes.map((r) => r.actor_id))]),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (affectedMembers.error || editors.error)
    redirect("/setup?problem=database");
  const memberNames = new Map(
    affectedMembers.data?.map((m) => [m.id, m.nickname]),
  );
  const editorNames = new Map(
    editors.data?.map((m) => [m.user_id, m.nickname]),
  );
  const { data: ownSignup, error: ownError } = await a.client
    .from("event_signups")
    .select("membership_id")
    .eq("event_id", id)
    .eq("membership_id", a.membership!.id)
    .maybeSingle();
  if (ownError) redirect("/setup?problem=database");
  const editable = e.status === "scheduled";
  const open = editable && new Date(e.starts_at).getTime() > Date.now();
  const maxPage = Math.max(
    1,
    Math.ceil(Math.max(signups.count ?? 0, roster.count ?? 0) / 50),
  );
  if (page > maxPage) redirect(`/events/${id}?page=${maxPage}`);
  return (
    <GuildShell current="/events">
      <ActivityDetailPanel id={id} />
      <details className="panel section-panel activity-legacy">
        <summary>Запись, посещаемость и история</summary>
        {manage && catalogEnabled && (
          <section className="panel section-panel">
            <h2>Рейд-босс</h2>
            <p>
              Сохранённый вес: {e.boss_name ?? "Не выбран"}
              {e.boss_weight ? ` · ${e.boss_weight / 100}` : ""}
            </p>
            <ActionForm
              action={setEventBoss}
              revision={e.version}
              label="Сохранить РБ"
            >
              <input type="hidden" name="id" value={e.id} />
              <input type="hidden" name="version" value={e.version} />
              <label>
                Босс из справочника
                <select name="boss" defaultValue={e.boss_id ?? ""}>
                  <option value="">Не выбран</option>
                  {bosses.data?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} · {b.weight / 100}
                    </option>
                  ))}
                </select>
              </label>
            </ActionForm>
          </section>
        )}

        <Link
          href={`/events?month=${e.starts_at.slice(0, 7)}`}
          className="text-button"
        >
          ← Журнал активностей
        </Link>
        <section className="panel section-panel">
          <span className="badge gold">{EVENT_STATUS[e.status]}</span>
          <h2 className="event-title">{e.title}</h2>
          {e.activity_weight != null && (
            <p className="badge gold">
              {e.activity_banner_name} · Коэффициент ×
              {(e.activity_weight / 100).toLocaleString("ru-RU")}
            </p>
          )}
          <p>
            {new Date(e.starts_at).toLocaleString("ru-RU", { timeZone: "UTC" })}{" "}
            UTC
          </p>
          <p className="profile-about">{e.description}</p>
          <p className="caption">
            Пометка дропа: {sourceName(e.treasury_source)}
          </p>
          {e.status === "completed" && e.treasury_source !== "none" && (
            <Link
              className="text-button"
              href={`/treasury?inventory=${e.treasury_source}&eventMonth=${new Date(e.starts_at).toISOString().slice(0, 7)}`}
            >
              Казна и инвентарь →
            </Link>
          )}
          <p className="caption">
            {e.counts_for_attendance
              ? "Учитывается в посещаемости"
              : "Не учитывается в посещаемости"}
          </p>
          {open ? (
            <ActionForm
              action={signupEvent}
              label={ownSignup ? "Отменить мою запись" : "Записаться"}
            >
              <input type="hidden" name="eventId" value={id} />
              <input type="hidden" name="join" value={String(!ownSignup)} />
            </ActionForm>
          ) : (
            <p className="notice">Запись закрыта.</p>
          )}
        </section>
        {(manage || treasuryManage) && e.status !== "cancelled" && (
          <details className="panel section-panel">
            <summary>Пометка дропа: прайм или мини РБ</summary>
            <p className="muted">
              Прайм направляет дроп в общий инвентарь, мини РБ — в инвентарь ХД.
              После внесения первой партии пометка фиксируется.
            </p>
            <ActionForm
              action={tagEventTreasury}
              revision={e.version}
              label="Сохранить пометку"
            >
              <input type="hidden" name="eventId" value={id} />
              <input type="hidden" name="version" value={e.version} />
              <label>
                Источник дропа
                <select name="source" defaultValue={e.treasury_source}>
                  {TREASURY_SOURCES.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Причина назначения или изменения
                <textarea
                  name="reason"
                  minLength={3}
                  maxLength={500}
                  required
                />
              </label>
            </ActionForm>
          </details>
        )}
        <section className="panel section-panel">
          <h2>Записались · {signups.count ?? 0}</h2>
          {signups.data?.length ? (
            <ul className="audit-list">
              {signups.data.map((s) => (
                <li key={s.membership_id}>{nicknameOf(s.memberships)}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">На этой странице записей нет.</p>
          )}
          <p className="caption">
            Запись на событие не равна подтверждённому присутствию.
          </p>
        </section>
        {manage && editable && (
          <>
            <details className="panel section-panel">
              <summary>Редактировать событие</summary>
              <ActionForm
                action={editEvent}
                revision={e.version}
                label="Сохранить изменения"
              >
                <input type="hidden" name="eventId" value={id} />
                <input type="hidden" name="version" value={e.version} />
                <EventFields event={e} />
                <label>
                  Причина изменения
                  <textarea
                    name="reason"
                    minLength={3}
                    maxLength={500}
                    required
                  />
                </label>
              </ActionForm>
            </details>
            <details className="panel section-panel">
              <summary>Завершить или отменить событие</summary>
              <ActionForm
                action={changeEvent}
                revision={e.version}
                label="Подтвердить статус"
              >
                <input type="hidden" name="eventId" value={id} />
                <input type="hidden" name="version" value={e.version} />
                <input type="hidden" name="title" value={e.title} />
                <input type="hidden" name="description" value={e.description} />
                <label>
                  Новый статус
                  <select name="status" required defaultValue="">
                    <option value="" disabled>
                      Выберите действие
                    </option>
                    <option value="completed">Завершить</option>
                    <option value="cancelled">Отменить</option>
                  </select>
                </label>
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
                  <span>
                    Подтверждаю завершение события. Сохранённый состав будет
                    учтён автоматически.
                  </span>
                </label>
              </ActionForm>
            </details>
          </>
        )}
        {e.status === "completed" && (
          <section className="panel section-panel">
            <h2>
              {attendanceManage
                ? "Посещаемость и применимость"
                : "Моя посещаемость"}
            </h2>
            <p className="notice">
              {e.attendance_finalized_at
                ? "Сохранённый состав учитывается автоматически. Изменения отметок сразу обновляют посещаемость."
                : "Сохраните состав активности, чтобы учесть посещаемость."}
            </p>
            {attendanceManage && (
              <p className="muted">
                В список включены участники, вступившие не позднее начала
                события. Проверьте применимость: для другого состава, покинувших
                гильдию до события и неприменимых игроков выберите «Не
                учитывается». Уважительные причины исключаются из расчёта.
              </p>
            )}
            <div className="attendance-grid">
              {roster.data?.map((r) => (
                <article key={r.membership_id} className="character-card">
                  <h3>{nicknameOf(r.memberships)}</h3>
                  <p className="caption">
                    {ATTENDANCE_MARKS.find(([v]) => v === r.mark)?.[1] ??
                      "Нет отметки"}
                  </p>
                  {attendanceManage && (
                    <ActionForm
                      action={markAttendance}
                      revision={r.version}
                      label="Сохранить отметку"
                    >
                      <input type="hidden" name="eventId" value={id} />
                      <input
                        type="hidden"
                        name="memberId"
                        value={r.membership_id}
                      />
                      <input type="hidden" name="version" value={r.version} />
                      <label>
                        Отметка
                        <select
                          name="mark"
                          required
                          defaultValue={r.mark ?? ""}
                        >
                          <option value="" disabled>
                            Выберите отметку
                          </option>
                          {ATTENDANCE_MARKS.map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Основание или причина исправления
                        <textarea
                          name="reason"
                          minLength={3}
                          maxLength={500}
                          rows={2}
                          required
                        />
                      </label>
                    </ActionForm>
                  )}
                </article>
              ))}
            </div>
            {!roster.data?.length && (
              <p className="muted">
                Нет записей посещаемости на этой странице.
              </p>
            )}
            <Link href="/attendance" className="text-button">
              К отчёту посещаемости →
            </Link>
          </section>
        )}
        {maxPage > 1 && (
          <nav className="pagination" aria-label="Страницы участников события">
            {page > 1 && (
              <Link href={`/events/${id}?page=${page - 1}`}>← Назад</Link>
            )}
            <span>
              {page} / {maxPage}
            </span>
            {page < maxPage && (
              <Link href={`/events/${id}?page=${page + 1}`}>Далее →</Link>
            )}
          </nav>
        )}
        {!!revisions.data?.length && (
          <details className="panel section-panel">
            <summary>Последние 20 изменений посещаемости</summary>
            <ul className="audit-list">
              {revisions.data.map((r) => (
                <li key={r.id}>
                  <strong>
                    {memberNames.get(r.membership_id) ?? "Участник"}
                  </strong>
                  <span className="caption">
                    Автор: {editorNames.get(r.actor_id) ?? "Администратор"}
                  </span>
                  <div>
                    <strong>
                      {ATTENDANCE_MARKS.find(([v]) => v === r.old_mark)?.[1] ??
                        "Нет отметки"}{" "}
                      → {ATTENDANCE_MARKS.find(([v]) => v === r.new_mark)?.[1]}
                    </strong>
                    <p>{r.reason}</p>
                  </div>
                  <time className="caption">
                    {new Date(r.created_at).toLocaleString("ru-RU", {
                      timeZone: "UTC",
                    })}{" "}
                    UTC
                  </time>
                </li>
              ))}
            </ul>
          </details>
        )}
      </details>
    </GuildShell>
  );
}
