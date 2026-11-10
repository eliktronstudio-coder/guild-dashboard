export const TREASURY_SOURCES = [
  ["none", "Без пометки"],
  ["prime", "Прайм"],
  ["mini_rb", "Мини РБ"],
] as const;
export type TreasurySource = "prime" | "mini_rb";
export const inventoryName = (source: TreasurySource) =>
  source === "prime" ? "Общий инвентарь" : "Инвентарь ХД";
export const sourceName = (source: string) =>
  TREASURY_SOURCES.find(([key]) => key === source)?.[1] ?? "Без пометки";
const SCALE = 10000n;
export const MAX_AMOUNT_UNITS = 100000000000000n;
/** Exact conversion; never parse money with Number/parseFloat. */
export function parseGold(value: string): string | null {
  const text = value.trim();
  if (!/^\d{1,11}([.,]\d{1,4})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.replace(",", ".").split(".");
  const units = BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, "0"));
  return units <= MAX_AMOUNT_UNITS ? units.toString() : null;
}
export function goldInput(units: string | null): string {
  if (units === null) return "";
  const n = BigInt(units);
  const fraction = (n % SCALE).toString().padStart(4, "0").replace(/0+$/, "");
  return `${n / SCALE}${fraction ? "." + fraction : ""}`;
}
export function formatGold(units: string): string {
  const [whole, fraction] = goldInput(units).split(".");
  return (
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f") +
    (fraction ? "," + fraction : "")
  );
}
export function splitSale(units: string, source: TreasurySource) {
  const gross = BigInt(units),
    guild = source === "prime" ? (gross * 3n) / 10n : 0n;
  return { guild: guild.toString(), fund: (gross - guild).toString() };
}
export function treasuryError(message: string) {
  const messages: Record<string, string> = {
    PERIOD_CLOSED:
      "Период закрыт. Его исходные операции зафиксированы в архиве.",
    FORBIDDEN: "Недостаточно прав. Обновите страницу.",
    STALE_VERSION:
      "Партия или событие уже изменились. Обновите страницу перед сохранением.",
    SOURCE_LOCKED: "По событию уже внесён дроп. Его пометку менять нельзя.",
    SOURCE_REQUIRED: "Сначала укажите пометку «Прайм» или «Мини РБ» в событии.",
    EVENT_NOT_COMPLETED: "Дроп можно внести только для завершённого события.",
    EVENT_CLOSED: "Отменённое событие недоступно.",
    INVALID_AMOUNT:
      "Укажите положительную сумму продажи, не более 10 000 000 000 золота.",
    INVALID_QUANTITY: "Количество должно быть целым, от 1 до 1 000 000.",
    QUANTITY_BELOW_SOLD:
      "Общее количество не может быть меньше уже проданного.",
    INSUFFICIENT_STOCK: "В партии недостаточно предметов. Обновите остаток.",
    REQUEST_CONFLICT:
      "Этот запрос уже сохранён с другими данными. Обновите страницу.",
    SALE_VOIDED:
      "Эта продажа уже отменена. Для новой продажи откройте партию заново.",
    REASON_REQUIRED: "Укажите причину от 3 до 500 символов.",
  };
  return (
    messages[message] ??
    "Изменение не сохранено. Проверьте поля и права доступа."
  );
}
export type TreasuryTotals = {
  archive_prime_units?: string;
  archive_mini_units?: string;
  archive_guild_units?: string;
  prime_units: string;
  prime_gross_units: string;
  mini_units: string;
  guild_units: string;
  prime_reserved_units: string;
  mini_reserved_units: string;
  prime_free_units: string;
  mini_free_units: string;
  guild_expense_units: string;
  inventory_units: string;
  general_units: string;
  xd_units: string;
  sales_count: number;
  stock_count: number;
  priced_count: number;
  unpriced_count: number;
};
export type Loot = {
  archived_period?: string | null;
  id: string;
  event_id: string;
  source: TreasurySource;
  name: string;
  category: string;
  quantity_total: number;
  quantity_remaining: number;
  estimated_unit_units: string | null;
  estimated_total_units: string | null;
  note: string;
  version: number;
  event_title: string;
};
export type TreasurySale = {
  id: string;
  source: TreasurySource;
  item_name: string;
  event_id: string;
  event_title: string;
  quantity: number;
  gross_units: string;
  guild_units: string;
  fund_units: string;
  note: string;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
};
