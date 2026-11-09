import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { memberDatabase, guild } from "./support/database";
import {
  activityFilters,
  parseActivityPayload,
  validEvidence,
} from "../src/lib/activity-workspace";
import { parseGold } from "../src/lib/treasury";
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=";
test("workspace filters and form validation use bounded real periods and exact money", () => {
  assert.equal(
    activityFilters({ from: "2026-02-30", through: "2026-03-02" }).error !==
      null,
    true,
  );
  assert.equal(
    activityFilters({ from: "2025-01-01", through: "2026-02-01" }).error !==
      null,
    true,
  );
  assert.equal(
    activityFilters({
      from: "2026-01-01",
      through: "2026-01-31",
      status: "paid",
      page: "2",
    }).filters.status,
    "paid",
  );
  assert.equal(validEvidence(image), true);
  assert.equal(validEvidence("data:image/svg+xml;base64,PHN2Zz4="), false);
  assert.equal(validEvidence("data:image/jpeg;base64,AAAA"), false);
  const parsed = parseActivityPayload(
    JSON.stringify({
      title: "Левиафан",
      startsAt: "2026-01-01T12:00",
      status: "completed",
      kind: "raid",
      source: "prime",
      coefficient: "1,5",
      reward: "10,1234",
      difficulty: "normal",
      guests: [],
      members: [],
      facts: {},
    }),
  );
  assert.ok("payload" in parsed);
  assert.equal(parsed.payload?.weight, 150);
  assert.equal(parsed.payload?.reward_units, "101234");
  assert.ok(
    "error" in
      parseActivityPayload(
        JSON.stringify({ title: "Левиафан", startsAt: "invalid" }),
      ),
  );
});
async function setup() {
  const result = await memberDatabase();
  await result.db.exec("create role service_role");
  for (const file of (await readdir("supabase/migrations"))
    .sort()
    .filter(
      (f) => f.endsWith(".sql") && !/000[12]_/.test(f) && !/001[78]_/.test(f),
    ))
    await result.db.exec(await readFile("supabase/migrations/" + file, "utf8"));
  await result.db.exec(
    "update public.memberships set joined_at=now()-interval '10 days'",
  );
  return result;
}
test("record activity atomically: confirmed roster, inventory snapshots, guests, evidence, facts and replay", async () => {
  const { db, as, scalar, members: m } = await setup();
  try {
    const banner = randomUUID(),
      catalog = randomUUID(),
      event = randomUUID(),
      loot = randomUUID(),
      rosterImage = randomUUID(),
      lootImage = randomUUID();
    await as(1);
    await db.query(
      "select public.save_activity_banner($1,$2,0,'Левиафан','',150)",
      [guild, banner],
    );
    await db.query(
      "select public.save_drop_registry($1,$2,0,'Адамантовый коготь','',20000000)",
      [guild, catalog],
    );
    const payload = {
      title: "Левиафан",
      status: "completed",
      starts_at: new Date(Date.now() - 86400000).toISOString(),
      kind: "raid",
      source: "prime",
      banner,
      banner_version: 1,
      weight: 150,
      reward_units: parseGold("10"),
      difficulty: "hard",
      night: true,
      counts: true,
      members: [m[1], m[2]],
      confirm_roster: true,
      guests: ["Гость"],
      facts: {
        boss_defeated: true,
        pvp_result: "none",
        organizer: m[1],
        raid_leader: m[1],
        full_participation: [m[1]],
      },
      evidence: [
        { id: rosterImage, kind: "roster", image },
        { id: lootImage, kind: "loot", image },
      ],
      loot: [{ id: catalog, version: 1, quantity: 2, request_id: loot }],
    };
    await db.query("select public.record_activity($1,$2::jsonb)", [
      event,
      JSON.stringify(payload),
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
        "select count(*)::int from public.attendance where event_id=$1 and mark='absent'",
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
      await scalar("select count(*)::int from public.treasury_awards"),
      0,
    );
    assert.equal(
      await scalar("select count(*)::int from public.treasury_payouts"),
      0,
    );
    assert.equal(
      await scalar(
        "select quantity_remaining from public.treasury_loot where id=$1",
        [loot],
      ),
      2,
    );
    assert.equal(
      await scalar(
        "select estimated_unit_units::text from public.treasury_loot where id=$1",
        [loot],
      ),
      "20000000",
    );
    const before = await scalar("select count(*)::int from public.audit_log");
    await db.query("select public.record_activity($1,$2::jsonb)", [
      event,
      JSON.stringify(payload),
    ]);
    assert.equal(
      await scalar("select count(*)::int from public.audit_log"),
      before,
    );
    const result = await scalar<any>(
      "select public.activity_journal($1,$2,$3,1)",
      [
        new Date(Date.now() - 3 * 86400000).toISOString(),
        new Date(Date.now() + 86400000).toISOString(),
        JSON.stringify({}),
      ],
    );
    assert.equal(result.total, 1);
    assert.equal(result.kpis.average, 2);
    assert.equal(result.kpis.best, 2);
    assert.equal(result.rows[0].percentage, 50);
    assert.equal(result.rows[0].journal_status, "completed");
    const detail = await scalar<any>("select public.activity_detail($1)", [
      event,
    ]);
    assert.equal(detail.roster.length, 2);
    assert.equal(detail.report.guests[0], "Гость");
    assert.equal(detail.loot_total_units, "40000000");
    assert.equal(detail.evidence.length, 2);
    await db.query(
      "select public.save_drop_registry($1,$2,1,'Адамантовый коготь',null,90000000)",
      [guild, catalog],
    );
    assert.equal(
      await scalar(
        "select estimated_unit_units::text from public.treasury_loot where id=$1",
        [loot],
      ),
      "20000000",
    );
    const sale = randomUUID();
    await db.query("select public.sell_treasury_loot($1,$2,1,1,1000000,$3)", [
      sale,
      loot,
      "Продажа дропа",
    ]);
    await db.query(
      "select public.allocate_treasury_sale($1,$2,$3::uuid[],$4)",
      [randomUUID(), sale, [m[1], m[2]], "Расчёт активности"],
    );
    assert.equal(
      (await scalar<any>("select public.activity_detail($1)", [event])).event
        .journal_status,
      "pending_payout",
    );
    const awards = await db.query<{
      id: string;
      amount_units: bigint;
      version: number;
    }>("select id,amount_units::text,version from public.treasury_awards");
    for (const award of awards.rows)
      await db.query("select public.pay_treasury_award($1,$2,$3,$4,$5)", [
        randomUUID(),
        award.id,
        award.version,
        award.amount_units,
        "Выплата за активность",
      ]);
    assert.equal(
      (await scalar<any>("select public.activity_detail($1)", [event])).event
        .journal_status,
      "paid",
    );
    await assert.rejects(
      db.query(
        "select public.remove_activity_drop($1,(select version from public.treasury_loot where id=$1),'Удаление')",
        [loot],
      ),
      /LOOT_HAS_HISTORY/,
    );
    await as(2);
    assert.equal(
      await scalar("select count(*)::int from public.activity_reports"),
      0,
    );
    assert.equal(
      await scalar(
        "select count(*)::int from public.activity_evidence where kind='roster'",
      ),
      0,
    );
    const own = await scalar<any>("select public.activity_detail($1)", [event]);
    assert.equal(own.can_view_roster, false);
    assert.deepEqual(own.roster, []);
    assert.equal(own.report.facts.organizer, undefined);
    assert.equal(
      own.evidence.some((e: any) => e.kind === "roster"),
      false,
    );
    await assert.rejects(
      db.query("select public.record_activity($1,$2::jsonb)", [
        randomUUID(),
        JSON.stringify(payload),
      ]),
      /FORBIDDEN/,
    );
    await assert.rejects(
      db.query("select public.activity_journal($1,$2,$3,1)", [
        new Date(Date.now() - 3 * 86400000).toISOString(),
        new Date(Date.now() + 86400000).toISOString(),
        JSON.stringify({ player: "Владелец" }),
      ]),
      /FORBIDDEN/,
    );
    await as(1);
    await assert.rejects(
      db.query(
        "select public.cancel_activity($1,(select version from public.events where id=$1),'Ошибка')",
        [event],
      ),
      /LOOT_HAS_HISTORY/,
    );
    const badId = randomUUID();
    await assert.rejects(
      db.query("select public.record_activity($1,$2::jsonb)", [
        badId,
        JSON.stringify({
          ...payload,
          loot: [
            { id: catalog, version: 2, quantity: 0, request_id: randomUUID() },
          ],
          evidence: [],
        }),
      ]),
      /INVALID_QUANTITY/,
    );
    assert.equal(
      await scalar("select count(*)::int from public.events where id=$1", [
        badId,
      ]),
      0,
    );
  } finally {
    await db.close();
  }
});
test("planned activities, version guards, cancellation and historical inventory deletion safeguards", async () => {
  const { db, as, scalar, members: m } = await setup();
  try {
    await as(1);
    const event = randomUUID(),
      payload = {
        title: "Будущий рейд",
        status: "scheduled",
        starts_at: new Date(Date.now() + 86400000).toISOString(),
        kind: "raid",
        source: "prime",
        weight: 100,
        reward_units: "0",
        difficulty: "normal",
        night: false,
        guests: [],
        members: [m[1]],
        facts: {},
        evidence: [],
        loot: [],
      };
    await db.query("select public.record_activity($1,$2::jsonb)", [
      event,
      JSON.stringify(payload),
    ]);
    assert.equal(
      await scalar(
        "select count(*)::int from public.event_signups where event_id=$1",
        [event],
      ),
      1,
    );
    assert.equal(
      await scalar(
        "select count(*)::int from public.attendance where event_id=$1",
        [event],
      ),
      0,
    );
    const version = await scalar<number>(
      "select version from public.events where id=$1",
      [event],
    );
    await assert.rejects(
      db.query("select public.save_activity_details($1,$2,$3::jsonb,$4)", [
        event,
        version - 1,
        JSON.stringify(payload),
        "Исправление",
      ]),
      /STALE_VERSION/,
    );
    await db.query("select public.save_activity_details($1,$2,$3::jsonb,$4)", [
      event,
      version,
      JSON.stringify({ ...payload, night: true, guests: ["Новый гость"] }),
      "Ночной состав",
    ]);
    assert.equal(
      await scalar(
        "select is_night from public.activity_reports where event_id=$1",
        [event],
      ),
      true,
    );
    await db.query(
      "select public.cancel_activity($1,(select version from public.events where id=$1),'Перенос рейда')",
      [event],
    );
    assert.equal(
      await scalar("select status from public.events where id=$1", [event]),
      "cancelled",
    );
    await assert.rejects(
      db.query("select public.record_activity($1,$2::jsonb)", [
        randomUUID(),
        JSON.stringify({ ...payload, status: "completed" }),
      ]),
      /EVENT_IN_FUTURE/,
    );
  } finally {
    await db.close();
  }
});
