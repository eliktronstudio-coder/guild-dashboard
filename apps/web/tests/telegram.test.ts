import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { memberDatabase, guild, id } from "./support/database";
import {
  parseUpdate,
  sameSecret,
  hashLink,
  boundedJson,
  messageText,
  sendMessage,
  registerBotWebhook,
} from "../src/lib/telegram/protocol";
const token = "a".repeat(43),
  hash = hashLink(token);
test("Telegram: fresh human private commands, secret comparison and safe integer IDs", () => {
  const now = Date.now(),
    input = {
      update_id: 123,
      message: {
        date: Math.floor(now / 1000),
        from: { id: 12345, is_bot: false, username: "Fox" },
        chat: { id: 12345, type: "private" },
        text: `/start link_${token}`,
      },
    };
  const parsed = parseUpdate(input, "XD_bot", now)!;
  assert.equal(parsed.p_telegram, "12345");
  assert.equal(parsed.p_hash, hash);
  for (const patch of [
    { chat: { id: -1, type: "group" } },
    { chat: { id: 333, type: "private" } },
    { from: { id: 12345, is_bot: true } },
    { date: Math.floor(now / 1000) - 601 },
    { date: Math.floor(now / 1000) + 121 },
    { text: "/events@Other_bot" },
    { text: "/start link_short" },
    { text: "/events injected" },
    { text: "x".repeat(513) },
  ])
    assert.equal(
      parseUpdate(
        { ...input, message: { ...input.message, ...patch } },
        "XD_bot",
        now,
      ),
      null,
    );
  assert.equal(
    parseUpdate(
      { ...input, update_id: Number.MAX_SAFE_INTEGER + 1 },
      "XD_bot",
      now,
    ),
    null,
  );
  assert.equal(
    parseUpdate(
      { ...input, message: { ...input.message, text: "/events@xd_BOT" } },
      "XD_bot",
      now,
    )?.p_command,
    "events",
  );
  assert.ok(sameSecret("secret", "secret"));
  assert.ok(!sameSecret("secreX", "secret"));
  assert.ok(!sameSecret(null, "secret"));
  assert.ok(!sameSecret("", ""));
});
test("Telegram: bounded streaming JSON, exact money, plain text and transport failures", async () => {
  const req = (body: string, type = "application/json") =>
    new Request("https://xd.test", {
      method: "POST",
      body,
      headers: { "content-type": type },
    });
  assert.deepEqual(await boundedJson(req('{"ok":true}')), { ok: true });
  await assert.rejects(boundedJson(req("x".repeat(33)), 32));
  await assert.rejects(boundedJson(req("{}", "text/plain")));
  await assert.rejects(boundedJson(req("bad")));
  assert.ok(
    messageText(
      { code: "award", amount_units: "1234567890123456789" },
      "https://xd.test",
    ).includes("123\u202f456\u202f789\u202f012\u202f345,6789"),
  );
  let sent: Record<string, unknown> = {};
  const fetcher: typeof fetch = async (_u, init) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({ ok: true });
  };
  assert.equal(
    (
      await sendMessage(
        "test",
        "123",
        {
          code: "event",
          title: "<b>Рейд</b>",
          starts_at: "2026-11-02T12:00:00Z",
          id: "abc",
          status: "scheduled",
        },
        "https://xd.test",
        fetcher,
      )
    ).result,
    "sent",
  );
  assert.equal(sent.parse_mode, undefined);
  assert.equal(sent.chat_id, "123");
  assert.ok(String(sent.text).includes("<b>Рейд</b>"));
  for (const [code, expected] of [
    [403, "blocked"],
    [401, "failed"],
    [429, "retry"],
    [500, "retry"],
  ] as const) {
    const r = await sendMessage(
      "test",
      "123",
      { code: "help" },
      "https://xd.test",
      async () =>
        Response.json(
          { ok: false, error_code: code, parameters: { retry_after: 999999 } },
          { status: code },
        ),
    );
    assert.equal(r.result, expected);
    if (expected === "retry") assert.equal(r.retry, 3600);
  }
  assert.equal(
    (
      await sendMessage(
        "test",
        "123",
        { code: "help" },
        "https://xd.test",
        async () => {
          throw Error("network secret");
        },
      )
    ).result,
    "retry",
  );
});
test("Telegram: webhook setup verifies bot and protects another integration", async () => {
  const c = {
      token: "test",
      username: "XD_bot",
      origin: "https://xd.test",
      webhookSecret: "secret",
    },
    calls: string[] = [];
  const make =
    (username: string, url: string): typeof fetch =>
    async (u, init) => {
      const method = String(u).split("/").at(-1)!;
      calls.push(method);
      if (method === "setWebhook") {
        const b = JSON.parse(String(init?.body));
        assert.equal(b.drop_pending_updates, false);
        assert.equal(b.secret_token, "secret");
      }
      return Response.json({
        ok: true,
        result:
          method === "getMe"
            ? { username, is_bot: true }
            : method === "getWebhookInfo"
              ? { url }
              : true,
      });
    };
  assert.equal(
    await registerBotWebhook(c, make("Other_bot", "")),
    "BOT_MISMATCH",
  );
  assert.deepEqual(calls, ["getMe"]);
  calls.length = 0;
  assert.equal(
    await registerBotWebhook(c, make("XD_bot", "https://other.test/hook")),
    "WEBHOOK_IN_USE",
  );
  assert.ok(!calls.includes("setWebhook"));
  calls.length = 0;
  assert.equal(await registerBotWebhook(c, make("XD_bot", "")), null);
  assert.deepEqual(calls, ["getMe", "getWebhookInfo", "setWebhook"]);
});
test("Telegram database: linking, outbox, financial notices and access boundaries", async (t) => {
  const { db, as, scalar, members: m } = await memberDatabase();
  try {
    await db.exec("create role service_role");
    for (const f of [
      "202610310003_events.sql",
      "202610310004_event_lifecycle.sql",
      "202610310005_attendance.sql",
      "202610310006_treasury.sql",
      "202611010007_settlements.sql",
      "202611010008_dashboard.sql",
      "202611010009_telegram.sql",
    ])
      await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
    const service = async () => db.exec("reset role;set role service_role");
    let update = 0;
    async function receive(
      tg: number,
      cmd: string,
      h: string | null = null,
      uid = ++update,
    ) {
      await service();
      await db.query(
        "select public.receive_telegram_update($1,$2,'Fox',$3,$4)",
        [uid, tg, cmd, h],
      );
    }
    const status = () =>
      scalar<{
        link: {
          id: string;
          telegram_id: string;
          notifications: boolean;
        } | null;
        request: { id: string; telegram_id: string | null } | null;
      }>("select public.telegram_status()");
    type Job = {
      id: string;
      lease: string;
      chat_id: string;
      body: { code: string; events?: unknown[]; amount_units?: string };
      wait_ms?: number;
    };
    const claim = () =>
      scalar<Job | null>("select public.claim_telegram_delivery()");
    const finish = (j: Job, result = "sent") =>
      scalar<boolean>("select public.finish_telegram_delivery($1,$2,$3,1)", [
        j.id,
        j.lease,
        result,
      ]);
    async function clearQueue() {
      await db.exec(
        "reset role;update private.telegram_outbox set status='cancelled',sent_at=null,attempted_at=null",
      );
    }
    async function bind(n: number, tg: number, seed: string) {
      await as(n);
      await db.query("select public.begin_telegram_link($1)", [hashLink(seed)]);
      await receive(tg, "link", hashLink(seed));
      await as(n);
      const s = await status();
      await db.query("select public.confirm_telegram_link($1,$2,true)", [
        s.request!.id,
        tg,
      ]);
    }
    await t.test(
      "browser and anonymous cannot call service functions or read private tables",
      async () => {
        await as(2);
        await assert.rejects(
          db.query(
            "select public.receive_telegram_update(1,101,null,'events',null)",
          ),
          /permission denied/,
        );
        await assert.rejects(claim(), /permission denied/);
        await assert.rejects(
          db.query("select * from private.telegram_links"),
          /permission denied/,
        );
        await assert.rejects(
          db.query("select public.telegram_delivery_status()"),
          /FORBIDDEN/,
        );
        await as(5);
        await assert.rejects(status(), /FORBIDDEN/);
        await db.exec("reset role;set role anon");
        await assert.rejects(status(), /permission denied/);
      },
    );
    await t.test(
      "proof requires website confirmation; no takeover, duplicate update or expired link",
      async () => {
        await as(2);
        await db.query("select public.begin_telegram_link($1)", [hash]);
        let s = await status();
        const request = s.request!.id;
        await assert.rejects(
          db.query("select public.confirm_telegram_link($1,101,true)", [
            request,
          ]),
          /LINK_EXPIRED/,
        );
        await receive(101, "link", hash, 100);
        await receive(102, "link", hash, 101);
        await receive(101, "link", hash, 100);
        await as(3);
        await assert.rejects(
          db.query("select public.confirm_telegram_link($1,101,true)", [
            request,
          ]),
          /LINK_EXPIRED/,
        );
        await as(2);
        s = await status();
        assert.equal(s.request!.telegram_id, "101");
        await assert.rejects(
          db.query("select public.confirm_telegram_link($1,102,true)", [
            request,
          ]),
          /LINK_EXPIRED/,
        );
        await db.query("select public.confirm_telegram_link($1,101,false)", [
          request,
        ]);
        assert.equal((await status()).link?.notifications, false);
        await assert.rejects(
          db.query("select public.begin_telegram_link($1)", [
            hashLink("again"),
          ]),
          /ALREADY_LINKED/,
        );
        await db.exec("reset role");
        assert.equal(
          await scalar<number>(
            "select count(*)::int from private.telegram_outbox where dedupe='update:100'",
          ),
          1,
        );
        await as(3);
        await db.query("select public.begin_telegram_link($1)", [
          hashLink("third"),
        ]);
        await receive(101, "link", hashLink("third"));
        await as(3);
        assert.equal((await status()).request?.telegram_id, null);
        await db.exec(
          "reset role;update private.telegram_requests set expires_at=now()-interval '1 second'",
        );
        await receive(103, "link", hashLink("third"));
        await as(3);
        assert.equal((await status()).request, null);
      },
    );
    const event = randomUUID();
    await t.test(
      "events need active binding; notifications are opt-in and roll back with the event",
      async () => {
        await clearQueue();
        await db.exec(
          "update public.memberships set joined_at=now()-interval '10 days'",
        );
        await db.query(
          "insert into public.events(id,guild_id,title,kind,starts_at,organizer_id) values($1,$2,'Новый рейд','raid',now()+interval '1 day',$3)",
          [event, guild, m[1]],
        );
        assert.equal(
          await scalar<number>(
            "select count(*)::int from private.telegram_outbox where kind='event'",
          ),
          0,
        );
        await as(2);
        await db.query("select public.set_telegram_notifications(true)");
        await as(1);
        await db.query(
          "select public.edit_event($1,1,'Новый рейд','raid',now()+interval '2 days','',true,'Перенос рейда')",
          [event],
        );
        await db.exec("reset role");
        assert.equal(
          await scalar<number>(
            "select count(*)::int from private.telegram_outbox where kind='event'",
          ),
          1,
        );
        await db.exec("begin");
        await db.query(
          "insert into public.events(id,guild_id,title,kind,starts_at,organizer_id) values($1,$2,'Откат','raid',now()+interval '1 day',$3)",
          [randomUUID(), guild, m[1]],
        );
        await db.exec("rollback");
        assert.equal(
          await scalar<number>(
            "select count(*)::int from private.telegram_outbox where kind='event'",
          ),
          1,
        );
        await clearQueue();
        await receive(101, "events");
        const job = (await claim())!;
        assert.equal(job.body.code, "events");
        assert.equal(job.body.events?.length, 1);
        assert.equal(job.chat_id, "101");
        assert.equal(await finish(job), true);
        await db.exec(
          "reset role;update private.telegram_outbox set sent_at=now()-interval '2 seconds',attempted_at=now()-interval '2 seconds' where sent_at is not null",
        );
        await receive(999, "events");
        const reply = (await claim())!;
        assert.equal(reply.body.code, "not_linked");
        assert.equal(reply.body.events, undefined);
        await finish(reply);
      },
    );
    await t.test(
      "delivery uses one in-flight lease, fences old workers and bounds retries",
      async () => {
        await clearQueue();
        await receive(101, "cabinet");
        const first = (await claim())!;
        assert.ok(first.id);
        assert.equal(await claim(), null);
        await db.exec(
          "reset role;update private.telegram_outbox set lease_until=now()-interval '1 second',attempted_at=now()-interval '2 seconds' where status='sending'",
        );
        await service();
        const second = (await claim())!;
        assert.equal(second.id, first.id);
        assert.notEqual(second.lease, first.lease);
        assert.equal(await finish(first), false);
        assert.equal(await finish(second, "retry"), true);
        await db.exec(
          "reset role;update private.telegram_outbox set attempts=4,available_at=now()-interval '1 second',attempted_at=now()-interval '2 seconds' where status='pending'",
        );
        await service();
        const last = (await claim())!;
        assert.equal(await finish(last, "retry"), true);
        await db.exec("reset role");
        assert.equal(
          await scalar<string>(
            "select status from private.telegram_outbox where id=$1",
            [last.id],
          ),
          "failed",
        );
        await as(2);
        await assert.rejects(
          db.query("select public.retry_telegram_failures()"),
          /FORBIDDEN/,
        );
        await as(1);
        assert.equal(
          await scalar<number>("select public.retry_telegram_failures()"),
          1,
        );
      },
    );
    await t.test(
      "award notifications belong to the recipient; cancellation suppresses stale income",
      async () => {
        await clearQueue();
        const raid = randomUUID(),
          loot = randomUUID(),
          sale = randomUUID(),
          allocation = randomUUID();
        await db.query(
          "insert into public.events(id,guild_id,title,kind,starts_at,organizer_id,treasury_source) values($1,$2,'Прайм','raid',now()-interval '1 day',$3,'prime')",
          [raid, guild, m[1]],
        );
        await as(1);
        await db.query(
          "select public.change_event($1,1,'Прайм','','completed','Завершён рейд')",
          [raid],
        );
        for (const n of [1, 2, 3, 4])
          await db.query(
            "select public.mark_attendance($1,$2,1,$3,'Проверен состав')",
            [raid, m[n], n === 2 ? "present" : "excluded"],
          );
        await db.query(
          "select public.finalize_attendance($1,(select version from public.events where id=$1))",
          [raid],
        );
        await db.query(
          "select public.add_treasury_loot($1,$2,'Трофей','',1,10000,'')",
          [loot, raid],
        );
        await db.query(
          "select public.sell_treasury_loot($1,$2,1,1,1000000000,'')",
          [sale, loot],
        );
        await db.query(
          "select public.allocate_treasury_sale($1,$2,$3,'Равные доли')",
          [allocation, sale, [m[2]]],
        );
        await db.exec("reset role");
        assert.equal(
          await scalar<number>(
            "select count(*)::int from private.telegram_outbox where kind='award' and chat_id=101",
          ),
          1,
        );
        await as(1);
        await db.query(
          "select public.void_treasury_allocation($1,'Исправление расчёта')",
          [allocation],
        );
        await db.exec(
          "reset role;update private.telegram_outbox set status='cancelled' where kind not in ('award','award_cancelled')",
        );
        await service();
        const job = (await claim())!;
        assert.equal(job.body.code, "award_cancelled");
        assert.equal(job.body.amount_units, "700000000");
        await finish(job);
        await db.exec("reset role");
        assert.equal(
          await scalar<string>(
            "select status from private.telegram_outbox where kind='award' limit 1",
          ),
          "cancelled",
        );
      },
    );
    await t.test(
      "blocking, stop and unlink prevent pending disclosure and old-binding delivery",
      async () => {
        await clearQueue();
        await receive(101, "events");
        await db.exec("reset role");
        await db.query("update public.profiles set blocked=true where id=$1", [
          id(2),
        ]);
        await service();
        assert.equal(await claim(), null);
        await as(2);
        await assert.rejects(status(), /FORBIDDEN/);
        await db.exec("reset role");
        await db.query("update public.profiles set blocked=false where id=$1", [
          id(2),
        ]);
        await receive(101, "stop");
        await as(2);
        assert.equal((await status()).link?.notifications, false);
        await receive(101, "unlink");
        await as(2);
        assert.equal((await status()).link, null);
        await bind(2, 202, "new binding");
        await as(2);
        assert.equal((await status()).link?.telegram_id, "202");
        await db.query("select public.unlink_telegram()");
        assert.equal((await status()).link, null);
      },
    );
  } finally {
    await db.close();
  }
});
