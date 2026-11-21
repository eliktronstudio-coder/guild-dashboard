import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draftStore } from "../src/store.mjs";
import { createVisionRecognizer } from "../src/vision.mjs";
import { parseLootVision } from "../src/loot-vision-protocol.mjs";
import {
  recognizeVisionLoot,
  resolveLoot,
  refreshSimilarLoot,
} from "../src/loot-review.mjs";

const items = [
  { slot: 0, visible: "Эссенция ярости", quantity: 1, uncertain: false },
  { slot: 1, visible: "Эссенция ярости", quantity: 2, uncertain: false },
];
const response = {
  status: "completed",
  output_text: JSON.stringify({ items }),
  usage: { input_tokens: 120, output_tokens: 80 },
};
async function fixture(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "xd-loot-gpt-")),
    store = draftStore(dir);
  const image = await sharp({
    create: { width: 120, height: 50, channels: 3, background: "#222" },
  })
    .png()
    .toBuffer();
  let calls = 0;
  const client = {
    responses: {
      create: async (body) => {
        calls++;
        assert.equal(body.text.format.name, "activity_loot");
        assert.equal(body.text.format.strict, true);
        assert.ok(
          body.input[0].content
            .filter((i) => i.type === "input_image")
            .every((i) => i.detail === "original"),
        );
        return structuredClone(response);
      },
    },
  };
  const recognize = createVisionRecognizer({
    store,
    env: { OPENAI_API_KEY: "mock" },
    client,
    log: () => {},
    local: () => {
      throw Error("LOCAL_OCR_MUST_NEVER_RUN");
    },
    ...extra,
  });
  return {
    store,
    image,
    recognize,
    calls: () => calls,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("GPT reads loot directly with originals and enlargements, preserves occurrences and caches identical pixels", async () => {
  const f = await fixture();
  try {
    const a = await f.recognize(f.image, { loot: true, scope: "guild" });
    assert.equal(a.engine, "gpt");
    assert.equal(a.lootItems.length, 2);
    assert.equal(a.lootItems[0].quantity, 1);
    assert.equal(a.lootItems[1].quantity, 2);
    const reencoded = await sharp(f.image)
      .png({ compressionLevel: 0 })
      .toBuffer();
    const b = await f.recognize(reencoded, { loot: true, scope: "guild" });
    assert.deepEqual(a.lootItems, b.lootItems);
    assert.equal(f.calls(), 1);
  } finally {
    f.close();
  }
});
test("missing key, provider failures and exhausted budgets never invoke Tesseract or invent loot", async () => {
  for (const extra of [
    { env: {} },
    { env: { OPENAI_API_KEY: "mock", OPENAI_DAILY_LIMIT: "0" } },
    {
      client: {
        responses: {
          create: async () => {
            throw { status: 429, message: "private provider key body" };
          },
        },
      },
    },
  ]) {
    const f = await fixture(extra);
    try {
      const r = await f.recognize(f.image, { loot: true });
      assert.equal(r.failed, true);
      assert.equal(r.engine, "unavailable");
      assert.deepEqual(r.lootItems, []);
      assert.match(r.notice, /вручную/);
      assert.ok(!r.notice.includes("private"));
      assert.ok(!r.notice.includes("Tesseract"));
    } finally {
      f.close();
    }
  }
});
test("loot schema rejects invalid quantities, duplicate row identities and incomplete responses", () => {
  for (const change of [
    { status: "incomplete" },
    { output_text: "bad json" },
    { output_text: JSON.stringify({ items: [items[0], items[0]] }) },
    { output_text: JSON.stringify({ items: [{ ...items[0], quantity: 0 }] }) },
    {
      output_text: JSON.stringify({ items: [{ ...items[0], quantity: 1.2 }] }),
    },
  ])
    assert.throws(() => parseLootVision({ ...response, ...change }));
  assert.equal(
    parseLootVision({
      ...response,
      output_text: JSON.stringify({
        items: [{ ...items[0], quantity: null, uncertain: true }],
      }),
    })[0].quantity,
    null,
  );
});
test("separate occurrences select different pack IDs and unread quantities cannot be auto-confirmed", () => {
  const drops = [
    { id: "small", name: "Эссенция ярости х1000" },
    { id: "big", name: "Эссенция ярости х2000" },
  ];
  const loot = recognizeVisionLoot(
    items.map((i) => ({ ...i, sourceKey: "image" })),
    drops,
  );
  assert.equal(loot.unresolved.length, 2);
  assert.notEqual(loot.readings[0].key, loot.readings[1].key);
  const d = { catalog: { drops }, loot };
  resolveLoot(d, loot.readings[0].key, "small", 1);
  resolveLoot(d, loot.readings[1].key, "big", 2);
  assert.deepEqual(
    d.loot.items.map((i) => [i.id, i.quantity]),
    [
      ["small", 1],
      ["big", 2],
    ],
  );
  const pending = {
    catalog: { drops },
    loot: recognizeVisionLoot(
      [{ slot: 0, visible: drops[0].name, quantity: null, uncertain: false }],
      drops,
    ),
  };
  refreshSimilarLoot(pending);
  assert.equal(pending.loot.unresolved.length, 1);
  assert.equal(pending.loot.items.length, 0);
});
test("production entrypoint and image utilities have no local OCR import or subprocess dependency", () => {
  const entry = readFileSync(
      new URL("../src/index.mjs", import.meta.url),
      "utf8",
    ),
    images = readFileSync(
      new URL("../src/images.mjs", import.meta.url),
      "utf8",
    );
  assert.ok(!entry.includes("./ocr.mjs") && !entry.includes('"./ocr.mjs"'));
  assert.ok(
    !images.includes("node:child_process") && !images.includes("spawn("),
  );
});

test("roster and loot share the same durable paid-request budget while cached reads stay available", async () => {
  let calls = 0;
  const f = await fixture({
    env: { OPENAI_API_KEY: "mock", OPENAI_DAILY_LIMIT: "1" },
    regions: async () => ({ boxes: [] }),
    client: {
      responses: {
        create: async () => {
          calls++;
          return { ...response, output_text: JSON.stringify({ players: [] }) };
        },
      },
    },
  });
  try {
    assert.equal((await f.recognize(f.image, { roster: true })).engine, "gpt");
    const loot = await f.recognize(f.image, { loot: true });
    assert.equal(loot.failed, true);
    assert.match(loot.notice, /Дневной лимит/);
    assert.equal(calls, 1);
    assert.equal((await f.recognize(f.image, { roster: true })).engine, "gpt");
    assert.equal(calls, 1);
  } finally {
    f.close();
  }
});
