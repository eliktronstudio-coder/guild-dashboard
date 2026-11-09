import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ImportWorkflow, renderDraft } from "../src/workflow.mjs";
import { draftStore } from "../src/store.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
function interaction(id, action, values = [], text = "") {
  return {
    customId: `xd:${id}:${action}`,
    user: { id: "staff" },
    values,
    fields: { getTextInputValue: () => text },
    async deferUpdate() {
      this.deferred = true;
    },
    async reply(v) {
      this.replyPayload = v;
    },
    async editReply(v) {
      this.replyPayload = v;
    },
    async followUp(v) {
      this.errorPayload = v;
    },
  };
}
test("complete Discord conversation publishes a stable reviewed payload and survives a lost response/restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xd-discord-"));
  let store = draftStore(dir);
  const requests = [];
  let lost = true;
  const member = { id: randomUUID(), nickname: "Ронин" },
    activity = { id: randomUUID(), name: "Левиафан", weight: 100, version: 1 },
    drop = {
      id: randomUUID(),
      name: "Коготь",
      version: 1,
      price_units: "20000000",
    };
  const draft = {
    id: randomUUID(),
    request: randomUUID(),
    owner: "staff",
    context: {
      server: "123456789012345678",
      channel: "223456789012345678",
      parent: null,
      user: "staff",
    },
    message: "423456789012345678",
    startsAt: "2026-11-08T10:00:00",
    activity,
    mode: "raid",
    source: "prime",
    catalog: { members: [member], activities: [activity], drops: [drop] },
    step: "images",
    content: "Коготь x2",
    attachments: [{ id: "photo", url: "fixture" }],
    rosterImages: ["photo"],
    lootImages: [],
    roster: { members: [], guests: [], unresolved: [] },
    loot: { items: [], unresolved: [] },
    lootRequests: {},
    evidence: [],
  };
  store.put(draft);
  const site = async (op, body) => {
    if (op === "context") return draft.catalog;
    requests.push(body);
    if (lost) {
      lost = false;
      throw Error("lost response");
    }
    return {
      event_id: draft.request,
      url: "https://xd-guild.ru/events/" + draft.request,
    };
  };
  const dependencies = {
    site,
    store,
    download: async () => Buffer.from("test"),
    ocr: async () => ({
      words: [{ text: "Ронин", confidence: 95, line: "1" }],
      text: "Ронин",
    }),
    prepareEvidence: async () => "data:image/jpeg;base64,/9j/2Q==",
  };
  let flow = new ImportWorkflow(dependencies);
  await flow.handle(interaction(draft.id, "analyze"));
  assert.equal(store.get(draft.id).roster.members.length, 1);
  assert.equal(store.get(draft.id).loot.items[0].quantity, 2);
  assert.equal(store.get(draft.id).evidence[0].kind, "roster");
  await flow.handle(interaction(draft.id, "confirm"));
  assert.equal(store.get(draft.id).step, "confirm");
  await flow.handle(interaction(draft.id, "publish"));
  assert.equal(requests.length, 1);
  store.close();
  store = draftStore(dir);
  flow = new ImportWorkflow({ ...dependencies, store });
  await flow.handle(interaction(draft.id, "publish"));
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(requests[1].activity.confirmRoster, true);
  assert.deepEqual(requests[1].activity.facts, {});
  assert.ok(store.get(draft.id).event);
  assert.equal(renderDraft(store.get(draft.id)).components.length, 0);
  store.close();
  rmSync(dir, { recursive: true });
});
test("another user cannot change a draft or release a running publication lock", async () => {
  const d = { id: randomUUID(), owner: "staff" },
    store = { get: () => d },
    flow = new ImportWorkflow({ store });
  flow.locks.add(d.id);
  const i = interaction(d.id, "publish");
  i.user.id = "stranger";
  await flow.handle(i);
  assert.ok(flow.locks.has(d.id));
  assert.match(i.replyPayload.content, /другим участником/);
});
test("correction modals satisfy Discord API limits, including an empty roster", async () => {
  const d = {
      id: randomUUID(),
      owner: "staff",
      roster: { members: [], guests: [], unresolved: [] },
      loot: { items: [], unresolved: [] },
    },
    flow = new ImportWorkflow({ store: { get: () => d } });
  for (const action of ["editroster", "editloot", "extra"]) {
    const i = interaction(d.id, action);
    i.showModal = async (modal) => {
      const raw = modal.toJSON();
      assert.ok(raw.title.length <= 45);
      assert.ok(raw.components[0].components[0].label.length <= 45);
    };
    await flow.handle(i);
    assert.equal(i.errorPayload, undefined);
    assert.equal(i.replyPayload, undefined);
  }
});
test("loot from a second message is included once and stays in the configured channel", async () => {
  let saved;
  const d = {
    id: randomUUID(),
    owner: "staff",
    context: { server: "s", channel: "c" },
    attachments: [],
    rosterImages: [],
    lootImages: [],
    content: "",
    step: "images",
  };
  const flow = new ImportWorkflow({
    site: async () => ({}),
    store: {
      get: () => structuredClone(saved ?? d),
      put: (v) => {
        saved = structuredClone(v);
      },
    },
    fetchMessage: async () => ({
      guildId: "s",
      channelId: "c",
      author: { bot: false },
      content: "Коготь x3",
      attachments: new Map(),
    }),
  });
  for (let i = 0; i < 2; i++) {
    const input = interaction(d.id, "extratext", [], "423456789012345678");
    await flow.handle(input);
    assert.equal(input.errorPayload, undefined);
  }
  assert.equal(saved.content.trim(), "Коготь x3");
  assert.equal(saved.extraMessages.length, 1);
  assert.equal(saved.analyzed, false);
});
