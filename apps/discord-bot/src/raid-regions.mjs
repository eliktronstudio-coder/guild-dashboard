// Detect the flat blue/pink panels of ArcheAge's raid roster, not the game scene.
export function raidRegions(rgb, width, height, channels = 3) {
  const n = width * height,
    mask = new Uint8Array(n),
    seen = new Uint8Array(n),
    queue = new Int32Array(n),
    regions = [];
  for (let i = 0; i < n; i++) {
    const r = rgb[i * channels],
      g = rgb[i * channels + 1],
      b = rgb[i * channels + 2];
    mask[i] =
      b > 95 && g > 65 && b > r * 1.2 && g > r * 1.1
        ? 1
        : r > 140 && b > 95 && r > g * 1.25 && b > g * 1.15
          ? 2
          : 0;
  }
  for (let i = 0; i < n; i++) {
    if (!mask[i] || seen[i]) continue;
    let head = 0,
      tail = 0,
      count = 0,
      left = i % width,
      right = left,
      top = Math.floor(i / width),
      bottom = top;
    queue[tail++] = i;
    seen[i] = 1;
    const color = mask[i];
    while (head < tail) {
      const p = queue[head++],
        x = p % width,
        y = Math.floor(p / width);
      count++;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      for (const next of [
        x ? p - 1 : -1,
        x < width - 1 ? p + 1 : -1,
        y ? p - width : -1,
        y < height - 1 ? p + width : -1,
      ])
        if (next >= 0 && !seen[next] && mask[next] === color) {
          seen[next] = 1;
          queue[tail++] = next;
        }
    }
    const w = right - left + 1,
      h = bottom - top + 1;
    if (
      w >= 22 &&
      h >= 9 &&
      w / h >= 1.4 &&
      w / h <= 10 &&
      w <= width * 0.99 &&
      h <= height * 0.95 &&
      count / (w * h) > 0.48
    )
      regions.push({ left, top, width: w, height: h, color });
  }
  // One-off blue landscape fragments are not a roster. Require a repeated card size.
  const candidates = regions.filter(
    (a) =>
      regions.filter(
        (b) =>
          Math.abs(a.width - b.width) <= Math.max(3, a.width * 0.25) &&
          Math.abs(a.height - b.height) <= Math.max(3, a.height * 0.25),
      ).length >= 3,
  );
  return candidates.sort((a, b) =>
    Math.abs(a.top - b.top) > Math.min(a.height, b.height) / 2
      ? a.top - b.top
      : a.left - b.left,
  );
}
