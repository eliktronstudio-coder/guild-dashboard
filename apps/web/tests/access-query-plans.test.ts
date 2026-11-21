import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { memberDatabase, guild, id, sid } from "./support/database";

test("statement-scoped identity plans retain immediate session, block and role checks", async () => {
  const c = await memberDatabase();
  const { db, scalar, as } = c;
  try {
    await db.exec("create role service_role");
    for (const f of (await readdir("supabase/migrations"))
      .sort()
      .filter(
        (f) =>
          f.endsWith(".sql") &&
          f > "202610310002_members.sql" &&
          !/^20261103001[78]/.test(f),
      ))
      await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
    const allowed = () =>
      scalar<boolean>("select public.has_permission($1,'members.read')", [
        guild,
      ]);
    await as(1);
    assert.equal(await allowed(), true);
    await as(2);
    assert.equal(await scalar("select private.viewer_id()"), id(2));
    assert.equal(await allowed(), true);
    assert.equal(
      await scalar("select private.is_member($1)", [id(999)]),
      false,
    );
    await db.exec("reset role");
    await db.query("update public.profiles set blocked=true where id=$1", [
      id(2),
    ]);
    await as(2);
    assert.equal(await allowed(), false);
    assert.equal(
      await scalar("select count(*)::int from public.member_directory"),
      0,
    );
    await db.exec("reset role");
    await db.query("update public.profiles set blocked=false where id=$1", [
      id(2),
    ]);
    await as(2);
    assert.equal(await allowed(), true);
    await db.exec("reset role");
    await db.query(
      "insert into public.revoked_sessions(session_id,user_id) values($1,$2)",
      [sid(2), id(2)],
    );
    await as(2);
    assert.equal(await allowed(), false);
    // A different user's live session must not validate this user's JWT.
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: id(2), session_id: sid(1) }),
    ]);
    await db.exec("set role authenticated");
    assert.equal(await scalar("select private.session_user_id()"), null);
    await as(1);
    assert.equal(await allowed(), true);
    await db.exec("reset role");
    await db.query(
      "delete from public.membership_roles where membership_id=$1",
      [c.members[1]],
    );
    await as(1);
    assert.equal(await allowed(), false);
    await db.exec("reset role;set role anon");
    await assert.rejects(allowed, /permission denied/);
  } finally {
    await db.close();
  }
});
