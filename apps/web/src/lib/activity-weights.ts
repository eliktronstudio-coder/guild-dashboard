const normalizeName = (name: string) => name.trim().toLowerCase();

/**
 * Коэффициент активности для расчёта посещаемости Прайма — не каждый поход
 * считается за одинаковую "единицу": лёгкий контент даёт меньше, тяжёлый
 * (разъярённые боссы) — больше. Заданы вручную гильдией.
 */
const ACTIVITY_WEIGHTS: Record<string, number> = {
  агл: 0.5,
  "агл т2": 1,
  авиара: 0.75,
  алтарь: 1,
  анталлон: 1,
  жук: 0.5,
  калидис: 0.5,
  калиель: 0.5,
  кошка: 1,
  кракен: 0.5,
  ксанатос: 0.5,
  левиафан: 1,
  "разъярённый левиафан": 1.5,
  "разъяренный левиафан": 1.5,
  месания: 0.75,
  "разъяренный морфеос": 1,
  "разъярённый морфеос": 1,
  "разъярённый кракен": 0.5,
  "разъяренный кракен": 0.5,
  фесаникс: 1,
};

const DEFAULT_WEIGHT = 1;

const isWordChar = (ch: string | undefined) =>
  ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/**
 * Ищет самое длинное известное название из списка ключей, встречающееся в
 * названии активности как отдельное слово — активности из игры называются
 * длиннее записи в таблице ("АГЛ Т1" -> "агл", "АГЛ Т2" -> "агл т2", "Кошка
 * (вечер)" -> "кошка"). Специально БЕЗ опечаточной устойчивости (в отличие
 * от findLabelMatch для баннеров, там OCR-ошибки) — здесь название вводит
 * админ вручную, а результат влияет на зарплату, так что нечёткое совпадение
 * рискованно.
 */
function matchLongestWord(raw: string, keys: string[]): string | null {
  const normalized = normalizeName(raw);
  let best: string | null = null;
  for (const key of keys) {
    let from = 0;
    for (;;) {
      const at = normalized.indexOf(key, from);
      if (at < 0) break;
      const boundaryOk =
        !isWordChar(normalized[at - 1]) &&
        !isWordChar(normalized[at + key.length]);
      if (boundaryOk) {
        if (!best || key.length > best.length) best = key;
        break;
      }
      from = at + 1;
    }
  }
  return best;
}

/**
 * Вес активности для расчёта посещаемости Прайма. PvP всегда 1, независимо
 * от названия — активность попадает в Прайм именно за счёт режима, а не
 * содержимого таблицы коэффициентов.
 */
export function activityAttendanceWeight(name: string, mode: string): number {
  if (mode === "PvP") return 1;
  const key = matchLongestWord(name, Object.keys(ACTIVITY_WEIGHTS));
  return key ? ACTIVITY_WEIGHTS[key] : DEFAULT_WEIGHT;
}

/**
 * Какая казна засчитывает активность для целей посещаемости — определяется
 * по названию, а не по категории, которую выбрал админ при создании: АГЛ,
 * АГЛ Т2 и Кошка всегда Мини-РБ, всё остальное — Прайм. PvP — всегда Прайм,
 * даже если по случайности совпало бы с одним из названий выше.
 */
const MINI_RB_NAMES = ["агл", "агл т2", "кошка"];

export function resolveAttendanceFund(
  name: string,
  mode: string,
): "Прайм" | "Мини-РБ" {
  if (mode === "PvP") return "Прайм";
  return matchLongestWord(name, MINI_RB_NAMES) ? "Мини-РБ" : "Прайм";
}
