import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { memberDatabase } from "./support/database";
test("events: permissions, signup retry and isolation from direct writes", async () => {
  const { db, as, scalar } = await memberDatabase();
  await db.exec(
    await readFile("supabase/migrations/202610310003_events.sql", "utf8"),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/202610310004_event_lifecycle.sql",
      "utf8",
    ),
  );
  await as(2);
  await assert.rejects(
    () =>
      db.query(
        "select public.create_event('Рейд','raid',now()+interval '1 day','',true)",
      ),
    /FORBIDDEN/,
  );
  await as(1);
  const event = await scalar(
    "select public.create_event('Рейд','raid',now()+interval '1 day','Сбор гильдии',true)",
  );
  await as(2);
  await db.query("select public.set_event_signup($1,true)", [event]);
  await db.query("select public.set_event_signup($1,true)", [event]);
  assert.equal(
    await scalar("select count(*)::int from public.event_signups"),
    1,
  );
  await assert.rejects(
    () => db.query("update public.events set status='completed'"),
    /permission denied/,
  );
  await db.query("select public.set_event_signup($1,false)", [event]);
  assert.equal(
    await scalar("select count(*)::int from public.event_signups"),
    0,
  );
  await as(1);
  await assert.rejects(
    () =>
      db.query(
        "select public.change_event($1,1,'Рейд','','completed','Завершение')",
        [event],
      ),
    /EVENT_IN_FUTURE/,
  );
  await db.query(
    "select public.change_event($1,1,'Рейд','','cancelled','Нет состава')",
    [event],
  );
  await as(2);
  await assert.rejects(
    () => db.query("select public.set_event_signup($1,true)", [event]),
    /EVENT_CLOSED/,
  );
  await as(5);
  assert.equal(await scalar("select count(*)::int from public.events"), 0);
  await assert.rejects(
    () => db.query("select public.set_event_signup($1,true)", [event]),
    /FORBIDDEN/,
  );
  await db.close();
});
