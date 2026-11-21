import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { memberDatabase } from "./support/database";
import { parseActivityPayload } from "../src/lib/activity-workspace";
async function setup() {
  const c = await memberDatabase();
  await c.db.exec("create role service_role");
  for (const f of (await readdir("supabase/migrations"))
    .sort()
    .filter(
      (f) =>
        f.endsWith(".sql") &&
        f > "202610310002_members.sql" &&
        f < "202611100031" &&
        !/^20261103001[78]/.test(f),
    ))
    await c.db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  await c.db.exec("update public.memberships set joined_at='2020-01-01'");
  await c.as(1);
  return c;
}
function payload(members: string[]) {
  return {
    title: "Автоматический состав",
    status: "completed",
    starts_at: new Date(Date.now() - 1000).toISOString(),
    kind: "raid",
    source: "mini_rb",
    weight: 100,
    reward_units: "0",
    difficulty: "normal",
    night: false,
    counts: true,
    members,
    confirm_roster: false,
    guests: [],
    facts: {},
    evidence: [],
    loot: [],
  };
}
test("removing manual review migrates saved reports and automatically counts saves, corrections and lifecycle completion", async () => {
  const c = await setup();
  const { db, members: m } = c;
  try {
    const older = randomUUID();
    await db.query("select public.record_activity($1,$2::jsonb)", [
      older,
      JSON.stringify(payload([m[1]])),
    ]);
    assert.equal(
      await c.scalar(
        "select attendance_finalized_at is null from public.events where id=$1",
        [older],
      ),
      true,
    );
    await db.exec("reset role");
    await db.exec(
      await readFile(
        "supabase/migrations/202611100031_automatic_attendance.sql",
        "utf8",
      ),
    );
    await c.as(1);
    assert.equal(
      await c.scalar(
        "select attendance_finalized_at is not null from public.events where id=$1",
        [older],
      ),
      true,
    );
    assert.equal(
      await c.scalar(
        "select count(*)::int from public.attendance where event_id=$1 and mark is null",
        [older],
      ),
      0,
    );
    const event = randomUUID(),
      p = payload([m[1], m[2]]);
    await db.query("select public.record_activity($1,$2::jsonb)", [
      event,
      JSON.stringify(p),
    ]);
    assert.equal(
      await c.scalar(
        "select count(*)::int from public.attendance where event_id=$1 and mark='present'",
        [event],
      ),
      2,
    );
    assert.equal(
      await c.scalar(
        "select count(*)::int from public.attendance where event_id=$1 and mark='absent'",
        [event],
      ),
      2,
    );
    assert.equal(
      await c.scalar(
        "select attendance_finalized_at is not null from public.events where id=$1",
        [event],
      ),
      true,
    );
    await db.query(
      "select public.save_activity_details($1,(select version from public.events where id=$1),$2::jsonb,'Обновление состава')",
      [event, JSON.stringify({ ...p, members: [m[2], m[3]] })],
    );
    assert.equal(
      await c.scalar(
        "select mark from public.attendance where event_id=$1 and membership_id=$2",
        [event, m[3]],
      ),
      "present",
    );
    assert.equal(
      await c.scalar(
        "select attendance_finalized_at is not null from public.events where id=$1",
        [event],
      ),
      true,
    );
    await db.query(
      "select public.mark_attendance($1,$2,(select version from public.attendance where event_id=$1 and membership_id=$2),'excused','Уважительная причина')",
      [event, m[2]],
    );
    assert.equal(
      await c.scalar(
        "select attendance_finalized_at is not null from public.events where id=$1",
        [event],
      ),
      true,
    );
    assert.equal(
      await c.scalar(
        "select mark from public.attendance where event_id=$1 and membership_id=$2",
        [event, m[2]],
      ),
      "excused",
    );
    const legacy = randomUUID();
    await db.query(
      "select public.create_guild_event($1,'Запланированный рейд','raid',now()+interval '1 hour','',true)",
      [legacy],
    );
    await db.exec("reset role");
    await db.query(
      "update public.events set starts_at=now()-interval '1 hour' where id=$1",
      [legacy],
    );
    await c.as(1);
    await db.query(
      "select public.change_event($1,(select version from public.events where id=$1),'Запланированный рейд','','completed','Рейд завершён')",
      [legacy],
    );
    assert.equal(
      await c.scalar(
        "select attendance_finalized_at is not null from public.events where id=$1",
        [legacy],
      ),
      true,
    );
    await c.as(2);
    await assert.rejects(
      db.query(
        "select public.mark_attendance($1,$2,1,'present','Чужая правка')",
        [event, m[2]],
      ),
      /FORBIDDEN/,
    );
    await assert.rejects(
      db.query("select private.complete_saved_attendance($1)", [event]),
      /permission denied/,
    );
    await assert.rejects(
      db.query(
        "select public.mark_attendance_before_automatic_count($1,$2,1,'present','Обход')",
        [event, m[2]],
      ),
      /permission denied/,
    );
    await c.as(1);
    assert.equal(
      await c.scalar("select count(*)::int from public.treasury_payouts"),
      0,
    );
  } finally {
    await db.close();
  }
});
test("activity form parser always enables automatic roster accounting", () => {
  const parsed = parseActivityPayload(
    JSON.stringify({
      title: "Рейд для теста",
      startsAt: "2026-11-01T12:00",
      status: "completed",
      kind: "raid",
      source: "prime",
      coefficient: "1",
      reward: "0",
      difficulty: "normal",
      members: [],
      guests: [],
      facts: {},
      confirmRoster: false,
    }),
  );
  assert.ok("payload" in parsed);
  assert.equal(parsed.payload?.confirm_roster, true);
});
