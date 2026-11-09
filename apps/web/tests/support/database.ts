import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
export const guild = "00000000-0000-4000-8000-000000000001";
export const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const sid = (n: number) =>
  `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const cid = (n: number) =>
  `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export async function memberDatabase() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,email text unique,raw_user_meta_data jsonb not null default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users);
 create table auth.identities(user_id uuid references auth.users,provider text);
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 grant usage on schema auth to authenticated,anon;
 grant execute on function auth.jwt(),auth.uid() to authenticated,anon;`);
  await db.exec(
    await readFile("supabase/migrations/202610310001_foundation.sql", "utf8"),
  );
  for (let n = 1; n <= 6; n++) {
    await db.query("insert into auth.users(id,email_confirmed_at) values($1,now())", [id(n)]);
    await db.query("insert into auth.sessions values($1,$2)", [sid(n), id(n)]);
  }
  await db.query("select private.bootstrap_owner($1,$2)", [id(1), "Владелец"]);
  // Existing production-like memberships are present BEFORE applying the additive migration.
  for (let n = 2; n <= 4; n++) {
    await db.query(
      "insert into public.memberships(guild_id,user_id,nickname) values($1,$2,$3)",
      [guild, id(n), ["", "", "Лиса", "Ронин", "Страж"][n]],
    );
  }
  await db.exec(
    `insert into public.membership_roles select m.guild_id,m.id,r.id from public.memberships m join public.roles r on r.guild_id=m.guild_id and r.code='member' where not exists(select 1 from public.membership_roles mr where mr.membership_id=m.id)`,
  );
  const before = await db.query(
    "select id,user_id,nickname,joined_at from public.memberships order by id",
  );
  await db.exec(
    await readFile("supabase/migrations/202610310002_members.sql", "utf8"),
  );
  const after = await db.query(
    "select id,user_id,nickname,joined_at from public.memberships order by id",
  );
  async function as(n: number) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: id(n), session_id: sid(n) }),
    ]);
    await db.exec("set role authenticated");
  }
  async function scalar<T = unknown>(
    sql: string,
    args: unknown[] = [],
  ): Promise<T> {
    const r = await db.query<Record<string, T>>(sql, args);
    return Object.values(r.rows[0] ?? {})[0];
  }
  const members: Record<number, string> = {};
  for (let n = 1; n <= 4; n++)
    members[n] = await scalar<string>(
      "select id from public.memberships where user_id=$1",
      [id(n)],
    );
  return { db, as, scalar, members, before: before.rows, after: after.rows };
}
