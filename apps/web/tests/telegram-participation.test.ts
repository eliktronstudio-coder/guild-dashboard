import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { memberDatabase, guild, id } from "./support/database";
import {
  parseUpdate,
  messageText,
  messageMarkup,
  sendMessage,
} from "../src/lib/telegram/protocol";
const eventId = "50000000-0000-4000-8000-000000000001";
test("bot participation protocol: direct commands and mobile deep links", async () => {
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
    [`/join ${eventId}`, "join"],
    [`/leave@XD_bot ${eventId}`, "leave"],
    [`/start join_${eventId}`, "join"],
    [`/start leave_${eventId}`, "leave"],
  ]) {
    const r = parseUpdate(input(text), "XD_bot")!;
    assert.equal(r.p_command, command);
    assert.equal(r.p_event, eventId);
    assert.equal(r.p_hash, null);
  }
  assert.equal(parseUpdate(input("/join"), "XD_bot")?.p_command, "signup_help");
  for (const text of [
    "/join invalid",
    "/leave 1;drop",
    `/start join_${eventId}_extra`,
    `/join ${eventId} extra`,
    `/join@Other_bot ${eventId}`,
  ])
    assert.equal(parseUpdate(input(text), "XD_bot"), null);
  const body = {
    code: "events",
    events: [
      {
        id: eventId,
        title: "Прайм",
        starts_at: "2099-01-01T18:00:00Z",
        signed_up: false,
      },
    ],
  };
  assert.equal(
    messageMarkup(body, "XD_bot")?.inline_keyboard[0][0].url,
    `https://t.me/XD_bot?start=join_${eventId}`,
  );
  assert.equal(
    messageMarkup(
      { ...body, events: [{ ...body.events[0], signed_up: true }] },
      "XD_bot",
    )?.inline_keyboard[0][0].url,
    `https://t.me/XD_bot?start=leave_${eventId}`,
  );
  assert.equal(
    messageMarkup(
      { ...body, events: [{ ...body.events[0], starts_at: "2000-01-01" }] },
      "XD_bot",
    ),
    undefined,
  );
  assert.equal(
    messageMarkup(
      {
        code: "event",
        id: eventId,
        status: "cancelled",
        starts_at: "2099-01-01",
      },
      "XD_bot",
    ),
    undefined,
  );
  assert.equal(messageMarkup(body, "evil/?x="), undefined);
  let sent: Record<string, unknown> = {};
  await sendMessage(
    "fake",
    "201",
    body,
    "https://xd.test",
    async (_u, init) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({ ok: true });
    },
    "XD_bot",
  );
  assert.ok(sent.reply_markup);
  assert.equal(sent.parse_mode, undefined);
  assert.match(
    messageText(
      {
        code: "payout",
        amount_units: "1234567890123456789",
        pending_units: "1",
      },
      "https://xd.test",
    ),
    /123\u202f456\u202f789\u202f012\u202f345,6789/,
  );
  assert.match(
    messageText(
      { code: "payout_cancelled", amount_units: "1", pending_units: "0" },
      "https://xd.test",
    ),
    /отменена/,
  );
});

test("Telegram participation and payouts: common rules, ownership, dedupe and current delivery state", async (t) => {
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
    await db.exec(
      "update public.memberships set joined_at=now()-interval '10 days'",
    );
    for (const n of [2, 3])
      await db.query(
        "insert into private.telegram_links(membership_id,telegram_id,notifications) values($1,$2,true)",
        [m[n], n * 100 + 1],
      );
    await as(2);
    const before = await scalar("select public.telegram_status()");
    await db.exec("reset role");
    await db.exec(
      await readFile(
        "supabase/migrations/202611010010_telegram_participation.sql",
        "utf8",
      ),
    );
    await as(2);
    assert.deepEqual(await scalar("select public.telegram_status()"), before);
    const service = async () => db.exec("reset role;set role service_role");
    let update = 1000;
    async function receive(
      tg: number,
      command: string,
      event: string | null = null,
      request = ++update,
    ) {
      await service();
      await db.query(
        "select public.receive_telegram_update($1,$2,null,$3,null,$4)",
        [request, tg, command, event],
      );
    }
    async function count(event: string, member = m[2]) {
      await db.exec("reset role");
      return scalar<number>(
        "select count(*)::int from public.event_signups where event_id=$1 and membership_id=$2",
        [event, member],
      );
    }
    async function clear() {
      await db.exec(
        "reset role;update private.telegram_outbox set status='cancelled',attempted_at=null,sent_at=null",
      );
    }
    type Job = {
      id: string;
      lease: string;
      chat_id: string;
      body: {
        code: string;
        signed_up?: boolean;
        events?: { id: string; signed_up: boolean }[];
        amount_units?: string;
        pending_units?: string;
      };
    };
    const claim = () =>
      scalar<Job | null>("select public.claim_telegram_delivery()");
    await db.exec("reset role");
    await db.query(
      "insert into public.events(id,guild_id,title,kind,starts_at,organizer_id) values($1,$2,'Будущий прайм','raid',now()+interval '1 day',$3)",
      [eventId, guild, m[1]],
    );
    await clear();
    await t.test(
      "website and bot change the same signup; repeated updates do not reverse or duplicate",
      async () => {
        await as(2);
        await db.query("select public.set_event_signup($1,true)", [eventId]);
        assert.equal(await count(eventId), 1);
        await receive(201, "leave", eventId, 100);
        assert.equal(await count(eventId), 0);
        await as(2);
        await db.query("select public.set_event_signup($1,true)", [eventId]);
        await receive(201, "leave", eventId, 100);
        assert.equal(await count(eventId), 1);
        await receive(201, "join", eventId, 101);
        await receive(201, "join", eventId, 102);
        assert.equal(await count(eventId), 1);
        assert.equal(await count(eventId, m[3]), 0);
        await db.exec("reset role");
        assert.equal(
          await scalar<number>(
            "select count(*)::int from public.audit_log where target_id=$1 and action='event.signup_changed'",
            [eventId],
          ),
          3,
        );
        await clear();
        await receive(201, "events");
        const job = (await claim())!;
        assert.equal(
          job.body.events?.find((e) => e.id === eventId)?.signed_up,
          true,
        );
      },
    );
    await t.test(
      "late, closed, missing and foreign events cannot be joined; users cannot impersonate service",
      async () => {
        await clear();
        for (const [status, offset] of [
          ["scheduled", "-1 day"],
          ["completed", "1 day"],
          ["cancelled", "1 day"],
        ]) {
          const e = randomUUID();
          await db.exec("reset role");
          await db.query(
            "insert into public.events(id,guild_id,title,kind,starts_at,organizer_id,status) values($1,$2,'Закрытый рейд','raid',now()+$3::interval,$4,$5)",
            [e, guild, offset, m[1], status],
          );
          await as(2);
          await assert.rejects(
            db.query("select public.set_event_signup($1,true)", [e]),
            /EVENT_CLOSED/,
          );
          await receive(201, "join", e);
          assert.equal(await count(e), 0);
        }
        const otherGuild = randomUUID(),
          otherEvent = randomUUID(),
          otherMember = randomUUID();
        await db.exec("reset role");
        await db.query(
          "insert into public.guilds(id,slug,name) values($1,'other','Other')",
          [otherGuild],
        );
        await db.query(
          "insert into public.memberships(id,guild_id,user_id,nickname) values($1,$2,$3,'Другой')",
          [otherMember, otherGuild, id(4)],
        );
        await db.query(
          "insert into public.events(id,guild_id,title,kind,starts_at,organizer_id) values($1,$2,'Секретный рейд','raid',now()+interval '1 day',$3)",
          [otherEvent, otherGuild, otherMember],
        );
        await receive(201, "join", otherEvent);
        assert.equal(await count(otherEvent), 0);
        await receive(201, "join", randomUUID());
        await as(2);
        await assert.rejects(
          db.query(
            "select public.receive_telegram_update(99999,301,null,'join',null,$1)",
            [eventId],
          ),
          /permission denied/,
        );
        await assert.rejects(
          db.query(
            "select private.set_member_event_signup($1,$2,true,'telegram',null)",
            [eventId, m[3]],
          ),
          /permission denied/,
        );
      },
    );
    await t.test(
      "a reply reflects the current signup after a later cancellation; attendance is unchanged",
      async () => {
        await clear();
        await receive(301, "join", eventId);
        await as(3);
        await db.query("select public.set_event_signup($1,false)", [eventId]);
        await service();
        const job = (await claim())!;
        assert.equal(job.body.code, "signup_status");
        assert.equal(job.body.signed_up, false);
        await db.exec("reset role");
        assert.equal(
          await scalar<number>(
            "select count(*)::int from public.attendance where event_id=$1",
            [eventId],
          ),
          0,
        );
      },
    );
    await t.test(
      "blocked and unlinked Telegram accounts cannot change registrations",
      async () => {
        await clear();
        await db.query("update public.profiles set blocked=true where id=$1", [
          id(3),
        ]);
        await receive(301, "join", eventId);
        assert.equal(await count(eventId, m[3]), 0);
        await db.query("update public.profiles set blocked=false where id=$1", [
          id(3),
        ]);
        await as(3);
        await db.query("select public.unlink_telegram()");
        await receive(301, "join", eventId);
        assert.equal(await count(eventId, m[3]), 0);
      },
    );
    let award: string, payout: string;
    await t.test(
      "partial payout queues only its recipient once and reports the exact remaining debt",
      async () => {
        await clear();
        await db.query(
          "insert into private.telegram_links(membership_id,telegram_id,notifications) values($1,301,true)",
          [m[3]],
        );
        const event = randomUUID(),
          loot = randomUUID(),
          sale = randomUUID(),
          allocation = randomUUID();
        payout = randomUUID();
        await db.query(
          "insert into public.events(id,guild_id,title,kind,starts_at,organizer_id,treasury_source) values($1,$2,'Прайм для выплаты','raid',now()-interval '1 day',$3,'prime')",
          [event, guild, m[1]],
        );
        await as(1);
        await db.query(
          "select public.change_event($1,1,'Прайм для выплаты','','completed','Проверка рейда')",
          [event],
        );
        for (const n of [1, 2, 3, 4])
          await db.query(
            "select public.mark_attendance($1,$2,1,$3,'Проверен состав')",
            [event, m[n], n === 2 ? "present" : "excluded"],
          );
        await db.query(
          "select public.finalize_attendance($1,(select version from public.events where id=$1))",
          [event],
        );
        await db.query(
          "select public.add_treasury_loot($1,$2,'Трофей','',1,10000,'')",
          [loot, event],
        );
        await db.query(
          "select public.sell_treasury_loot($1,$2,1,1,1000000000,'')",
          [sale, loot],
        );
        await db.query(
          "select public.allocate_treasury_sale($1,$2,$3,'Доля участника')",
          [allocation, sale, [m[2]]],
        );
        award = await scalar<string>(
          "select id from public.treasury_awards where allocation_id=$1",
          [allocation],
        );
        await clear();
        await as(1);
        const args = [payout, award];
        await db.query(
          "select public.pay_treasury_award($1,$2,1,123456789,'Передано в игре')",
          args,
        );
        await db.query(
          "select public.pay_treasury_award($1,$2,1,123456789,'Передано в игре')",
          args,
        );
        await service();
        const job = (await claim())!;
        assert.equal(job.body.code, "payout");
        assert.equal(job.chat_id, "201");
        assert.equal(job.body.amount_units, "123456789");
        assert.equal(job.body.pending_units, "576543211");
        await db.exec("reset role");
        assert.equal(
          await scalar<number>(
            "select count(*)::int from private.telegram_outbox where kind='payout'",
          ),
          1,
        );
      },
    );
    await t.test(
      "voided payout suppresses its unsent notice and restores debt; opt-out suppresses new notices",
      async () => {
        await db.exec(
          "reset role;update private.telegram_outbox set status='pending',lease=null,lease_until=null,attempted_at=null where kind='payout'",
        );
        await as(1);
        await db.query(
          "select public.void_treasury_payout($1,'Исправление выплаты')",
          [payout],
        );
        await db.query(
          "select public.void_treasury_payout($1,'Исправление выплаты')",
          [payout],
        );
        await service();
        const job = (await claim())!;
        assert.equal(job.body.code, "payout_cancelled");
        assert.equal(job.body.pending_units, "700000000");
        await db.exec("reset role");
        assert.equal(
          await scalar<string>(
            "select status from private.telegram_outbox where kind='payout' limit 1",
          ),
          "cancelled",
        );
        await clear();
        await as(2);
        await db.query("select public.set_telegram_notifications(false)");
        await as(1);
        const version = await scalar<number>(
          "select version from public.treasury_awards where id=$1",
          [award],
        );
        await db.query(
          "select public.pay_treasury_award($1,$2,$3,1,'Минимальная выплата')",
          [randomUUID(), award, version],
        );
        await db.exec("reset role");
        assert.equal(
          await scalar<number>(
            "select count(*)::int from private.telegram_outbox where status='pending' and kind='payout'",
          ),
          0,
        );
      },
    );
  } finally {
    await db.close();
  }
});
