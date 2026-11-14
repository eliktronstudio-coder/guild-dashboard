import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { memberDatabase, guild, id, sid } from "./support/database";
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
  return c;
}
test("Хил is accepted at registration and existing-member selection, and appears in the roster", async () => {
  const c = await setup();
  try {
    await c.as(2);
    await c.db.query("select public.set_own_player_class('Хил')");
    assert.equal(
      await c.scalar(
        "select character_class from public.member_directory where id=$1",
        [c.members[2]],
      ),
      "Хил",
    );
    await c.db.exec("reset role");
    await c.db.query(
      "insert into auth.users(id,email_confirmed_at,raw_user_meta_data) values($1,now(),$2)",
      [
        id(7),
        {
          registration_flow: "open_email_v1",
          login: "healer_7",
          game_nickname: "Целитель",
          game_class: "Хил",
          rules_accepted: true,
          privacy_accepted: true,
        },
      ],
    );
    await c.db.query("insert into auth.sessions values($1,$2)", [
      sid(7),
      id(7),
    ]);
    await c.as(7);
    const member = await c.scalar("select public.complete_open_registration()");
    assert.equal(
      await c.scalar(
        "select player_class from public.memberships where id=$1",
        [member],
      ),
      "Хил",
    );
    assert.equal(
      await c.scalar(
        "select class_selected_at is not null from public.memberships where id=$1",
        [member],
      ),
      true,
    );
  } finally {
    await c.db.close();
  }
});
test("legacy players explicitly select once; retries, permissions and session revocation remain safe", async () => {
  const c = await setup();
  const { db, as, scalar, members: m } = c;
  try {
    assert.equal(
      await scalar(
        "select count(*)::int from public.memberships where class_selected_at is null",
      ),
      4,
    );
    await as(2);
    await assert.rejects(
      db.query("select public.set_own_player_class('Администратор')"),
      /INVALID_PLAYER_CLASS/,
    );
    await db.query("select public.set_own_player_class('Маг')");
    const selected = await scalar(
      "select class_selected_at from public.memberships where id=$1",
      [m[2]],
    );
    assert.equal(
      await scalar(
        "select character_class from public.member_directory where id=$1",
        [m[2]],
      ),
      "Маг",
    );
    await db.query("select public.set_own_player_class('Маг')");
    assert.deepEqual(
      await scalar(
        "select class_selected_at from public.memberships where id=$1",
        [m[2]],
      ),
      selected,
    );
    await assert.rejects(
      db.query("select public.set_own_player_class('Танк')"),
      /CLASS_ALREADY_SELECTED/,
    );
    assert.equal(
      await scalar("select player_class from public.memberships where id=$1", [
        m[3],
      ]),
      null,
    );
    await assert.rejects(
      db.query(
        "update public.memberships set player_class='Танк',class_selected_at=now() where id=$1",
        [m[3]],
      ),
      /permission denied/,
    );
    await db.exec("reset role");
    assert.equal(
      await scalar(
        "select count(*)::int from public.audit_log where action='member.class_selected'",
      ),
      1,
    );
    await db.query("update public.profiles set blocked=true where id=$1", [
      id(2),
    ]);
    await as(2);
    await assert.rejects(
      db.query("select public.set_own_player_class('Маг')"),
      /AUTH_REQUIRED/,
    );
    await db.exec("reset role");
    await db.query("update public.memberships set status='left' where id=$1", [
      m[3],
    ]);
    await as(3);
    await assert.rejects(
      db.query("select public.set_own_player_class('Танк')"),
      /FORBIDDEN/,
    );
    await db.exec("reset role");
    await db.query(
      "insert into public.revoked_sessions(session_id,user_id) values($1,$2)",
      [sid(4), id(4)],
    );
    await as(4);
    await assert.rejects(
      db.query("select public.set_own_player_class('Лучник')"),
      /AUTH_REQUIRED/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select public.set_own_player_class('Маг')"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
test("new registration requires an allowed class in Auth and enrollment; older unfinished registrations can choose on onboarding", async () => {
  const c = await setup();
  const { db, as, scalar } = c;
  const meta = {
    registration_flow: "open_email_v1",
    login: "archer_7",
    game_nickname: "Сокол",
    rules_accepted: true,
    privacy_accepted: true,
  };
  try {
    for (const game_class of [null, "owner", ""]) {
      await assert.rejects(
        db.query(
          "insert into auth.users(id,email_confirmed_at,raw_user_meta_data) values($1,now(),$2)",
          [id(7), { ...meta, game_class }],
        ),
        /CLASS_REQUIRED/,
      );
    }
    assert.equal(
      await scalar("select count(*)::int from public.profiles where id=$1", [
        id(7),
      ]),
      0,
    );
    await db.query(
      "insert into auth.users(id,email_confirmed_at,raw_user_meta_data) values($1,now(),$2)",
      [id(7), { ...meta, game_class: "Лучник" }],
    );
    await db.query("insert into auth.sessions values($1,$2)", [sid(7), id(7)]);
    // Enrollment uses the captured, validated intent rather than mutable metadata.
    await db.query(
      'update auth.users set raw_user_meta_data=raw_user_meta_data||\'{"game_class":"Танк","role":"owner"}\' where id=$1',
      [id(7)],
    );
    await as(7);
    const member = await scalar("select public.complete_open_registration()");
    assert.equal(
      await scalar("select player_class from public.memberships where id=$1", [
        member,
      ]),
      "Лучник",
    );
    assert.equal(
      await scalar(
        "select class_selected_at is not null from public.memberships where id=$1",
        [member],
      ),
      true,
    );
    assert.equal(
      await scalar("select public.has_permission($1,'members.manage')", [
        guild,
      ]),
      false,
    );
    assert.equal(
      await scalar("select public.complete_open_registration()"),
      member,
    );
    await assert.rejects(
      db.query("select public.complete_open_registration_before_class()"),
      /permission denied/,
    );
    await as(5);
    await assert.rejects(
      db.query(
        "select public.complete_open_registration('fighter_5','Ястреб',true,true)",
      ),
      /CLASS_REQUIRED/,
    );
    const old = await scalar(
      "select public.complete_open_registration('fighter_5','Ястреб',true,true,'Милик')",
    );
    assert.equal(
      await scalar(
        "select character_class from public.member_directory where id=$1",
        [old],
      ),
      "Милик",
    );
    await db.exec("reset role");
    await db.query(
      "insert into private.email_registrations(user_id,login,nickname) values($1,'tank_6','Рыцарь')",
      [id(6)],
    );
    await as(6);
    await assert.rejects(
      db.query("select public.complete_open_registration()"),
      /CLASS_REQUIRED/,
    );
    await scalar(
      "select public.complete_open_registration(null,null,false,false,'Танк')",
    );
    assert.equal(
      await scalar(
        "select player_class from public.memberships where user_id=$1",
        [id(6)],
      ),
      "Танк",
    );
  } finally {
    await db.close();
  }
});
