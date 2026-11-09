import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { draftStore } from "../src/store.mjs";
import {
  recognizeIndependentRoster,
  manuallyReadRoster,
} from "../src/recognition.mjs";
const words = (image = "image-a", slot = "slot-a", text = "ClippedNa...") =>
  ["gray:rus+eng", "white:eng"].map((pass) => ({
    kind: "raid-cell",
    region: "0",
    imageKey: image,
    slotKey: slot,
    text,
    confidence: 95,
    pass,
    line: pass,
    unbiased: pass === "gray:rus+eng",
    clipped: text.endsWith("..."),
  }));
test("reading names does not depend on website membership and never fabricates account IDs", () => {
  const r = recognizeIndependentRoster(words("a", "a", "GuestFox"), []);
  assert.equal(r.members.length, 0);
  assert.deepEqual(r.guests, ["GuestFox"]);
  assert.equal(r.readings[0].visible, "GuestFox");
  assert.equal(r.readings[0].memberId, null);
  const clipped = recognizeIndependentRoster(words(), []);
  assert.equal(clipped.guests.length, 0);
  assert.equal(clipped.unresolved.length, 1);
  assert.equal(clipped.readings[0].visible, "ClippedNa...");
  const manual = manuallyReadRoster(
    "NewPlayer\n? CheckThis\nгость: Visitor",
    [],
  );
  assert.deepEqual(manual.guests, ["NewPlayer", "Visitor"]);
  assert.deepEqual(manual.unresolved, ["CheckThis"]);
});
test("confirmed names persist across restarts; an exact corrected image is remembered without needing a website account", () => {
  const dir = mkdtempSync(join(tmpdir(), "xd-names-"));
  let store = draftStore(dir);
  try {
    const reading = recognizeIndependentRoster(words(), []).readings[0];
    assert.equal(store.recallNickname("guild-a", reading).name, undefined);
    store.put({ id: "legacy", message: "preserved" });
    const confirmation = {
      scope: "guild-a",
      id: "manual-a",
      source: "message-a",
      actor: "user-a",
      names: ["ClippedNameFull"],
      corrections: [
        {
          key: reading.key,
          imageKey: reading.imageKey,
          name: "ClippedNameFull",
          variants: reading.variants,
        },
      ],
    };
    assert.equal(store.rememberNicknames(confirmation), true);
    assert.equal(store.rememberNicknames(confirmation), false);
    store.close();
    store = draftStore(dir);
    assert.equal(store.get("legacy").message, "preserved");
    const r = recognizeIndependentRoster(words(), [], {
      recall: (reading) => store.recallNickname("guild-a", reading),
    });
    assert.deepEqual(r.guests, ["ClippedNameFull"]);
    assert.equal(r.readings[0].origin, "memory");
    assert.deepEqual(store.knownNicknames("guild-a"), ["ClippedNameFull"]);
    assert.deepEqual(store.knownNicknames("other-guild"), []);
    assert.equal(store.recallNickname("other-guild", reading).name, undefined);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
test("repeated copies do not create independent training evidence, conflicts stay ambiguous and forgetting removes the bad mapping", () => {
  const dir = mkdtempSync(join(tmpdir(), "xd-aliases-")),
    store = draftStore(dir);
  try {
    const add = (id, image, name = "CorrectName") =>
      store.rememberNicknames({
        scope: "guild",
        id,
        source: id,
        actor: "human",
        names: [name],
        corrections: [
          {
            key: "slot-" + id,
            imageKey: image,
            name,
            variants: ["CorrcctName"],
          },
        ],
      });
    const reading = {
      key: "new-slot",
      imageKey: "new-image",
      visible: "CorrcctName",
      confidence: 90,
      variants: ["CorrcctName"],
    };
    add("a", "image-one");
    add("a-copy", "image-one");
    assert.equal(store.recallNickname("guild", reading).name, undefined);
    add("b", "image-two");
    assert.equal(store.recallNickname("guild", reading).name, "CorrectName");
    add("c", "image-three", "DifferentName");
    assert.equal(store.recallNickname("guild", reading).conflict, true);
    assert.equal(store.forgetNickname("guild", "DifferentName"), true);
    assert.equal(store.recallNickname("guild", reading).name, "CorrectName");
    assert.equal(store.nicknameMemoryStats("guild").names, 1);
    assert.equal(store.forgetNickname("guild", "CorrectName"), true);
    assert.equal(store.recallNickname("guild", reading).name, undefined);
    assert.equal(store.nicknameMemoryStats("guild").examples, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
