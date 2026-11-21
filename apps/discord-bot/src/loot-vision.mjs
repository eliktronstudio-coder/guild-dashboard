import OpenAI from "openai";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { visionConfig, visionFailure, visionNotice } from "./vision-budget.mjs";
import { remoteVisionClient } from "./vision-remote.mjs";
import { lootVisionRequest, parseLootVision } from "./loot-vision-protocol.mjs";

export function createLootVisionRecognizer({
  store,
  env = process.env,
  client,
  log = console.info,
  clock = Date.now,
  remoteClient = remoteVisionClient,
} = {}) {
  return async function recognize(buffer, options = {}) {
    let config, reservation, response;
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
      const imageKey = createHash("sha256").update(source).digest("hex");
      const key = createHash("sha256")
        .update(JSON.stringify(["loot-vision-v1", config.model, imageKey]))
        .digest("hex");
      const scope = String(options.scope ?? "default");
      let items = store.visionCached(scope, key, clock(), config.cacheTtl);
      if (!items) {
        reservation = store.visionReserve(scope, key, config, clock());
        if (reservation.cached) items = reservation.cached;
        else {
          const images = [source],
            meta = await sharp(source).metadata();
          if (Math.max(meta.width, meta.height) < 1000)
            images.push(
              await sharp(source)
                .resize({
                  width: meta.width * 2,
                  height: meta.height * 2,
                  fit: "inside",
                })
                .png()
                .toBuffer(),
            );
          const payload = {
            kind: "loot",
            model: config.model,
            maxOutput: config.maxOutput,
            slots: 1,
            retry: false,
            images: images.map(
              (b) => "data:image/png;base64," + b.toString("base64"),
            ),
          };
          if (remote)
            response = await remote(
              { ...payload, requestId: reservation.id },
              config.timeout,
            );
          else {
            const api =
              client ??
              new OpenAI({
                apiKey: env.OPENAI_API_KEY,
                maxRetries: 0,
                timeout: config.timeout,
              });
            response = await api.responses.create(lootVisionRequest(payload), {
              timeout: config.timeout,
              maxRetries: 0,
            });
          }
          items = parseLootVision(response);
          const input = response.usage?.input_tokens,
            output = response.usage?.output_tokens;
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
              result: items,
              costMicros: cost,
              inputTokens: input ?? null,
              outputTokens: output ?? null,
            },
            clock(),
          );
          log(
            JSON.stringify({
              event: "loot_vision_usage",
              model: config.model,
              inputTokens: input ?? null,
              outputTokens: output ?? null,
              estimatedUSD: (cost ?? config.reserveMicros) / 1e6,
            }),
          );
        }
      }
      return {
        words: [],
        text: "",
        lootItems: items.map((i) => ({ ...i, sourceKey: imageKey })),
        engine: "gpt",
        notice: items.length
          ? "Дроп прочитан GPT; проверьте предметы, варианты наборов и количество."
          : "GPT не нашёл полученных предметов на скриншоте дропа. Проверьте изображение или введите предметы вручную.",
      };
    } catch (error) {
      const code = visionFailure(error);
      if (reservation?.id) {
        const u = response?.usage ?? error.visionUsage,
          input = u?.input_tokens,
          output = u?.output_tokens;
        const cost =
          Number.isSafeInteger(input) &&
          input >= 0 &&
          Number.isSafeInteger(output) &&
          output >= 0
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
      log(JSON.stringify({ event: "loot_vision_failure", code }));
      return {
        words: [],
        text: "",
        lootItems: [],
        engine: "unavailable",
        failed: true,
        notice: visionNotice(code),
      };
    }
  };
}
