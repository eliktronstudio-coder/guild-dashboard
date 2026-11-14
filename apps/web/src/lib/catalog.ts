export function parseWeight(value: string, player = false) {
  const text = value.trim().replace(",", ".");
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return n >= (player ? 20 : 1) && n <= (player ? 125 : 100000) ? n : null;
}
export const weightLabel = (n: number) => (n / 100).toLocaleString("ru-RU");
export function catalogError(message: string) {
  if (message.includes("STALE_VERSION"))
    return "Данные изменились. Обновите страницу перед сохранением.";
  if (message.includes("duplicate key"))
    return "Такое название уже есть в справочнике.";
  if (message.includes("EVENT_LOCKED"))
    return "Для события уже есть начисления или оно отменено.";
  return "Не удалось сохранить. Проверьте поля и права доступа.";
}
