import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { refineRosterWords, raidLabelSheets } from "../src/ocr.mjs";
import { recognizeIndependentRoster } from "../src/recognition.mjs";
import { readingSuggestions } from "../src/matching.mjs";
const members = [
  { id: "1", nickname: "Kuzik" },
  { id: "2", nickname: "Ронин" },
];
const words = (region, text) =>
  ["gray", "white"].map((variant) => ({
    kind: "raid-cell",
    region: String(region),
    slotKey: "slot-" + region,
    imageKey: "image",
    pass: variant + ":rus+eng",
    line: variant + region,
    text,
    confidence: 90,
    unbiased: true,
  }));
async function sheets() {
  const image = await sharp({
    create: { width: 640, height: 176, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  return ["gray", "white"].map((variant) => ({
    image,
    variant,
    start: 0,
    count: 2,
  }));
}
test("single-cell retries preserve identity, do not reread good cells, and recover an independently read registered nickname", async () => {
  const original = [...words(0, "Kuzlk"), ...words(1, "Ронин")];
  let calls = 0;
  const result = await refineRosterWords(original, await sheets(), {
    members,
    maxCells: 1,
    read: async (image, options) => {
      calls++;
      assert.equal(options.psm, 7);
      assert.equal(options.dictionary, undefined);
      assert.equal((await sharp(image).metadata()).height, 88);
      return [{ text: "Kuzik", confidence: 96, left: 10 }];
    },
  });
  assert.equal(calls, 2);
  assert.equal(original.length, 4);
  assert.equal(result.length, 6);
  assert.ok(
    result
      .slice(4)
      .every(
        (w) => w.slotKey === "slot-0" && w.imageKey === "image" && w.unbiased,
      ),
  );
  assert.deepEqual(
    new Set(
      recognizeIndependentRoster(result, members).members.map((m) => m.id),
    ),
    new Set(["1", "2"]),
  );
});
test("retry timeouts or exhausted budgets preserve all primary OCR observations", async () => {
  const original = words(0, "Kuzlk");
  let calls = 0;
  const failed = await refineRosterWords(original, await sheets(), {
    members,
    read: async () => {
      calls++;
      throw Error("OCR_TIMEOUT");
    },
  });
  assert.deepEqual(failed, original);
  assert.equal(calls, 2);
  await refineRosterWords(original, await sheets(), {
    members,
    deadline: Date.now(),
    read: async () => {
      throw Error("MUST_NOT_RUN");
    },
  });
});
test("soft white-text extraction retains faint antialiased letters below the old hard threshold", async () => {
  const labels = [5, 70, 135]
    .map(
      (x) =>
        `<rect x="${x}" y="5" width="55" height="25" fill="#2896d2"/><text x="${x + 3}" y="17" fill="#919191" font-family="sans-serif" font-size="10">Ронин</text>`,
    )
    .join("");
  const input = await sharp(
    Buffer.from(
      `<svg width="220" height="45" xmlns="http://www.w3.org/2000/svg"><rect width="220" height="45" fill="#302820"/>${labels}</svg>`,
    ),
  )
    .png()
    .toBuffer();
  const { sheets: result } = await raidLabelSheets(input);
  const white = result.find((s) => s.variant === "white");
  assert.ok(white);
  const stats = await sharp(white.image).stats();
  assert.ok(
    stats.channels[0].min < 80,
    "faint glyphs must remain visible to OCR",
  );
});
test("review hints use every OCR alternative, not just the strongest but incorrect reading", () => {
  const hints = readingSuggestions(
    { visible: "NothingUseful", variants: ["Ронин", "Kuzlk"] },
    members,
  );
  assert.equal(hints[0].nickname, "Ронин");
  assert.ok(hints.some((m) => m.nickname === "Kuzik"));
});
test("near-registry OCR errors, very short guests and dictionary-only guesses stay pending", () => {
  const near = recognizeIndependentRoster(words(0, "Kuzlk"), members);
  assert.deepEqual(near.guests, []);
  assert.equal(near.unresolved.length, 1);
  const short = recognizeIndependentRoster(words(0, "See"), []);
  assert.equal(short.unresolved.length, 1);
  const biased = recognizeIndependentRoster(
    words(0, "Kuzik").map((w) => ({ ...w, unbiased: false })),
    members,
  );
  assert.equal(biased.members.length, 0);
  assert.equal(biased.unresolved.length, 1);
});
