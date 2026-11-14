// Real Tesseract evaluation on generated game-sized labels, never live accounts.
import sharp from "sharp";
import { ocr } from "../src/ocr.mjs";
import { recognizeIndependentRoster } from "../src/recognition.mjs";
const names = [
  "Bloomy",
  "Konigzavion",
  "Emberglaze",
  "Badboy",
  "Heartsoul",
  "Fleurdi",
  "Mentaa",
  "Стакстаки",
  "Плакиплаки",
  "Вуэкко",
  "Бякибяки",
  "Faor",
];
const members = names.map((nickname, i) => ({ id: String(i), nickname }));
for (const [size, cellWidth] of [
  [9, 82],
  [11, 82],
  [9, 55],
  [11, 55],
]) {
  const width = 360,
    height = 130,
    cellHeight = 32;
  const cells = names
    .map((name, i) => {
      const x = 8 + (i % 4) * 88,
        y = 8 + Math.floor(i / 4) * 38;
      return `<clipPath id="c${i}"><rect x="${x + 2}" y="${y + 2}" width="${cellWidth - 4}" height="18"/></clipPath><rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" fill="${i % 3 ? "#2896d2" : "#d250aa"}"/><text x="${x + 3}" y="${y + 13}" fill="white" font-family="Liberation Sans" font-size="${size}" clip-path="url(#c${i})">${name}</text><rect x="${x}" y="${y + 26}" width="${cellWidth}" height="3" fill="#607040"/>`;
    })
    .join("");
  const buffer = await sharp(
    Buffer.from(
      `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#40372b"/>${cells}</svg>`,
    ),
  )
    .jpeg({ quality: 85 })
    .toBuffer();
  const start = Date.now();
  const result = await ocr(buffer, { roster: true, members });
  const roster = recognizeIndependentRoster(result.words, members);
  const wrong = roster.readings.filter(
    (r) => r.name && r.name !== names[Number(r.observations[0].region)],
  );
  console.log(
    JSON.stringify({
      font: size,
      cellWidth,
      slots: roster.detectedSlots,
      recognized: roster.members.length,
      pending: roster.unresolved.length,
      ms: Date.now() - start,
      readings: roster.readings.map((r) => ({
        region: r.region,
        visible: r.visible,
        name: r.name,
        variants: r.variants,
      })),
      wrong: wrong.length,
    }),
  );
}
