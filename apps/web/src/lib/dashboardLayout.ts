/**
 * Пользовательская раскладка панелей дашборда: ширина в колонках 12-колоночной
 * сетки, высота в пикселях и порядок. Хранится в браузере — раскладка своя на
 * каждом устройстве и не требует ни миграции БД, ни запросов на сервер.
 */

export type PanelLayout = {
  id: string;
  /** Ширина в колонках 12-колоночной сетки (от 3 до 12). */
  span: number;
  /** Высота в пикселях; null — по содержимому. */
  height: number | null;
  hidden?: boolean;
};

export const MIN_SPAN = 3;
export const MAX_SPAN = 12;
export const MIN_HEIGHT = 200;
export const MAX_HEIGHT = 1200;

const STORAGE_KEY = "xd-dashboard-layout-v1";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Приводит сохранённую раскладку к актуальному набору панелей: незнакомые id
 * отбрасываются, новые панели добавляются в конец. Без этого добавление панели
 * в код ломало бы дашборд у всех, кто уже что-то настроил.
 */
export function reconcileLayout(
  raw: string | null,
  defaults: PanelLayout[],
): PanelLayout[] {
  let saved: unknown = null;
  try {
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  if (!Array.isArray(saved)) return defaults;

  const byId = new Map(defaults.map((d) => [d.id, d]));
  const result: PanelLayout[] = [];
  for (const entry of saved) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, span, height } = entry as Partial<PanelLayout>;
    if (
      typeof id !== "string" ||
      !byId.has(id) ||
      result.some((r) => r.id === id)
    )
      continue;
    result.push({
      id,
      hidden: (entry as PanelLayout).hidden === true,
      span: clamp(
        Math.round(Number(span) || byId.get(id)!.span),
        MIN_SPAN,
        MAX_SPAN,
      ),
      height:
        typeof height === "number" && Number.isFinite(height)
          ? clamp(Math.round(height), MIN_HEIGHT, MAX_HEIGHT)
          : null,
    });
  }
  for (const d of defaults) {
    if (!result.some((r) => r.id === d.id)) result.push(d);
  }
  return result;
}

const listeners = new Set<() => void>();
let cached: string | null = null;
let cacheValid = false;

function emit() {
  cacheValid = false;
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  // Раскладка может измениться в другой вкладке.
  const onStorage = () => {
    cacheValid = false;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Сырая строка из localStorage; кэшируется, чтобы значение было стабильным в пределах рендера. */
export function getSnapshot() {
  if (!cacheValid) {
    try {
      cached = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      cached = null;
    }
    cacheValid = true;
  }
  return cached;
}

/** На сервере раскладки нет — рендерится раскладка по умолчанию. */
export function getServerSnapshot(): string | null {
  return null;
}

export function saveLayout(layout: PanelLayout[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Приватный режим/переполнение — раскладка просто не сохранится.
  }
  emit();
}

export function resetLayout() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // см. выше
  }
  emit();
}
