export const PLAYER_CLASSES = [
  "Лучник",
  "Маг",
  "Милик",
  "Танк",
  "Хил",
] as const;
export type PlayerClass = (typeof PLAYER_CLASSES)[number];
export function isPlayerClass(value: unknown): value is PlayerClass {
  return typeof value === "string" && PLAYER_CLASSES.some((c) => c === value);
}
