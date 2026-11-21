import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { memberDatabase, guild, id, sid } from "./support/database";
import {
  registrationInput,
  loginError,
  normalizeLogin,
} from "../src/lib/registration";
test("registration validates email/login/nickname, matching passwords and explicit consent", () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    email: " Player@Example.com ",
    login: " Dragon_XD ",
    nickname: " Волк ",
    playerClass: "Маг",
    password: "a-strong-password",
    confirmation: "a-strong-password",
    rules: "on",
    privacy: "on",
  }))
    form.set(key, value);
  const good = registrationInput(form);
  assert.equal(good.error, null);
  assert.equal(good.login, "dragon_xd");
  assert.equal(good.nickname, "Волк");
  assert.equal(good.email, "player@example.com");
  assert.equal(good.playerClass, "Маг");
  form.delete("playerClass");
  assert.match(registrationInput(form).error!, /Выберите класс/);
  form.set("playerClass", "owner");
  assert.match(registrationInput(form).error!, /Выберите класс/);
  form.set("playerClass", "Маг");
  form.set("confirmation", "wrong-password");
  assert.match(registrationInput(form).error!, /не совпадают/);
  form.set("confirmation", "a-strong-password");
  form.delete("rules");
  assert.match(registrationInput(form).error!, /Подтвердите/);
  assert.ok(loginError("admin@example.com"));
  assert.ok(loginError("админ"));
  assert.ok(loginError("a"));
  assert.equal(loginError(normalizeLogin(" Hero-1 ")), null);
});
test("open registration reserves unique logins, grants only member, respects blocks/session revocation and keeps email resolution private", async () => {
  const { db, as, scalar } = await memberDatabase();
  try {
    await db.exec("create role service_role");
    await db.exec(
      await readFile(
        "supabase/migrations/202611090022_open_registration.sql",
        "utf8",
      ),
    );
    const meta = {
      registration_flow: "open_email_v1",
      login: "new_player",
      game_nickname: "Сокол",
      rules_accepted: true,
      privacy_accepted: true,
      role: "owner",
    };
    await db.query(
      "insert into auth.users(id,email_confirmed_at,email,raw_user_meta_data) values($1,now(),'new@example.test',$2)",
      [id(7), meta],
    );
    await db.query("insert into auth.sessions values($1,$2)", [sid(7), id(7)]);
    await as(7);
    const result = await scalar("select public.complete_open_registration()");
    assert.ok(result);
    assert.equal(
      await scalar("select public.complete_open_registration()"),
      result,
    );
    assert.equal(
      await scalar("select public.has_permission($1,'members.read')", [guild]),
      true,
    );
    assert.equal(
      await scalar("select public.has_permission($1,'roles.assign')", [guild]),
      false,
    );
    await assert.rejects(
      db.query("select * from private.email_registrations"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select public.registration_login_email('new_player')"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select public.claim_auth_attempt($1,5,3600)", ["a".repeat(64)]),
      /permission denied/,
    );
    await db.exec("reset role");
    assert.equal(
      await scalar(
        "select count(*)::int from public.audit_log where action='member.self_registered'",
      ),
      1,
    );
    assert.equal(
      await scalar(
        "select count(*)::int from public.membership_roles where membership_id=$1",
        [result],
      ),
      1,
    );
    assert.equal(
      await scalar("select public.registration_login_email('new_player')"),
      "new@example.test",
    );
    await assert.rejects(
      db.query(
        "insert into auth.users(id,email_confirmed_at,email,raw_user_meta_data) values($1,now(),'other@example.test',$2)",
        [id(8), meta],
      ),
      /unique/,
    );
    assert.equal(
      await scalar("select count(*)::int from auth.users where id=$1", [id(8)]),
      0,
    );
    await db.query("update public.profiles set blocked=true where id=$1", [
      id(7),
    ]);
    assert.equal(
      await scalar("select public.registration_login_email('new_player')"),
      null,
    );
    await as(7);
    await assert.rejects(
      db.query("select public.complete_open_registration()"),
      /AUTH_REQUIRED/,
    );
    await db.exec("reset role");
    await db.query("update public.profiles set blocked=false where id=$1", [
      id(7),
    ]);
    await db.query(
      "insert into public.revoked_sessions(session_id,user_id) values($1,$2)",
      [sid(7), id(7)],
    );
    await as(7);
    await assert.rejects(
      db.query("select public.complete_open_registration()"),
      /AUTH_REQUIRED/,
    );
    await db.exec("reset role");
    await db.query("delete from public.revoked_sessions where user_id=$1", [
      id(7),
    ]);
    await db.query("update public.memberships set status='left' where id=$1", [
      result,
    ]);
    await as(7);
    await assert.rejects(
      db.query("select public.complete_open_registration()"),
      /MEMBERSHIP_INACTIVE/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select public.complete_open_registration()"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
test("existing accounts enroll with consent; nickname conflict is fixable, rate limit persists without exposing email", async () => {
  const { db, as, scalar } = await memberDatabase();
  try {
    await db.exec("create role service_role");
    await db.exec(
      await readFile(
        "supabase/migrations/202611090022_open_registration.sql",
        "utf8",
      ),
    );
    await as(5);
    await assert.rejects(
      db.query("select public.complete_open_registration()"),
      /CONSENT_REQUIRED/,
    );
    await assert.rejects(
      db.query(
        "select public.complete_open_registration('player_5','Лиса',true,true)",
      ),
      /NICKNAME_UNAVAILABLE/,
    );
    assert.ok(
      await scalar(
        "select public.complete_open_registration('player_5','Север',true,true)",
      ),
    );
    await db.exec("reset role");
    const key = "a".repeat(64);
    for (let i = 0; i < 3; i++)
      assert.equal(
        await scalar("select public.claim_auth_attempt($1,3,3600)", [key]),
        true,
      );
    assert.equal(
      await scalar("select public.claim_auth_attempt($1,3,3600)", [key]),
      false,
    );
    await db.exec(
      "update private.auth_attempts set attempted_at=now()-interval '2 days'",
    );
    assert.equal(
      await scalar("select public.claim_auth_attempt($1,3,3600)", [key]),
      true,
    );
    assert.equal(
      await scalar("select count(*)::int from private.auth_attempts"),
      1,
    );
    // A new email registration with a taken game nickname retains the account and can fix it.
    await db.query(
      "insert into auth.users(id,email_confirmed_at,email,raw_user_meta_data) values($1,now(),'six@example.test',$2)",
      [
        id(8),
        {
          registration_flow: "open_email_v1",
          login: "player_8",
          game_nickname: "Лиса",
          rules_accepted: true,
          privacy_accepted: true,
        },
      ],
    );
    await db.query("insert into auth.sessions values($1,$2)", [sid(8), id(8)]);
    await as(8);
    await assert.rejects(
      db.query("select public.complete_open_registration()"),
      /NICKNAME_UNAVAILABLE/,
    );
    assert.ok(
      await scalar(
        "select public.complete_open_registration('player_8','Ястреб',true,true)",
      ),
    );
  } finally {
    await db.close();
  }
});
