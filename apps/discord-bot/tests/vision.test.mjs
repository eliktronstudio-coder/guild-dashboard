import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draftStore } from "../src/store.mjs";
import {
  createVisionRecognizer,
  visionConfig,
  visionFailure,
  parseVision,
} from "../src/vision.mjs";
import { recognizeIndependentRoster } from "../src/recognition.mjs";
import { registeredMatch, readingSuggestions } from "../src/matching.mjs";
const env = { OPENAI_API_KEY: "mock-not-a-real-key" },
  now = Date.UTC(2026, 10, 12, 9);
const players = [
  {
    slot: 0,
    visible: "СмешанныйX",
    uncertain: false,
    truncated: false,
    group: 2,
  },
];
const response = {
  status: "completed",
  output_text: JSON.stringify({ players }),
  usage: { input_tokens: 100, output_tokens: 50 },
};
async function fixture(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "xd-vision-")),
    store = draftStore(dir);
  const buffer = await sharp({
    create: { width: 100, height: 40, channels: 3, background: "#235bad" },
  })
    .png()
    .toBuffer();
  let calls = 0,
    localCalls = [];
  const client = {
    responses: {
      create: async (body) => {
        calls++;
        assert.equal(body.model, "gpt-5.4-mini");
        assert.equal(body.text.format.strict, true);
        assert.ok(
          body.input[0].content
            .filter((x) => x.type === "input_image")
            .every((x) => x.detail === "original"),
        );
        return structuredClone(response);
      },
    },
  };
  const local = async (b, options) => {
    localCalls.push(options);
    return { words: [{ text: "local" }], text: "Дроп x2" };
  };
  const recognize = createVisionRecognizer({
    store,
    env,
    clock: () => now,
    client,
    local,
    regions: async () => ({
      boxes: [{ left: 0, top: 0, width: 100, height: 40 }],
    }),
    log: () => {},
    ...extra,
  });
  return {
    store,
    buffer,
    recognize,
    calls: () => calls,
    localCalls,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("Responses Vision uses originals, preserves visible names/group and caches pixels; loot stays local", async () => {
  const f = await fixture();
  try {
    const a = await f.recognize(f.buffer, {
      roster: true,
      loot: true,
      scope: "guild",
    });
    assert.equal(a.words[0].text, "СмешанныйX");
    assert.equal(a.words[0].group, 2);
    assert.equal(a.text, "Дроп x2");
    assert.equal(f.localCalls[0].roster, false);
    const differentlyEncoded = await sharp(f.buffer)
      .png({ compressionLevel: 0 })
      .toBuffer();
    await f.recognize(differentlyEncoded, { roster: true, scope: "guild" });
    assert.equal(f.calls(), 1);
    await f.recognize(f.buffer, { roster: true, scope: "other" });
    assert.equal(f.calls(), 2);
  } finally {
    f.close();
  }
});
test("missing key and loot-only do not contact OpenAI", async () => {
  const f = await fixture({ env: {} });
  try {
    const a = await f.recognize(f.buffer, { roster: true });
    assert.equal(a.engine, "tesseract");
    assert.match(a.notice, /не подключён/);
    await f.recognize(f.buffer, { roster: false, loot: true });
    assert.equal(f.calls(), 0);
  } finally {
    f.close();
  }
});
test("rate limits, timeouts and malformed output fall back without leaking SDK error text", async () => {
  for (const failure of [
    { status: 429, message: "private provider text" },
    { message: "timeout private" },
    null,
  ]) {
    const f = await fixture({
      client: {
        responses: {
          create: async () => {
            if (failure) throw failure;
            return { ...response, output_text: "invalid" };
          },
        },
      },
    });
    try {
      const r = await f.recognize(f.buffer, { roster: true });
      assert.equal(r.engine, "tesseract");
      assert.ok(!r.notice.includes("private"));
    } finally {
      f.close();
    }
  }
});
test("persistent daily/monthly limits and concurrency reserve before calls; cache is free", async () => {
  const f = await fixture();
  try {
    const config = { ...visionConfig(env, now), daily: 2 };
    const a = f.store.visionReserve("a", "1", config, now);
    const b = f.store.visionReserve("b", "2", config, now);
    assert.throws(
      () => f.store.visionReserve("c", "3", config, now),
      /GPT_BUSY/,
    );
    f.store.visionFinish(a.id, { result: players, costMicros: 100 }, now);
    assert.deepEqual(
      f.store.visionReserve("a", "1", config, now).cached,
      players,
    );
    assert.throws(
      () => f.store.visionReserve("c", "3", config, now),
      /GPT_DAILY_LIMIT/,
    );
    f.store.visionFinish(b.id, { error: "timeout" }, now);
    assert.throws(
      () =>
        f.store.visionReserve(
          "c",
          "3",
          { ...config, daily: 20, monthlyMicros: 1 },
          now,
        ),
      /GPT_MONTHLY_LIMIT/,
    );
    assert.throws(() =>
      visionConfig({ ...env, OPENAI_MONTHLY_BUDGET_USD: "NaN" }, now),
    );
    assert.throws(() =>
      visionConfig({ ...env, OPENAI_MONTHLY_BUDGET_USD: "6" }, now),
    );
  } finally {
    f.close();
  }
});
test("daily cap triggers clear free fallback before any API call", async () => {
  const f = await fixture({ env: { ...env, OPENAI_DAILY_LIMIT: "0" } });
  try {
    const r = await f.recognize(f.buffer, { roster: true });
    assert.match(r.notice, /Дневной лимит/);
    assert.equal(f.calls(), 0);
  } finally {
    f.close();
  }
});
test("retry sends only numbered disputed crops and preserves slot identity", async () => {
  let images;
  const f = await fixture({
    client: {
      responses: {
        create: async (body) => {
          images = body.input[0].content.filter(
            (c) => c.type === "input_image",
          );
          return response;
        },
      },
    },
  });
  try {
    const r = await f.recognize(f.buffer, {
      roster: true,
      retryCells: [
        {
          slotKey: "previous",
          box: { left: 0, top: 0, width: 100, height: 40 },
        },
      ],
    });
    assert.equal(images.length, 1);
    assert.equal(r.words[0].slotKey, "previous");
    assert.equal(f.localCalls.length, 0);
  } finally {
    f.close();
  }
});
test("strict schema rejects duplicated/invalid slots and incomplete outputs; omitted cells need review", () => {
  assert.throws(() => parseVision({ ...response, status: "incomplete" }, 1));
  assert.throws(() =>
    parseVision(
      {
        ...response,
        output_text: JSON.stringify({ players: [...players, ...players] }),
      },
      1,
    ),
  );
  assert.throws(() =>
    parseVision(
      {
        ...response,
        output_text: JSON.stringify({ players: [{ ...players[0], slot: 7 }] }),
      },
      1,
    ),
  );
  assert.equal(
    parseVision({ ...response, output_text: '{"players":[]}' }, 1)[0].uncertain,
    true,
  );
});
test("only exact canonical/registered aliases link IDs; confusables, cropped and uncertain require review", () => {
  const members = [
    { id: "1", nickname: "СмешанныйX", aliases: ["AltName"] },
    { id: "2", nickname: "CмешанныйX" },
  ];
  assert.equal(registeredMatch("altname", members).id, "1");
  assert.equal(registeredMatch("СмешанныйX", members).id, "1");
  const word = {
    text: "СмешанныйX",
    confidence: 96,
    line: "1",
    kind: "raid-cell",
    region: "1",
    engine: "gpt",
    unbiased: true,
  };
  assert.equal(recognizeIndependentRoster([word], members).members[0].id, "1");
  for (const change of [
    { clipped: true },
    { uncertain: true },
    { text: "СмешанныиX" },
  ])
    assert.equal(
      recognizeIndependentRoster([{ ...word, ...change }], members).members
        .length,
      0,
    );
  assert.ok(readingSuggestions({ visible: "СмешанныиX" }, members).length <= 3);
  assert.equal(
    registeredMatch("FooBar", [{ id: "3", nickname: "Foo-Bar" }]),
    null,
  );
});

test("provider failures have actionable safe categories without exposing SDK messages", () => {
  const failures = [
    [
      { status: 403, code: "unsupported_country_region_territory" },
      "GPT_REGION_FORBIDDEN",
    ],
    [{ status: 401 }, "GPT_AUTH"],
    [{ status: 403 }, "GPT_AUTH"],
    [{ status: 429, code: "insufficient_quota" }, "GPT_QUOTA"],
    [{ status: 429 }, "GPT_RATE_LIMIT"],
    [{ name: "APIConnectionTimeoutError" }, "GPT_TIMEOUT"],
    [{ status: 400 }, "GPT_INVALID_REQUEST"],
    [{ status: 404 }, "GPT_MODEL_UNAVAILABLE"],
    [{ status: 500 }, "GPT_ERROR"],
  ];
  for (const [error, code] of failures)
    assert.equal(
      visionFailure({ ...error, message: "private SDK details" }),
      code,
    );
});
test("region rejection explains VPS restriction, uses Tesseract, and makes no automatic inference retry", async () => {
  let calls = 0;
  const logs = [];
  const f = await fixture({
    client: {
      responses: {
        create: async () => {
          calls++;
          throw {
            status: 403,
            code: "unsupported_country_region_territory",
            message: "private SDK details",
          };
        },
      },
    },
    log: (text) => logs.push(text),
  });
  try {
    const result = await f.recognize(f.buffer, { roster: true });
    assert.equal(result.engine, "tesseract");
    assert.match(result.notice, /региону сервера/);
    assert.match(result.notice, /403/);
    assert.equal(calls, 1);
    assert.ok(logs.some((line) => line.includes("GPT_REGION_FORBIDDEN")));
    assert.ok(logs.every((line) => !line.includes("private")));
  } finally {
    f.close();
  }
});

test("remote mode works without worker OpenAI key and keeps durable caching and token costs", async () => {
  let calls = 0;
  const remoteEnv = {
    VISION_SERVICE_URL: "https://test.onrender.com",
    VISION_SERVICE_SECRET: "test-secret-".repeat(4),
  };
  const f = await fixture({
    env: remoteEnv,
    remoteClient: () => async (payload, timeout) => {
      calls++;
      assert.equal(timeout, 120000);
      assert.equal(payload.slots, 1);
      assert.ok(payload.requestId);
      assert.ok(
        payload.images.every((i) => i.startsWith("data:image/png;base64,")),
      );
      assert.ok(!JSON.stringify(payload).includes("mock-not-a-real-key"));
      return response;
    },
  });
  try {
    const r = await f.recognize(f.buffer, { roster: true });
    assert.equal(r.engine, "gpt");
    await f.recognize(f.buffer, { roster: true });
    assert.equal(calls, 1);
    assert.equal(f.calls(), 0);
  } finally {
    f.close();
  }
});
test("misconfigured remote does not fall through to direct OpenAI or reserve a paid attempt", async () => {
  const f = await fixture({
    env: { ...env, VISION_SERVICE_URL: "https://private.invalid" },
  });
  try {
    const r = await f.recognize(f.buffer, { roster: true });
    assert.equal(r.engine, "tesseract");
    assert.match(r.notice, /ещё не настроен/);
    assert.equal(f.calls(), 0);
  } finally {
    f.close();
  }
});
test("remote provider regional and quota codes retain actionable fallback categories", async () => {
  const f = await fixture({
    env: { VISION_SERVICE_URL: "https://test.onrender.com" },
    remoteClient: () => async () => {
      throw {
        message: "REMOTE_ERROR",
        status: 403,
        code: "unsupported_country_region_territory",
      };
    },
  });
  try {
    const r = await f.recognize(f.buffer, { roster: true });
    assert.match(r.notice, /региону сервера/);
  } finally {
    f.close();
  }
});


test("missing local panels send original image to GPT once, cache it, and require manual review", async () => {
  const f = await fixture({ regions: async () => ({ boxes: [] }) });
  try {
    const result = await f.recognize(f.buffer, { roster: true, scope: "whole" });
    assert.equal(result.engine, "gpt");
    assert.match(result.notice, /по исходному изображению/);
    assert.equal(result.words.length, 1);
    assert.equal(result.words[0].text, "СмешанныйX");
    assert.equal(result.words[0].uncertain, true);
    assert.equal(result.words[0].box, undefined);
    assert.ok(result.words[0].slotKey);
    assert.equal(f.calls(), 1);
    assert.equal(f.localCalls.length, 0);
    const cached = await f.recognize(f.buffer, { roster: true, scope: "whole" });
    assert.equal(f.calls(), 1);
    assert.deepEqual(cached.words, result.words);
    const roster = recognizeIndependentRoster(result.words, [{ id: "member", nickname: "СмешанныйX" }]);
    assert.equal(roster.readings[0].pending, true);
  } finally { f.close(); }
});
test("whole-image response has no synthetic blank slots and rejects duplicate slot ids", () => {
  assert.equal(parseVision(response, 150, true).length, 1);
  assert.equal(parseVision({ ...response, output_text: '{"players":[]}' }, 150, true).length, 0);
  assert.throws(() => parseVision({ ...response, output_text: JSON.stringify({ players: [players[0], players[0]] }) }, 150, true));
});
test("whole-image request keeps budget protection and free fallback on provider failure", async () => {
  const f = await fixture({ regions: async () => ({ boxes: [] }), client: { responses: { create: async () => { throw { status: 429 }; } } } });
  try {
    const result = await f.recognize(f.buffer, { roster: true });
    assert.match(result.notice, /лимит частоты/);
    assert.equal(f.localCalls.length, 1);
  } finally { f.close(); }
});

test("tiny unsegmented roster supplies original plus enlarged view without a second paid call", async () => {
  let calls=0;
  const f=await fixture({regions:async()=>({boxes:[]}), client:{responses:{create:async(body)=>{
    calls++;
    assert.match(body.instructions,/preserving repeated syllables/);
    const images=body.input[0].content.filter(v=>v.type==='input_image');
    assert.equal(images.length,2);
    const metadata=await Promise.all(images.map(v=>sharp(Buffer.from(v.image_url.split(',')[1],'base64')).metadata()));
    assert.equal(metadata[0].width,100);
    assert.equal(metadata[1].width,400);
    return structuredClone(response);
  }}}});
  try{
    await f.recognize(f.buffer,{roster:true});
    await f.recognize(f.buffer,{roster:true});
    assert.equal(calls,1);
  }finally{f.close();}
});
