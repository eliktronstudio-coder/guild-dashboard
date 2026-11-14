import { createServer } from "node:http";
import { timingSafeEqual, createHash } from "node:crypto";
import OpenAI from "openai";
import {
  visionRequest,
  parseVision,
} from "../../discord-bot/src/vision-protocol.mjs";
import { signVisionRequest } from "../../discord-bot/src/vision-remote.mjs";

const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const safeCode = (error) =>
  [
    "unsupported_country_region_territory",
    "insufficient_quota",
    "billing_hard_limit_reached",
  ].includes(error?.code)
    ? error.code
    : "GPT_ERROR";
const usageOf = (response) => {
  const u = response?.usage;
  return Number.isSafeInteger(u?.input_tokens) &&
    u.input_tokens >= 0 &&
    Number.isSafeInteger(u?.output_tokens) &&
    u.output_tokens >= 0
    ? { input_tokens: u.input_tokens, output_tokens: u.output_tokens }
    : null;
};
function validInput(data) {
  return (
    data &&
    data.version === 1 &&
    /^gpt-5\.4-mini(?:-2026-03-17)?$/.test(data.model) &&
    Number.isInteger(data.maxOutput) &&
    data.maxOutput >= 512 &&
    data.maxOutput <= 16384 &&
    Number.isInteger(data.slots) &&
    data.slots >= 1 &&
    data.slots <= 150 &&
    typeof data.retry === "boolean" &&
    (data.wholeImage === undefined || (data.wholeImage === true && data.retry === false && data.slots === 150 && data.images?.length === 1)) &&
    Array.isArray(data.images) &&
    data.images.length >= 1 &&
    data.images.length <= 7 &&
    data.images.every(
      (x) =>
        typeof x === "string" &&
        x.length > 40 &&
        /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(x),
    ) &&
    Object.keys(data).every((k) =>
      ["version", "model", "maxOutput", "slots", "retry", "images", "wholeImage"].includes(k),
    )
  );
}
export function createVisionServer({
  env = process.env,
  client,
  clock = Date.now,
  log = console.info,
} = {}) {
  const secret = env.VISION_SERVICE_SECRET;
  if (typeof secret !== "string" || secret.length < 32 || !env.OPENAI_API_KEY)
    throw Error("Vision service environment incomplete");
  const model = env.OPENAI_MODEL ?? "gpt-5.4-mini";
  if (!/^gpt-5\.4-mini(?:-2026-03-17)?$/.test(model))
    throw Error("Unsupported Vision model");
  const api =
    client ??
    new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 0, timeout: 65000 });
  const cache = new Map();
  let active = 0,
    day = "",
    daily = 0,
    month = "",
    spent = 0;
  const send = (res, status, value) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  const reject = (res, status, code) =>
    send(res, status, { error: { code, status } });
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      send(res, 200, { status: "ok", protocol: 1, capabilities: ["whole-image-roster"] });
      return;
    }
    if (!equal(req.headers.authorization, "Bearer " + secret)) {
      reject(res, 401, "GPT_SERVICE_AUTH");
      return;
    }
    // Read-only readiness check: model metadata, never inference or token charges.
    if (req.method === "GET" && req.url === "/ready") {
      try {
        await api.models.retrieve(model, { maxRetries: 0, timeout: 15000 });
        send(res, 200, { ready: true, model, protocol: 1 });
      } catch (error) {
        send(res, 503, {
          ready: false,
          error: {
            code: safeCode(error),
            status: Number.isInteger(error.status) ? error.status : 503,
          },
        });
      }
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/roster") {
      reject(res, 404, "GPT_ERROR");
      return;
    }
    const timestamp = req.headers["x-xd-timestamp"],
      id = req.headers["x-xd-request-id"],
      signature = req.headers["x-xd-signature"];
    if (
      typeof timestamp !== "string" ||
      !/^\d{13}$/.test(timestamp) ||
      Math.abs(clock() - Number(timestamp)) > 300000 ||
      typeof id !== "string" ||
      !/^[a-zA-Z0-9-]{16,80}$/.test(id) ||
      typeof signature !== "string"
    ) {
      reject(res, 401, "GPT_SERVICE_AUTH");
      return;
    }
    const maxBytes = 24 * 1024 * 1024;
    if (Number(req.headers["content-length"] ?? 0) > maxBytes) {
      reject(res, 413, "GPT_ERROR");
      req.resume();
      return;
    }
    let response;
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          reject(res, 413, "GPT_ERROR");
          return;
        }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString("utf8");
      if (!equal(signature, signVisionRequest(secret, timestamp, id, body))) {
        reject(res, 401, "GPT_SERVICE_AUTH");
        return;
      }
      let input;
      try {
        input = JSON.parse(body);
      } catch {
        reject(res, 400, "GPT_ERROR");
        return;
      }
      if (!validInput(input) || input.model !== model) {
        reject(res, 400, "GPT_ERROR");
        return;
      }
      const digest = createHash("sha256").update(body).digest("hex");
      for (const [key, entry] of cache)
        if (entry.expires < clock() && !entry.running) cache.delete(key);
      if (cache.has(id)) {
        const entry = cache.get(id);
        if (entry.digest !== digest) {
          reject(res, 409, "GPT_ERROR");
          return;
        }
        const result = await entry.promise;
        send(res, result.status, result.value);
        return;
      }
      if (active >= 2 || cache.size >= 100) {
        reject(res, 429, "GPT_BUSY");
        return;
      }
      const date = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Yekaterinburg",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(clock()));
      if (day !== date) {
        day = date;
        daily = 0;
      }
      if (month !== date.slice(0, 7)) {
        month = date.slice(0, 7);
        spent = 0;
      }
      // Secondary, in-memory guard. The authoritative durable $5 ledger remains on Timeweb.
      const reserve = Math.ceil(400000 * 0.75 + input.maxOutput * 4.5);
      if (daily >= 20) {
        reject(res, 429, "GPT_DAILY_LIMIT");
        return;
      }
      if (spent + reserve > 5e6) {
        reject(res, 429, "GPT_MONTHLY_LIMIT");
        return;
      }
      daily++;
      spent += reserve;
      active++;
      const entry = { digest, running: true, expires: clock() + 600000 };
      entry.promise = (async () => {
        try {
          response = await api.responses.create(visionRequest(input), {
            maxRetries: 0,
            timeout: 65000,
          });
          parseVision(response, input.slots, input.wholeImage === true);
          return {
            status: 200,
            value: {
              status: response.status,
              output_text: response.output_text,
              usage: usageOf(response),
            },
          };
        } catch (error) {
          const status = [
            400, 401, 403, 404, 408, 422, 429, 500, 502, 503, 504,
          ].includes(error?.status)
            ? error.status
            : 502;
          if (!response && [400, 401, 403, 404, 422, 429].includes(status))
            spent -= reserve;
          log(
            JSON.stringify({
              event: "vision_service_failure",
              code: safeCode(error),
              status,
            }),
          );
          return {
            status: 502,
            value: {
              error: { code: safeCode(error), status },
              usage: usageOf(response),
            },
          };
        } finally {
          const usage = usageOf(response);
          if (usage) {
            const cost = Math.ceil(
              usage.input_tokens * 0.75 + usage.output_tokens * 4.5,
            );
            spent += cost - reserve;
            log(
              JSON.stringify({
                event: "vision_service_usage",
                model,
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens,
                estimatedUSD: cost / 1e6,
              }),
            );
          }
          active--;
          entry.running = false;
          entry.expires = clock() + 600000;
        }
      })();
      cache.set(id, entry);
      const result = await entry.promise;
      send(res, result.status, result.value);
    } catch {
      if (!res.headersSent) reject(res, 502, "GPT_ERROR");
      else res.end();
    }
  });
  server.requestTimeout = 90000;
  server.headersTimeout = 15000;
  return server;
}
