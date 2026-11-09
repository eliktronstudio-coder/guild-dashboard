import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { raidRegions } from "../src/raid-regions.mjs";
import { raidLabelSheets } from "../src/ocr.mjs";
test("colored raid panels are isolated from landscape, health bars and a narrow selected card", () => {
  const width = 300,
    height = 200,
    rgb = Buffer.alloc(width * height * 3, 40);
  const rect = (left, top, w, h, color) => {
    for (let y = top; y < top + h; y++)
      for (let x = left; x < left + w; x++)
        for (let c = 0; c < 3; c++) rgb[(y * width + x) * 3 + c] = color[c];
  };
  rect(5, 5, 55, 25, [40, 150, 210]);
  rect(70, 5, 55, 25, [210, 80, 170]);
  rect(135, 5, 44, 25, [40, 150, 210]);
  rect(5, 40, 55, 3, [40, 150, 210]);
  rect(240, 100, 20, 70, [40, 150, 210]);
  const regions = raidRegions(rgb, width, height);
  assert.equal(regions.length, 3);
  assert.deepEqual(
    regions.map((r) => r.width),
    [55, 55, 44],
  );
});
test("raid sheet generation bounds rows and creates separate grayscale and text-mask treatments", async () => {
  const input = await sharp(
    Buffer.from(
      '<svg width="220" height="140" xmlns="http://www.w3.org/2000/svg"><rect width="220" height="140" fill="#342f28"/><rect x="5" y="5" width="55" height="25" fill="#2896d2"/><rect x="70" y="5" width="55" height="25" fill="#d250aa"/><rect x="135" y="5" width="55" height="25" fill="#2896d2"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  const { boxes, sheets } = await raidLabelSheets(input);
  assert.equal(boxes.length, 3);
  assert.equal(sheets.length, 2);
  for (const sheet of sheets) {
    const meta = await sharp(sheet.image).metadata();
    assert.equal(meta.width, 640);
    assert.equal(meta.height, 3 * 88);
  }
});
