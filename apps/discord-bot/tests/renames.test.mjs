import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseRename,
  automaticRenames,
  RENAME_CHANNEL,
} from "../src/renames.mjs";
test("rename syntax requires one explicit pair and never guesses nicknames", () => {
  for (const divider of ["-", "—", "→", "->"])
    assert.deepEqual(parseRename(`Стакистаки ${divider} Мэт`), {
      oldName: "Стакистаки",
      newName: "Мэт",
    });
  for (const value of [
    "привет",
    "Лиса - Ронин - Страж",
    "a - b",
    "Лиса\nМэт",
    "Лиса - Лиса",
  ])
    assert.equal(parseRename(value), null);
  assert.deepEqual(parseRename("One-Name - Next_Name"), {
    oldName: "One-Name",
    newName: "Next_Name",
  });
});
test("rename reactions follow committed API result; other channels and bots ignored", async () => {
  const calls = [],
    reactions = [];
  let fail = false;
  const handle = automaticRenames({
    server: () => "123",
    site: async (...args) => {
      calls.push(args);
      if (fail) throw Error("NO");
    },
  });
  const message = {
    id: "111",
    guildId: "123",
    channelId: RENAME_CHANNEL,
    author: { id: "222", bot: false },
    content: "Стакистаки - Мэт",
    react: async (x) => reactions.push(x),
  };
  await handle({ ...message, channelId: "other" });
  await handle({ ...message, author: { bot: true } });
  assert.equal(calls.length, 0);
  await handle(message);
  assert.deepEqual(reactions, ["✅"]);
  assert.equal(calls[0][0], "rename");
  assert.equal(calls[0][1].oldName, "Стакистаки");
  fail = true;
  await handle(message);
  assert.equal(reactions.at(-1), "❌");
  await handle({ ...message, content: "ошибка" });
  assert.equal(calls.length, 2);
  assert.equal(reactions.at(-1), "❌");
});
