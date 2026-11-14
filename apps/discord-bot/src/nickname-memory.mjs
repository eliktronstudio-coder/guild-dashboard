export function gameNickname(value) {
  const name = String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
  return name.length >= 2 &&
    name.length <= 32 &&
    /^[\p{L}\p{N} _-]+$/u.test(name) &&
    /\p{L}/u.test(name)
    ? name
    : null;
}
export const nicknameKey = (value) =>
  String(value).normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
export function visibleNickname(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/^[\s\[\]{}()|"'`]+|[\s\[\]{}()|"'`]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 100);
}
export const aliasKey = (value) => nicknameKey(visibleNickname(value));
export function memoryDecision(exact, aliases, reading) {
  const exactNames = [...new Set(exact.map((r) => r.nickname))];
  if (exactNames.length === 1)
    return { name: exactNames[0], reason: "confirmed-image" };
  if (exactNames.length > 1) return { conflict: true, names: exactNames };
  const names = [...new Set(aliases.map((r) => r.nickname))];
  if (names.length > 1) return { conflict: true, names };
  const reliable = aliases.filter(
    (r) => r.samples >= 2 && r.alias.replace(/[^\p{L}\p{N}]/gu, "").length >= 4,
  );
  if (
    names.length === 1 &&
    reliable.some(
      (r) => r.alias === aliasKey(reading.visible) && reading.confidence >= 50,
    )
  )
    return { name: names[0], reason: "confirmed-examples" };
  if (names.length === 1 && new Set(reliable.map((r) => r.alias)).size >= 2)
    return { name: names[0], reason: "corroborated-examples" };
  return { names };
}
