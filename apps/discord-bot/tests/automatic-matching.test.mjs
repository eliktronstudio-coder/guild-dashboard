import test from "node:test";
import assert from "node:assert/strict";
import { recognizeIndependentRoster } from "../src/recognition.mjs";
const recognize = (text, names, extra = {}) =>
  recognizeIndependentRoster(
    [
      {
        text,
        confidence: 96,
        engine: "gpt",
        kind: "raid-cell",
        slotKey: "one",
        unbiased: true,
        ...extra,
      },
    ],
    names.map((nickname, i) => ({ id: String(i), nickname })),
  );
test("clear isolated similar names and long unique prefixes auto-match without losing image text", () => {
  for (const [raw, nickname, extra] of [
    ["Potatoo", "Potatooo", {}],
    ["Cartell", "Cartelll", {}],
    ["Сертрал…", "Сертралин", { clipped: true }],
  ]) {
    const r = recognize(raw, [nickname], extra);
    assert.equal(r.members[0]?.nickname, nickname);
    assert.equal(r.unresolved.length, 0);
    assert.equal(r.readings[0].visible, raw.normalize("NFKC"));
    assert.equal(r.readings[0].origin, "automatic-similar");
    assert.equal(r.readings[0].status, "автосопоставлено");
  }
});
test("ambiguous candidates, poor readings and short prefixes stay unresolved", () => {
  for (const [raw, names, extra] of [
    ["Cartel", ["Cartell", "Cartelll"], {}],
    ["Сертрол_", ["Сертрал", "Сертралин"], { uncertain: true }],
    ["Cartell", ["Cartelll"], { confidence: 60 }],
    ["Cartell", ["Cartelll"], { uncertain: true }],
    ["Cartell", ["Cartelll"], { unbiased: false }],
    ["Cart…", ["Cartelll"], { clipped: true }],
    ["Cartell", ["Cartelll"], { engine: "tesseract" }],
  ]) {
    const r = recognize(raw, names, extra);
    assert.equal(r.members.length, 0);
    assert.equal(r.unresolved.length, 1);
  }
});

test("visual alphabet differences use the same skeleton for ranking and automatic acceptance", () => {
  const r = recognize("Pоtatoo", ["Potatooo"]); // Cyrillic о in a Latin name.
  assert.equal(r.members[0]?.nickname, "Potatooo");
  assert.equal(r.readings[0].origin, "automatic-similar");
  assert.equal(recognize("Pоtatoo", ["Potatoo", "Potatooo"]).members.length, 0);
});
test("current exact roster and rename aliases override stale remembered guest names", () => {
  const word = {
    text: "Слакислаки",
    confidence: 96,
    engine: "gpt",
    kind: "raid-cell",
    slotKey: "one",
    unbiased: true,
  };
  const r = recognizeIndependentRoster(
    [word],
    [{ id: "same-player", nickname: "Aniris", aliases: ["Слакислаки"] }],
    { recall: () => ({ name: "Слакислаки" }) },
  );
  assert.equal(r.members[0]?.id, "same-player");
  assert.equal(r.readings[0].name, "Aniris");
  assert.deepEqual(r.guests, []);
  const current = recognizeIndependentRoster(
    [{ ...word, text: "Aniris" }],
    [{ id: "same-player", nickname: "Aniris" }],
    { recall: () => ({ name: "Слакислаки" }) },
  );
  assert.equal(current.members[0]?.id, "same-player");
  assert.deepEqual(current.guests, []);
  const conflict = recognizeIndependentRoster(
    [word],
    [
      { id: "a", nickname: "FirstName", aliases: ["Слакислаки"] },
      { id: "b", nickname: "SecondName", aliases: ["Слакислаки"] },
    ],
  );
  assert.equal(conflict.members.length, 0);
  assert.equal(conflict.unresolved.length, 1);
});
