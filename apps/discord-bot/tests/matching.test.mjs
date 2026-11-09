import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rosterText,
  recognizeRoster,
  lootText,
  reviewReady,
} from "../src/matching.mjs";
const members = [
    { id: "1", nickname: "Kuzik" },
    { id: "2", nickname: "Ронин" },
    { id: "3", nickname: "Лиса" },
  ],
  drops = [
    { id: "a", name: "Коготь", price_units: "20000000", version: 1 },
    {
      id: "b",
      name: "Эссенция ярости x2000",
      price_units: "4000000",
      version: 1,
    },
  ];
test("OCR never silently accepts fuzzy/low-confidence names; explicit guest and correction resolve them", () => {
  const got = recognizeRoster(
    [
      { text: "Kuzik", confidence: 92, line: "1" },
      { text: "Ронин", confidence: 25, line: "2" },
      { text: "Kuzlk", confidence: 88, line: "3" },
      { text: "Маг", confidence: 98, line: "4" },
    ],
    members,
  );
  assert.deepEqual(
    got.members.map((m) => m.id),
    ["1"],
  );
  assert.deepEqual(got.unresolved, ["Kuzlk"]);
  const corrected = rosterText("Kuzik\nРонин\nгость: Новый\n? Лиса", members);
  assert.deepEqual(
    corrected.members.map((m) => m.id),
    ["1", "2"],
  );
  assert.deepEqual(corrected.guests, ["Новый"]);
  assert.deepEqual(corrected.unresolved, ["Лиса"]);
});
test("loot quantities do not confuse named essence packs, duplicate rows merge and unknown lines block review", () => {
  const got = lootText(
    "Получено: [Коготь]x2\nКоготь х3\nЭссенция ярости x2000\nЭссенция ярости x2000 x2\nНеизвестный x5",
    drops,
  );
  assert.deepEqual(
    got.items.map((i) => [i.id, i.quantity]),
    [
      ["a", 5],
      ["b", 3],
    ],
  );
  assert.deepEqual(got.unresolved, ["Неизвестный x5"]);
  assert.equal(lootText("Коготь x0", drops).items.length, 0);
  assert.equal(lootText("? Коготь", drops).items.length, 0);
  assert.equal(
    reviewReady({
      activity: {},
      mode: "raid",
      source: "prime",
      analyzed: true,
      roster: { members: [{}], unresolved: [] },
      loot: { unresolved: ["?"] },
    }),
    false,
  );
});
