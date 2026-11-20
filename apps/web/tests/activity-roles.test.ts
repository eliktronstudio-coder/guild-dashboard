import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { memberDatabase, readyForSaleFixture, guild } from "./support/database";
import { ROLE_OPTIONS } from "../src/lib/members";
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=";
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
  await readyForSaleFixture(c.db);
  await c.db.exec("update public.memberships set joined_at='2020-01-01'");
  await c.as(1);
  for (const [n, role] of [
    [2, "admin"],
    [3, "guild_master"],
    [4, "tablemaker"],
  ] as const)
    await c.db.query("select public.assign_member_role($1,$2)", [
      c.members[n],
      role,
    ]);
  return c;
}
test("guild master follows the admin ACL exactly, including future permissions; owner protection and revocation remain", async () => {
  const c = await setup();
  try {
    const { db, members: m } = c;
    assert.ok(ROLE_OPTIONS.some(([code]) => code === "guild_master"));
    assert.ok(ROLE_OPTIONS.some(([code]) => code === "tablemaker"));
    const permissions = () =>
      c.scalar<string[]>(
        "select array_agg(key order by key) from public.permissions where public.has_permission($1,key)",
        [guild],
      );
    await c.as(2);
    const admin = await permissions();
    await c.as(3);
    assert.deepEqual(await permissions(), admin);
    assert.equal(
      await c.scalar("select public.has_permission($1,'roles.assign')", [
        guild,
      ]),
      false,
    );
    await assert.rejects(
      db.query("select public.set_member_blocked($1,true)", [m[1]]),
      /OWNER_PROTECTED/,
    );
    await assert.rejects(
      db.query("select public.assign_member_role($1,'admin')", [m[4]]),
      /FORBIDDEN/,
    );
    await db.exec(
      "reset role;insert into public.permissions values('future.test');insert into public.role_permissions select id,'future.test' from public.roles where code='admin'",
    );
    await c.as(3);
    assert.equal(
      await c.scalar("select public.has_permission($1,'future.test')", [guild]),
      true,
    );
    await c.as(1);
    await db.query("select public.assign_member_role($1,'member')", [m[3]]);
    await c.as(3);
    assert.equal(
      await c.scalar("select public.has_permission($1,'events.manage')", [
        guild,
      ]),
      false,
    );
  } finally {
    await c.db.close();
  }
});
test("tablemaker creates/edits activities, changes raid roster, adds/removes drop and screenshots without treasury or account powers", async () => {
  const c = await setup();
  try {
    const { db, members: m } = c;
    const catalog = randomUUID(),
      event = randomUUID(),
      loot = randomUUID();
    await c.as(1);
    await db.query(
      "select public.save_drop_registry($1,$2,0,'Предмет рейда','',10000)",
      [guild, catalog],
    );
    await c.as(4);
    for (const permission of [
      "events.manage",
      "attendance.manage",
      "activities.loot",
      "members.read",
    ])
      assert.equal(
        await c.scalar("select public.has_permission($1,$2)", [
          guild,
          permission,
        ]),
        true,
      );
    for (const permission of [
      "treasury.read",
      "treasury.manage",
      "treasury.allocate",
      "treasury.pay",
      "treasury.spend",
      "members.manage",
      "roles.assign",
      "members.coefficient",
      "drops.manage",
      "discord.manage",
    ])
      assert.equal(
        await c.scalar("select public.has_permission($1,$2)", [
          guild,
          permission,
        ]),
        false,
      );
    const payload = {
      title: "Тестовый рейд",
      status: "completed",
      starts_at: new Date(Date.now() - 3600000).toISOString(),
      kind: "raid",
      source: "prime",
      weight: 100,
      reward_units: "0",
      difficulty: "normal",
      night: false,
      counts: true,
      members: [m[1], m[4]],
      confirm_roster: true,
      guests: [],
      facts: {},
      evidence: [
        { id: randomUUID(), kind: "loot", image },
        { id: randomUUID(), kind: "roster", image },
      ],
      loot: [{ id: catalog, version: 1, quantity: 2, request_id: loot }],
    };
    await db.query("select public.record_activity($1,$2::jsonb)", [
      event,
      JSON.stringify(payload),
    ]);
    assert.equal(
      await c.scalar(
        "select count(*)::int from public.treasury_loot where id=$1",
        [loot],
      ),
      1,
    );
    assert.equal(
      await c.scalar(
        "select count(*)::int from public.activity_evidence where event_id=$1",
        [event],
      ),
      2,
    );
    const detail = await c.scalar<{ loot: unknown[] }>(
      "select public.activity_detail($1)",
      [event],
    );
    assert.equal(detail.loot.length, 1);
    const edited = {
      ...payload,
      title: "Изменённый рейд",
      members: [m[2], m[4]],
      evidence: [],
      loot: [],
    };
    await db.query(
      "select public.save_activity_details($1,(select version from public.events where id=$1),$2::jsonb,'Исправлен состав')",
      [event, JSON.stringify(edited)],
    );
    assert.equal(
      await c.scalar(
        "select mark from public.attendance where event_id=$1 and membership_id=$2",
        [event, m[2]],
      ),
      "present",
    );
    await db.query(
      "select public.remove_activity_drop($1,1,'Исправление дропа')",
      [loot],
    );
    const second = randomUUID();
    await db.query("select public.add_activity_drop($1,$2,1,1,$3)", [
      event,
      catalog,
      second,
    ]);
    await assert.rejects(
      db.query("select public.sell_treasury_loot($1,$2,1,1,10000,'Продажа')", [
        randomUUID(),
        second,
      ]),
      /FORBIDDEN/,
    );
    await assert.rejects(
      db.query("select public.treasury_summary()"),
      /FORBIDDEN/,
    );
    await assert.rejects(
      db.query("select public.set_member_weight($1,1,125)", [m[4]]),
      /FORBIDDEN/,
    );
    await assert.rejects(
      db.query("select public.set_member_blocked($1,true)", [m[2]]),
      /FORBIDDEN/,
    );
    await assert.rejects(
      db.query(
        "select public.save_drop_registry($1,$2,1,'Смена реестра','',20000)",
        [guild, catalog],
      ),
      /FORBIDDEN/,
    );
    await c.as(1);
    await db.query(
      "select public.sell_treasury_loot($1,$2,1,1,10000,'Продажа')",
      [randomUUID(), second],
    );
    const chest = randomUUID();
    await db.query(
      "select public.add_registry_inventory($1,null,$2,1,'prime',10000,1,'')",
      [chest, catalog],
    );
    await c.as(4);
    assert.equal(
      await c.scalar("select count(*)::int from public.treasury_sales_log"),
      0,
    );
    assert.equal(
      await c.scalar(
        "select count(*)::int from public.treasury_loot where id=$1",
        [chest],
      ),
      0,
    );
    await assert.rejects(
      db.query("select public.remove_activity_drop($1,2,'Удаление продажи')", [
        second,
      ]),
      /LOOT_HAS_HISTORY/,
    );
    await assert.rejects(
      db.query("select public.remove_activity_drop($1,1,'Удаление сундука')", [
        chest,
      ]),
      /FORBIDDEN/,
    );
    await assert.rejects(
      db.query("select public.add_activity_drop($1,$2,1,1,$3)", [
        chest,
        catalog,
        randomUUID(),
      ]),
      /FORBIDDEN/,
    );
    await assert.rejects(
      db.query("select public.activity_detail($1)", [chest]),
      /FORBIDDEN/,
    );
    const clean = randomUUID();
    await db.query("select public.record_activity($1,$2::jsonb)", [
      clean,
      JSON.stringify({ ...edited, loot: [] }),
    ]);
    await db.query(
      "select public.delete_activity($1,(select version from public.events where id=$1),'Дубликат')",
      [clean],
    );
    assert.equal(
      await c.scalar(
        "select deleted_at is not null from public.events where id=$1",
        [clean],
      ),
      true,
    );
  } finally {
    await c.db.close();
  }
});
