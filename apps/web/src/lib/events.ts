export const EVENT_KINDS = [
  ["raid", "Рейд"],
  ["pvp", "PvP"],
  ["siege", "Осада"],
  ["farm", "Фарм"],
  ["guild", "Гильдейское событие"],
] as const;
export const EVENT_STATUS: Record<string, string> = {
  scheduled: "Запланировано",
  completed: "Завершено",
  cancelled: "Отменено",
};
export const ATTENDANCE_MARKS = [
  ["present", "Присутствовал"],
  ["absent", "Отсутствовал"],
  ["excused", "Уважительная причина"],
  ["excluded", "Не учитывается"],
] as const;
export function utcInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const full = value.length === 16 ? value + ":00" : value;
  const date = new Date(full + "Z");
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 19) === full
    ? date.toISOString()
    : null;
}
export function monthRange(value: string | undefined) {
  const now = new Date();
  const fallback = now.toISOString().slice(0, 7);
  const month =
    value &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(value) &&
    Number(value.slice(0, 4)) >= 2000 &&
    Number(value.slice(0, 4)) <= 2100
      ? value
      : fallback;
  const from = new Date(month + "-01T00:00:00Z");
  const until = new Date(from);
  until.setUTCMonth(until.getUTCMonth() + 1);
  return { month, from: from.toISOString(), until: until.toISOString() };
}
export const queryValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;
export function eventError(message: string) {
  return (
    (
      {
        FORBIDDEN: "Недостаточно прав. Обновите страницу.",
        STALE_VERSION:
          "Данные уже изменились. Обновите страницу перед сохранением.",
        EVENT_CLOSED: "Событие закрыто.",
        EVENT_NOT_COMPLETED: "Сначала завершите событие.",
        EVENT_IN_FUTURE: "Нельзя завершить будущее событие.",
        EVENT_IN_PAST: "Выберите будущую дату UTC.",
        INVALID_EVENT_TIME:
          "Переносить время можно только до начала события и на будущую дату.",
        UNMARKED_MEMBERS: "Есть участники без отметки. Проверьте весь список.",
        EMPTY_ROSTER: "Нет участников для подтверждения отчёта.",
        NOT_IN_ROSTER: "Участник отсутствует в составе этого события.",
        REASON_REQUIRED: "Укажите причину: от 3 до 500 символов.",
        REQUEST_CONFLICT:
          "Этот запрос уже использован с другими данными. Обновите страницу.",
      } as Record<string, string>
    )[message] ?? "Операция не выполнена. Проверьте данные и повторите позже."
  );
}
export function nicknameOf(value: unknown): string {
  if (Array.isArray(value)) return nicknameOf(value[0]);
  return value &&
    typeof value === "object" &&
    "nickname" in value &&
    typeof value.nickname === "string"
    ? value.nickname
    : "Участник";
}
