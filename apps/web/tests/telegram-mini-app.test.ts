import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { verifyMiniAppData } from "../src/lib/telegram/mini-app";
import type { MiniAppData } from "../src/lib/telegram/mini-app-types";
import { memberDatabase, guild, id } from "./support/database";
const token = "123456:LOCAL_TEST_TOKEN_NOT_A_REAL_BOT";
const now = 1793577600000;
function signed(fields: Record<string, string>) {
  const canonical = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");
  const key = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", key).update(canonical).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}
const fields = {
  auth_date: String(now / 1000),
  user: '{"id":201,"first_name":"Лиса"}',
  query_id: "test-query",
};

test("Mini App HMAC: original fields, optional signature, order and fixed vector", () => {
  const raw = signed(fields);
  assert.deepEqual(verifyMiniAppData(raw, token, now), {
    ok: true,
    telegramId: "201",
    authDate: now / 1000,
  });
  const reverse = [...new URLSearchParams(raw)].reverse();
  assert.equal(
    verifyMiniAppData(new URLSearchParams(reverse).toString(), token, now).ok,
    true,
  );
  assert.equal(
    verifyMiniAppData(
      signed({ ...fields, signature: "Ed25519_signature_field" }),
      token,
      now,
    ).ok,
    true,
  );
  assert.equal(
    verifyMiniAppData(raw + "&signature=unsigned", token, now).ok,
    false,
  );
  assert.equal(verifyMiniAppData(raw, token + "wrong", now).ok, false);
  assert.equal(
    verifyMiniAppData(raw.replace("201", "301"), token, now).ok,
    false,
  );
  // Independent Python hashlib/hmac vector pins the documented algorithm.
  assert.equal(
    new URLSearchParams(raw).get("hash"),
    "aab970c53079d0c3ad5b9ab892c8d8da47b54360f7948044c75b441420965c7e",
  );
});
test("Mini App rejects ambiguous, expired, forged and malformed credentials", () => {
  const raw = signed(fields);
  for (const bad of [
    "",
    null,
    {},
    "x".repeat(12001),
    raw + "&user=%7B%22id%22%3A301%7D",
    raw + "&hash=" + "0".repeat(64),
    raw + "&auth_date=1",
    raw + "&bad=%GG",
    raw.replace(/hash=[^&]+/, "hash=aa"),
  ])
    assert.equal(verifyMiniAppData(bad, token, now).ok, false);
  assert.equal(verifyMiniAppData(raw, token, now + 299000).ok, true);
  assert.deepEqual(verifyMiniAppData(raw, token, now + 300000), {
    ok: false,
    code: "expired",
  });
  assert.equal(verifyMiniAppData(raw, token, now - 31000).ok, false);
  for (const user of [
    "null",
    "[]",
    "{}",
    '{"id":0}',
    '{"id":-1}',
    '{"id":"201"}',
    '{"id":9007199254740992}',
    '{"id":201,"is_bot":true}',
    "{bad",
  ])
    assert.equal(
      verifyMiniAppData(signed({ ...fields, user }), token, now).ok,
      false,
    );
  for (const auth_date of ["NaN", "1.2", "-1", "Infinity"])
    assert.equal(
      verifyMiniAppData(signed({ ...fields, auth_date }), token, now).ok,
      false,
    );
  assert.equal(
    verifyMiniAppData(signed({ ...fields, query_id: "a\nuser=x" }), token, now)
      .ok,
    false,
  );
  assert.equal(
    verifyMiniAppData(signed({ auth_date: fields.auth_date }), token, now).ok,
    false,
  );
});

test("Mini App database: service boundary, binding, own data and bounded reads", async (t) => {
  const { db, as, scalar, members: m } = await memberDatabase();
  try {
    await db.exec("create role service_role");
    for (const f of (await readdir("supabase/migrations"))
      .sort()
      .filter(
        (f) =>
          f.endsWith(".sql") &&
          f > "202610310002_members.sql" &&
          f < "202611020012",
      ))
      await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
    for (const n of [2, 3])
      await db.query(
        "insert into private.telegram_links(membership_id,telegram_id,notifications) values($1,$2,false)",
        [m[n], n * 100 + 1],
      );
    await as(2);
    const before = await scalar("select public.telegram_status()");
    await db.exec("reset role");
    await db.exec(
      await readFile(
        "supabase/migrations/202611020012_telegram_mini_app.sql",
        "utf8",
      ),
    );
    await as(2);
    assert.deepEqual(await scalar("select public.telegram_status()"), before);
    async function report(tg = 201, period = "month") {
      await db.exec("reset role;set role service_role");
      return scalar<MiniAppData & { error?: string }>(
        "select public.telegram_mini_app_report($1,$2)",
        [tg, period],
      );
    }
    await t.test(
      "anonymous/browser cannot impersonate a Telegram ID or read throttling metadata",
      async () => {
        for (const role of ["anon", "authenticated"]) {
          await db.exec("reset role;set role " + role);
          await assert.rejects(
            db.exec("select public.telegram_mini_app_report(201,'month')"),
            /permission denied/,
          );
          await assert.rejects(
            db.exec("select * from private.telegram_mini_app_limits"),
            /permission denied/,
          );
        }
        await db.exec("reset role;set role service_role");
        await assert.rejects(
          db.exec("select * from private.telegram_mini_app_limits"),
          /permission denied/,
        );
        await assert.rejects(report(201, "season"), /INVALID_PERIOD/);
        await assert.rejects(report(-1), /FORBIDDEN/);
      },
    );
    await t.test(
      "unbound, blocked and departed players receive the same denial",
      async () => {
        assert.deepEqual(await report(401), { error: "forbidden" });
        await db.exec("reset role");
        await db.query("update public.profiles set blocked=true where id=$1", [
          id(2),
        ]);
        assert.deepEqual(await report(), { error: "forbidden" });
        await db.exec("reset role");
        await db.query("update public.profiles set blocked=false where id=$1", [
          id(2),
        ]);
        await db.query(
          "update public.memberships set status='left' where id=$1",
          [m[2]],
        );
        assert.deepEqual(await report(), { error: "forbidden" });
        await db.exec("reset role");
        await db.query(
          "update public.memberships set status='active' where id=$1",
          [m[2]],
        );
      },
    );
    await t.test(
      "own report agrees with bot statistics; future events show only own signup",
      async () => {
        await db.exec("reset role");
        const e = randomUUID();
        await db.query(
          "insert into public.events(id,guild_id,title,kind,starts_at,organizer_id) values($1,$2,'Ближайший рейд','raid',now()+interval '1 day',$3)",
          [e, guild, m[1]],
        );
        await as(2);
        await db.query("select public.set_event_signup($1,true)", [e]);
        const result = await report();
        assert.equal(result.nickname, "Лиса");
        assert.equal(result.events[0].signed_up, true);
        assert.equal(result.events[0].id, e);
        assert.equal((await report(301)).events[0].signed_up, false);
        assert.equal(result.stats.percentage, null);
        assert.equal(result.stats.pending_units, "0");
        assert.equal("user_id" in result, false);
        assert.equal("membership_id" in result, false);
        await db.exec("reset role");
        const stats = await scalar(
          "select private.telegram_personal_stats((select id from private.telegram_links where telegram_id=201),date_trunc('month',now()),date_trunc('day',now())+interval '1 day')",
        );
        assert.deepEqual(result.stats, stats);
        const sessions = await scalar(
          "select count(*)::int from auth.sessions",
        );
        const signups = await scalar(
          "select count(*)::int from public.event_signups",
        );
        await report(201, "week");
        await db.exec("reset role");
        assert.equal(
          await scalar("select count(*)::int from auth.sessions"),
          sessions,
        );
        assert.equal(
          await scalar("select count(*)::int from public.event_signups"),
          signups,
        );
        assert.equal(
          await scalar("select count(*)::int from public.treasury_payouts"),
          0,
        );
        await db.query(
          "update public.events set status='cancelled' where id=$1",
          [e],
        );
        assert.equal((await report()).events.length, 0);
      },
    );
    await t.test(
      "unlink immediately removes access and replay never recovers old binding",
      async () => {
        await db.exec("reset role");
        await db.query(
          "delete from private.telegram_links where membership_id=$1",
          [m[2]],
        );
        assert.deepEqual(await report(), { error: "forbidden" });
        await db.exec("reset role");
        await db.query(
          "insert into private.telegram_links(membership_id,telegram_id) values($1,201)",
          [m[2]],
        );
        assert.equal((await report()).nickname, "Лиса");
      },
    );
    await t.test(
      "20 requests per ID per minute, independent IDs and reset after window",
      async () => {
        await db.exec(
          "reset role;delete from private.telegram_mini_app_limits",
        );
        for (let n = 0; n < 20; n++)
          assert.equal((await report()).error, undefined);
        assert.deepEqual(await report(), { error: "rate_limited" });
        assert.equal((await report(301)).error, undefined);
        await db.exec(
          "reset role;update private.telegram_mini_app_limits set window_start=now()-interval '2 minutes' where telegram_id=201",
        );
        assert.equal((await report()).error, undefined);
        await db.exec("reset role");
        assert.equal(
          await scalar(
            "select requests from private.telegram_mini_app_limits where telegram_id=201",
          ),
          1,
        );
        await db.exec(
          "update private.telegram_mini_app_limits set window_start=now()-interval '2 days' where telegram_id=301",
        );
        await report();
        await db.exec("reset role");
        assert.equal(
          await scalar(
            "select count(*)::int from private.telegram_mini_app_limits where telegram_id=301",
          ),
          0,
        );
      },
    );
  } finally {
    await db.close();
  }
});
