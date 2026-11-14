import { createHash } from "node:crypto";
import {
  registeredMatch,
  rosterText,
  nicknameSuggestions,
} from "./matching.mjs";
import {
  gameNickname,
  nicknameKey,
  visibleNickname,
  aliasKey,
} from "./nickname-memory.mjs";
export function independentReadings(words) {
  const groups = new Map();
  for (const w of words) {
    const key = w.kind === "raid-cell" ? (w.slotKey ?? w.region) : w.line;
    groups.set(key, [...(groups.get(key) ?? []), w]);
  }
  return [...groups].map(([region, observations]) => {
    const votes = new Map();
    for (const word of observations) {
      const text = visibleNickname(word.text);
      if (!text) continue;
      const k = aliasKey(text);
      let v = votes.get(k);
      if (!v) {
        v = {
          text,
          confidences: [],
          passes: new Set(),
          treatments: new Set(),
          unbiased: false,
        };
        votes.set(k, v);
      }
      v.confidences.push(Math.max(0, word.confidence));
      v.passes.add(word.pass ?? word.line);
      v.treatments.add(String(word.pass ?? "generic").split(":")[0]);
      v.unbiased ||= word.unbiased !== false;
    }
    const ranked = [...votes.values()]
      .map((v) => ({
        ...v,
        confidence:
          v.confidences.reduce((a, b) => a + b, 0) / v.confidences.length,
      }))
      .sort(
        (a, b) =>
          b.confidence +
          Math.min(3, b.passes.size) * 12 +
          b.treatments.size * 8 +
          (b.unbiased ? 10 : 0) -
          (a.confidence +
            Math.min(3, a.passes.size) * 12 +
            a.treatments.size * 8 +
            (a.unbiased ? 10 : 0)),
      );
    const best = ranked[0],
      first = observations[0],
      visible = best?.text ?? "",
      imageKey = first.imageKey ?? "",
      key =
        first.slotKey ??
        createHash("sha256")
          .update(imageKey + ":" + String(region))
          .digest("hex");
    return {
      key,
      region,
      imageKey,
      visible,
      confidence: best?.confidence ?? 0,
      passes: best?.passes.size ?? 0,
      unbiased: best?.unbiased ?? false,
      truncated:
        observations.some((w) => w.clipped === true) || /[.…_-]$/.test(visible),
      engine: first.engine,
      uncertain: observations.some((w) => w.uncertain === true),
      box: first.box,
      group: first.group,
      verifiedCell: first.kind === "raid-cell",
      variants: [...votes.values()].map((v) => v.text),
      observations,
      alternatives: ranked
        .slice(0, 6)
        .map((v) => ({ text: v.text, confidence: v.confidence })),
    };
  });
}
function exactMember(name, members) {
  return registeredMatch(name, members);
}
export function recognizeIndependentRoster(
  words,
  members,
  { recall = () => ({}) } = {},
) {
  const readings = independentReadings(words),
    selected = new Map(),
    guests = [],
    unresolved = [],
    unresolvedKeys = [];
  for (const reading of readings) {
    const memory = recall(reading) ?? {};
    let name = null,
      member = null;
    if (memory.name && !reading.truncated && !reading.uncertain) {
      name = memory.name;
      member = exactMember(name, members);
      reading.origin = "memory";
    } else if (!memory.conflict) {
      const registered = registeredMatch(reading.visible, members);
      if (
        registered &&
        !reading.truncated &&
        !reading.uncertain &&
        reading.confidence >= 70 &&
        reading.unbiased
      ) {
        member = registered;
        name = member.nickname;
        reading.origin = "registry";
      } else if (
        reading.verifiedCell &&
        !reading.truncated &&
        reading.confidence >= 85 &&
        (reading.passes >= 2 || reading.engine === "gpt") &&
        !reading.uncertain &&
        reading.unbiased &&
        nicknameKey(reading.visible).replace(/[^\p{L}\p{N}]/gu, "").length >=
          4 &&
        // A one-letter OCR error must not turn a registered player into a
        // confidently "new" guest. Offer the close player for review instead.
        nicknameSuggestions(reading.visible, members).length === 0
      ) {
        name = gameNickname(reading.visible);
        reading.origin = "read-from-image";
      }
    }
    reading.suggestions = nicknameSuggestions(reading.visible, members).slice(
      0,
      3,
    );
    reading.status =
      reading.truncated || reading.uncertain
        ? "ручная проверка"
        : member
          ? "точно"
          : reading.suggestions.length
            ? "похожие"
            : "не найден";
    if (name && (member || guests.length < 50)) {
      reading.name = name;
      reading.memberId = member?.id ?? null;
      reading.pending = false;
      if (member) selected.set(member.id, member);
      else if (!guests.includes(name)) guests.push(name);
    } else {
      reading.pending = true;
      reading.memoryCandidates = [
        ...new Set([memory.name, ...(memory.names ?? [])].filter(Boolean)),
      ];
      unresolved.push(
        reading.visible ||
          `Ячейка ${readings.indexOf(reading) + 1}: ник не прочитан`,
      );
      unresolvedKeys.push(reading.key);
    }
  }
  return {
    members: [...selected.values()],
    guests,
    unresolved,
    unresolvedKeys,
    readings,
    detectedSlots: readings.filter((r) => r.verifiedCell).length,
  };
}
export function manuallyReadRoster(text, members) {
  const result = { members: [], guests: [], unresolved: [] };
  for (const raw of text
    .split(/[\n,;]+/u)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const known = rosterText(raw, members);
    result.members.push(...known.members);
    result.guests.push(...known.guests);
    for (const unknown of known.unresolved) {
      const name = raw.startsWith("?") ? null : gameNickname(unknown);
      if (name) result.guests.push(name);
      else result.unresolved.push(unknown);
    }
  }
  result.members = [...new Map(result.members.map((m) => [m.id, m])).values()];
  result.guests = [...new Set(result.guests)];
  if (result.guests.length > 50) throw Error("TOO_MANY_GUESTS");
  return result;
}
export function resolveReading(draft, index, name, origin = "manual") {
  const valid = gameNickname(name);
  if (!valid) throw Error("INVALID_NICKNAME");
  const reading = draft.roster.readings?.find(
      (r) => r.key === draft.roster.unresolvedKeys?.[index],
    ),
    member = exactMember(valid, draft.catalog.members);
  if (member) {
    if (!draft.roster.members.some((m) => m.id === member.id))
      draft.roster.members.push(member);
  } else {
    if (
      !draft.roster.guests.includes(valid) &&
      draft.roster.guests.length >= 50
    )
      throw Error("TOO_MANY_GUESTS");
    draft.roster.guests = [...new Set([...draft.roster.guests, valid])];
  }
  if (reading) {
    Object.assign(reading, {
      name: valid,
      memberId: member?.id ?? null,
      pending: false,
      origin,
      status: "подтверждён вручную",
    });
  }
  draft.roster.unresolved.splice(index, 1);
  draft.roster.unresolvedKeys?.splice(index, 1);
  return reading
    ? {
        name: valid,
        key: reading.key,
        imageKey: reading.imageKey,
        variants: reading.variants,
      }
    : null;
}

export function correctAnyReading(draft, key, name) {
  const reading = draft.roster.readings?.find((r) => r.key === key);
  if (!reading) throw Error("DRAFT_CHANGED");
  const pending = draft.roster.unresolvedKeys?.indexOf(key) ?? -1;
  if (pending >= 0)
    return resolveReading(draft, pending, name, "manual-correction");
  const valid = gameNickname(name);
  if (!valid) throw Error("INVALID_NICKNAME");
  const previous = { name: reading.name, memberId: reading.memberId },
    member = exactMember(valid, draft.catalog.members);
  if (
    !member &&
    !draft.roster.guests.includes(valid) &&
    draft.roster.guests.length >= 50
  )
    throw Error("TOO_MANY_GUESTS");
  Object.assign(reading, {
    name: valid,
    memberId: member?.id ?? null,
    pending: false,
    ignored: false,
    origin: "manual-correction",
    status: "подтверждён вручную",
  });
  if (
    previous.memberId &&
    !draft.roster.readings.some(
      (r) => r !== reading && !r.ignored && r.memberId === previous.memberId,
    )
  )
    draft.roster.members = draft.roster.members.filter(
      (m) => m.id !== previous.memberId,
    );
  if (
    previous.name &&
    !previous.memberId &&
    !draft.roster.readings.some(
      (r) =>
        r !== reading && !r.ignored && r.name === previous.name && !r.memberId,
    )
  )
    draft.roster.guests = draft.roster.guests.filter(
      (n) => n !== previous.name,
    );
  if (member) {
    if (!draft.roster.members.some((m) => m.id === member.id))
      draft.roster.members.push(member);
  } else draft.roster.guests = [...new Set([...draft.roster.guests, valid])];
  return {
    name: valid,
    key: reading.key,
    imageKey: reading.imageKey,
    variants: reading.variants,
  };
}
