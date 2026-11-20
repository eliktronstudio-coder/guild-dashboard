import { createHash, randomUUID } from "node:crypto";
import { norm, lootText } from "./matching.mjs";

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = old;
    }
  }
  return row[b.length];
}
export function parseLootReading(raw, drops) {
  const text = raw
    .replace(/^\?\s*/, "")
    .replace(/^[•*-]\s*/, "")
    .replace(/^получено\s*:\s*/iu, "")
    .trim();
  const exact = lootText(text, drops).items[0];
  if (exact)
    return {
      name: exact.name,
      // A complete item name is not evidence that its quantity was visible.
      // In particular, a pack's x2000 suffix is part of its name.
      quantity: drops.some(
        (d) => norm(d.name) === norm(text.replace(/^\[(.*)\]$/u, "$1")),
      )
        ? null
        : exact.quantity,
    };
  const tail = text.match(/^(.*?)\s*[xх×]\s*(\d+)\s*$/iu);
  const head = text.match(/^(\d+)\s*[xх×]\s*(.+)$/iu);
  const tab = text.match(/^(.*?)\t+(\d+)$/u);
  return {
    name: (tail?.[1] ?? head?.[2] ?? tab?.[1] ?? text)
      .trim()
      .replace(/^\[(.*)\]$/u, "$1"),
    quantity:
      tail || head || tab ? Number(tail?.[2] ?? head?.[1] ?? tab?.[2]) : null,
  };
}
export function lootSuggestions(name, drops) {
  const key = norm(name);
  if (key.length < 3) return [];
  return drops
    .map((item) => ({ ...item, matchCost: distance(key, norm(item.name)) }))
    .filter(
      (item) => item.matchCost <= Math.max(2, Math.floor(key.length * 0.25)),
    )
    .sort(
      (a, b) => a.matchCost - b.matchCost || a.name.localeCompare(b.name, "ru"),
    )
    .slice(0, 3);
}
function validQuantity(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000;
}
export function rebuildLoot(readings, drops) {
  const selected = new Map(),
    unresolved = [];
  for (const r of readings) {
    if (r.ignored) continue;
    const item = drops.find((d) => d.id === r.itemId);
    if (!r.pending && item && validQuantity(r.quantity)) {
      const total = (selected.get(item.id)?.quantity ?? 0) + r.quantity;
      if (validQuantity(total)) {
        selected.set(item.id, { ...item, quantity: total });
        continue;
      }
      r.pending = true;
      r.status = "проверьте общее количество";
    }
    unresolved.push(r.raw || "Предмет не прочитан");
  }
  return { items: [...selected.values()], unresolved, readings };
}
export function recognizeLoot(text, drops) {
  const readings = [];
  for (const raw of text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (/^(нет|без дропа|дроп|список дропа|монеты?|золото)[:.!]?$/iu.test(raw))
      continue;
    const parsed = parseLootReading(raw, drops);
    const suggestions = lootSuggestions(parsed.name, drops);
    const exact = drops.filter((d) => norm(d.name) === norm(parsed.name));
    const [best, next] = suggestions;
    const digits = (value) => (value.match(/\d+/g) ?? []).join(":");
    const similar =
      exact.length === 0 &&
      norm(parsed.name).length >= 6 &&
      !/[.…]{2}|…/u.test(parsed.name) &&
      best &&
      best.matchCost <= (norm(parsed.name).length >= 12 ? 2 : 1) &&
      (!next || next.matchCost - best.matchCost >= 2) &&
      digits(parsed.name) === digits(best.name);
    const item = exact.length === 1 ? exact[0] : similar ? best : null;
    const pending =
      raw.startsWith("?") || !item || !validQuantity(parsed.quantity);
    readings.push({
      key: createHash("sha256")
        .update(readings.length + ":" + raw)
        .digest("hex")
        .slice(0, 16),
      raw,
      ...parsed,
      itemId: item?.id ?? null,
      name: item?.name ?? parsed.name,
      suggestions,
      pending,
      status: !validQuantity(parsed.quantity)
        ? "проверьте количество"
        : pending
          ? "требует проверки"
          : similar
            ? "автосопоставлено"
            : "точно",
    });
  }
  return rebuildLoot(readings, drops);
}
export function ensureLoot(d) {
  if (!d.loot.readings)
    d.loot = recognizeLoot(
      [
        ...d.loot.items.map((i) => `${i.name} x${i.quantity}`),
        ...d.loot.unresolved.map((r) => "? " + r),
      ].join("\n"),
      d.catalog.drops,
    );
  return d.loot.readings.filter((r) => !r.ignored);
}
export function lootReading(d) {
  const rows = ensureLoot(d);
  return rows.find((r) => r.key === d.lootFocusKey) ?? rows[0];
}
export function persistLoot(d) {
  d.loot = rebuildLoot(d.loot.readings, d.catalog.drops);
  d.rosterOnly = false;
  if (d.screensOnly) {
    d.lootOverride = d.loot.readings
      .filter((r) => !r.ignored)
      .map((r) =>
        r.pending
          ? "? " + r.raw.replace(/^\?\s*/, "")
          : `${r.name} x${r.quantity}`,
      )
      .join("\n");
    d.lootOverrideImages = Object.keys(d.lootImageResults ?? {});
  }
}
export function resolveLoot(d, key, itemId, quantity) {
  ensureLoot(d);
  const r = d.loot.readings.find((r) => r.key === key && !r.ignored);
  const item = d.catalog.drops.find((i) => i.id === itemId);
  if (!r || !item) throw Error("DRAFT_CHANGED");
  if (!validQuantity(quantity)) throw Error("INVALID_LOOT_QUANTITY");
  const other = d.loot.readings
    .filter((x) => x !== r && !x.ignored && !x.pending && x.itemId === itemId)
    .reduce((total, x) => total + x.quantity, 0);
  if (!validQuantity(other + quantity)) throw Error("INVALID_LOOT_QUANTITY");
  Object.assign(r, {
    itemId,
    name: item.name,
    quantity,
    pending: false,
    status: "подтверждён вручную",
  });
  persistLoot(d);
}
export function addLootReading(d) {
  ensureLoot(d);
  const r = {
    key: randomUUID().replaceAll("-", "").slice(0, 16),
    raw: "Новый предмет",
    quantity: null,
    pending: true,
    suggestions: [],
    status: "требует проверки",
  };
  d.loot.readings.push(r);
  d.lootFocusKey = r.key;
  persistLoot(d);
}
