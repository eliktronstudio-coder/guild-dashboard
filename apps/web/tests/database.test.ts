import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const guild = "00000000-0000-4000-8000-000000000001";
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sid = (n: number) =>
  `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("database: real PostgreSQL migration, permissions, applications and revocation", async (t) => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users);
 create table auth.identities(user_id uuid references auth.users,provider text);
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 grant usage on schema auth to authenticated,anon;
 grant execute on function auth.jwt(),auth.uid() to authenticated,anon;`);
  await db.exec(
    await readFile("supabase/migrations/202610310001_foundation.sql", "utf8"),
  );
  await db.exec(
    await readFile("supabase/migrations/202610310002_members.sql", "utf8"),
  );
  for (let n = 1; n <= 6; n++) {
    await db.query("insert into auth.users values($1,now())", [id(n)]);
    await db.query("insert into auth.sessions values($1,$2)", [sid(n), id(n)]);
  }
  await db.query("select private.bootstrap_owner($1,$2)", [id(1), "Владелец"]);
  async function as(n: number) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: id(n), session_id: sid(n) }),
    ]);
    await db.exec("set role authenticated");
  }
  async function scalar(sql: string, args: unknown[] = []) {
    const r = await db.query<Record<string, unknown>>(sql, args);
    return Object.values(r.rows[0] ?? {})[0];
  }
  await t.test("anonymous cannot read or bootstrap", async () => {
    await db.exec("set role anon");
    await assert.rejects(
      () => db.query("select * from public.memberships"),
      /permission denied/,
    );
    await assert.rejects(
      () => db.query("select private.bootstrap_owner($1,$2)", [id(2), "Пират"]),
      /permission denied/,
    );
  });
  let app: string;
  await t.test(
    "mandatory consents, nickname validation and retry-safe submission",
    async () => {
      await as(2);
      await assert.rejects(
        () => db.query("select public.submit_application('Лиса',false,true)"),
        /CONSENT_REQUIRED/,
      );
      for (const nick of ["", "A", "XД", "ли\u200bса", "-----"])
        await assert.rejects(
          () =>
            db.query("select public.submit_application($1,true,true)", [nick]),
          /INVALID_NICKNAME/,
        );
      app = (await scalar(
        "select public.submit_application('   Лунная    Лиса  ',true,true)",
      )) as string;
      assert.equal(
        await scalar("select public.submit_application('Другой',true,true)"),
        app,
      );
      assert.equal(
        await scalar("select nickname from public.applications"),
        "Лунная Лиса",
      );
      assert.equal(
        await scalar("select count(*)::int from public.memberships"),
        0,
      );
      await assert.rejects(
        () =>
          db.query("select public.review_application($1,'approved','')", [app]),
        /FORBIDDEN/,
      );
      await assert.rejects(
        () => db.query("update public.applications set status='approved'"),
        /permission denied/,
      );
    },
  );
  await t.test(
    "review creates exactly one member and role; audit preserves history",
    async () => {
      await as(1);
      await db.query(
        "select public.review_application($1,'approved','Проверен в игре')",
        [app],
      );
      await db.query(
        "select public.review_application($1,'approved','Повтор')",
        [app],
      );
      assert.equal(
        await scalar(
          "select count(*)::int from public.memberships where user_id=$1",
          [id(2)],
        ),
        1,
      );
      assert.equal(
        await scalar(
          "select count(*)::int from public.audit_log where action='application.approved'",
        ),
        1,
      );
      await assert.rejects(
        () =>
          db.query("select public.review_application($1,'rejected','Ошибка')", [
            app,
          ]),
        /ALREADY_REVIEWED/,
      );
      await as(2);
      assert.equal(
        await scalar("select public.has_permission($1,'members.read')", [
          guild,
        ]),
        true,
      );
      assert.equal(
        await scalar("select public.has_permission($1,'applications.review')", [
          guild,
        ]),
        false,
      );
      assert.equal(
        await scalar("select count(*)::int from public.audit_log"),
        0,
      );
    },
  );
  await t.test(
    "case, whitespace and homoglyph conflicts cannot take over a member",
    async () => {
      await as(3);
      await assert.rejects(
        () =>
          db.query("select public.submit_application('лунная лиса',true,true)"),
        /NICKNAME_UNAVAILABLE/,
      );
      const a = await scalar(
        "select public.submit_application('Coco',true,true)",
      );
      await as(4);
      const b = await scalar(
        "select public.submit_application('Сосо',true,true)",
      );
      await as(1);
      await db.query("select public.review_application($1,'approved','')", [a]);
      await assert.rejects(
        () =>
          db.query("select public.review_application($1,'approved','')", [b]),
        /NICKNAME_UNAVAILABLE/,
      );
      assert.equal(
        await scalar("select status from public.applications where id=$1", [b]),
        "pending",
      );
    },
  );
  await t.test(
    "owner protected, role changes effective immediately, guild boundaries enforced",
    async () => {
      await as(1);
      const member = await scalar(
        "select id from public.memberships where user_id=$1",
        [id(2)],
      );
      const owner = await scalar(
        "select id from public.memberships where user_id=$1",
        [id(1)],
      );
      await assert.rejects(
        () => db.query("select public.set_member_blocked($1,true)", [owner]),
        /OWNER_PROTECTED/,
      );
      await assert.rejects(
        () =>
          db.query("select public.assign_member_role($1,'owner')", [member]),
        /OWNER_PROTECTED/,
      );
      await db.query("select public.assign_member_role($1,'officer')", [
        member,
      ]);
      await as(2);
      assert.equal(
        await scalar("select public.has_permission($1,'applications.review')", [
          guild,
        ]),
        true,
      );
      assert.equal(
        await scalar(
          "select public.has_permission('00000000-0000-4000-8000-000000000099','applications.review')",
        ),
        false,
      );
      await as(1);
      await db.query("select public.assign_member_role($1,'member')", [member]);
      await as(2);
      assert.equal(
        await scalar("select public.has_permission($1,'applications.review')", [
          guild,
        ]),
        false,
      );
    },
  );
  await t.test(
    "block and session revocation deny old tokens; unblock does not resurrect sessions",
    async () => {
      await as(1);
      const member = await scalar(
        "select id from public.memberships where user_id=$1",
        [id(2)],
      );
      await db.query("select public.set_member_blocked($1,true)", [member]);
      await as(2);
      assert.equal(
        await scalar("select count(*)::int from public.memberships"),
        0,
      );
      await assert.rejects(
        () => db.query("select public.submit_application('Чужой',true,true)"),
        /AUTH_REQUIRED/,
      );
      await as(1);
      await db.query("select public.set_member_blocked($1,false)", [member]);
      await as(2);
      assert.equal(await scalar("select private.session_user_id()"), null);
      await as(3);
      await db.query("select public.revoke_my_sessions(true)");
      assert.equal(
        await scalar("select count(*)::int from public.memberships"),
        0,
      );
    },
  );
  await t.test(
    "unverified account and removed auth session are rejected",
    async () => {
      await db.exec("reset role");
      await db.query(
        "update auth.users set email_confirmed_at=null where id=$1",
        [id(5)],
      );
      await as(5);
      assert.equal(await scalar("select private.session_user_id()"), null);
      await db.exec("reset role");
      await db.query("delete from auth.sessions where id=$1", [sid(6)]);
      await as(6);
      assert.equal(await scalar("select private.session_user_id()"), null);
    },
  );
  await db.close();
});
