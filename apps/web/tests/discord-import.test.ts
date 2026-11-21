import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { memberDatabase, guild, id } from "./support/database";
async function setup() {
  const result = await memberDatabase();
  await result.db.exec("create role service_role");
  for (const f of (await readdir("supabase/migrations"))
    .sort()
    .filter(
      (f) =>
        f.endsWith(".sql") &&
        f > "202610310002_members.sql" &&
        !f.includes("017_") &&
        !f.includes("018_"),
    ))
    await result.db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  return result;
}
const server = "123456789012345678",
  channel = "223456789012345678",
  user = "323456789012345678",
  message = "423456789012345678";
test("Any unlinked Discord channel participant can import through the configured connection, with exact snapshots and replay protection", async () => {
  const { db, as, scalar, members } = await setup();
  try {
    const banner = randomUUID(),
      drop = randomUUID(),
      event = randomUUID(),
      lot = randomUUID();
    await db.exec(
      "update public.memberships set joined_at=now()-interval '2 days'",
    );
    await db.query(
      "insert into public.guild_activity_banners(id,guild_id,name,weight) values($1,$2,'Левиафан',100)",
      [banner, guild],
    );
    await db.query(
      "insert into public.guild_drop_registry(id,guild_id,name,price_units) values($1,$2,'Коготь',20000000)",
      [drop, guild],
    );
    await as(1);
    await db.query("select public.save_discord_settings($1,$2,true)", [
      server,
      channel,
    ]);
    await assert.rejects(
      db.query("select public.discord_import_context($1,$2,null,$3)", [
        server,
        channel,
        user,
      ]),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ role: "service_role" }),
    ]);
    await db.query(
      "insert into public.characters(guild_id,membership_id,name) values($1,$2,'VisionAlias')",
      [guild, members[1]],
    );
    await db.query(
      "insert into public.characters(guild_id,membership_id,name,archived_at) values($1,$2,'ArchivedAlias',now())",
      [guild, members[1]],
    );
    await db.exec("set role service_role");
    const ctx = await scalar<Record<string, unknown[]>>(
      "select public.discord_import_context($1,$2,null,$3)",
      [server, channel, user],
    );
    assert.equal(ctx.members.length, 4);
    const catalog = ctx.members as { id: string; aliases: string[] }[];
    assert.ok(
      catalog.find((m) => m.id === members[1])?.aliases.includes("VisionAlias"),
    );
    assert.ok(!catalog.some((m) => m.aliases.includes("ArchivedAlias")));
    assert.ok(
      !catalog
        .filter((m) => m.id !== members[1])
        .some((m) => m.aliases.includes("VisionAlias")),
    );
    assert.equal(ctx.activities.length, 1);
    assert.equal(
      await scalar(
        "select nullif(current_setting('xd.discord_actor',true),'')",
      ),
      null,
    );
    await assert.rejects(
      db.query("select public.discord_import_context($1,$2,null,$3)", [
        server,
        "523456789012345678",
        user,
      ]),
      /DISCORD_CHANNEL_FORBIDDEN/,
    );
    // Forum threads are accepted only through the configured parent channel.
    assert.ok(
      await scalar("select public.discord_import_context($1,$2,$3,$4)", [
        server,
        "523456789012345678",
        channel,
        user,
      ]),
    );
    const payload = {
      title: "Левиафан",
      status: "completed",
      starts_at: new Date(Date.now() - 1000).toISOString(),
      kind: "raid",
      source: "prime",
      banner,
      banner_version: 1,
      weight: 100,
      reward_units: "0",
      difficulty: "normal",
      night: false,
      counts: true,
      confirm_roster: true,
      members: [members[1], members[2]],
      guests: ["Гость"],
      evidence: [],
      loot: [{ id: drop, version: 1, quantity: 2, request_id: lot }],
      facts: {},
    };
    const query =
      "select public.record_discord_activity($1,$2,null,$3,$4,$5,$6)";
    const args = [server, channel, user, message, event, payload];
    assert.equal(await scalar(query, args), event);
    assert.equal(await scalar(query, args), event);
    await assert.rejects(
      db.query(query, [
        server,
        channel,
        user,
        message,
        randomUUID(),
        { ...payload, weight: 150 },
      ]),
      /REQUEST_CONFLICT/,
    );
    await db.exec("reset role");
    assert.equal(
      await scalar("select count(*)::int from public.events where id=$1", [
        event,
      ]),
      1,
    );
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
        "select quantity_total from public.treasury_loot where id=$1",
        [lot],
      ),
      2,
    );
    assert.equal(
      await scalar(
        "select estimated_unit_units::text from public.treasury_loot where id=$1",
        [lot],
      ),
      "20000000",
    );
    assert.equal(
      await scalar("select count(*)::int from public.discord_imports"),
      1,
    );
    assert.equal(
      await scalar("select count(*)::int from public.treasury_awards"),
      0,
    );
    assert.equal(
      await scalar(
        "select count(*)::int from public.audit_log where action='discord.activity_imported' and actor_id=$1",
        [id(1)],
      ),
      1,
    );
  } finally {
    await db.close();
  }
});
test("Channel import never grants website permissions; disabled connections and unavailable owners stop imports", async () => {
  const { db, as, scalar, members } = await setup();
  try {
    await as(1);
    await db.query("select public.save_discord_settings($1,$2,true)", [
      server,
      channel,
    ]);
    await as(2);
    await db.query("select set_config('xd.discord_actor',$1,false)", [id(1)]);
    assert.equal(
      await scalar("select public.has_permission($1,'discord.manage')", [
        guild,
      ]),
      false,
    );
    await assert.rejects(
      db.query("select public.save_discord_settings($1,$2,true)", [
        server,
        channel,
      ]),
      /FORBIDDEN/,
    );
    await assert.rejects(
      db.query("select public.record_activity($1,'{}'::jsonb)", [randomUUID()]),
      /FORBIDDEN/,
    );
    await assert.rejects(
      db.query("select public.save_discord_staff($1,$2)", [user, members[2]]),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select public.discord_runtime()"),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ role: "service_role" }),
    ]);
    await db.exec("set role service_role");
    assert.ok(
      await scalar("select public.discord_import_context($1,$2,null,$3)", [
        server,
        channel,
        user,
      ]),
    );
    await db.exec("reset role");
    assert.equal(
      await scalar("select count(*)::int from public.discord_staff"),
      0,
    );
    await db.query("update public.profiles set blocked=true where id=$1", [
      id(1),
    ]);
    await db.exec("set role service_role");
    await assert.rejects(
      db.query("select public.discord_import_context($1,$2,null,$3)", [
        server,
        channel,
        user,
      ]),
      /DISCORD_CONNECTION_OWNER_UNAVAILABLE/,
    );
    await db.exec("reset role");
    await db.query("update public.profiles set blocked=false where id=$1", [
      id(1),
    ]);
    await db.exec("update public.discord_settings set enabled=false");
    await db.exec("set role service_role");
    await assert.rejects(
      db.query("select public.discord_import_context($1,$2,null,$3)", [
        server,
        channel,
        user,
      ]),
      /DISCORD_CHANNEL_FORBIDDEN/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select public.discord_runtime()"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("Discord event coefficient overrides persist as real weights and drive separate Prime/Mini attendance", async () => {
  const c = await setup();
  try {
    await c.as(1);
    await c.db.query("select public.save_discord_settings($1,$2,true)", [
      server,
      channel,
    ]);
    await c.db.exec("reset role");
    const banners = [
      { id: randomUUID(), name: "Левиафан", source: "prime" },
      { id: randomUUID(), name: "АГЛ", source: "mini_rb" },
    ];
    for (const b of banners)
      await c.db.query(
        "insert into public.guild_activity_banners(id,guild_id,name,weight) values($1,$2,$3,100)",
        [b.id, guild, b.name],
      );
    await c.db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ role: "service_role" }),
    ]);
    await c.db.exec("set role service_role");
    const rpc = "select public.record_discord_activity($1,$2,null,$3,$4,$5,$6)";
    let seq = 0;
    const payload = (
      b: (typeof banners)[number],
      weight: number | null,
      member = c.members[2],
    ) => ({
      title: b.name,
      status: "completed",
      starts_at: new Date(Date.now() - 86400000).toISOString(),
      kind: "raid",
      source: b.source,
      banner: b.id,
      banner_version: 1,
      weight,
      reward_units: "0",
      difficulty: "normal",
      night: false,
      counts: true,
      confirm_roster: true,
      members: [member],
      guests: [],
      evidence: [],
      loot: [],
      facts: {},
    });
    for (const b of banners) {
      for (const [weight, member] of [
        [150, c.members[2]],
        [50, c.members[3]],
      ] as const) {
        await c.db.query(rpc, [
          server,
          channel,
          user,
          String(423456789012345670n + BigInt(seq++)),
          randomUUID(),
          payload(b, weight, member),
        ]);
      }
    }
    for (const weight of [0, null, 100001])
      await assert.rejects(
        c.db.query(rpc, [
          server,
          channel,
          user,
          "523456789012345678",
          randomUUID(),
          payload(banners[0], weight),
        ]),
        /INVALID_INPUT/,
      );
    await assert.rejects(
      c.db.query(rpc, [
        server,
        channel,
        user,
        "523456789012345678",
        randomUUID(),
        { ...payload(banners[0], 150), banner_version: 2 },
      ]),
      /CATALOG_STALE/,
    );
    await c.db.exec("reset role");
    assert.deepEqual(
      (
        await c.db.query<{ activity_weight: number }>(
          "select activity_weight from public.events order by activity_weight",
        )
      ).rows.map((r) => r.activity_weight),
      [50, 50, 150, 150],
    );
    assert.equal(
      await c.scalar(
        "select count(*)::int from public.guild_activity_banners where weight=100",
      ),
      2,
    );
    assert.equal(
      await c.scalar(
        "select count(*)::int from public.audit_log where action='discord.activity_imported' and detail->>'base_weight'='100' and detail->>'activity_weight' in ('50','150')",
      ),
      4,
    );
    await c.as(1);
    const report = await c.scalar<{
      rows: { id: string; prime_percentage: number; mini_percentage: number }[];
    }>("select public.lifetime_payroll_report()");
    const member = report.rows.find((r) => r.id === c.members[2])!;
    assert.equal(member.prime_percentage, 75);
    assert.equal(member.mini_percentage, 75);
  } finally {
    await c.db.close();
  }
});

test("Discord renames preserve membership identity, validate scope, reject collisions and replay safely", async () => {
  const { db, as, scalar, members } = await setup();
  try {
    await as(1);
    await db.query("select public.save_discord_settings($1,$2,true)", [
      server,
      channel,
    ]);
    const event = randomUUID();
    await db.exec("reset role");
    await db.query(
      "insert into public.events(id,guild_id,title,kind,starts_at,organizer_id,status) values($1,$2,'Рейд','raid',now()-interval '1 day',$3,'completed')",
      [event, guild, members[1]],
    );
    await db.query(
      "insert into public.event_signups(guild_id,event_id,membership_id) values($1,$2,$3)",
      [guild, event, members[2]],
    );
    await db.exec("set role authenticated");
    const sql = "select public.rename_discord_member($1,$2,null,$3,$4,$5,$6)";
    const args = [server, "1211335490024771674", user, message, "Лиса", "Мэт"];
    await assert.rejects(db.query(sql, args), /permission denied/);
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ role: "service_role" }),
    ]);
    await db.exec("set role service_role");
    await assert.rejects(
      db.query(sql, [server, channel, user, message, "Лиса", "Мэт"]),
      /DISCORD_CHANNEL_FORBIDDEN/,
    );
    await assert.rejects(
      db.query(sql, [
        "000000000000000000",
        args[1],
        user,
        message,
        "Лиса",
        "Мэт",
      ]),
      /DISCORD_CHANNEL_FORBIDDEN/,
    );
    await assert.rejects(
      db.query(sql, [server, args[1], user, message, "Лиса", "Ронин"]),
      /NICKNAME_UNAVAILABLE/,
    );
    const result = await scalar<{ membership_id: string }>(sql, args);
    assert.equal(result.membership_id, members[2]);
    assert.equal(
      (await scalar<{ replayed: boolean }>(sql, args)).replayed,
      true,
    );
    await assert.rejects(
      db.query(sql, [server, args[1], user, message, "Лиса", "Новый"]),
      /REQUEST_CONFLICT/,
    );
    // An old name can follow the same member after a rename, but never uses fuzzy matching.
    const next = await scalar<{ membership_id: string }>(sql, [
      server,
      args[1],
      user,
      "523456789012345678",
      "Лиса",
      "Другой",
    ]);
    assert.equal(next.membership_id, members[2]);
    await assert.rejects(
      db.query(sql, [
        server,
        args[1],
        user,
        "623456789012345678",
        "Лис",
        "Новый",
      ]),
      /MEMBER_NOT_UNIQUE/,
    );
    await db.exec("reset role");
    assert.equal(
      await scalar("select nickname from public.memberships where id=$1", [
        members[2],
      ]),
      "Другой",
    );
    assert.equal(
      await scalar(
        "select m.nickname from public.event_signups a join public.memberships m on m.id=a.membership_id where a.event_id=$1",
        [event],
      ),
      "Другой",
    );
    assert.equal(await scalar("select count(*) from public.memberships"), 4);
    assert.equal(
      await scalar(
        "select count(*) from public.nickname_history where membership_id=$1",
        [members[2]],
      ),
      2,
    );
    assert.equal(
      await scalar(
        "select nullif(current_setting('xd.discord_actor',true),'')",
      ),
      null,
    );
  } finally {
    await db.close();
  }
});
