import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { memberDatabase, guild } from "./support/database";
import { parseDropPhoto } from "../src/lib/drop-registry";
import {
  summarizeAttendance,
  type AttendanceFact,
} from "../src/lib/command-analytics";
test("activity banner PNG dimensions are independent of drop icons", () => {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(480, 16);
  bytes.writeUInt32BE(180, 20);
  const photo = "data:image/png;base64," + bytes.toString("base64");
  assert.equal(parseDropPhoto(photo, false, true), photo);
  assert.equal(parseDropPhoto(photo, false), false);
  assert.equal(
    parseDropPhoto("data:image/png;base64," + "A".repeat(500001), false, true),
    false,
  );
});
test("activity banners: admin CRUD, member visibility, event snapshots, retry and safe deletion on production schema", async () => {
  const { db, as, scalar } = await memberDatabase();
  try {
    await db.exec("create role service_role;");
    for (const f of (await readdir("supabase/migrations"))
      .sort()
      .filter(
        (f) => f.endsWith(".sql") && !/000[12]_/.test(f) && !/001[78]_/.test(f),
      ))
      await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
    await db.exec(
      await readFile(
        "supabase/migrations/202611090020_activity_banners.sql",
        "utf8",
      ),
    );
    const banner = randomUUID(),
      event = randomUUID(),
      other = randomUUID();
    const date = new Date(Date.now() + 86400000).toISOString();
    await as(2);
    await assert.rejects(
      db.query("select public.save_activity_banner($1,$2,0,'Кракен','',150)", [
        guild,
        banner,
      ]),
      /FORBIDDEN/,
    );
    await as(1);
    await db.query(
      "select public.save_activity_banner($1,$2,0,'Кракен','',150)",
      [guild, banner],
    );
    await assert.rejects(
      db.query("select public.save_activity_banner($1,$2,0,'кракен','',150)", [
        guild,
        other,
      ]),
      /duplicate key/,
    );
    await assert.rejects(
      db.query("select public.save_activity_banner($1,$2,1,'Кракен','',0)", [
        guild,
        banner,
      ]),
      /check constraint/,
    );
    await db.query(
      "select public.create_banner_event($1,$2,'Кракен','raid',$3,'',true)",
      [banner, event, date],
    );
    await db.query(
      "select public.create_banner_event($1,$2,'Кракен','raid',$3,'',true)",
      [banner, event, date],
    );
    assert.equal(
      await scalar("select activity_weight from public.events where id=$1", [
        event,
      ]),
      150,
    );
    await db.query(
      "select public.save_activity_banner($1,$2,1,'Разъярённый Кракен',null,200)",
      [guild, banner],
    );
    assert.equal(
      await scalar("select activity_weight from public.events where id=$1", [
        event,
      ]),
      150,
    );
    await assert.rejects(
      db.query("select public.delete_activity_banner($1,$2,1)", [
        guild,
        banner,
      ]),
      /STALE_VERSION/,
    );
    await as(2);
    assert.equal(
      await scalar("select count(*)::int from public.guild_activity_banners"),
      1,
    );
    await assert.rejects(
      db.query("select public.delete_activity_banner($1,$2,2)", [
        guild,
        banner,
      ]),
      /FORBIDDEN/,
    );
    await assert.rejects(
      db.query("delete from public.guild_activity_banners"),
      /permission denied/,
    );
    await as(1);
    await db.query("select public.delete_activity_banner($1,$2,2)", [
      guild,
      banner,
    ]);
    assert.equal(
      await scalar(
        "select activity_banner_name from public.events where id=$1",
        [event],
      ),
      "Кракен",
    );
    await db.query(
      "select public.create_banner_event($1,$2,'Кракен','raid',$3,'',true)",
      [banner, event, date],
    );
    await assert.rejects(
      db.query(
        "select public.create_banner_event($1,$2,'Кракен','raid',$3,'',true)",
        [banner, other, date],
      ),
      /INVALID_BANNER/,
    );
    assert.equal(
      await scalar("select count(*)::int from public.events where id=$1", [
        other,
      ]),
      0,
    );
  } finally {
    await db.close();
  }
});
test("saved activity coefficient overrides title defaults in weighted Prime attendance", () => {
  const base = {
    title: "Поход в четверг",
    activity_banner_name: "Кракен",
    kind: "raid",
    starts_at: "2026-01-01T00:00:00Z",
    status: "completed",
    counts_for_attendance: true,
    attendance_finalized_at: "2026-01-01T01:00:00Z",
    boss_name: null,
    boss_weight: null,
  };
  const facts: AttendanceFact[] = [
    {
      membership_id: "member",
      mark: "present",
      event: { ...base, id: "one", activity_weight: 150 },
    },
    {
      membership_id: "member",
      mark: "absent",
      event: { ...base, id: "two", activity_weight: 50 },
    },
  ];
  const summary = summarizeAttendance(
    facts,
    [{ id: "member", nickname: "Тест" }],
    "",
    new Date("2026-02-01"),
  );
  assert.equal(summary.rows[0].prime, 75);
  assert.equal(summary.rows[0].percentage, 50);
});
