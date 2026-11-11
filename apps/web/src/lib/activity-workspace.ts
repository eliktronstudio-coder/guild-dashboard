import { parseGold } from "./treasury";
import { parseWeight } from "./catalog";
import { isUuid } from "./members";
import { utcInput } from "./events";
export const JOURNAL_STATUSES: Record<string, string> = {
  scheduled: "Запланирована",
  unconfirmed: "Состав не сохранён",
  completed: "Завершена",
  pending_payout: "К выплате",
  paid: "Выплачено",
  cancelled: "Отменена",
};
export const DIFFICULTIES: Record<string, string> = {
  normal: "Обычная",
  hard: "Сложная",
  heroic: "Героическая",
};
export type ActivityMember = {
  id: string;
  nickname: string;
  character_class: string | null;
  status?: string;
};
export type ActivityTemplate = {
  id: string;
  name: string;
  weight: number;
  version: number;
};
export type DropOption = {
  id: string;
  name: string;
  price_units: string;
  version: number;
};
export type Evidence = { id: string; kind: "roster" | "loot"; image: string };
export type ActivityFacts = {
  boss_defeated?: boolean;
  pvp_result?: string;
  organizer?: string | null;
  raid_leader?: string | null;
  full_participation?: string[];
};
export type ActivityDetail = {
  event: {
    id: string;
    title: string;
    starts_at: string;
    kind: string;
    status: string;
    source: string;
    journal_status?: string;
    version: number;
    weight: number;
    banner: string | null;
    has_banner: boolean;
    finalized: boolean;
    description: string;
    counts: boolean;
  };
  report: {
    difficulty: string;
    night: boolean;
    reward_units: string | null;
    guests: string[];
    facts: ActivityFacts;
  };
  can_view_roster: boolean;
  roster: ActivityMember[];
  selected_members: string[];
  participants: number | null;
  loot: {
    id: string;
    name: string;
    quantity: number;
    remaining: number;
    unit_units: string | null;
    total_units: string | null;
    has_photo: boolean;
    version: number;
    has_history: boolean;
  }[];
  loot_total_units: string | null;
  unpriced_count: number | null;
  evidence: { id: string; kind: "roster" | "loot" }[];
};
export type JournalRow = {
  id: string;
  title: string;
  kind: string;
  starts_at: string;
  status: string;
  treasury_source: string;
  version: number;
  difficulty: string;
  is_night: boolean;
  has_banner: boolean;
  participants: number | null;
  percentage: number | null;
  journal_status: string;
};
export type JournalReport = {
  total: number;
  page: number;
  can_view_roster: boolean;
  kpis: {
    total: number;
    average: number | null;
    best: number | null;
    cancelled: number;
  };
  rows: JournalRow[];
};
export function activityFilters(
  params: Record<string, string | string[] | undefined>,
) {
  const value = (k: string) =>
    typeof params[k] === "string" ? (params[k] as string) : "";
  const now = new Date();
  const defaultFrom = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  )
    .toISOString()
    .slice(0, 10);
  const from = value("from") || defaultFrom,
    through = value("through") || now.toISOString().slice(0, 10);
  const valid = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  const until = valid(through)
    ? new Date(Date.parse(through) + 86400000).toISOString()
    : "";
  const error =
    !valid(from) ||
    !valid(through) ||
    from > through ||
    Date.parse(until) - Date.parse(from) > 366 * 86400000
      ? "Выберите корректный период до 366 дней."
      : null;
  return {
    from,
    through,
    until,
    error,
    page: Math.max(1, Math.min(10000, parseInt(value("page")) || 1)),
    filters: {
      status: Object.hasOwn(JOURNAL_STATUSES, value("status"))
        ? value("status")
        : "",
      source: ["prime", "mini_rb"].includes(value("source"))
        ? value("source")
        : "",
      kind: ["pve", "pvp"].includes(value("kind")) ? value("kind") : "",
      banner: isUuid(value("banner")) ? value("banner") : "",
      player: value("player").trim().slice(0, 80),
    },
  };
}
export function validEvidence(image: string) {
  if (
    image.length > 500000 ||
    !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(image)
  )
    return false;
  const bytes = Buffer.from(image.split(",")[1], "base64");
  return image.startsWith("data:image/png")
    ? bytes.length > 24 &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : bytes.length > 4 &&
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255 &&
        bytes[bytes.length - 2] === 255 &&
        bytes[bytes.length - 1] === 217;
}
export function parseActivityPayload(raw: string) {
  if (raw.length > 4500000)
    return {
      error: "Слишком большой отчёт. Уменьшите количество скриншотов.",
    } as const;
  try {
    const p = JSON.parse(raw);
    const weight = parseWeight(String(p.coefficient ?? "")),
      reward = parseGold(String(p.reward ?? "0"));
    if (
      !p ||
      !["scheduled", "completed"].includes(p.status) ||
      typeof p.title !== "string" ||
      p.title.trim().length < 3 ||
      p.title.trim().length > 120 ||
      !["raid", "pvp", "siege", "farm", "guild"].includes(p.kind) ||
      !["prime", "mini_rb", "none"].includes(p.source) ||
      weight === null ||
      reward === null ||
      !Object.hasOwn(DIFFICULTIES, p.difficulty)
    )
      throw Error();
    const starts = utcInput(p.startsAt);
    if (!starts) throw Error();
    if (p.banner && !isUuid(p.banner)) throw Error();
    if (
      !Array.isArray(p.guests) ||
      p.guests.length > 50 ||
      p.guests.some(
        (n: unknown) => typeof n !== "string" || !n.trim() || n.length > 80,
      )
    )
      throw Error();
    if (
      p.members !== undefined &&
      (!Array.isArray(p.members) ||
        p.members.length > 500 ||
        p.members.some((id: unknown) => typeof id !== "string" || !isUuid(id)))
    )
      throw Error();
    const evidence = p.evidence ?? [];
    if (
      !Array.isArray(evidence) ||
      evidence.length > 8 ||
      evidence.some(
        (v: Evidence) =>
          !isUuid(v.id) ||
          !["roster", "loot"].includes(v.kind) ||
          typeof v.image !== "string" ||
          !validEvidence(v.image),
      )
    )
      return {
        error:
          "Проверьте скриншоты: максимум 8 изображений PNG/JPEG до 375 КБ каждое.",
      } as const;
    const remove = p.removeEvidence ?? [];
    if (
      !Array.isArray(remove) ||
      remove.length > 8 ||
      remove.some((id: string) => !isUuid(id))
    )
      throw Error();
    const loot = p.loot ?? [];
    if (
      !Array.isArray(loot) ||
      loot.length > 75 ||
      loot.some(
        (v: {
          id: string;
          version: number;
          quantity: number;
          request_id: string;
        }) =>
          !isUuid(v.id) ||
          !isUuid(v.request_id) ||
          !Number.isSafeInteger(v.version) ||
          v.version < 1 ||
          !Number.isSafeInteger(v.quantity) ||
          v.quantity < 1 ||
          v.quantity > 1000000,
      )
    )
      throw Error();
    const facts = p.facts ?? {};
    if (
      typeof facts !== "object" ||
      facts === null ||
      !["none", "win", "loss", "draw"].includes(facts.pvp_result ?? "none") ||
      [facts.organizer, facts.raid_leader].some((id) => id && !isUuid(id)) ||
      !Array.isArray(facts.full_participation ?? []) ||
      (facts.full_participation ?? []).some((id: string) => !isUuid(id))
    )
      throw Error();
    if (
      (facts.boss_defeated ||
        (facts.pvp_result && facts.pvp_result !== "none") ||
        facts.organizer ||
        facts.raid_leader ||
        (facts.full_participation ?? []).length) &&
      !p.factsConfirmed
    )
      return { error: "Подтвердите факты для достижений." } as const;
    return {
      payload: {
        title: p.title.trim(),
        status: p.status,
        starts_at: starts,
        kind: p.kind,
        source: p.source,
        banner: p.banner || null,
        banner_version: p.bannerVersion || null,
        weight,
        reward_units: reward,
        difficulty: p.difficulty,
        night: p.night === true,
        counts: p.counts !== false,
        description: String(p.description ?? "").slice(0, 4000),
        guests: p.guests.map((n: string) => n.trim()),
        ...(p.members !== undefined
          ? { members: [...new Set(p.members)] }
          : {}),
        confirm_roster: true,
        evidence,
        remove_evidence: remove,
        loot,
        facts,
      },
    } as const;
  } catch {
    return {
      error:
        "Проверьте название, дату, коэффициент, состав и количество дропа.",
    } as const;
  }
}
export function activityError(message: string) {
  for (const [code, label] of Object.entries({
    PERIOD_CLOSED:
      "Расчётный период архивирован. Состав и активности в нём зафиксированы.",
    FORBIDDEN: "Недостаточно прав для этого действия.",
    STALE_VERSION: "Запись уже изменена. Обновите страницу.",
    REQUEST_CONFLICT: "Этот запрос уже сохранён с другими данными.",
    INVALID_ROSTER:
      "Состав содержит недоступного игрока. Обновите список участников.",
    EVENT_IN_FUTURE: "Будущую активность можно только запланировать.",
    EVENT_IN_PAST: "Для прошедшей даты выберите завершённую активность.",
    INVALID_FACTS: "Проверьте подтверждённые факты и участников.",
    CATALOG_STALE:
      "Реестр обновился. Обновите форму и выберите предмет или баннер заново.",
    SOURCE_LOCKED: "Вид активности закреплён уже внесённым дропом.",
    LOOT_HAS_HISTORY:
      "Сначала проверьте дроп и историю продаж: запись связана с учётом казны.",
    EVENT_CLOSED: "Активность отменена или закрыта для этого действия.",
    UNMARKED_MEMBERS:
      "Подтвердите отметки всего состава перед завершением отчёта.",
    EMPTY_ROSTER: "Состав активности не заполнен.",
    TOO_MANY_IMAGES: "Максимум 8 скриншотов на активность.",
    REASON_REQUIRED: "Укажите причину изменения от 3 до 500 символов.",
  }))
    if (message.includes(code)) return label;
  return "Не удалось сохранить активность. Проверьте поля и повторите попытку.";
}
