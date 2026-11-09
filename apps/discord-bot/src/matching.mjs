export const norm = (value) =>
  String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}]/gu, "");
function index(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = norm(r.name ?? r.nickname);
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return map;
}
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = old;
    }
  }
  return row[b.length];
}
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
function cleanNickname(value) {
  return String(value)
    .trim()
    .replace(/^[\s\[\]{}()|"'`]+|[\s\[\]{}()|"'`]+$/gu, "");
}
export function nicknameSuggestions(value, rows) {
  const raw = cleanNickname(value).replace(/^Ячейка \d+:\s*/u, ""),
    keys = [visual(raw), ...raw.split(/\s+/u).map(visual)].filter(
      (k) => k.length >= 3,
    ),
    ranked = [];
  for (const r of rows) {
    let best = Infinity;
    const target = visual(r.nickname ?? r.name);
    for (const key of keys) {
      best = Math.min(best, distance(key, target));
      for (
        let length = Math.max(3, key.length - 1);
        length <= Math.min(target.length, key.length + 1);
        length++
      )
        best = Math.min(
          best,
          distance(key, target.slice(0, length)) +
            0.35 +
            ((target.length - length) / Math.max(1, target.length)) * 0.2,
        );
    }
    if (best <= 3.5 && best / Math.max(4, ...keys.map((k) => k.length)) <= 0.55)
      ranked.push({ ...r, matchCost: best });
  }
  return ranked.sort((a, b) => a.matchCost - b.matchCost).slice(0, 5);
}
export function suggestion(value, rows) {
  const matches = nicknameSuggestions(value, rows);
  return matches[0] &&
    (!matches[1] || matches[0].matchCost < matches[1].matchCost)
    ? matches[0]
    : null;
}
function nicknameCandidates(raw, members, allowPrefix = false) {
  const cleaned = cleanNickname(raw),
    variants = [cleaned, ...cleaned.split(/\s+/u)].filter(
      (v) => norm(v).length >= 2,
    ),
    result = new Map();
  for (const value of variants) {
    const key = norm(value),
      skeleton = visual(value),
      clipped = /[.…_-]$/.test(value),
      exact = members.filter((m) => norm(m.nickname) === key),
      similar = members.filter((m) => visual(m.nickname) === skeleton),
      prefix =
        (allowPrefix || clipped) && skeleton.length >= 4
          ? members.filter(
              (m) =>
                visual(m.nickname).startsWith(skeleton) &&
                skeleton.length / visual(m.nickname).length >= 0.35,
            )
          : [];
    const possible =
      exact.length && !clipped
        ? exact
        : similar.length && !clipped
          ? similar
          : prefix;
    if (possible.length === 1) {
      const m = possible[0];
      result.set(m.id, {
        member: m,
        score: exact.some((x) => x.id === m.id)
          ? 100
          : similar.some((x) => x.id === m.id)
            ? 96
            : 88,
      });
    }
  }
  return [...result.values()];
}
function recognizeCells(words, members) {
  const regions = new Map(),
    selected = new Map(),
    unresolved = [];
  for (const word of words)
    regions.set(word.region, [...(regions.get(word.region) ?? []), word]);
  for (const [region, observations] of regions) {
    const votes = new Map();
    for (const word of observations) {
      if (word.confidence < 20) continue;
      for (const candidate of nicknameCandidates(word.text, members, true)) {
        let v = votes.get(candidate.member.id);
        if (!v) {
          v = {
            member: candidate.member,
            passes: new Set(),
            best: 0,
            score: 0,
          };
          votes.set(candidate.member.id, v);
        }
        v.passes.add(word.pass ?? word.line);
        v.best = Math.max(v.best, word.confidence);
        v.score = Math.max(v.score, candidate.score);
      }
    }
    const ranked = [...votes.values()]
        .filter((v) => v.best >= 70 || v.passes.size >= 2)
        .sort(
          (a, b) =>
            b.passes.size - a.passes.size ||
            b.score - a.score ||
            b.best - a.best,
        ),
      winner = ranked[0],
      runner = ranked[1];
    if (
      winner &&
      (!runner ||
        (winner.passes.size >= runner.passes.size + 2 && winner.best >= 80))
    ) {
      selected.set(winner.member.id, winner.member);
      continue;
    }
    // A low-confidence exact reading must be corroborated by two passes plus
    // close readings from a different image treatment. Fuzzy-only guesses stay pending.
    const corroborated = members.filter((m) => {
      const exact = observations.filter(
        (w) =>
          w.confidence >= 5 &&
          nicknameCandidates(w.text, [m], false).some((c) => c.score >= 96),
      );
      if (new Set(exact.map((w) => w.pass)).size < 2) return false;
      const close = observations.filter(
        (w) =>
          w.confidence >= 5 &&
          (nicknameSuggestions(w.text, [m])[0]?.matchCost ?? 100) <= 1.05,
      );
      return (
        close.length >= 4 &&
        new Set(close.map((w) => String(w.pass).split(":")[0])).size >= 2
      );
    });
    if (corroborated.length === 1) {
      selected.set(corroborated[0].id, corroborated[0]);
      continue;
    }
    const ordered = observations
      .filter((w) => w.text.trim())
      .map((w) => ({
        ...w,
        cost: nicknameSuggestions(w.text, members)[0]?.matchCost ?? 100,
      }))
      .sort((a, b) => a.cost - b.cost || b.confidence - a.confidence);
    unresolved.push(
      cleanNickname(ordered[0]?.text ?? "") ||
        `Ячейка ${Number(String(region).split(":").at(-1)) + 1}: ник не прочитан`,
    );
  }
  return {
    members: [...selected.values()],
    guests: [],
    unresolved,
    detectedSlots: regions.size,
  };
}
export function rosterText(text, members) {
  const by = index(members),
    selected = new Map(),
    guests = [],
    unresolved = [];
  for (const line of text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (line.startsWith("?")) {
      unresolved.push(line.replace(/^\?\s*/, ""));
      continue;
    }
    if (/^гость\s*:/i.test(line)) {
      const name = line.replace(/^гость\s*:/i, "").trim();
      if (name.length && name.length <= 80) guests.push(name);
      else unresolved.push(line);
      continue;
    }
    const exact = by.get(norm(line));
    if (exact?.length === 1) selected.set(exact[0].id, exact[0]);
    else unresolved.push(line);
  }
  return {
    members: [...selected.values()],
    guests: [...new Set(guests)],
    unresolved,
  };
}
export function recognizeRoster(words, members) {
  if (words.some((w) => w.kind === "raid-cell"))
    return recognizeCells(
      words.filter((w) => w.kind === "raid-cell"),
      members,
    );
  const by = index(members),
    selected = new Map(),
    uncertain = new Set(),
    ignored = new Set([
      "рейд",
      "группа",
      "уровень",
      "лидер",
      "помощник",
      "здоровье",
      "мана",
      "маг",
      "хил",
      "танк",
      "лучник",
      "милик",
      "командир",
      "рейда",
      "состав",
      "опции",
      "настройки",
      "закрыть",
    ]);
  for (const word of words) {
    const raw = word.text.trim();
    if (
      !/^[\p{L}\p{N}_-]{2,32}$/u.test(raw) ||
      !/[\p{L}]/u.test(raw) ||
      ignored.has(norm(raw)) ||
      word.confidence < 35
    )
      continue;
    const exact = nicknameCandidates(raw, members);
    if (exact.length === 1 && word.confidence >= 65)
      selected.set(exact[0].member.id, exact[0].member);
    else uncertain.add(raw);
  }
  // OCR words can split a nickname containing spaces; only exact unique whole-line matches qualify.
  const lines = new Map();
  for (const w of words) {
    const key = w.line;
    lines.set(key, [...(lines.get(key) ?? []), w]);
  }
  for (const line of lines.values()) {
    const text = line.map((w) => w.text).join(" "),
      exact = by.get(norm(text));
    if (exact?.length === 1 && line.every((w) => w.confidence >= 65)) {
      selected.set(exact[0].id, exact[0]);
      for (const w of line) uncertain.delete(w.text.trim());
    }
  }
  for (const m of selected.values())
    for (const u of uncertain)
      if (norm(u) === norm(m.nickname)) uncertain.delete(u);
  return {
    members: [...selected.values()],
    guests: [],
    unresolved: [...uncertain].slice(0, 150),
  };
}
export function lootText(text, drops) {
  const by = index(drops),
    selected = new Map(),
    unresolved = [];
  for (let raw of text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (raw.startsWith("?")) {
      unresolved.push(raw.replace(/^\?\s*/, ""));
      continue;
    }
    if (/^(нет|без дропа|дроп|список дропа|монеты?|золото)[:.!]?$/i.test(raw))
      continue;
    raw = raw
      .replace(/^[•*-]\s*/, "")
      .replace(/^получено\s*:\s*/i, "")
      .replace(/^\[(.*?)\](?=\s*[xх×]|$)/u, "$1");
    let name = raw,
      quantity = 1;
    let exact = by.get(norm(raw));
    if (exact?.length !== 1) {
      const tail = raw.match(/^(.*?)\s*[xх×]\s*(\d+)\s*$/iu),
        head = raw.match(/^(\d+)\s*[xх×]\s*(.+)$/iu),
        tab = raw.match(/^(.*?)\t+(\d+)$/u);
      if (tail) {
        name = tail[1].trim().replace(/^\[(.*)\]$/u, "$1");
        quantity = Number(tail[2]);
      } else if (head) {
        quantity = Number(head[1]);
        name = head[2];
      } else if (tab) {
        name = tab[1];
        quantity = Number(tab[2]);
      }
      exact = by.get(norm(name));
    }
    if (
      exact?.length !== 1 ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 1_000_000
    ) {
      unresolved.push(raw);
      continue;
    }
    const item = exact[0],
      old = selected.get(item.id);
    const total = (old?.quantity ?? 0) + quantity;
    if (total > 1_000_000) {
      unresolved.push(raw);
      continue;
    }
    selected.set(item.id, { ...item, quantity: total });
  }
  return { items: [...selected.values()], unresolved };
}
export function reviewReady(draft, { rosterOnly = false } = {}) {
  return Boolean(
    draft.activity &&
    draft.mode &&
    draft.source &&
    draft.analyzed &&
    draft.roster.members.length &&
    !draft.roster.unresolved.length &&
    (rosterOnly || !draft.loot.unresolved.length),
  );
}
