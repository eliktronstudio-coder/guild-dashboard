import { spawn } from "node:child_process";
import sharp from "sharp";
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
export async function ocr(buffer) {
  if (busy >= 1) throw Error("OCR_BUSY");
  busy++;
  try {
    const image = await sharp(buffer, { limitInputPixels: 25_000_000 })
      .rotate()
      .resize({ width: 3000, height: 3000, fit: "inside" })
      .greyscale()
      .normalize()
      .sharpen()
      .png()
      .toBuffer();
    const output = await new Promise((resolve, reject) => {
      const child = spawn(
        "tesseract",
        [
          "stdin",
          "stdout",
          "-l",
          "rus+eng",
          "--psm",
          "11",
          "-c",
          "tessedit_create_tsv=1",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      const parts = [];
      let size = 0,
        failed = false;
      const timer = setTimeout(() => {
        failed = true;
        child.kill("SIGKILL");
        reject(Error("OCR_TIMEOUT"));
      }, 45000);
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
        if (!failed) {
          if (code === 0) resolve(Buffer.concat(parts).toString("utf8"));
          else reject(Error("OCR_FAILED"));
        }
      });
      child.stdin.end(image);
    });
    const words = output
      .split("\n")
      .slice(1)
      .map((line) => line.split("\t"))
      .filter((row) => row.length >= 12 && row[0] === "5" && row[11].trim())
      .map((row) => ({
        text: row.slice(11).join("\t"),
        confidence: Number(row[10]),
        line: row.slice(1, 5).join(":"),
      }));
    const lines = new Map();
    for (const w of words)
      lines.set(w.line, [...(lines.get(w.line) ?? []), w.text]);
    return {
      words,
      text: [...lines.values()].map((row) => row.join(" ")).join("\n"),
    };
  } finally {
    busy--;
  }
}
