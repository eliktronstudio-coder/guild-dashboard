import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { memberDatabase, guild, id } from "./support/database";
test("owner bootstrap closes only own pending application with audit and keeps self-review forbidden", async () => {
  const { db, as, scalar } = await memberDatabase();
  try {
    await db.exec("create role service_role");
    await db.query(
      "insert into public.applications(guild_id,user_id,nickname,rules_version,privacy_version) values($1,$2,'Владелец','1','1')",
      [guild, id(1)],
    );
    for (const f of (await readdir("supabase/migrations"))
      .sort()
      .filter((f) => f.endsWith(".sql") && f > "202610310002_members.sql"))
      await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
    assert.equal(
      await scalar("select status from public.applications where user_id=$1", [
        id(1),
      ]),
      "approved",
    );
    assert.equal(
      await scalar(
        "select count(*)::int from public.audit_log where action='application.approved' and detail->>'source'='owner_bootstrap'",
      ),
      1,
    );
    await db.query("select private.close_owner_application($1,$2)", [
      guild,
      id(1),
    ]);
    assert.equal(
      await scalar(
        "select count(*)::int from public.audit_log where action='application.approved'",
      ),
      1,
    );
    await as(2);
    await assert.rejects(
      db.query("select private.close_owner_application($1,$2)", [guild, id(2)]),
      /permission denied/,
    );
    await db.exec("reset role");
    await assert.rejects(
      db.query("select private.bootstrap_owner($1,$2)", [id(5), "Новый"]),
      /OWNER_ALREADY_EXISTS/,
    );
    await db.query(
      "insert into public.applications(guild_id,user_id,nickname,rules_version,privacy_version) values($1,$2,'Новый','1','1'),($1,$3,'Другой','1','1')",
      [guild, id(5), id(6)],
    );
    await db.exec(
      "delete from public.membership_roles where role_id in (select id from public.roles where code='owner')",
    );
    await db.query("select private.bootstrap_owner($1,$2)", [id(5), "Новый"]);
    assert.equal(
      await scalar("select status from public.applications where user_id=$1", [
        id(5),
      ]),
      "approved",
    );
    assert.equal(
      await scalar("select status from public.applications where user_id=$1", [
        id(6),
      ]),
      "pending",
    );
  } finally {
    await db.close();
  }
});
