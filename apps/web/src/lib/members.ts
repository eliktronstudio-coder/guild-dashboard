export const ROLE_OPTIONS = [
  ["owner", "Главный администратор"],
  ["admin", "Администратор"],
  ["officer", "Офицер"],
  ["treasurer", "Казначей"],
  ["member", "Участник"],
  ["guest", "Гость"],
] as const;
export const AVATAR_STYLES = [
  ["gold", "Золото"],
  ["crimson", "Гранат"],
  ["teal", "Бирюза"],
  ["silver", "Серебро"],
] as const;
export type Character = {
  id: string;
  name: string;
  game_server: string;
  character_class: string;
  specialization: string;
  is_main: boolean;
  archived_at: string | null;
  version: number;
};
export type DirectoryMember = {
  id: string;
  nickname: string;
  joined_at: string;
  status: string;
  avatar_style: string;
  main_character: string | null;
  character_class: string | null;
  specialization: string | null;
  game_server: string | null;
  role_codes: string[];
  role_names: string[];
};
export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
export function parseVersion(value: string, allowNew = false) {
  if (!/^\d+$/.test(value)) return null;
  const version = Number(value);
  return Number.isSafeInteger(version) &&
    version >= (allowNew ? 0 : 1) &&
    version <= 2147483647
    ? version
    : null;
}
export function directoryFilters(
  raw: Record<string, string | string[] | undefined>,
) {
  const params: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  const short = (v: string | undefined, n = 80) => (v ?? "").trim().slice(0, n);
  return {
    q: short(params.q, 64),
    role: ROLE_OPTIONS.some(([code]) => code === params.role)
      ? params.role!
      : "",
    characterClass: short(params.characterClass),
    server: short(params.server, 60),
    sort: ["nickname", "joined_new", "joined_old"].includes(params.sort ?? "")
      ? params.sort!
      : "nickname",
    page: Math.max(
      1,
      Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1),
    ),
  };
}
export function directoryHref(
  filters: ReturnType<typeof directoryFilters>,
  page: number,
) {
  const params = new URLSearchParams();
  for (const key of ["q", "role", "characterClass", "server", "sort"] as const)
    if (filters[key]) params.set(key, filters[key]);
  params.set("page", String(page));
  return `/members?${params}`;
}
export const literalSearch = (text: string) =>
  `%${text.replace(/[\\%_]/g, "\\$&")}%`;
