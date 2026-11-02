import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { memberDatabase, guild, id } from "./support/database";
import {
  parseUpdate,
  messageText,
  messageMarkup,
  type DeliveryBody,
} from "../src/lib/telegram/protocol";

test("personal statistics commands, mobile links and exact readable amounts", () => {
  const input = (text: string) => ({
    update_id: 1,
    message: {
      date: Math.floor(Date.now() / 1000),
      from: { id: 201, is_bot: false },
      chat: { id: 201, type: "private" },
      text,
    },
  });
  for (const [text, command] of [
    ["/stats", "stats_month"],
    ["/stats week", "stats_week"],
    ["/stats@XD_bot month", "stats_month"],
    ["/start stats_week", "stats_week"],
    ["/start stats_month", "stats_month"],
  ]) {
    assert.deepEqual(parseUpdate(input(text), "XD_bot"), {
      p_update: "1",
      p_telegram: "201",
      p_username: null,
      p_command: command,
      p_hash: null,
      p_event: null,
    });
  }
  for (const text of [
    "/stats all",
    "/stats season",
    "/stats 301",
    "/stats week 301",
    "/stats@other_bot",
    "/start stats_week_301",
  ])
    assert.equal(parseUpdate(input(text), "XD_bot"), null);
  const body: DeliveryBody = {
    code: "stats_month",
    period_from: "2026-11-01",
    period_through: "2026-11-02",
    present: 0,
    applicable: 0,
    percentage: null,
    earned_units: "1234567890123456789",
    paid_units: "1",
    pending_units: "0",
  };
  const text = messageText(body, "https://xd.test");
  assert.match(text, /Нет данных/);
  assert.match(text, /123\u202f456\u202f789\u202f012\u202f345,6789/);
  assert.match(text, /0,0001 золота/);
  assert.match(text, /за всё время: 0 золота/);
  assert.match(text, /UTC/);
  assert.match(
    messageText({ ...body, percentage: 66.7 }, "https://xd.test"),
    /66,7%/,
  );
  assert.equal(
    messageMarkup(body, "XD_bot")?.inline_keyboard[0][0].url,
    "https://t.me/XD_bot?start=stats_week",
  );
  assert.equal(
    messageMarkup(body, "XD_bot")?.inline_keyboard[0][1].url,
    "https://t.me/XD_bot?start=stats_month",
  );
  assert.equal(messageMarkup(body, "bad/name"), undefined);
});

test("Telegram personal statistics: SQL migration, isolated members and corrections", async (t) => {
  const { db, as, scalar, members: m } = await memberDatabase();
  try {
    await db.exec("create role service_role");
    for (const f of (await readdir("supabase/migrations"))
      .sort()
      .filter((f) => f.endsWith(".sql") && f > "202610310002_members.sql"))
      await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
    const links: Record<number, string> = {};
    for (const n of [2, 3]) {
      links[n] = randomUUID();
      await db.query(
        "insert into private.telegram_links(id,membership_id,telegram_id,notifications) values($1,$2,$3,false)",
        [links[n], m[n], n * 100 + 1],
      );
    }
    const from = await scalar<string>(
      "select (date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')::text",
    );
    const until = await scalar<string>(
      "select ((date_trunc('day',now() at time zone 'UTC')+interval '1 day') at time zone 'UTC')::text",
    );
    const stats = async (n = 2, start = from, end = until) => {
      await db.exec("reset role");
      return scalar<DeliveryBody>(
        "select private.telegram_personal_stats($1,$2,$3)",
        [links[n], start, end],
      );
    };
    let update = 100;
    async function clear() {
      await db.exec(
        "reset role;update private.telegram_outbox set status='cancelled',attempted_at=null,lease=null,lease_until=null",
      );
    }
    async function receive(
      tg = 201,
      command = "stats_month",
      request = ++update,
    ) {
      await db.exec("reset role;set role service_role");
      await db.query("select public.receive_telegram_update($1,$2,null,$3)", [
        request,
        tg,
        command,
      ]);
    }
    const claim = () =>
      scalar<{ body: DeliveryBody; chat_id: string } | null>(
        "select public.claim_telegram_delivery()",
      );
    await t.test(
      "empty denominator stays null, zero gold and opt-out permits requested replies",
      async () => {
        const s = await stats();
        assert.equal(s.percentage, null);
        assert.equal(s.present, 0);
        assert.equal(s.applicable, 0);
        assert.equal(s.earned_units, "0");
        assert.equal(s.paid_units, "0");
        assert.equal(s.pending_units, "0");
        await receive();
        const job = (await claim())!;
        assert.equal(job.chat_id, "201");
        assert.deepEqual(job.body, { ...s, code: "stats_month" });
      },
    );
    await t.test(
      "UTC period snapshot, duplicate updates and service-only boundary",
      async () => {
        await clear();
        await db.exec("set timezone='Pacific/Kiritimati'");
        await receive(201, "stats_week", 500);
        await receive(201, "stats_week", 500);
        await db.exec("reset role");
        assert.equal(
          await scalar(
            "select count(*)::int from private.telegram_outbox where dedupe='update:500'",
          ),
          1,
        );
        assert.equal(
          await scalar(
            "select (payload->>'period_from')::timestamptz=(date_trunc('week',now() at time zone 'UTC') at time zone 'UTC') from private.telegram_outbox where dedupe='update:500'",
          ),
          true,
        );
        assert.equal(
          await scalar(
            "select (payload->>'period_until')::timestamptz=$1::timestamptz from private.telegram_outbox where dedupe='update:500'",
            [until],
          ),
          true,
        );
        await db.exec("set timezone='UTC'");
        for (const role of ["anon", "authenticated", "service_role"]) {
          await db.exec("reset role;set role " + role);
          await assert.rejects(
            db.query("select private.telegram_personal_stats($1,$2,$3)", [
              links[3],
              from,
              until,
            ]),
            /permission denied/,
          );
          if (role !== "service_role") {
            await assert.rejects(
              db.exec(
                "select public.receive_telegram_update(9999,301,null,'stats_month')",
              ),
              /permission denied/,
            );
            await assert.rejects(
              db.exec("select public.claim_telegram_delivery()"),
              /permission denied/,
            );
          }
        }
        await db.exec("reset role");
        await assert.rejects(stats(2, until, from), /INVALID_PERIOD/);
        await assert.rejects(stats(2, "-infinity", until), /INVALID_PERIOD/);
      },
    );
    async function event(
      mark: string,
      options: {
        status?: string;
        counted?: boolean;
        finalized?: boolean;
        time?: string;
        member?: number;
      } = {},
    ) {
      await db.exec("reset role");
      const e = randomUUID();
      await db.query(
        `insert into public.events(id,guild_id,title,kind,starts_at,organizer_id,status,counts_for_attendance,attendance_finalized_at)
        values($1,$2,'Тестовая активность','raid',$3,$4,$5,$6,case when $7 then now() end)`,
        [
          e,
          guild,
          options.time ?? from,
          m[1],
          options.status ?? "completed",
          options.counted ?? true,
          options.finalized ?? true,
        ],
      );
      await db.query(
        "insert into public.attendance(guild_id,event_id,membership_id,mark) values($1,$2,$3,$4)",
        [guild, e, m[options.member ?? 2], mark],
      );
      return e;
    }
    let countedEvent: string;
    await t.test(
      "attendance agrees with dashboard and excludes uncounted events",
      async () => {
        countedEvent = await event("present");
        await event("present");
        await event("absent");
        await event("excused");
        await event("excluded");
        await event("present", { status: "cancelled" });
        await event("present", { status: "scheduled" });
        await event("present", { counted: false });
        await event("present", { finalized: false });
        await event("present", { time: until });
        await event("present", { time: "2000-01-01T00:00:00Z" });
        await event("absent", { member: 3 });
        const s = await stats();
        assert.equal(s.present, 2);
        assert.equal(s.applicable, 3);
        assert.equal(s.percentage, 66.7);
        assert.equal((await stats(3)).percentage, 0);
        await as(2);
        const d = await scalar<{ own_present: number; own_attendance: number }>(
          "select public.dashboard_report($1,$2)",
          [from, until],
        );
        assert.equal(d.own_present, s.present);
        assert.equal(d.own_attendance, s.percentage);
      },
    );
    // Synthetic database fixtures; exercise real constraints and triggers, never guild records.
    async function award(n: number, amount: number, created: string) {
      await db.exec("reset role");
      const loot = randomUUID(),
        sale = randomUUID(),
        allocation = randomUUID(),
        w = randomUUID();
      await db.query(
        "insert into public.treasury_loot(id,guild_id,event_id,source,name,quantity_total,quantity_remaining,created_by) values($1,$2,$3,'prime','Трофей',1,0,$4)",
        [loot, guild, countedEvent, id(1)],
      );
      const gross = Math.floor((amount * 10) / 7),
        guildPart = Math.floor((gross * 3) / 10);
      assert.equal(gross - guildPart, amount);
      await db.query(
        "insert into public.treasury_sales(id,guild_id,loot_id,source,quantity,gross_units,guild_units,fund_units,created_by) values($1,$2,$3,'prime',1,$4,$5,$6,$7)",
        [sale, guild, loot, gross, guildPart, amount, id(1)],
      );
      await db.query(
        "insert into public.treasury_allocations(id,guild_id,sale_id,recipient_ids,reason,created_by,created_at) values($1,$2,$3,$4,'Тестовая запись',$5,$6)",
        [allocation, guild, sale, [m[n]], id(1), created],
      );
      await db.query(
        "insert into public.treasury_awards(id,guild_id,allocation_id,membership_id,nickname_snapshot,amount_units) values($1,$2,$3,$4,'Тестовый игрок',$5)",
        [w, guild, allocation, m[n], amount],
      );
      return { w, allocation };
    }
    async function pay(w: string, amount: number, created: string) {
      const p = randomUUID();
      await db.query(
        "insert into public.treasury_payouts(id,guild_id,award_id,amount_units,reference,created_by,created_at) values($1,$2,$3,$4,'Тестовая выплата',$5,$6)",
        [p, guild, w, amount, id(1), created],
      );
      return p;
    }
    let current: { w: string; allocation: string }, payout: string;
    await t.test(
      "period income and payouts differ from lifetime debt; own totals match website",
      async () => {
        current = await award(2, 700000003, from);
        const old = await award(2, 700000000, "2000-01-01T00:00:00Z");
        await award(3, 70000000000, from);
        payout = await pay(current.w, 100000001, from);
        await pay(old.w, 200000002, "2000-01-02T00:00:00Z");
        await pay(old.w, 300000003, from);
        const s = await stats();
        assert.equal(s.earned_units, "700000003");
        assert.equal(s.paid_units, "400000004");
        assert.equal(s.pending_units, "799999997");
        const other = await stats(3);
        assert.equal(other.earned_units, "70000000000");
        assert.equal(other.paid_units, "0");
        await as(2);
        const d = await scalar<{
          own_earned_units: string;
          own_finance: { pending_units: string };
        }>("select public.dashboard_report($1,$2)", [from, until]);
        assert.equal(s.earned_units, d.own_earned_units);
        assert.equal(s.pending_units, d.own_finance.pending_units);
        const past = await stats(
          2,
          "1999-12-31T00:00:00Z",
          "2000-01-01T00:00:00Z",
        );
        assert.equal(past.earned_units, "0");
        assert.equal(past.pending_units, s.pending_units);
      },
    );
    await t.test(
      "financial exports isolate recipients, preserve exact money and enforce period",
      async () => {
        await as(2);
        const own = await scalar<{ id: string; amount_units: string }[]>(
          "select public.finance_export('awards',$1,$2)",
          [from, until],
        );
        assert.equal(own.length, 1);
        assert.equal(own[0].id, current.w);
        assert.equal(own[0].amount_units, "700000003");
        const paid = await scalar<{ amount_units: string }[]>(
          "select public.finance_export('payouts',$1,$2)",
          [from, until],
        );
        assert.equal(paid.length, 2);
        assert.equal(
          paid.reduce((n, r) => n + BigInt(r.amount_units), 0n),
          400000004n,
        );
        await assert.rejects(
          db.query("select public.finance_export('awards',$1,$2)", [
            until,
            from,
          ]),
          /INVALID_PERIOD/,
        );
        await as(1);
        assert.equal(
          (
            await scalar<unknown[]>(
              "select public.finance_export('awards',$1,$2)",
              [from, until],
            )
          ).length,
          2,
        );
        await db.exec("reset role;set role anon");
        await assert.rejects(
          db.query("select public.finance_export('awards',$1,$2)", [
            from,
            until,
          ]),
          /permission denied/,
        );
      },
    );
    await t.test(
      "queued replies recompute after attendance and finance corrections",
      async () => {
        await clear();
        await receive();
        await db.exec("reset role");
        await db.query(
          "update public.events set attendance_finalized_at=null where id=$1",
          [countedEvent],
        );
        await db.query(
          "update public.treasury_payouts set voided_at=now(),voided_by=$2,void_reason='Исправлено' where id=$1",
          [payout, id(1)],
        );
        await db.query(
          "update public.treasury_allocations set voided_at=now(),voided_by=$2,void_reason='Исправлено' where id=$1",
          [current.allocation, id(1)],
        );
        await db.exec("set role service_role");
        const job = (await claim())!;
        assert.equal(job.body.present, 1);
        assert.equal(job.body.percentage, 50);
        assert.equal(job.body.earned_units, "0");
        assert.equal(job.body.paid_units, "300000003");
        assert.equal(job.body.pending_units, "199999995");
      },
    );
    await t.test(
      "financial export retains cancelled records and current corrected balances",
      async () => {
        await as(2);
        const rows = await scalar<
          { allocation_voided_at: string; pending_units: string }[]
        >("select public.finance_export('awards',$1,$2)", [from, until]);
        assert.ok(rows[0].allocation_voided_at);
        assert.equal(rows[0].pending_units, "0");
        const paid = await scalar<{ id: string; voided_at: string }[]>(
          "select public.finance_export('payouts',$1,$2)",
          [from, until],
        );
        assert.ok(paid.find((r) => r.id === payout)?.voided_at);
      },
    );
    await t.test(
      "blocking, inactive membership and replaced binding cancel queued private data",
      async () => {
        await clear();
        await receive();
        await db.exec("reset role");
        await db.query("update public.profiles set blocked=true where id=$1", [
          id(2),
        ]);
        await db.exec("set role service_role");
        assert.equal(await claim(), null);
        await clear();
        await receive();
        assert.equal((await claim())!.body.code, "not_linked");
        await db.exec("reset role");
        await db.query("update public.profiles set blocked=false where id=$1", [
          id(2),
        ]);
        await clear();
        await receive();
        await db.exec("reset role");
        await db.query(
          "update public.memberships set status='left' where id=$1",
          [m[2]],
        );
        await db.exec("set role service_role");
        assert.equal(await claim(), null);
        await db.exec("reset role");
        await db.query(
          "update public.memberships set status='active' where id=$1",
          [m[2]],
        );
        await clear();
        await receive();
        await db.exec("reset role");
        await db.query(
          "delete from private.telegram_links where id=any($1::uuid[])",
          [[links[2], links[3]]],
        );
        await db.query(
          "insert into private.telegram_links(membership_id,telegram_id) values($1,201)",
          [m[3]],
        );
        await db.exec("set role service_role");
        assert.equal(await claim(), null);
        await clear();
        await receive();
        assert.equal((await claim())!.body.earned_units, "70000000000");
      },
    );
  } finally {
    await db.close();
  }
});
