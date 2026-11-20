import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { memberDatabase, guild } from "./support/database";
import { parseDropPhoto } from "../src/lib/drop-registry";
test("drop photos reject unprepared, oversized, non-PNG and wrong-size uploads", () => {
  assert.equal(parseDropPhoto("", false), null);
  assert.equal(parseDropPhoto("", true), "");
  for (const data of [
    "processing",
    "invalid",
    "data:image/svg+xml;base64,AAAA",
    "data:image/png;base64," + "A".repeat(100000),
    "data:image/png;base64,AAAA",
  ])
    assert.equal(parseDropPhoto(data, false), false);
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(100, 16);
  bytes.writeUInt32BE(100, 20);
  const png = "data:image/png;base64," + bytes.toString("base64");
  assert.equal(parseDropPhoto(png, false), png);
  bytes.writeUInt32BE(200, 16);
  assert.equal(
    parseDropPhoto("data:image/png;base64," + bytes.toString("base64"), false),
    false,
  );
});
test("drop registry runs on production schema without 017/018: CRUD, RLS, audit and conflict protection", async () => {
  const { db, as, scalar } = await memberDatabase();
  try {
    await db.exec("create role service_role;");
    const files = (await readdir("supabase/migrations"))
      .sort()
      .filter(
        (f) => f.endsWith(".sql") && !/000[12]_/.test(f) && !/001[78]_/.test(f),
      );
    for (const file of files)
      await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
    await db.exec(
      await readFile(
        "supabase/migrations/202611090019_drop_registry.sql",
        "utf8",
      ),
    ); // safe retry
    const item = randomUUID(),
      other = randomUUID();
    await as(2);
    assert.equal(
      await scalar("select public.has_permission($1,'drops.manage')", [guild]),
      false,
    );
    await assert.rejects(
      db.query("select public.save_drop_registry($1,$2,0,'Клинок','',1250)", [
        guild,
        item,
      ]),
      /FORBIDDEN/,
    );
    await as(1);
    await db.query(
      "select public.save_drop_registry($1,$2,0,'Клинок','',1250)",
      [guild, item],
    );
    assert.equal(
      await scalar(
        "select price_units::text from public.guild_drop_registry where id=$1",
        [item],
      ),
      "1250",
    );
    await assert.rejects(
      db.query("select public.save_drop_registry($1,$2,0,'клинок','',100)", [
        guild,
        other,
      ]),
      /duplicate key/,
    );
    await assert.rejects(
      db.query("select public.save_drop_registry($1,$2,0,'Клинок','',100)", [
        guild,
        item,
      ]),
      /STALE_VERSION/,
    );
    await db.query(
      "select public.save_drop_registry($1,$2,1,'Новый клинок',null,99999999999999)",
      [guild, item],
    );
    assert.equal(
      await scalar(
        "select price_units::text from public.guild_drop_registry where id=$1",
        [item],
      ),
      "99999999999999",
    );
    await assert.rejects(
      db.query("select public.save_drop_registry($1,$2,2,'Клинок','',-1)", [
        guild,
        item,
      ]),
      /check constraint/,
    );
    await as(2);
    assert.equal(
      await scalar("select count(*)::int from public.guild_drop_registry"),
      0,
    );
    await assert.rejects(
      db.query("select public.delete_drop_registry($1,$2,2)", [guild, item]),
      /FORBIDDEN/,
    );
    await assert.rejects(
      db.query("delete from public.guild_drop_registry"),
      /permission denied/,
    );
    await as(1);
    await assert.rejects(
      db.query("select public.delete_drop_registry($1,$2,1)", [guild, item]),
      /STALE_VERSION/,
    );
    await db.query("select public.delete_drop_registry($1,$2,2)", [
      guild,
      item,
    ]);
    assert.equal(
      await scalar("select count(*)::int from public.guild_drop_registry"),
      0,
    );
    assert.equal(
      await scalar(
        "select count(*)::int from public.audit_log where action like 'drop_registry.%'",
      ),
      3,
    );
  } finally {
    await db.close();
  }
});
