import sharp from "sharp";
import { createHash } from "node:crypto";
import { raidRegionLayout } from "./raid-regions.mjs";
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
  const layout = raidRegionLayout(
    analysis.data,
    analysis.info.width,
    analysis.info.height,
    analysis.info.channels,
  );
  const boxes = layout.regions
    .map((b) => ({
      left: Math.max(0, Math.floor(b.left * scaleX)),
      top: Math.max(0, Math.floor(b.top * scaleY)),
      width: Math.round(b.width * scaleX),
      height: Math.round(b.height * scaleY),
    }))
    .slice(0, 150);
  if (boxes.length < 3)
    return { boxes: [], sheets: [], imageKey, incomplete: layout.incomplete };
  return { boxes, sheets: [], imageKey, incomplete: layout.incomplete };
}
