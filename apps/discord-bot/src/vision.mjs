import OpenAI from "openai";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { parseVision, visionRequest } from "./vision-protocol.mjs";
export { parseVision } from "./vision-protocol.mjs";
import { remoteVisionClient } from "./vision-remote.mjs";
import { ocr, raidLabelSheets } from "./ocr.mjs";

const notices = {
  GPT_ROSTER_NOT_FOUND:
    "На скриншоте не найдены ячейки состава рейда. Запрос в GPT не отправлялся; используется Tesseract. Выберите изображение состава или загрузите исходный скриншот без уменьшения.",
  GPT_ROSTER_TOO_LARGE:
    "На изображении найдено слишком много ячеек. Запрос в GPT не отправлялся; используется Tesseract. Обрежьте изображение до состава одного рейда.",
  GPT_SERVICE_AUTH:
    "Сервис распознавания не принял секрет подключения. Используется Tesseract; администратору: проверьте настройки Render и VPS.",
  GPT_SERVICE_CONFIG:
    "Сервис распознавания ещё не настроен. Используется Tesseract.",
  GPT_NO_KEY: "GPT не подключён: используется Tesseract.",
  GPT_DAILY_LIMIT:
    "Дневной лимит GPT исчерпан. Используется бесплатный Tesseract.",
  GPT_MONTHLY_LIMIT:
    "Месячный бюджет GPT исчерпан. Используется бесплатный Tesseract.",
  GPT_BUSY: "GPT занят: используется Tesseract.",
  GPT_REGION_FORBIDDEN:
    "OpenAI отклонил запрос по региону сервера (403). GPT недоступен на этом VPS; используется Tesseract.",
  GPT_AUTH:
    "OpenAI отклонил API-ключ. Администратору: проверьте ключ на VPS. Используется Tesseract.",
  GPT_QUOTA:
    "У OpenAI исчерпана квота или не подключена оплата. Используется Tesseract.",
  GPT_RATE_LIMIT:
    "Достигнут лимит частоты OpenAI. Используется Tesseract; повторите разбор позже.",
  GPT_TIMEOUT: "OpenAI не ответил вовремя. Используется Tesseract.",
  GPT_INVALID_REQUEST:
    "OpenAI отклонил формат запроса. Используется Tesseract; администратору: проверьте журнал бота.",
  GPT_MODEL_UNAVAILABLE:
    "Модель GPT недоступна этому API-проекту. Используется Tesseract.",
  GPT_ERROR: "GPT временно недоступен: используется Tesseract.",
};
// Classify provider errors using fixed identifiers only: never log the SDK message/body.
export function visionFailure(error) {
  if (Object.hasOwn(notices, error?.message)) return error.message;
  if (
    error?.status === 403 &&
    error?.code === "unsupported_country_region_territory"
  )
    return "GPT_REGION_FORBIDDEN";
  if (error?.status === 401 || error?.status === 403) return "GPT_AUTH";
  if (
    error?.code === "insufficient_quota" ||
    error?.code === "billing_hard_limit_reached"
  )
    return "GPT_QUOTA";
  if (error?.status === 429) return "GPT_RATE_LIMIT";
  if (
    error?.name === "APIConnectionTimeoutError" ||
    error?.status === 408 ||
    error?.status === 504
  )
    return "GPT_TIMEOUT";
  if (error?.status === 400 || error?.status === 422)
    return "GPT_INVALID_REQUEST";
  if (error?.status === 404) return "GPT_MODEL_UNAVAILABLE";
  return "GPT_ERROR";
}
function number(env, key, fallback, min, max) {
  const n = Number(env[key] ?? fallback);
  if (!Number.isFinite(n) || n < min || n > max) throw Error("Invalid " + key);
  return n;
}
export function visionConfig(env = process.env, now = Date.now()) {
  const model = env.OPENAI_MODEL ?? "gpt-5.4-mini";
  if (!/^gpt-5\.4-mini(?:-2026-03-17)?$/.test(model))
    throw Error("Unsupported OPENAI_MODEL pricing");
  const timeout = number(
      env,
      "OPENAI_TIMEOUT_MS",
      env.VISION_SERVICE_URL ? 120000 : 60000,
      1000,
      180000,
    ),
    maxOutput = number(env, "OPENAI_MAX_OUTPUT_TOKENS", 8192, 512, 16384);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: env.OPENAI_BUDGET_TIMEZONE ?? "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  return {
    model,
    timeout,
    maxOutput,
    daily: number(env, "OPENAI_DAILY_LIMIT", 20, 0, 10000),
    concurrent: number(env, "OPENAI_CONCURRENCY", 2, 1, 2),
    monthlyMicros: Math.floor(
      number(env, "OPENAI_MONTHLY_BUDGET_USD", 5, 0, 5) * 1e6,
    ),
    reserveMicros: Math.ceil(400000 * 0.75 + maxOutput * 4.5),
    cacheTtl: number(env, "OPENAI_CACHE_DAYS", 30, 1, 90) * 86400000,
    leaseMs: timeout + 30000,
    day: date,
    month: date.slice(0, 7),
  };
}
// Returns the same words/text contract as OCR. The model never chooses website IDs.
export function createVisionRecognizer({
  store,
  env = process.env,
  client,
  local = ocr,
  regions = raidLabelSheets,
  log = console.info,
  clock = Date.now,
  remoteClient = remoteVisionClient,
} = {}) {
  return async function recognize(buffer, options = {}) {
    if (!options.roster || options.forceTesseract)
      return local(buffer, options);
    let reservation, response, config;
    try {
      if (!env.VISION_SERVICE_URL && !env.OPENAI_API_KEY)
        throw Error("GPT_NO_KEY");
      config = visionConfig(env, clock());
      const remote = env.VISION_SERVICE_URL ? remoteClient(env) : null;
      const source = await sharp(buffer, { limitInputPixels: 25000000 })
        .rotate()
        .removeAlpha()
        .png()
        .toBuffer();
      const layout = await regions(source),
        imageKey = createHash("sha256").update(source).digest("hex");
      // A retry accepts only previously detected disputed cells, never the full screenshot.
      const cells = options.retryCells?.length
        ? options.retryCells.map((c) => ({ slotKey: c.slotKey, box: c.box }))
        : layout.boxes.map((box, i) => ({
            box,
            slotKey: createHash("sha256")
              .update(imageKey + ":" + i)
              .digest("hex"),
          }));
      const wholeImage = !cells.length && !options.retryCells;
      if (!cells.length && !wholeImage) throw Error("GPT_ROSTER_NOT_FOUND");
      if (cells.length > 150) throw Error("GPT_ROSTER_TOO_LARGE");
      const key = createHash("sha256")
          .update(
            JSON.stringify([
              wholeImage ? "vision-whole-v2" : "vision-v2",
              config.model,
              imageKey,
              cells,
              Boolean(options.retryCells),
            ]),
          )
          .digest("hex"),
        scope = String(options.scope ?? "default");
      let players = store.visionCached(scope, key, clock(), config.cacheTtl);
      if (!players) {
        const images = [];
        if (!options.retryCells) images.push(source);
        if (wholeImage) {
          const meta = await sharp(source).metadata();
          if (Math.max(meta.width, meta.height) < 800) {
            const scale = Math.min(4, 1600 / Math.max(meta.width, meta.height));
            images.push(await sharp(source).resize({ width: Math.round(meta.width * scale), height: Math.round(meta.height * scale), fit: "inside", kernel: "lanczos3" }).png().toBuffer());
          }
        }
        // Original-color enlarged crops preserve mixed alphabets and colored-panel strokes.
        for (let start = 0; start < cells.length; start += 25) {
          const batch = cells.slice(start, start + 25),
            layers = [];
          for (const [i, c] of batch.entries()) {
            const crop = await sharp(source)
              .extract({
                left: c.box.left,
                top: c.box.top,
                width: c.box.width,
                height: c.box.height,
              })
              .resize({ width: 600, height: 72, fit: "inside" })
              .png()
              .toBuffer();
            const label = Buffer.from(
              `<svg width="70" height="88"><rect width="70" height="88" fill="white"/><text x="4" y="40" font-size="24">${start + i}</text></svg>`,
            );
            layers.push(
              { input: label, left: 0, top: i * 88 },
              { input: crop, left: 75, top: i * 88 },
            );
          }
          images.push(
            await sharp({
              create: {
                width: 680,
                height: batch.length * 88,
                channels: 3,
                background: "#ffffff",
              },
            })
              .composite(layers)
              .png()
              .toBuffer(),
          );
        }
        reservation = store.visionReserve(scope, key, config, clock());
        if (reservation.cached) players = reservation.cached;
        else {
          const payload = {
            model: config.model,
            maxOutput: config.maxOutput,
            slots: wholeImage ? 150 : cells.length,
            ...(wholeImage ? { wholeImage: true } : {}),
            retry: Boolean(options.retryCells),
            images: images.map(
              (b) => "data:image/png;base64," + b.toString("base64"),
            ),
          };
          if (env.VISION_SERVICE_URL) {
            response = await remote(
              { ...payload, requestId: reservation.id },
              config.timeout,
            );
          } else {
            const api =
              client ??
              new OpenAI({
                apiKey: env.OPENAI_API_KEY,
                maxRetries: 0,
                timeout: config.timeout,
              });
            response = await api.responses.create(visionRequest(payload), {
              timeout: config.timeout,
              maxRetries: 0,
            });
          }
          players = parseVision(response, wholeImage ? 150 : cells.length, wholeImage);
          const usage = response.usage,
            input = usage?.input_tokens,
            output = usage?.output_tokens;
          const cost =
            Number.isSafeInteger(input) &&
            input >= 0 &&
            Number.isSafeInteger(output) &&
            output >= 0
              ? Math.ceil(input * 0.75 + output * 4.5)
              : undefined;
          store.visionFinish(
            reservation.id,
            {
              result: players,
              costMicros: cost,
              inputTokens: input ?? null,
              outputTokens: output ?? null,
            },
            clock(),
          );
          log(
            JSON.stringify({
              event: "vision_usage",
              model: config.model,
              inputTokens: input ?? null,
              outputTokens: output ?? null,
              estimatedUSD: (cost ?? config.reserveMicros) / 1e6,
            }),
          );
        }
      }
      const words = players.map((p) => ({
        text: p.visible,
        confidence: p.uncertain || wholeImage ? 30 : 96,
        line: String(p.slot),
        region: String(p.slot),
        kind: "raid-cell",
        pass: "gpt:vision",
        unbiased: true,
        engine: "gpt",
        uncertain: p.uncertain || wholeImage,
        clipped: p.truncated || cells[p.slot]?.box.clipped === true,
        imageKey,
        slotKey: cells[p.slot]?.slotKey ?? createHash("sha256").update(imageKey + ":whole:" + p.slot).digest("hex"),
        box: cells[p.slot]?.box,
        group: p.group,
      }));
      const loot = options.loot
        ? await local(buffer, { ...options, roster: false })
        : { text: "" };
      return {
        words,
        text: loot.text,
        regionCount: words.length,
        engine: "gpt",
        notice:
          wholeImage
            ? (words.length ? "Состав прочитан GPT по исходному изображению без локального выделения ячеек. Все ники требуют ручного подтверждения." : "GPT не нашёл ников рейда на изображении. Выберите скриншот состава или введите участников вручную.")
            : "Состав прочитан GPT; похожие и обрезанные ники требуют проверки.",
      };
    } catch (error) {
      const code = visionFailure(error);
      if (reservation?.id) {
        const input = (response?.usage ?? error.visionUsage)?.input_tokens,
          output = (response?.usage ?? error.visionUsage)?.output_tokens;
        const cost =
          Number.isSafeInteger(input) && Number.isSafeInteger(output)
            ? Math.ceil(input * 0.75 + output * 4.5)
            : [400, 401, 403, 404, 422, 429].includes(error.status)
              ? 0
              : undefined;
        store.visionFinish(
          reservation.id,
          {
            costMicros: cost,
            inputTokens: input ?? null,
            outputTokens: output ?? null,
            error: code,
          },
          clock(),
        );
      }
      log(
        JSON.stringify({
          event: "vision_fallback",
          code,
          status: Number.isInteger(error?.status) ? error.status : null,
        }),
      );
      // On a disputed-only retry do not rerun OCR for the entire image.
      if (options.retryCells)
        return {
          words: [],
          text: "",
          engine: "tesseract",
          notice: notices[code] + " Спорные ники можно исправить вручную.",
        };
      return {
        ...(await local(buffer, options)),
        engine: "tesseract",
        notice: notices[code],
      };
    }
  };
}
