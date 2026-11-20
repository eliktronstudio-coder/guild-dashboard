import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  recognizeLoot,
  refreshSimilarLoot,
  ensureLoot,
  resolveLoot,
  persistLoot,
} from "../src/loot-review.mjs";
import { ImportWorkflow, renderDraft } from "../src/workflow.mjs";

const drops = [
  {
    id: randomUUID(),
    name: "Трофейная эссенция стихий",
    price_units: "1500000",
    version: 1,
  },
  {
    id: randomUUID(),
    name: "Коготь дракона",
    price_units: "30000",
    version: 2,
  },
];
test("drop recognition accepts clear isolated typos, aggregates duplicates and retains original readings", () => {
  const r = recognizeLoot(
    "Трофейная эссенцня стихий x2\nТрофейная эссенция стихий x3",
    drops,
  );
  assert.equal(r.items[0].quantity, 5);
  assert.equal(r.items[0].id, drops[0].id);
  assert.equal(r.readings[0].status, "автосопоставлено");
  assert.equal(r.readings[0].raw, "Трофейная эссенцня стихий x2");
  assert.deepEqual(r.unresolved, []);
});
test("ambiguous items, unread quantities, numeric variants and clipped names remain pending", () => {
  const similar = [
    { id: "a", name: "Коготь дракона" },
    { id: "b", name: "Коготь драконы" },
  ];
  assert.equal(
    recognizeLoot("Коготь драконя x3", similar).unresolved.length,
    1,
  );
  for (const raw of [
    "Коготь дракона x0",
    "Коготь дракона x1000001",
    "Коготь… x3",
    "Коготъ дракона",
    "Коготь дракона",
    "Коготь дракона xO",
    "? Коготь дракона x3",
  ]) {
    const r = recognizeLoot(raw, drops);
    assert.equal(r.items.length, 0, raw);
    assert.equal(r.unresolved.length, 1, raw);
  }
  assert.equal(
    recognizeLoot("Эссенция ярости x200 x2", [
      { id: "pack", name: "Эссенция ярости x2000" },
    ]).items.length,
    0,
  );
  const packs = recognizeLoot(
    "Эссенция ярости x2000\nЭссенция ярости x2000 x2",
    [{ id: "pack", name: "Эссенция ярости x2000" }],
  );
  assert.equal(packs.items[0].quantity, 2);
  assert.equal(packs.unresolved.length, 1);
});
test("manual correction persists over later screenshot batches and rejects unsafe totals atomically", () => {
  const d = {
    catalog: { drops },
    screensOnly: true,
    lootImageResults: { old: "? raw" },
    loot: recognizeLoot("? Неизвестный x2\nКоготь дракона x3", drops),
  };
  const key = ensureLoot(d)[0].key;
  resolveLoot(d, key, drops[1].id, 4);
  assert.equal(d.loot.items[0].quantity, 7);
  assert.deepEqual(d.lootOverrideImages, ["old"]);
  const later = recognizeLoot(d.lootOverride + "\nКоготь дракона x2", drops);
  assert.equal(later.items[0].quantity, 9);
  const before = structuredClone(d.loot);
  for (const quantity of [0, -1, 1.5, NaN, 1000000])
    assert.throws(
      () => resolveLoot(d, key, drops[1].id, quantity),
      /INVALID_LOOT_QUANTITY/,
    );
  assert.deepEqual(d.loot, before);
  d.loot.readings[0].ignored = true;
  persistLoot(d);
  assert.equal(d.loot.items[0].quantity, 3);
  assert.throws(() => resolveLoot(d, key, drops[0].id, 1), /DRAFT_CHANGED/);
});
function fixture() {
  const member = { id: randomUUID(), nickname: "Ронин" };
  let saved = {
    id: randomUUID(),
    request: randomUUID(),
    owner: "staff",
    context: {},
    message: "one",
    startsAt: "2026-11-01T00:00:00Z",
    step: "review",
    analyzed: true,
    screensOnly: true,
    lootImageResults: { old: "unread" },
    evidence: [],
    lootRequests: {},
    catalog: { members: [member], drops, activities: [] },
    activity: { id: randomUUID(), name: "Анталлон", weight: 100, version: 1 },
    mode: "raid",
    source: "prime",
    roster: { members: [member], guests: [], unresolved: [] },
    loot: recognizeLoot("? Непрочитанный предмет x2", drops),
  };
  const published = [];
  const flow = new ImportWorkflow({
    store: {
      get: () => structuredClone(saved),
      put: (d) => {
        saved = structuredClone(d);
      },
    },
    site: async (op, payload) => {
      if (op === "context") return saved.catalog;
      published.push(payload);
      return { event_id: randomUUID(), url: "https://xd-guild.ru/events/test" };
    },
  });
  const run = async (action, values = [], text = "", owner = "staff") => {
    const i = {
      customId: `xd:${saved.id}:${action}`,
      user: { id: owner },
      values,
      fields: { getTextInputValue: () => text },
      deferUpdate: async () => {
        i.deferred = true;
      },
      editReply: async (p) => {
        i.payload = p;
      },
      reply: async (p) => {
        i.error = p;
      },
      followUp: async (p) => {
        i.error = p;
      },
      showModal: async (modal) => {
        i.modal = modal.toJSON();
      },
    };
    await flow.handle(i);
    return i;
  };
  return { get: () => saved, run, published };
}
test("drop workflow searches registry, confirms quantity against a stable row and publishes canonical item IDs", async () => {
  const f = fixture();
  await f.run("reviewLoot");
  assert.equal(f.get().step, "lootReview");
  await f.run("lootPick", ["registry"]);
  assert.equal(
    renderDraft(f.get()).components[0].components[0].options[0].value,
    "search",
  );
  const search = await f.run("lootPick", ["search"]);
  assert.ok(search.modal);
  assert.equal(search.deferred, undefined);
  await f.run("lootQuery", [], "коготь");
  assert.equal(
    renderDraft(f.get()).components[0].components[0].options.length,
    2,
  );
  const selection = await f.run("lootPick", [drops[1].id]);
  assert.ok(selection.modal.custom_id.length <= 100);
  const action = selection.modal.custom_id.split(":").slice(2).join(":");
  const bad = await f.run(action, [], "1.5");
  assert.ok(bad.error);
  assert.equal(f.get().loot.unresolved.length, 1);
  await f.run(action, [], "4");
  assert.equal(f.get().loot.items[0].quantity, 4);
  assert.equal(f.get().loot.items[0].version, 2);
  assert.equal(f.get().loot.unresolved.length, 0);
  await f.run("backreview");
  await f.run("confirm");
  assert.equal(f.get().step, "confirm");
  await f.run("publish");
  assert.equal(f.published.length, 1);
  assert.equal(f.published[0].activity.loot[0].id, drops[1].id);
  assert.equal(f.published[0].activity.loot[0].quantity, 4);
});
test("registry pagination, empty searches, add/remove and ownership stay within Discord limits", async () => {
  const f = fixture();
  f.get().catalog.drops = Array.from({ length: 60 }, (_, i) => ({
    id: randomUUID(),
    name: `Предмет ${String(i).padStart(2, "0")}`,
    price_units: "10000",
    version: 1,
  }));
  await f.run("reviewLoot");
  await f.run("lootPick", ["registry"]);
  assert.equal(
    renderDraft(f.get()).components[0].components[0].options.length,
    25,
  );
  await f.run("lootNext");
  assert.equal(f.get().lootSearchPage, 1);
  await f.run("lootQuery", [], "нет такого предмета");
  assert.equal(
    renderDraft(f.get()).components[0].components[0].options.length,
    1,
  );
  await f.run("lootAll");
  assert.equal(f.get().lootSearchQuery, "");
  const foreign = await f.run("addLoot", [], "", "other");
  assert.ok(foreign.error);
  await f.run("reviewLoot");
  await f.run("lootPick", ["skip"]);
  assert.equal(f.get().loot.unresolved.length, 0);
  await f.run("addLoot");
  assert.equal(f.get().loot.unresolved.length, 1);
  assert.equal(f.get().step, "lootSearch");
  for (const row of renderDraft(f.get()).components)
    assert.ok(row.components.length <= 5);
});

test("quantity forms remain tied to their original row even after focus changes", async () => {
  const f = fixture();
  await f.run("reviewLoot");
  const original = f.get().loot.readings[0].key;
  const modal = await f.run("lootPick", [drops[1].id]);
  await f.run("addLoot");
  const added = f.get().lootFocusKey;
  await f.run(modal.modal.custom_id.split(":").slice(2).join(":"), [], "8");
  assert.equal(
    f.get().loot.readings.find((r) => r.key === original).quantity,
    8,
  );
  assert.equal(
    f.get().loot.readings.find((r) => r.key === added).pending,
    true,
  );
  await f.run("lootFocus", [original]);
  await f.run("lootPick", ["skip"]);
  const stale = await f.run(
    modal.modal.custom_id.split(":").slice(2).join(":"),
    [],
    "9",
  );
  assert.ok(stale.error);
  assert.equal(f.get().loot.items.length, 0);
});

test("similar loot handles several OCR errors, mixed alphabets and unique long clipped prefixes", () => {
  for (const raw of [
    "Трофеиная эссенцня стихии x2",
    "Тpофейная эcсенция cтихий x2",
    "Трофейная эссенция… x2",
  ]) {
    const result = recognizeLoot(raw, drops);
    assert.equal(result.items[0]?.id, drops[0].id, raw);
    assert.equal(result.items[0].quantity, 2);
    assert.equal(result.readings[0].status, "автосопоставлено");
    assert.equal(result.readings[0].raw, raw);
  }
  const ambiguous = [...drops, { id: "fire", name: "Трофейная эссенция огня" }];
  assert.equal(
    recognizeLoot("Трофейная эссенция… x2", ambiguous).unresolved.length,
    1,
  );
  assert.equal(
    recognizeLoot("Трофеиная эссенцня стихии", drops).items.length,
    0,
  );
});
test("older pending loot auto-matches on review without losing row identity, corrections or roster-only intent", () => {
  const raw = "Трофеиная эссенцня стихии x2";
  const d = {
    catalog: { drops },
    screensOnly: true,
    rosterOnly: true,
    lootImageResults: { image: raw },
    loot: {
      items: [],
      unresolved: [raw],
      readings: [
        {
          key: "old-row",
          raw,
          pending: true,
          quantity: 2,
          status: "требует проверки",
        },
        {
          key: "manual",
          raw: "Original",
          name: drops[1].name,
          itemId: drops[1].id,
          quantity: 4,
          pending: false,
          status: "подтверждён вручную",
        },
      ],
    },
  };
  refreshSimilarLoot(d);
  assert.equal(d.loot.readings[0].key, "old-row");
  assert.equal(d.loot.readings[0].raw, raw);
  assert.equal(d.loot.items.find((i) => i.id === drops[0].id).quantity, 2);
  assert.equal(d.loot.items.find((i) => i.id === drops[1].id).quantity, 4);
  assert.equal(d.rosterOnly, true);
  assert.deepEqual(d.loot.unresolved, []);
  const before = structuredClone(d);
  refreshSimilarLoot(d);
  assert.deepEqual(d, before);
});

test("received loot log strips damaged brackets, defaults single drops to one and keeps explicit quantities", () => {
  const names = [
    "Нарвиг, огненный клинок Морфеоса",
    "Каменное сердце Морфеоса",
    "Эссенция ярости",
    "Мелкий лунный жемчуг",
    "Фрагмент чертежа пиратского галеона",
    "Трофейная эссенция стихий",
    "Призма солнечного акхиума",
    "Эссенция солнечного акхиума",
    "Эссенция лунного акхиума",
    "Эссенция звездного акхиума",
  ];
  const registry = names.map((name, i) => ({ id: String(i), name }));
  const raw =
    "ДНЕЙ В NG\nПолучено: [Нарвиг, огненный клинок Морфеосаl\nПолучено: [Каменное сердце Морфеоса]\nПолучено: ]Эссенция ярости]\nПолучено: [Мелкий лунный жемчуг]\nПолучено: [Фрагмент чертежа пиратского галеона]\nПолучено: Трофейная эссенция стихий]х2\nПолучено: [Призма солнечного акхиума]x2\nПолучено: ]Эссенция солнечного акхиума]x2\nПолучено: [Эссенция лунного акхиума]x2\nПолучено: [Эссенция звездного акхиума]";
  const r = recognizeLoot(raw, registry);
  assert.equal(r.items.length, 10);
  assert.deepEqual(r.unresolved, []);
  assert.deepEqual(
    r.items.map((i) => i.quantity),
    [1, 1, 1, 1, 1, 2, 2, 2, 2, 1],
  );
  assert.equal(
    recognizeLoot("Получено: [Каменное сердце\nМорфеоса]", registry).items[0]
      .quantity,
    1,
  );
  assert.equal(
    recognizeLoot("Получено: [Эссенция ярости]xO", registry).items.length,
    0,
  );
  assert.equal(
    recognizeLoot("Получено: [Свиток опыта 2", registry).unresolved.length,
    1,
  );
  assert.equal(
    recognizeLoot("Получено: [Эссенция ярости x2000]", [
      { id: "pack", name: "Эссенция ярости x2000" },
    ]).items[0].quantity,
    1,
  );
});

test("unnumbered rage essence offers every catalogue pack size without selecting one or mixing pack count", () => {
  const sizes = [2000, 1000, 10000, 12500, 3000, 4500, 6000, 8000];
  const registry = sizes.map((n) => ({
    id: String(n),
    name: `Эссенция ярости х${n}`,
    version: 1,
    price_units: "10000",
  }));
  const result = recognizeLoot("Получено: [Эссенция ярости]x2", registry);
  assert.equal(result.items.length, 0);
  assert.equal(result.unresolved.length, 1);
  assert.deepEqual(
    result.readings[0].suggestions.map((i) => i.packSize),
    [1000, 2000, 3000, 4500, 6000, 8000, 10000, 12500],
  );
  const d = { catalog: { drops: registry }, loot: result };
  resolveLoot(d, result.readings[0].key, "1000", 2);
  assert.equal(d.loot.items[0].id, "1000");
  assert.equal(d.loot.items[0].quantity, 2);
  assert.equal(
    recognizeLoot("Получено: [Эссенция ярости х2000]x2", registry).items[0].id,
    "2000",
  );
  assert.equal(
    recognizeLoot("Получено: [Эссенция ярости]", [registry[0]]).items.length,
    0,
  );
});
test("existing disputed drafts refresh all pack choices, preserve raw text and fit Discord options", async () => {
  const f = fixture();
  const sizes = [1000, 2000, 3000, 4500, 6000, 8000, 10000, 12500];
  f.get().catalog.drops = sizes.map((n) => ({
    id: String(n),
    name: `Эссенция ярости х${n}`,
    version: 1,
    price_units: "10000",
  }));
  f.get().loot = {
    items: [],
    unresolved: ["Получено: [Эссенция ярости]"],
    readings: [
      {
        key: "pack",
        raw: "Получено: [Эссенция ярости]",
        quantity: 1,
        pending: true,
        suggestions: [],
      },
    ],
  };
  await f.run("reviewLoot");
  const menu = renderDraft(f.get()).components[1].components[0];
  assert.equal(menu.placeholder, "Выберите размер набора");
  assert.equal(menu.options.length, 10);
  assert.deepEqual(
    menu.options.slice(0, 8).map((i) => i.value),
    sizes.map(String),
  );
  const selected = await f.run("lootPick", ["2000"]);
  assert.equal(selected.modal.components[0].components[0].value, "1");
  await f.run(selected.modal.custom_id.split(":").slice(2).join(":"), [], "3");
  assert.equal(f.get().loot.items[0].quantity, 3);
  assert.equal(f.get().loot.items[0].id, "2000");
  assert.equal(f.get().loot.readings[0].raw, "Получено: [Эссенция ярости]");
});
