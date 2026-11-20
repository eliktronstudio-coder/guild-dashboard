import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { memberDatabase, id } from "./support/database";
import { csv } from "../src/lib/csv";
test("CSV escapes delimiters, quotes, line breaks and spreadsheet formulas", () => {
  assert.equal(
    csv([["Ник", "a;b", 'a"b', null, "=1", "  @SUM(A1)", "\t1"]]),
    '\uFEFF"Ник";"a;b";"a""b";"";"\'=1";"\'  @SUM(A1)";"\'\t1"\r\n',
  );
});
test("export respects active membership, permission changes and attendance ownership", async () => {
  const { db, as, scalar } = await memberDatabase();
  try {
    await db.exec("create role service_role");
    for (const f of (await readdir("supabase/migrations"))
      .sort()
      .filter((f) => f.endsWith(".sql") && f > "202610310002_members.sql"))
      await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
    await as(2);
    const members = await scalar<Record<string, unknown>[]>(
      "select public.guild_export('members')",
    );
    assert.equal(members.length, 4);
    assert.equal("user_id" in members[0], false);
    const own = await scalar<{ nickname: string }[]>(
      "select public.guild_export('attendance',now()-interval '30 days',now())",
    );
    assert.ok(own.every((r) => r.nickname === "Лиса"));
    await as(1);
    const all = await scalar<unknown[]>(
      "select public.guild_export('attendance',now()-interval '30 days',now())",
    );
    assert.equal(all.length, 4);
    await db.exec(
      "reset role;delete from public.role_permissions where permission='members.read'",
    );
    await as(2);
    await assert.rejects(
      db.exec("select public.guild_export('members')"),
      /FORBIDDEN/,
    );
    await db.exec("reset role");
    await db.query("update public.profiles set blocked=true where id=$1", [
      id(2),
    ]);
    await as(2);
    await assert.rejects(
      db.exec(
        "select public.guild_export('attendance',now()-interval '1 day',now())",
      ),
      /FORBIDDEN/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.exec("select public.guild_export('members')"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
