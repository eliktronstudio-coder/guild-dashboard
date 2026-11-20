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
test("historical screenshot drafts retain current members even if website registration happened after the screenshot", async () => {
  const member = {
    id: "later-member",
    nickname: "Ронин",
    joined_at: new Date().toISOString(),
  };
  let saved;
  const flow = new ImportWorkflow({
    store: {
      put: (d) => {
        saved = d;
      },
    },
    site: async () => ({
      members: [member],
      activities: [{ id: "activity", name: "Рейд", weight: 100 }],
      drops: [],
    }),
  });
  const input = {
    user: { id: "staff" },
    deferred: false,
    async deferReply() {
      this.deferred = true;
    },
    async editReply(v) {
      this.response = v;
    },
  };
  await flow.start(input, {
    guildId: "guild",
    channelId: "channel",
    channel: { isThread: () => false },
    id: "historical-message",
    createdTimestamp: Date.now() - 86400000,
    content: "Старый рейд",
    attachments: new Map(),
  });
  assert.ok(saved);
  assert.deepEqual(saved.catalog.members, [member]);
  assert.equal(saved.step, "choose");
});
test("explicitly approved full roster cells teach OCR examples across distinct images without publishing an activity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xd-approved-examples-")),
    store = draftStore(dir);
  try {
    let mutations = 0;
    const member = { id: "member", nickname: "CorrectName" };
    const flow = new ImportWorkflow({
      store,
      site: async () => {
        mutations++;
      },
    });
    for (let i = 0; i < 2; i++) {
      const id = randomUUID();
      store.put({
        id,
        request: randomUUID(),
        owner: "staff",
        context: { server: "guild" },
        message: "source-" + i,
        catalog: { members: [member] },
        activity: { name: "Рейд", weight: 100 },
        mode: "raid",
        source: "prime",
        step: "review",
        analyzed: true,
        roster: {
          members: [member],
          guests: [],
          unresolved: [],
          readings: [
            {
              key: "slot-" + i,
              imageKey: "image-" + i,
              verifiedCell: true,
              pending: false,
              origin: "registry",
              name: "CorrectName",
              memberId: member.id,
              truncated: false,
              variants: ["CorrcctName", "CorrectName"],
            },
          ],
        },
        loot: { items: [], unresolved: [] },
      });
      await flow.handle(interaction(id, "remember"));
    }
    assert.equal(
      store.recallNickname("guild", {
        key: "new",
        visible: "CorrcctName",
        variants: ["CorrcctName"],
        confidence: 90,
      }).name,
      "CorrectName",
    );
    assert.equal(
      store.recallNickname("other-guild", {
        key: "new",
        visible: "CorrcctName",
        variants: ["CorrcctName"],
        confidence: 90,
      }).name,
      undefined,
    );
    assert.equal(mutations, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
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
  const saved = store.get(draft.id),
    summary = renderDraft(saved);
  assert.equal(summary.components.length, 0);
  assert.deepEqual(summary.embeds, []);
  assert.match(summary.content, /Название: Левиафан/);
  assert.match(summary.content, /Коэффициент: ×1/);
  assert.match(summary.content, /Дата создания: .*Екатеринбург/);
  const savedAt = saved.savedAt;
  await flow.handle(interaction(draft.id, "publish"));
  assert.equal(store.get(draft.id).savedAt, savedAt);
  assert.equal(requests.length, 2);
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
test("a disputed nickname can be confirmed from hints or explicitly kept as a guest without retyping the roster", async () => {
  const member = { id: randomUUID(), nickname: "SilverKnight" },
    d = {
      id: randomUUID(),
      owner: "staff",
      catalog: { members: [member] },
      activity: { name: "Рейд", weight: 100 },
      mode: "raid",
      source: "prime",
      analyzed: true,
      step: "review",
      roster: {
        members: [],
        guests: [],
        unresolved: ["SilverKn...", "GuestFox"],
      },
      loot: { items: [], unresolved: [] },
    };
  let saved = d;
  const flow = new ImportWorkflow({
    store: {
      get: () => structuredClone(saved),
      put: (value) => {
        saved = structuredClone(value);
      },
    },
  });
  assert.equal(renderDraft(d).components.length, 5);
  await flow.handle(interaction(d.id, "rosterPick", [member.id]));
  assert.equal(saved.roster.members[0].id, member.id);
  assert.deepEqual(saved.roster.unresolved, ["GuestFox"]);
  await flow.handle(interaction(d.id, "rosterPick", ["guest"]));
  assert.deepEqual(saved.roster.guests, ["GuestFox"]);
  assert.equal(saved.roster.unresolved.length, 0);
});
test("one-name correction teaches the selected cell, not another row, and works for names absent from the site", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xd-learn-flow-")),
    store = draftStore(dir);
  try {
    const key = "a".repeat(64),
      id = randomUUID(),
      d = {
        id,
        request: randomUUID(),
        owner: "staff",
        context: { server: "guild-a" },
        message: "source-a",
        catalog: { members: [] },
        activity: { name: "Рейд", weight: 100 },
        mode: "raid",
        source: "prime",
        analyzed: true,
        step: "review",
        roster: {
          members: [],
          guests: [],
          unresolved: ["Nickname..."],
          unresolvedKeys: [key],
          readings: [
            {
              key,
              imageKey: "frame-a",
              visible: "Nickname...",
              variants: ["Nickname..."],
              truncated: true,
            },
          ],
        },
        loot: { items: [], unresolved: [] },
      };
    store.put(d);
    const flow = new ImportWorkflow({ store });
    const show = interaction(id, "editnick");
    show.showModal = async (m) => {
      const raw = m.toJSON();
      assert.ok(raw.custom_id.length <= 100);
      assert.ok(raw.components[0].components[0].label.length <= 45);
    };
    await flow.handle(show);
    assert.equal(show.errorPayload, undefined);
    const edit = interaction(
      id,
      "correctNick_" + key.slice(0, 24),
      [],
      "NicknameFull",
    );
    await flow.handle(edit);
    assert.equal(edit.errorPayload, undefined);
    assert.deepEqual(store.get(id).roster.guests, ["NicknameFull"]);
    assert.equal(store.get(id).roster.unresolved.length, 0);
    assert.deepEqual(store.knownNicknames("guild-a"), ["NicknameFull"]);
    const remembered = store.recallNickname("guild-a", {
      key,
      visible: "Nickname...",
      variants: ["Nickname..."],
      confidence: 90,
    });
    assert.equal(remembered.name, "NicknameFull");
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
test("confirmed guest-only names can be remembered without creating attendance or an activity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xd-guests-memory-")),
    store = draftStore(dir);
  try {
    const id = randomUUID();
    store.put({
      id,
      request: randomUUID(),
      owner: "staff",
      context: { server: "guild" },
      message: "source",
      catalog: { members: [] },
      activity: { name: "Рейд", weight: 100 },
      mode: "raid",
      source: "prime",
      step: "review",
      analyzed: true,
      roster: { members: [], guests: ["NewPlayer"], unresolved: [] },
      loot: { items: [], unresolved: [] },
    });
    let mutations = 0;
    const flow = new ImportWorkflow({
      store,
      site: async () => {
        mutations++;
      },
    });
    await flow.handle(interaction(id, "remember"));
    assert.deepEqual(store.knownNicknames("guild"), ["NewPlayer"]);
    assert.equal(mutations, 0);
    assert.equal(store.get(id).event, undefined);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
test("an already accepted OCR guest can be corrected and taught; the wrong guest is removed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xd-recheck-name-")),
    store = draftStore(dir);
  try {
    const id = randomUUID(),
      key = "b".repeat(64);
    store.put({
      id,
      request: randomUUID(),
      owner: "staff",
      context: { server: "guild" },
      message: "source",
      catalog: { members: [] },
      activity: { name: "Рейд", weight: 100 },
      mode: "raid",
      source: "prime",
      step: "review",
      analyzed: true,
      roster: {
        members: [],
        guests: ["IncorrectName"],
        unresolved: [],
        unresolvedKeys: [],
        readings: [
          {
            key,
            imageKey: "image",
            visible: "IncorrectName",
            name: "IncorrectName",
            memberId: null,
            pending: false,
            variants: ["IncorrectName"],
            origin: "read-from-image",
          },
        ],
      },
      loot: { items: [], unresolved: [] },
    });
    const flow = new ImportWorkflow({ store });
    await flow.handle(interaction(id, "reviewNames"));
    assert.equal(store.get(id).step, "names");
    const edit = interaction(id, "editnick");
    edit.showModal = async (modal) => {
      assert.ok(modal.toJSON().custom_id.length <= 100);
    };
    await flow.handle(edit);
    assert.equal(edit.errorPayload, undefined);
    await flow.handle(
      interaction(id, "correctNick_" + key.slice(0, 24), [], "CorrectName"),
    );
    assert.deepEqual(store.get(id).roster.guests, ["CorrectName"]);
    assert.equal(
      store.recallNickname("guild", {
        key,
        visible: "IncorrectName",
        confidence: 90,
        variants: ["IncorrectName"],
      }).name,
      "CorrectName",
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
test("memory storage failure does not report a successfully published activity as failed", async () => {
  const id = randomUUID(),
    member = { id: randomUUID(), nickname: "PlayerOne" };
  let saved = {
    id,
    request: randomUUID(),
    owner: "staff",
    context: { server: "guild" },
    message: "source",
    catalog: { members: [member] },
    activity: { id: randomUUID(), name: "Рейд", weight: 100, version: 1 },
    mode: "raid",
    source: "prime",
    startsAt: "2026-11-09T10:00:00",
    step: "confirm",
    analyzed: true,
    roster: { members: [member], guests: [], unresolved: [] },
    loot: { items: [], unresolved: [] },
    lootRequests: {},
    evidence: [],
  };
  const store = {
    get: () => structuredClone(saved),
    put: (value) => {
      saved = structuredClone(value);
    },
    rememberNicknames() {
      throw Error("memory unavailable");
    },
  };
  const flow = new ImportWorkflow({
      store,
      site: async () => ({
        event_id: id,
        url: "https://xd-guild.ru/events/" + id,
      }),
    }),
    i = interaction(id, "publish");
  await flow.handle(i);
  assert.equal(i.errorPayload, undefined);
  assert.equal(saved.event.event_id, id);
  assert.equal(saved.nicknameMemoryFailed, true);
  assert.match(i.replyPayload.content, /Активность сохранена/);
});
test("roster-only publication skips unresolved or selected loot and loot screenshots while preserving the original draft", async () => {
  const id = randomUUID(),
    member = { id: randomUUID(), nickname: "PlayerOne" },
    drop = {
      id: randomUUID(),
      name: "Коготь",
      version: 1,
      quantity: 2,
      price_units: "10000",
    };
  let saved = {
    id,
    request: randomUUID(),
    owner: "staff",
    context: { server: "guild" },
    message: "source",
    catalog: { members: [member] },
    activity: { id: randomUUID(), name: "Рейд", weight: 100, version: 1 },
    mode: "raid",
    source: "prime",
    startsAt: "2026-11-09T10:00:00",
    step: "review",
    analyzed: true,
    roster: { members: [member], guests: [], unresolved: [] },
    loot: { items: [drop], unresolved: ["Подпись к скриншоту"] },
    lootRequests: {},
    evidence: [
      { id: randomUUID(), kind: "roster", image: "roster-image" },
      { id: randomUUID(), kind: "loot", image: "loot-image" },
    ],
  };
  const publications = [],
    store = {
      get: () => structuredClone(saved),
      put: (value) => {
        saved = structuredClone(value);
      },
    },
    flow = new ImportWorkflow({
      store,
      site: async (op, body) => {
        publications.push(body);
        return { event_id: id, url: "https://xd-guild.ru/events/" + id };
      },
    });
  const blocked = interaction(id, "confirm");
  await flow.handle(blocked);
  assert.ok(blocked.errorPayload);
  assert.equal(publications.length, 0);
  const controls = renderDraft(saved).components;
  assert.ok(controls.length <= 5);
  assert.ok(controls.every((r) => r.components.length <= 5));
  await flow.handle(interaction(id, "confirmRosterOnly"));
  assert.equal(saved.step, "confirm");
  await flow.handle(interaction(id, "publish"));
  assert.deepEqual(publications[0].activity.loot, []);
  assert.deepEqual(
    publications[0].activity.evidence.map((e) => e.kind),
    ["roster"],
  );
  assert.deepEqual(publications[0].activity.members, [member.id]);
  assert.equal(publications[0].activity.confirmRoster, true);
  assert.equal(saved.loot.items.length, 1);
  assert.equal(saved.loot.unresolved.length, 1);
});
test("roster-only analysis ignores caption text and loot-only attachments; unreviewed names still cannot publish", async () => {
  const id = randomUUID(),
    member = { id: randomUUID(), nickname: "PlayerOne" };
  let saved = {
    id,
    request: randomUUID(),
    owner: "staff",
    context: { server: "guild" },
    message: "source",
    catalog: { members: [member], drops: [] },
    activity: { name: "Рейд", weight: 100 },
    mode: "raid",
    source: "prime",
    step: "images",
    content: "Это состав рейда, а не список предметов",
    attachments: [
      { id: "roster", url: "roster-url" },
      { id: "loot", url: "loot-url" },
    ],
    rosterImages: ["roster"],
    lootImages: ["loot"],
    roster: { members: [], guests: [], unresolved: [] },
    loot: { items: [], unresolved: [] },
  };
  const downloads = [],
    store = {
      get: () => structuredClone(saved),
      put: (value) => {
        saved = structuredClone(value);
      },
    },
    flow = new ImportWorkflow({
      store,
      site: async () => ({}),
      download: async (url) => {
        downloads.push(url);
        return Buffer.from("image");
      },
      ocr: async (_buffer, options) => {
        assert.equal(options.loot, false);
        return {
          words: [{ text: "PlayerOne", confidence: 95, line: "1" }],
          text: "Not loot",
        };
      },
      prepareEvidence: async () => "prepared",
    });
  await flow.handle(interaction(id, "analyzeRoster"));
  assert.deepEqual(downloads, ["roster-url"]);
  assert.equal(saved.roster.members.length, 1);
  assert.deepEqual(saved.loot, { items: [], unresolved: [] });
  assert.deepEqual(
    saved.evidence.map((e) => e.kind),
    ["roster"],
  );
  saved.roster.unresolved = ["Unknown"];
  const attempt = interaction(id, "confirmRosterOnly");
  await flow.handle(attempt);
  assert.ok(attempt.errorPayload);
  assert.equal(saved.event, undefined);
});

test("GPT disputed-cell retry preserves confirmed corrections, ignored cells and loot in the existing draft", async () => {
  const id = randomUUID(),
    member = { id: randomUUID(), nickname: "Registered" };
  const box = { left: 0, top: 0, width: 50, height: 20 };
  const base = {
    kind: "raid-cell",
    pass: "gpt:vision",
    engine: "gpt",
    unbiased: true,
    confidence: 96,
    imageKey: "pixels",
    attachmentId: "shot",
    box,
  };
  const words = [
    {
      ...base,
      text: "Registered",
      slotKey: "good",
      region: "0",
      line: "shot:0",
    },
    {
      ...base,
      text: "Unclear",
      uncertain: true,
      slotKey: "bad",
      region: "1",
      line: "shot:1",
    },
    { ...base, text: "Noise", slotKey: "ignored", region: "2", line: "shot:2" },
  ];
  const { recognizeIndependentRoster } = await import("../src/recognition.mjs");
  const roster = recognizeIndependentRoster(words, [member]);
  Object.assign(
    roster.readings.find((r) => r.key === "good"),
    {
      origin: "manual-correction",
      name: "Registered",
      memberId: member.id,
      pending: false,
    },
  );
  Object.assign(
    roster.readings.find((r) => r.key === "ignored"),
    { ignored: true, pending: false },
  );
  let saved = {
    id,
    request: randomUUID(),
    owner: "staff",
    context: { server: "guild" },
    message: "source",
    catalog: { members: [member], drops: [] },
    activity: { name: "Raid", weight: 100 },
    mode: "raid",
    source: "prime",
    step: "review",
    attachments: [{ id: "shot", url: "image" }],
    recognitionWords: words,
    roster,
    loot: {
      items: [{ id: "drop", name: "Loot", quantity: 3 }],
      unresolved: [],
    },
    evidence: [{ id: "proof", kind: "roster", image: "preserved" }],
    analyzed: true,
  };
  const originalLoot = structuredClone(saved.loot),
    originalEvidence = structuredClone(saved.evidence);
  const flow = new ImportWorkflow({
    store: {
      get: () => structuredClone(saved),
      put: (d) => {
        saved = structuredClone(d);
      },
    },
    site: async () => ({}),
    download: async () => Buffer.from("image"),
    ocr: async (b, options) => {
      assert.equal(options.loot, false);
      assert.deepEqual(options.retryCells, [{ slotKey: "bad", box }]);
      return {
        words: [
          { ...base, text: "NewGuest", slotKey: "bad", region: "0", line: "0" },
        ],
        text: "",
        notice: "GPT",
      };
    },
  });
  const click = interaction(id, "retryVision");
  await flow.handle(click);
  assert.equal(click.errorPayload, undefined);
  assert.deepEqual(saved.roster.members, [member]);
  assert.deepEqual(saved.roster.guests, ["NewGuest"]);
  assert.deepEqual(saved.roster.unresolved, []);
  assert.equal(
    saved.roster.readings.find((r) => r.key === "good").origin,
    "manual-correction",
  );
  assert.ok(saved.roster.readings.find((r) => r.key === "ignored").ignored);
  assert.deepEqual(saved.loot, originalLoot);
  assert.deepEqual(saved.evidence, originalEvidence);
  const rendered = renderDraft(saved);
  assert.ok(rendered.components.length <= 5);
});

test("one screenshot action handles roster plus successive loot batches without rereading or losing edits", async () => {
  const member = { id: randomUUID(), nickname: "Ронин" },
    drop = {
      id: randomUUID(),
      name: "Коготь",
      version: 1,
      price_units: "10000",
    };
  const catalog = {
    members: [member],
    activities: [{ id: randomUUID(), name: "Рейд", weight: 100, version: 1 }],
    drops: [drop],
  };
  let saved,
    calls = [];
  const flow = new ImportWorkflow({
    store: {
      get: () => structuredClone(saved),
      put: (d) => {
        saved = structuredClone(d);
      },
    },
    site: async () => catalog,
    download: async (url) => Buffer.from(url),
    prepareEvidence: async () => "data:image/jpeg;base64,/9j/2Q==",
    ocr: async (buf, options) => {
      calls.push(buf.toString());
      return {
        words: options.roster
          ? [{ text: "Ронин", confidence: 95, line: "1" }]
          : [],
        text: options.loot ? "Коготь x1" : "",
      };
    },
  });
  const files = Array.from({ length: 10 }, (_, i) => ({
    id: "first" + i,
    name: i + ".png",
    url: "first" + i,
    size: 100,
    contentType: "image/png",
  }));
  const start = {
    user: { id: "staff" },
    async deferReply() {
      this.deferred = true;
    },
    async editReply(v) {
      this.payload = v;
    },
  };
  await flow.start(start, {
    guildId: "s",
    channelId: "c",
    channel: { isThread: () => false },
    id: "message",
    createdTimestamp: Date.now(),
    content: "Коготь x999",
    attachments: new Map(files.map((f) => [f.id, f])),
  });
  assert.equal(saved.screensOnly, true);
  assert.deepEqual(saved.rosterImages, ["first0"]);
  assert.equal(saved.lootImages.length, 9);
  saved.activity = catalog.activities[0];
  saved.mode = "raid";
  saved.source = "prime";
  saved.step = "images";
  let labels = renderDraft(saved)
    .components.flatMap((r) => r.components)
    .map((c) => c.label);
  assert.ok(labels.includes("Распознать скрины"));
  assert.ok(!labels.includes("Только состав — без дропа"));
  assert.ok(!labels.includes("Tesseract бесплатно"));
  assert.ok(!labels.includes("Дроп из сообщения"));
  await flow.handle(interaction(saved.id, "analyze"));
  assert.equal(saved.loot.items[0].quantity, 9);
  assert.equal(saved.roster.members[0].id, member.id);
  assert.equal(saved.evidence.length, 8);
  const upload = interaction(saved.id, "uploadLoot");
  upload.showModal = async (modal) => {
    upload.modal = modal.toJSON();
  };
  await flow.handle(upload);
  assert.equal(upload.modal.components[0].component.type, 19);
  assert.equal(upload.modal.components[0].component.max_values, 10);
  await flow.handle(interaction(saved.id, "loottext", [], "Коготь x7"));
  const added = Array.from({ length: 10 }, (_, i) => ({
    id: "next" + i,
    name: i + ".png",
    url: "next" + i,
    size: 100,
    contentType: "image/png",
  }));
  const more = interaction(saved.id, "lootFiles");
  more.fields.getUploadedFiles = () => new Map(added.map((f) => [f.id, f]));
  await flow.handle(more);
  assert.equal(more.errorPayload, undefined);
  assert.equal(saved.attachments.length, 20);
  await flow.handle(interaction(saved.id, "analyze"));
  assert.equal(calls.length, 20);
  assert.equal(saved.loot.items[0].quantity, 17);
  assert.equal(saved.roster.members[0].id, member.id);
  assert.equal(saved.evidence.length, 8);
  await flow.handle(interaction(saved.id, "analyze"));
  assert.equal(calls.length, 20);
  assert.equal(saved.loot.items[0].quantity, 17);
  const duplicate = interaction(saved.id, "lootFiles");
  duplicate.fields.getUploadedFiles = () =>
    new Map([
      [
        "duplicate",
        {
          id: "duplicate",
          name: "duplicate.png",
          url: "first1",
          size: 100,
          contentType: "image/png",
        },
      ],
    ]);
  await flow.handle(duplicate);
  await flow.handle(interaction(saved.id, "analyze"));
  assert.equal(calls.length, 20);
  assert.equal(saved.loot.items[0].quantity, 17);
  const rendered = renderDraft(saved);
  assert.deepEqual(
    rendered.embeds.map((e) => e.title),
    [
      "Распознанные ники",
      "Нераспознанные / требуют проверки",
      "Распознанный дроп",
    ],
  );
  assert.match(rendered.embeds[0].description, /Ронин/);
  assert.match(rendered.embeds[2].description, /Коготь × 17/);
});

test("full site roster search supports all members, pagination and a stable unresolved reading", async () => {
  const members = Array.from({ length: 60 }, (_, i) => ({
    id: randomUUID(),
    nickname: "Player" + String(i).padStart(2, "0"),
  }));
  let saved = {
    id: randomUUID(),
    owner: "staff",
    catalog: { members },
    activity: { name: "Рейд", weight: 100 },
    mode: "raid",
    source: "prime",
    step: "review",
    roster: { members: [], guests: [], unresolved: ["WrongName"] },
    loot: { items: [], unresolved: [] },
  };
  const flow = new ImportWorkflow({
    store: {
      get: () => structuredClone(saved),
      put: (d) => {
        saved = structuredClone(d);
      },
    },
  });
  const pick = interaction(saved.id, "rosterPick", ["roster"]);
  pick.showModal = async (modal) => {
    pick.modal = modal.toJSON();
  };
  await flow.handle(pick);
  assert.match(pick.modal.title, /составе/);
  await flow.handle(interaction(saved.id, "memberQuery", [], ""));
  assert.equal(saved.step, "memberSearch");
  assert.equal(
    renderDraft(saved).components[0].components[0].options.length,
    25,
  );
  await flow.handle(interaction(saved.id, "memberNext"));
  assert.equal(saved.memberSearchPage, 1);
  await flow.handle(interaction(saved.id, "memberQuery", [], "player59"));
  const options = renderDraft(saved).components[0].components[0].options;
  assert.equal(options.length, 1);
  assert.equal(options[0].value, members[59].id);
  await flow.handle(interaction(saved.id, "memberPick", [members[59].id]));
  assert.equal(saved.roster.members[0].id, members[59].id);
  assert.equal(saved.roster.unresolved.length, 0);
});

test("a bad additional upload leaves existing attachment selection intact", async () => {
  let saved = {
    id: randomUUID(),
    owner: "staff",
    context: {},
    step: "images",
    attachments: [{ id: "roster", name: "r.png" }],
    rosterImages: ["roster"],
    lootImages: [],
  };
  const flow = new ImportWorkflow({
    store: {
      get: () => structuredClone(saved),
      put: (d) => {
        saved = structuredClone(d);
      },
    },
  });
  const input = interaction(saved.id, "lootFiles");
  input.fields.getUploadedFiles = () =>
    new Map([["bad", { id: "bad", contentType: "application/pdf", size: 1 }]]);
  await flow.handle(input);
  assert.ok(input.errorPayload);
  assert.equal(saved.attachments.length, 1);
});

test("fourth coefficient row uses site default, accepts a comma override and submits the actual chosen weight", async () => {
  const first = { id: randomUUID(), name: "Рейд", weight: 100, version: 1 },
    second = { id: randomUUID(), name: "АГЛ", weight: 50, version: 1 },
    member = { id: randomUUID(), nickname: "Ронин" };
  let saved = {
    id: randomUUID(),
    request: randomUUID(),
    owner: "staff",
    context: {},
    message: "message",
    startsAt: "2026-11-01T00:00:00",
    catalog: { activities: [first, second], members: [member], drops: [] },
    step: "choose",
    analyzed: true,
    roster: { members: [member], guests: [], unresolved: [] },
    loot: { items: [], unresolved: [] },
    evidence: [],
    lootRequests: {},
  };
  const publications = [];
  const flow = new ImportWorkflow({
    store: {
      get: () => structuredClone(saved),
      put: (d) => {
        saved = structuredClone(d);
      },
    },
    site: async (op, p) => {
      publications.push(p);
      return { event_id: randomUUID(), url: "https://xd-guild.ru/events/test" };
    },
  });
  await flow.handle(interaction(saved.id, "activity", [first.id]));
  assert.equal(saved.coefficientWeight, 100);
  const controls = renderDraft(saved).components;
  assert.equal(controls.length, 5);
  assert.match(controls[3].components[0].label, /Коэффициент: ×1/);
  const edit = interaction(saved.id, "editCoefficient");
  edit.showModal = async (modal) => {
    edit.modal = modal.toJSON();
  };
  await flow.handle(edit);
  assert.equal(edit.modal.components[0].components[0].value, "1.00");
  await flow.handle(interaction(saved.id, "coefficientValue", [], "1,50"));
  assert.equal(saved.coefficientWeight, 150);
  assert.equal(saved.activity.weight, 100);
  await flow.handle(interaction(saved.id, "activity", [first.id]));
  assert.equal(saved.coefficientWeight, 150);
  for (const invalid of ["0", "-1", "1.001", "1000.01", "NaN"]) {
    const attempt = interaction(saved.id, "coefficientValue", [], invalid);
    await flow.handle(attempt);
    assert.ok(attempt.errorPayload);
    assert.equal(saved.coefficientWeight, 150);
  }
  await flow.handle(interaction(saved.id, "mode", ["raid"]));
  await flow.handle(interaction(saved.id, "source", ["prime"]));
  await flow.handle(interaction(saved.id, "images"));
  assert.equal(saved.step, "review");
  assert.match(renderDraft(saved).content, /коэффициент ×1,5/);
  await flow.handle(interaction(saved.id, "confirm"));
  await flow.handle(interaction(saved.id, "publish"));
  assert.equal(publications[0].activity.coefficient, "1.50");
  assert.match(renderDraft(saved).content, /Коэффициент: ×1,5/);
  saved = { ...saved, event: undefined, step: "choose" };
  await flow.handle(interaction(saved.id, "activity", [second.id]));
  assert.equal(saved.coefficientWeight, 50);
});
