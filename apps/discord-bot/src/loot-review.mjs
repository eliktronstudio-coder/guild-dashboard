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
const receivedLine = (text) =>
  /^получено\s*:/iu.test(text.replace(/^\?\s*/, ""));
const interfaceNoise = (text) => /^дней\s+в\s+ng$/iu.test(text.trim());
const cleanItem = (text) =>
  text
    .trim()
    .replace(/^[\[\]{}|]+|[\[\]{}|]+$/gu, "")
    .trim()
    .replace(/(?<=[а-яё])l$/iu, "");
function lootLines(text) {
  const lines = [];
  for (const line of text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const previous = lines.at(-1);
    if (
      !receivedLine(line) &&
      previous &&
      receivedLine(previous) &&
      previous.includes("[") &&
      !previous.includes("]") &&
      !interfaceNoise(line) &&
      previous.split("\n").length < 3
    )
      lines[lines.length - 1] += "\n" + line;
    else lines.push(line);
  }
  return lines.map((s) => s.replace(/\n/gu, " "));
}
export function parseLootReading(raw, drops) {
  const received = receivedLine(raw);
  const text = raw
    .replace(/^\?\s*/, "")
    .replace(/^[•*-]\s*/, "")
    .replace(/^получено\s*:\s*/iu, "")
    .trim();
  const exact = lootText(text, drops).items[0];
  if (exact)
    return {
      name: exact.name,
      quantity: drops.some((d) => norm(d.name) === norm(cleanItem(text)))
        ? received
          ? 1
          : null
        : exact.quantity,
    };
  // Prefer a complete catalogue label before interpreting a pack suffix as quantity.
  const whole = drops.filter((d) => norm(d.name) === norm(cleanItem(text)));
  if (whole.length === 1)
    return { name: whole[0].name, quantity: received ? 1 : null };
  const tail = text.match(/^(.*?)\s*[xх×]\s*(\d+)\s*$/iu);
  const head = text.match(/^(\d+)\s*[xх×]\s*(.+)$/iu);
  const tab = text.match(/^(.*?)\t+(\d+)$/u);
  const malformedMultiplier = /[xх×]\s*[\dOoОо?]*\s*$/iu.test(text);
  const completeReceived =
    received && !/[.…]{2}|…/u.test(text) && !malformedMultiplier;
  return {
    name: cleanItem(tail?.[1] ?? head?.[2] ?? tab?.[1] ?? text),
    quantity:
      tail || head || tab
        ? Number(tail?.[2] ?? head?.[1] ?? tab?.[2])
        : completeReceived
          ? 1
          : null,
  };
}
export function lootSuggestions(name, drops) {
  // OCR often mixes visually identical Latin and Cyrillic letters.
  // Digits stay unchanged: different pack sizes must never be conflated.
  const visual = (value) =>
    norm(value).replace(
      /[аекмнорстухві]/gu,
      (c) =>
        ({
          а: "a",
          е: "e",
          к: "k",
          м: "m",
          н: "h",
          о: "o",
          р: "p",
          с: "c",
          т: "t",
          у: "y",
          х: "x",
          в: "b",
          і: "i",
        })[c],
    );
  const key = visual(name),
    clipped = /(?:\.{2,}|…)\s*$/u.test(name);
  if (key.length < 3 || key.length > 200) return [];
  // A pack size in a catalogue label is not the number of packs looted.
  // Without a visible size, offer the family instead of guessing one variant.
  const variants = drops
    .flatMap((item) => {
      const pack = item.name.match(/^(.*?)\s*[xх×]\s*(\d+)\s*$/iu);
      if (!pack || /\d/u.test(name)) return [];
      const base = visual(pack[1]);
      const score =
        1 - distance(key, base) / Math.max(key.length, base.length, 1);
      return key.length >= 6 && score >= 0.82
        ? [
            {
              ...item,
              matchCost: 0,
              matchScore: score,
              packVariant: true,
              packSize: Number(pack[2]),
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        b.matchScore - a.matchScore ||
        a.packSize - b.packSize ||
        a.name.localeCompare(b.name, "ru"),
    );
  if (variants.length) return variants.slice(0, 23);
  return drops
    .map((item) => {
      const target = visual(item.name),
        cost = distance(key, target);
      const fullScore = 1 - cost / Math.max(key.length, target.length, 1);
      const prefixScore =
        clipped &&
        key.length >= 8 &&
        key.length / target.length >= 0.65 &&
        key.length < target.length
          ? 1 - distance(key, target.slice(0, key.length)) / key.length
          : 0;
      return {
        ...item,
        matchCost: cost,
        matchScore: Math.max(fullScore, prefixScore),
        prefixMatch: prefixScore > fullScore,
      };
    })
    .filter((item) => item.matchScore >= 0.55)
    .sort(
      (a, b) =>
        b.matchScore - a.matchScore ||
        a.matchCost - b.matchCost ||
        a.name.localeCompare(b.name, "ru"),
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
  for (const raw of lootLines(text)) {
    if (interfaceNoise(raw)) continue;
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
      best &&
      !best.packVariant &&
      best.matchScore >= (best.prefixMatch ? 0.9 : 0.82) &&
      (!next || best.matchScore - next.matchScore >= 0.08) &&
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
          ? suggestions.some((i) => i.packVariant)
            ? "выберите размер набора"
            : "требует проверки"
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
export function refreshSimilarLoot(d) {
  ensureLoot(d);
  let changed = false;
  for (const reading of d.loot.readings) {
    if (!reading.pending || reading.ignored) continue;
    if (interfaceNoise(reading.raw)) {
      reading.ignored = true;
      reading.status = "надпись интерфейса";
      changed = true;
      continue;
    }
    const retry = recognizeLoot(reading.raw, d.catalog.drops).readings[0];
    if (
      retry?.pending &&
      (JSON.stringify(reading.suggestions) !==
        JSON.stringify(retry.suggestions) ||
        reading.status !== retry.status)
    ) {
      reading.suggestions = retry.suggestions;
      reading.status = retry.status;
      changed = true;
    }
    if (retry && !retry.pending) {
      changed = true;
      Object.assign(reading, {
        itemId: retry.itemId,
        name: retry.name,
        quantity: retry.quantity,
        suggestions: retry.suggestions,
        pending: false,
        status: retry.status,
      });
    }
  }
  if (changed) {
    const rosterOnly = d.rosterOnly;
    persistLoot(d);
    d.rosterOnly = rosterOnly;
  }
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
