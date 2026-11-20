import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { automaticImports } from "../src/automatic.mjs";
import { ImportWorkflow } from "../src/workflow.mjs";
import { draftStore } from "../src/store.mjs";
const picture = (id) => ({
  id,
  name: id + ".png",
  url: id,
  size: 100,
  contentType: "image/png",
});
function message(id, edits = []) {
  return {
    id,
    guildId: "guild",
    channelId: "channel",
    channel: { id: "channel", isThread: () => false },
    author: { id: "user", bot: false },
    createdTimestamp: Date.now(),
    content: "",
    attachments: new Map(["roster", "loot"].map((id) => [id, picture(id)])),
    reply: async (payload) => {
      edits.push(payload);
      return {
        edit: async (payload) => {
          edits.push(payload);
        },
      };
    },
  };
}
function action(id, action, values = []) {
  return {
    customId: `xd:${id}:${action}`,
    user: { id: "user" },
    values,
    async deferUpdate() {
      this.deferred = true;
    },
    async editReply() {},
    async reply(payload) {
      this.error = payload;
    },
    async followUp(payload) {
      this.error = payload;
    },
  };
}

test("a screenshot message automatically recognises both images before asking for metadata; saving still requires confirmation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xd-auto-"));
  let store = draftStore(dir);
  try {
    const member = { id: randomUUID(), nickname: "Ронин" },
      activity = { id: randomUUID(), name: "Рейд", weight: 100, version: 1 },
      drop = {
        id: randomUUID(),
        name: "Коготь",
        version: 1,
        price_units: "10000",
      };
    const catalog = {
        members: [member],
        activities: [activity],
        drops: [drop],
      },
      calls = [],
      published = [],
      edits = [];
    const flow = new ImportWorkflow({
      store,
      site: async (op, payload) => {
        if (op === "import") {
          published.push(payload);
          return {
            event_id: randomUUID(),
            url: "https://xd-guild.ru/activities",
          };
        }
        return catalog;
      },
      download: async (url) => Buffer.from(url),
      prepareEvidence: async () => "data:image/jpeg;base64,/9j/2Q==",
      ocr: async (buf, options) => {
        calls.push(options);
        return {
          words: options.roster
            ? [{ text: "Ронин", confidence: 95, line: "1" }]
            : [],
          text: options.loot ? "Коготь x2" : "",
        };
      },
    });
    const incoming = automaticImports({
        flow,
        store,
        allowed: (c) => c.id === "channel",
      }),
      m = message("message", edits);
    await incoming(m);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].roster, true);
    assert.equal(calls[1].loot, true);
    assert.equal(published.length, 0);
    const rendered = edits.at(-1),
      id = rendered.components[0].components[0].custom_id.split(":")[1];
    let d = store.get(id);
    assert.equal(d.step, "choose");
    assert.equal(d.analyzed, true);
    assert.equal(d.activity, undefined);
    assert.equal(d.roster.members[0].id, member.id);
    assert.equal(d.loot.items[0].quantity, 2);
    assert.equal(rendered.embeds.length, 4);
    assert.ok(edits.every((e) => e.flags === undefined));
    assert.ok(edits.every((e) => e.allowedMentions.parse.length === 0));
    const premature = action(id, "confirm");
    await flow.handle(premature);
    assert.ok(premature.error);
    assert.equal(published.length, 0);
    await flow.handle(action(id, "activity", [activity.id]));
    await flow.handle(action(id, "mode", ["raid"]));
    await flow.handle(action(id, "source", ["mini_rb"]));
    await flow.handle(action(id, "images"));
    assert.equal(store.get(id).step, "review");
    assert.equal(calls.length, 2);
    await flow.handle(action(id, "confirm"));
    await flow.handle(action(id, "publish"));
    assert.equal(published.length, 1);
    assert.equal(published[0].activity.source, "mini_rb");
    assert.equal(published[0].activity.loot[0].quantity, 2);
    await incoming(m);
    assert.equal(calls.length, 2);
    assert.equal(published.length, 1);
    store.close();
    store = draftStore(dir);
    assert.equal(store.claimAutomaticMessage("guild", "message"), false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("automatic intake ignores bots, text-only messages and other channels", async () => {
  let calls = 0;
  const intake = automaticImports({
    flow: {
      start: async () => {
        calls++;
      },
    },
    store: {
      claimAutomaticMessage: () => {
        calls++;
        return true;
      },
    },
    allowed: (c) => c.id === "channel",
  });
  const bot = message("bot");
  bot.author.bot = true;
  await intake(bot);
  const text = message("text");
  text.attachments.clear();
  await intake(text);
  const elsewhere = message("elsewhere");
  elsewhere.channel.id = "other";
  await intake(elsewhere);
  assert.equal(calls, 0);
});

test("automatic intake serialises work and continues after an unavailable message", async () => {
  const seen = [],
    errors = [];
  let active = 0;
  const intake = automaticImports({
    store: { claimAutomaticMessage: () => true },
    allowed: () => true,
    onError: () => errors.push(true),
    flow: {
      start: async (_, m) => {
        assert.equal(active, 0);
        active++;
        seen.push(m.id);
        await Promise.resolve();
        active--;
        if (m.id === "first") throw Error("offline");
      },
    },
  });
  await Promise.all([intake(message("first")), intake(message("second"))]);
  assert.deepEqual(seen, ["first", "second"]);
  assert.equal(errors.length, 1);
});
