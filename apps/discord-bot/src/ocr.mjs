import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { raidRegions } from "./raid-regions.mjs";
let busy = 0;
export async function downloadImage(url) {
  const target = new URL(url);
  if (
    target.protocol !== "https:" ||
    !["cdn.discordapp.com", "media.discordapp.net"].includes(target.hostname) ||
    target.username ||
    target.password
  )
    throw Error("INVALID_IMAGE");
  const r = await fetch(target, {
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (
    !r.ok ||
    !/^image\/(png|jpe?g|webp)(;|$)/i.test(r.headers.get("content-type") ?? "")
  )
    throw Error("INVALID_IMAGE");
  if (Number(r.headers.get("content-length")) > 12 * 1024 * 1024)
    throw Error("IMAGE_TOO_LARGE");
  let size = 0;
  const chunks = [];
  for await (const part of r.body) {
    size += part.length;
    if (size > 12 * 1024 * 1024) throw Error("IMAGE_TOO_LARGE");
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}
export async function prepareEvidence(buffer) {
  const input = sharp(buffer, {
    limitInputPixels: 25_000_000,
    animated: false,
  }).rotate();
  for (const quality of [85, 65, 45]) {
    const data = await input
      .clone()
      .resize({
        width: 1600,
        height: 1200,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#fff" })
      .jpeg({ quality })
      .toBuffer();
    const image = "data:image/jpeg;base64," + data.toString("base64");
    if (image.length <= 500000) return image;
  }
  throw Error("IMAGE_TOO_LARGE");
}
async function runTesseract(
  image,
  { language = "rus+eng", psm = 11, dictionary, deadline } = {},
) {
  const args = [
    "stdin",
    "stdout",
    "-l",
    language,
    "--psm",
    String(psm),
    "-c",
    "tessedit_create_tsv=1",
    "-c",
    "user_defined_dpi=150",
  ];
  const modelDir =
    process.env.XD_TESSDATA_DIR ??
    (existsSync("/var/lib/xd-discord-ocr-models/eng.traineddata")
      ? "/var/lib/xd-discord-ocr-models"
      : null);
  if (modelDir) args.push("--tessdata-dir", modelDir);
  if (dictionary) args.push("--user-words", dictionary);
  return new Promise((resolve, reject) => {
    const child = spawn("tesseract", args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, OMP_THREAD_LIMIT: "1" },
      }),
      parts = [];
    let size = 0,
      failed = false;
    const timer = setTimeout(
      () => {
        failed = true;
        child.kill("SIGKILL");
        reject(Error("OCR_TIMEOUT"));
      },
      Math.max(1, Math.min(45000, deadline ? deadline - Date.now() : 45000)),
    );
    child.stdout.on("data", (part) => {
      size += part.length;
      if (size > 4_000_000) {
        failed = true;
        child.kill("SIGKILL");
        reject(Error("OCR_OUTPUT_TOO_LARGE"));
      } else parts.push(part);
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      reject(Error("OCR_NOT_INSTALLED"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failed) return;
      if (code !== 0) return reject(Error("OCR_FAILED"));
      const words = Buffer.concat(parts)
        .toString("utf8")
        .split("\n")
        .slice(1)
        .map((line) => line.split("\t"))
        .filter((row) => row.length >= 12 && row[0] === "5" && row[11].trim())
        .map((row) => ({
          text: row.slice(11).join("\t").trim(),
          confidence: Number(row[10]),
          line: row.slice(1, 5).join(":"),
          left: Number(row[6]),
          top: Number(row[7]),
          width: Number(row[8]),
          height: Number(row[9]),
        }));
      resolve(words);
    });
    child.stdin.end(image);
  });
}
function textLines(words) {
  const lines = new Map();
  for (const w of words)
    lines.set(w.line, [...(lines.get(w.line) ?? []), w.text]);
  return [...lines.values()].map((line) => line.join(" ")).join("\n");
}
export async function raidLabelSheets(buffer) {
  const source = await sharp(buffer, { limitInputPixels: 25_000_000 })
      .rotate()
      .removeAlpha()
      .png()
      .toBuffer(),
    meta = await sharp(source).metadata();
  const analysis = await sharp(source)
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const imageKey = createHash("sha256")
    .update(
      `${analysis.info.width}:${analysis.info.height}:${analysis.info.channels}:`,
    )
    .update(analysis.data)
    .digest("hex");
  const scaleX = meta.width / analysis.info.width,
    scaleY = meta.height / analysis.info.height;
  const boxes = raidRegions(
    analysis.data,
    analysis.info.width,
    analysis.info.height,
    analysis.info.channels,
  )
    .map((b) => ({
      left: Math.max(0, Math.floor(b.left * scaleX)),
      top: Math.max(0, Math.floor(b.top * scaleY)),
      width: Math.round(b.width * scaleX),
      height: Math.round(b.height * scaleY),
    }))
    .slice(0, 150);
  if (boxes.length < 3) return { boxes: [], sheets: [], imageKey };
  const sheets = [];
  for (let start = 0; start < boxes.length; start += 35) {
    const batch = boxes.slice(start, start + 35);
    for (const variant of ["gray", "white"]) {
      const layers = [];
      for (const [i, b] of batch.entries()) {
        const inset = Math.max(1, Math.round(scaleX * 1.5)),
          left = b.left + inset,
          top = b.top + Math.max(1, Math.round(scaleY)),
          width = Math.min(b.width - 2 * inset, meta.width - left),
          height = Math.min(
            Math.max(
              7,
              Math.round(b.height * 0.58) - Math.max(1, Math.round(scaleY)),
            ),
            meta.height - top,
          );
        const input = sharp(source)
          .extract({ left, top, width, height })
          .removeAlpha();
        let label;
        if (variant === "gray")
          label = await input
            .greyscale()
            .normalize()
            .negate()
            .resize({
              width: 600,
              height: 64,
              fit: "inside",
              kernel: "lanczos3",
            })
            .png()
            .toBuffer();
        else {
          const crop = await input.raw().toBuffer({ resolveWithObject: true }),
            mask = Buffer.alloc(width * height, 255);
          for (let p = 0; p < mask.length; p++) {
            const r = crop.data[p * 3],
              g = crop.data[p * 3 + 1],
              blue = crop.data[p * 3 + 2];
            if (
              Math.min(r, g, blue) > 155 &&
              Math.max(r, g, blue) - Math.min(r, g, blue) < 90
            ) {
              mask[p] = 0;
              if (p % width >= width - 2) b.clipped = true;
            }
          }
          label = await sharp(mask, { raw: { width, height, channels: 1 } })
            .resize({
              width: 600,
              height: 64,
              fit: "inside",
              kernel: "lanczos3",
            })
            .png()
            .toBuffer();
        }
        layers.push({ input: label, left: 15, top: i * 88 + 12 });
      }
      const image = await sharp({
        create: {
          width: 640,
          height: batch.length * 88,
          channels: 3,
          background: "#fff",
        },
      })
        .composite(layers)
        .png()
        .toBuffer();
      sheets.push({ image, start, count: batch.length, variant });
    }
  }
  return { boxes, sheets, imageKey };
}
export async function ocr(buffer, options = {}) {
  if (busy >= 1) throw Error("OCR_BUSY");
  busy++;
  const deadline = Date.now() + 90000;
  let imageKey = createHash("sha256").update(buffer).digest("hex");
  let directory;
  try {
    let dictionary;
    const vocabulary = [
      ...(options.roster ? (options.members ?? []) : []),
      ...(options.roster ? (options.knownNames ?? []) : []),
      ...(options.loot ? (options.drops ?? []) : []),
    ].map((item) =>
      typeof item === "string" ? item : (item.nickname ?? item.name),
    );
    if (vocabulary.length) {
      directory = await mkdtemp(join(tmpdir(), "xd-roster-"));
      dictionary = join(directory, "names.txt");
      await writeFile(dictionary, vocabulary.join("\n"), { mode: 0o600 });
    }
    let words = [],
      regionCount = 0;
    if (options.roster) {
      const {
        boxes,
        sheets,
        imageKey: pixelKey,
      } = await raidLabelSheets(buffer);
      imageKey = pixelKey;
      regionCount = boxes.length;
      for (const sheet of sheets)
        for (const language of [
          "rus+eng",
          "eng",
          "rus",
          ...(dictionary && sheet.variant === "gray"
            ? ["rus+eng-dictionary"]
            : []),
        ]) {
          const found = await runTesseract(sheet.image, {
            language: language.replace("-dictionary", ""),
            psm: 6,
            dictionary: language === "rus+eng" ? undefined : dictionary,
            deadline,
          });
          const rows = new Map();
          for (const w of found) {
            const row = Math.floor((w.top + w.height / 2) / 88);
            if (row < 0 || row >= sheet.count) continue;
            rows.set(row, [...(rows.get(row) ?? []), w]);
          }
          for (let i = 0; i < sheet.count; i++) {
            const line = (rows.get(i) ?? []).sort((a, b) => a.left - b.left),
              text = line.map((w) => w.text).join(" ");
            words.push({
              text,
              confidence: line.length
                ? line.reduce(
                    (sum, w) => sum + w.confidence * w.text.length,
                    0,
                  ) /
                  Math.max(
                    1,
                    line.reduce((sum, w) => sum + w.text.length, 0),
                  )
                : 0,
              line: `${sheet.variant}:${language}:${sheet.start + i}`,
              region: String(sheet.start + i),
              kind: "raid-cell",
              pass: sheet.variant + ":" + language,
              unbiased: !dictionary || language === "rus+eng",
              imageKey,
              slotKey: createHash("sha256")
                .update(
                  imageKey +
                    ":" +
                    [
                      boxes[sheet.start + i].left,
                      boxes[sheet.start + i].top,
                      boxes[sheet.start + i].width,
                      boxes[sheet.start + i].height,
                    ].join(":"),
                )
                .digest("hex"),
              clipped: boxes[sheet.start + i].clipped ?? false,
            });
          }
        }
    }
    let text = "";
    if (!regionCount || options.loot) {
      const image = await sharp(buffer, { limitInputPixels: 25_000_000 })
        .rotate()
        .resize({ width: 4000, height: 4000, fit: "inside" })
        .greyscale()
        .normalize()
        .sharpen()
        .png()
        .toBuffer();
      const full = (await runTesseract(image, { dictionary, deadline })).map(
        (w) => ({
          ...w,
          imageKey,
          slotKey: createHash("sha256")
            .update(imageKey + ":generic:" + w.line)
            .digest("hex"),
          unbiased: !dictionary,
        }),
      );
      text = textLines(full);
      if (!regionCount) words = full;
    }
    if (!text) text = textLines(words.filter((w) => w.pass === "gray:rus+eng"));
    return { words, text, regionCount };
  } finally {
    busy--;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
