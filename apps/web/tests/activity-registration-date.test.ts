import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { memberDatabase, guild, id } from "./support/database";
import type { PayrollReport } from "../src/lib/payroll";
async function setup() {
  const c = await memberDatabase();
  await c.db.exec("create role service_role");
  for (const f of (await readdir("supabase/migrations"))
    .sort()
    .filter(
      (f) =>
        f.endsWith(".sql") &&
        f > "202610310002_members.sql" &&
        !/^20261103001[78]/.test(f),
    ))
    await c.db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  await c.as(1);
  return c;
}
const payload = (members: string[]) => ({
  title: "Рейд до регистрации",
  status: "completed",
  starts_at: new Date(Date.now() - 86400000).toISOString(),
  kind: "raid",
  source: "mini_rb",
  weight: 100,
  reward_units: "0",
  difficulty: "normal",
  night: false,
  counts: true,
  members,
  confirm_roster: true,
  guests: [],
  facts: {},
  evidence: [],
  loot: [],
});
test("past activities save selected later-registered members and count their actual attendance, without assigning unrelated newcomers absences", async () => {
  const c = await setup();
  const { db, members: m, scalar } = c;
  try {
    const event = randomUUID(),
      data = payload([m[1], m[2]]);
    assert.equal(
      await scalar(
        "select bool_and(joined_at>$1::timestamptz) from public.memberships",
        [data.starts_at],
      ),
      true,
    );
    await db.query("select public.record_activity($1,$2::jsonb)", [
      event,
      JSON.stringify(data),
    ]);
    assert.equal(
      await scalar(
        "select count(*)::int from public.attendance where event_id=$1 and mark='present'",
        [event],
      ),
      2,
    );
    assert.equal(
      await scalar(
        "select attendance_finalized_at is not null from public.events where id=$1",
        [event],
      ),
      true,
    );
    assert.equal(
      await scalar(
        "select count(*)::int from public.attendance where event_id=$1 and membership_id=$2",
        [event, m[3]],
      ),
      0,
    );
    await db.exec("reset role");
    const report = await scalar<PayrollReport>(
      "select private.period_payroll($1,private.period_start($2::date))",
      [guild, data.starts_at.slice(0, 10)],
    );
    const row = report.rows.find((r) => r.id === m[2]);
    assert.equal(row?.percentage, 100);
    assert.equal(row?.present, "100");
    assert.equal(row?.eligible, true);
    await c.as(1);
    const version = await scalar<number>(
      "select version from public.events where id=$1",
      [event],
    );
    await db.query(
      "select public.save_activity_details($1,$2,$3::jsonb,'Дополнен исторический состав')",
      [
        event,
        version,
        JSON.stringify({ ...data, members: [m[1], m[2], m[3]] }),
      ],
    );
    assert.equal(
      await scalar(
        "select mark from public.attendance where event_id=$1 and membership_id=$2",
        [event, m[3]],
      ),
      "present",
    );
    assert.equal(
      await scalar("select public.record_activity($1,$2::jsonb)", [
        event,
        JSON.stringify(data),
      ]),
      event,
    );
  } finally {
    await db.close();
  }
});
test("ignoring registration time preserves active-member checks, tenant isolation, write ACL and closed-period protection", async () => {
  const c = await setup();
  const { db, members: m } = c;
  try {
    await db.exec("reset role");
    await db.query("update public.memberships set status='left' where id=$1", [
      m[3],
    ]);
    const other = randomUUID(),
      foreign = randomUUID();
    await db.query(
      "insert into public.guilds(id,slug,name) values($1,'other','Other')",
      [other],
    );
    await db.query(
      "insert into public.memberships(id,guild_id,user_id,nickname) values($1,$2,$3,'Чужой')",
      [foreign, other, id(5)],
    );
    await c.as(1);
    for (const member of [m[3], foreign, randomUUID()]) {
      const event = randomUUID();
      await assert.rejects(
        db.query("select public.record_activity($1,$2::jsonb)", [
          event,
          JSON.stringify(payload([member])),
        ]),
        /INVALID_ROSTER/,
      );
      assert.equal(
        await c.scalar("select count(*)::int from public.events where id=$1", [
          event,
        ]),
        0,
      );
    }
    await c.as(2);
    await assert.rejects(
      db.query("select public.record_activity($1,$2::jsonb)", [
        randomUUID(),
        JSON.stringify(payload([m[2]])),
      ]),
      /FORBIDDEN/,
    );
    await db.exec("reset role");
    await db.query(
      "insert into public.period_archives(guild_id,period_from,closed_by,snapshot) values($1,private.period_start($2::date),$3,'{}')",
      [guild, payload([]).starts_at.slice(0, 10), id(1)],
    );
    await c.as(1);
    await assert.rejects(
      db.query("select public.record_activity($1,$2::jsonb)", [
        randomUUID(),
        JSON.stringify(payload([m[1]])),
      ]),
      /PERIOD_CLOSED/,
    );
  } finally {
    await db.close();
  }
});
