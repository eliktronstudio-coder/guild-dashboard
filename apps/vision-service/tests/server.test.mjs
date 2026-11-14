import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createVisionServer } from "../src/server.mjs";
import {
  signVisionRequest,
  remoteVisionClient,
} from "../../discord-bot/src/vision-remote.mjs";
const secret = "test-only-not-a-real-secret-".repeat(2),
  now = Date.now();
const env = { OPENAI_API_KEY: "mock-key", VISION_SERVICE_SECRET: secret };
const input = {
  version: 1,
  model: "gpt-5.4-mini",
  slots: 1,
  maxOutput: 8192,
  retry: false,
  images: ["data:image/png;base64," + "A".repeat(80)],
};
const reply = {
  status: "completed",
  output_text: JSON.stringify({
    players: [
      {
        slot: 0,
        visible: "ИгрокX",
        uncertain: false,
        truncated: false,
        group: 1,
      },
    ],
  }),
  usage: { input_tokens: 100, output_tokens: 50 },
};
async function setup(create = async () => reply) {
  let calls = 0,
    models = 0;
  const client = {
    responses: {
      create: async (body, options) => {
        calls++;
        assert.equal(body.store, false);
        assert.equal(options.maxRetries, 0);
        assert.equal(body.input[0].content[1].detail, "original");
        return create(body);
      },
    },
    models: {
      retrieve: async () => {
        models++;
        return { id: input.model };
      },
    },
  };
  const server = createVisionServer({
    env,
    client,
    clock: () => now,
    log: () => {},
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = "http://127.0.0.1:" + server.address().port;
  function post(value = input, id = randomUUID(), change = {}) {
    const body = JSON.stringify(value),
      timestamp = String(now);
    return fetch(url + "/v1/roster", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + secret,
        "X-XD-Timestamp": timestamp,
        "X-XD-Request-Id": id,
        "X-XD-Signature": signVisionRequest(secret, timestamp, id, body),
        ...change,
      },
      body,
    });
  }
  return {
    url,
    post,
    calls: () => calls,
    models: () => models,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
test("health is free; readiness requires authentication and uses model metadata only", async () => {
  const f = await setup();
  try {
    const health = await fetch(f.url + "/health");
    assert.equal(health.status, 200);
    assert.deepEqual((await health.json()).capabilities, ["whole-image-roster"]);
    assert.equal((await fetch(f.url + "/ready")).status, 401);
    assert.equal(
      (
        await fetch(f.url + "/ready", {
          headers: { Authorization: "Bearer " + secret },
        })
      ).status,
      200,
    );
    assert.equal(f.calls(), 0);
    assert.equal(f.models(), 1);
  } finally {
    await f.close();
  }
});
test("authenticated signed roster reaches official Responses contract; duplicate request is free", async () => {
  const f = await setup();
  try {
    const id = randomUUID();
    assert.equal((await f.post(input, id)).status, 200);
    assert.equal((await f.post(input, id)).status, 200);
    assert.equal(f.calls(), 1);
    const result = await (await f.post(input, id)).json();
    assert.equal(JSON.parse(result.output_text).players[0].visible, "ИгрокX");
    assert.equal((await f.post({ ...input, slots: 2 }, id)).status, 409);
    assert.equal(f.calls(), 1);
  } finally {
    await f.close();
  }
});
test("rejects bad credentials, altered signatures, stale timestamps and arbitrary prompts before inference", async () => {
  const f = await setup();
  try {
    for (const headers of [
      { Authorization: "Bearer wrong" },
      { "X-XD-Signature": "wrong" },
      { "X-XD-Timestamp": String(now - 600000) },
    ])
      assert.equal((await f.post(input, randomUUID(), headers)).status, 401);
    for (const value of [
      { ...input, prompt: "arbitrary" },
      { ...input, model: "other" },
      { ...input, slots: 151 },
      { ...input, images: ["https://internal.example/image"] },
      { ...input, maxOutput: 50000 },
    ])
      assert.equal((await f.post(value)).status, 400);
    assert.equal(f.calls(), 0);
  } finally {
    await f.close();
  }
});
test("upstream error is sanitized and keeps provider category without SDK message or image", async () => {
  const f = await setup(async () => {
    throw {
      status: 403,
      code: "unsupported_country_region_territory",
      message: "secret provider debug",
    };
  });
  try {
    const r = await f.post();
    assert.equal(r.status, 502);
    const text = await r.text();
    assert.match(text, /unsupported_country_region_territory/);
    assert.ok(!text.includes("secret provider debug"));
  } finally {
    await f.close();
  }
});
test("concurrent duplicate shares one inference and third concurrent request is rejected", async () => {
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const f = await setup(async () => {
    await waiting;
    return reply;
  });
  try {
    const id = randomUUID();
    const a = f.post(input, id),
      b = f.post(input, id),
      c = f.post(input, randomUUID());
    while (f.calls() < 2) await new Promise((r) => setTimeout(r, 5));
    assert.equal((await f.post()).status, 429);
    release();
    assert.ok((await Promise.all([a, b, c])).every((r) => r.status === 200));
    assert.equal(f.calls(), 2);
  } finally {
    release();
    await f.close();
  }
});
test("server secondary daily cap stops a twenty-first inference", async () => {
  const f = await setup();
  try {
    for (let i = 0; i < 20; i++) assert.equal((await f.post()).status, 200);
    const r = await f.post();
    assert.equal(r.status, 429);
    assert.equal((await r.json()).error.code, "GPT_DAILY_LIMIT");
    assert.equal(f.calls(), 20);
  } finally {
    await f.close();
  }
});
test("worker transport uses service secret, validates host, never forwards OpenAI key, and classifies provider errors", async () => {
  assert.throws(
    () =>
      remoteVisionClient({
        VISION_SERVICE_URL: "http://example.onrender.com",
        VISION_SERVICE_SECRET: secret,
      }),
    /GPT_SERVICE_CONFIG/,
  );
  assert.throws(
    () =>
      remoteVisionClient({
        VISION_SERVICE_URL: "https://example.onrender.com@attacker.example",
        VISION_SERVICE_SECRET: secret,
      }),
    /GPT_SERVICE_CONFIG/,
  );
  const request = remoteVisionClient(
    {
      VISION_SERVICE_URL: "https://example.onrender.com",
      VISION_SERVICE_SECRET: secret,
      OPENAI_API_KEY: "must-not-leave-worker",
    },
    {
      clock: () => now,
      fetchImpl: async (url, options) => {
        assert.equal(url.href, "https://example.onrender.com/v1/roster");
        assert.equal(options.redirect, "error");
        assert.ok(!JSON.stringify(options).includes("must-not-leave-worker"));
        assert.equal(
          options.headers["X-XD-Signature"],
          signVisionRequest(
            secret,
            String(now),
            options.headers["X-XD-Request-Id"],
            options.body,
          ),
        );
        return new Response(
          JSON.stringify({
            error: {
              status: 403,
              code: "unsupported_country_region_territory",
            },
          }),
          { status: 502 },
        );
      },
    },
  );
  await assert.rejects(
    request({ ...input, requestId: randomUUID() }, 1000),
    (error) =>
      error.status === 403 &&
      error.code === "unsupported_country_region_territory" &&
      error.message !== "GPT_ERROR",
  );
});

test("unknown upstream failures keep conservative reserves and stop at monthly ceiling", async () => {
  const f = await setup(async () => {
    throw Error("lost response");
  });
  try {
    for (let i = 0; i < 14; i++) assert.equal((await f.post()).status, 502);
    const r = await f.post();
    assert.equal(r.status, 429);
    assert.equal((await r.json()).error.code, "GPT_MONTHLY_LIMIT");
    assert.equal(f.calls(), 14);
  } finally {
    await f.close();
  }
});

test("signed whole-image mode finds variable roster length without numbered crops", async () => {
  const f = await setup(async (body) => {
    assert.match(body.input[0].content[0].text, /no numbered crops/);
    assert.match(body.instructions, /Do not transcribe chat/);
    return reply;
  });
  try {
    const r = await f.post({ ...input, slots: 150, wholeImage: true });
    assert.equal(r.status, 200);
    assert.equal(f.calls(), 1);
    assert.equal((await r.json()).output_text, reply.output_text);
    assert.equal((await f.post({ ...input, slots: 150, wholeImage: true, retry: true })).status, 400);
    assert.equal(f.calls(), 1);
  } finally { await f.close(); }
});
