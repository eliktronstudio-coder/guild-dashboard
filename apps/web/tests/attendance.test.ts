import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { memberDatabase, id, guild } from "./support/database";
test("attendance: applicable roster, finalization, revisions and exact denominator", async (t) => {
  const { db, as, scalar, members: m } = await memberDatabase();
  for (const f of [
    "202610310003_events.sql",
    "202610310004_event_lifecycle.sql",
    "202610310005_attendance.sql",
  ])
    await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  await db.query(
    "update public.memberships set joined_at=now()-interval '10 days'",
  );
  const period = {
    from: new Date(Date.now() - 15 * 86400000).toISOString(),
    until: new Date(Date.now() + 86400000).toISOString(),
  };
  const version = (event: string) =>
    scalar<number>("select version from public.events where id=$1", [event]);
  const report = () =>
    db.query<{
      membership_id: string;
      present: number;
      absent: number;
      excused: number;
      excluded: number;
      percentage: number | null;
    }>("select * from public.attendance_report($1,$2)", [
      period.from,
      period.until,
    ]);
  async function makeEvent(status = "completed", counts = true) {
    await db.exec("reset role");
    const event = randomUUID();
    await db.query(
      "insert into public.events(id,guild_id,title,kind,starts_at,description,organizer_id,counts_for_attendance) values($1,$2,'Тестовый рейд','raid',now()-interval '1 day','',$3,$4)",
      [event, guild, m[1], counts],
    );
    await as(1);
    if (status !== "scheduled")
      await db.query(
        "select public.change_event($1,1,'Тестовый рейд','',$2,'Проверка события')",
        [event, status],
      );
    return event;
  }
  async function markAll(event: string, memberMark = "present") {
    await as(1);
    for (const member of Object.values(m))
      await db.query(
        "select public.mark_attendance($1,$2,1,$3,'Проверено офицером')",
        [event, member, member === m[2] ? memberMark : "excluded"],
      );
  }
  async function finalize(event: string) {
    await as(1);
    await db.query("select public.finalize_attendance($1,$2)", [
      event,
      await version(event),
    ]);
  }
  let event: string;
  await t.test(
    "request UUID deduplicates event creation and rejects changed payload",
    async () => {
      await as(1);
      const request = randomUUID(),
        future = new Date(Date.now() + 86400000).toISOString();
      const args = [request, "Будущий рейд", "raid", future, "Описание", true];
      await db.query(
        "select public.create_guild_event($1,$2,$3,$4,$5,$6)",
        args,
      );
      await db.query(
        "select public.create_guild_event($1,$2,$3,$4,$5,$6)",
        args,
      );
      assert.equal(
        await scalar("select count(*)::int from public.events where id=$1", [
          request,
        ]),
        1,
      );
      await assert.rejects(
        () =>
          db.query("select public.create_guild_event($1,$2,$3,$4,$5,$6)", [
            request,
            "Другой рейд",
            ...args.slice(2),
          ]),
        /REQUEST_CONFLICT/,
      );
      await assert.rejects(
        () =>
          db.query(
            "select public.change_event($1,1,'Будущий рейд','','completed','Завершение')",
            [request],
          ),
        /EVENT_IN_FUTURE/,
      );
      await assert.rejects(
        () =>
          db.query(
            "select public.create_event('Старый вызов','raid',$1,'',true)",
            [future],
          ),
        /permission denied/,
      );
    },
  );
  await t.test(
    "completion freezes eligible candidates, including non-signups, excluding late joins",
    async () => {
      await db.exec("reset role");
      await db.query(
        "insert into public.memberships(guild_id,user_id,nickname) values($1,$2,'Новичок')",
        [guild, id(5)],
      );
      event = await makeEvent();
      assert.equal(
        await scalar(
          "select count(*)::int from public.event_signups where event_id=$1",
          [event],
        ),
        0,
      );
      assert.equal(
        await scalar(
          "select count(*)::int from public.attendance where event_id=$1",
          [event],
        ),
        4,
      );
      assert.equal(
        await scalar(
          "select count(*)::int from public.attendance where event_id=$1 and mark is null",
          [event],
        ),
        4,
      );
      await assert.rejects(() => finalize(event), /UNMARKED_MEMBERS/);
      const r = (await report()).rows.find((r) => r.membership_id === m[2])!;
      assert.equal(r.percentage, null);
    },
  );
  await t.test(
    "member cannot self-mark or see other members attendance",
    async () => {
      await as(2);
      assert.equal(
        await scalar(
          "select count(*)::int from public.attendance where event_id=$1",
          [event],
        ),
        1,
      );
      await assert.rejects(
        () =>
          db.query("select public.mark_attendance($1,$2,1,'present','Обход')", [
            event,
            m[2],
          ]),
        /FORBIDDEN/,
      );
      await assert.rejects(
        () => db.query("update public.attendance set mark='present'"),
        /permission denied/,
      );
      assert.equal((await report()).rows.length, 1);
    },
  );
  await t.test(
    "all marks and explicit finalization are required; retries do not duplicate history",
    async () => {
      await markAll(event);
      const v = await version(event);
      await db.query(
        "select public.mark_attendance($1,$2,1,'present','Повтор запроса')",
        [event, m[2]],
      );
      assert.equal(await version(event), v);
      assert.equal(
        await scalar(
          "select count(*)::int from public.attendance_revisions where event_id=$1",
          [event],
        ),
        4,
      );
      await assert.rejects(
        () => db.query("select public.finalize_attendance($1,2)", [event]),
        /STALE_VERSION/,
      );
      await finalize(event);
      await finalize(event);
      assert.equal(
        Number(
          (await report()).rows.find((r) => r.membership_id === m[2])!
            .percentage,
        ),
        100,
      );
    },
  );
  await t.test(
    "correction records before/after and removes report from statistics until checked",
    async () => {
      await as(1);
      await db.query(
        "select public.mark_attendance($1,$2,2,'absent','Исправлена ошибочная отметка')",
        [event, m[2]],
      );
      assert.equal(
        (await report()).rows.find((r) => r.membership_id === m[2])!.percentage,
        null,
      );
      await assert.rejects(
        () =>
          db.query(
            "select public.mark_attendance($1,$2,2,'excused','Устаревшая форма')",
            [event, m[2]],
          ),
        /STALE_VERSION/,
      );
      const history = await db.query(
        "select old_mark,new_mark,actor_id,reason from public.attendance_revisions where event_id=$1 and membership_id=$2 order by id desc",
        [event, m[2]],
      );
      assert.deepEqual(history.rows[0], {
        old_mark: "present",
        new_mark: "absent",
        actor_id: id(1),
        reason: "Исправлена ошибочная отметка",
      });
      await finalize(event);
    },
  );
  await t.test(
    "excused/excluded, non-counted, cancelled and unfinalized events do not inflate denominator",
    async () => {
      for (const mark of ["present", "excused", "excluded"]) {
        const e = await makeEvent();
        await markAll(e, mark);
        await finalize(e);
      }
      const nonCounted = await makeEvent("completed", false);
      await markAll(nonCounted, "absent");
      await finalize(nonCounted);
      const unfinished = await makeEvent();
      await markAll(unfinished, "absent");
      await makeEvent("cancelled");
      await makeEvent("scheduled");
      const r = (await report()).rows.find((r) => r.membership_id === m[2])!;
      assert.equal(Number(r.present), 1);
      assert.equal(Number(r.absent), 1);
      assert.equal(Number(r.excused), 1);
      assert.equal(Number(r.excluded), 1);
      assert.equal(Number(r.percentage), 50);
      assert.equal(
        (await report()).rows.find((r) => r.membership_id === m[1])!.percentage,
        null,
      );
    },
  );
  await t.test(
    "period is start-inclusive / end-exclusive and validated",
    async () => {
      await as(1);
      const at = await scalar<string>(
        "select starts_at::text from public.events where id=$1",
        [event],
      );
      const empty = await db.query<{ present: number; absent: number }>(
        "select * from public.attendance_report($1,$2)",
        [period.from, at],
      );
      assert.ok(
        empty.rows.every(
          (r) => Number(r.present) === 0 && Number(r.absent) === 0,
        ),
      );
      await assert.rejects(
        () =>
          db.query("select * from public.attendance_report($1,$2)", [
            period.until,
            period.from,
          ]),
        /INVALID_PERIOD/,
      );
    },
  );
  await t.test(
    "scheduled events can be edited, closed events cannot; foreign membership cannot be injected",
    async () => {
      const e = await makeEvent("scheduled");
      await as(1);
      const date = await scalar<string>(
        "select starts_at::text from public.events where id=$1",
        [e],
      );
      await db.query(
        "select public.edit_event($1,1,'Исправленный рейд','pvp',$2,'Описание',false,'Правка типа')",
        [e, date],
      );
      await assert.rejects(
        () =>
          db.query(
            "select public.edit_event($1,1,'Старая форма','raid',$2,'',true,'Повтор')",
            [e, date],
          ),
        /STALE_VERSION/,
      );
      await assert.rejects(
        () =>
          db.query(
            "select public.edit_event($1,1,'Закрытый рейд','raid',$2,'',true,'Правка')",
            [event, date],
          ),
        /EVENT_CLOSED/,
      );
      await assert.rejects(
        () =>
          db.query(
            "select public.mark_attendance($1,$2,1,'present','Подмена ID')",
            [event, randomUUID()],
          ),
        /NOT_IN_ROSTER/,
      );
    },
  );
  await t.test(
    "blocked session and non-member cannot fetch attendance report",
    async () => {
      await as(1);
      await db.query("select public.set_member_blocked($1,true)", [m[2]]);
      await as(2);
      await assert.rejects(() => report(), /FORBIDDEN/);
      await as(6);
      await assert.rejects(() => report(), /FORBIDDEN/);
    },
  );
  await db.close();
});
