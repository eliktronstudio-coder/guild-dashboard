type ArchiveError = { code?: string; message?: string };
export function archiveErrorMessage(error: ArchiveError): string {
  const known: Record<string, string> = {
    NO_ACTIVITIES: "В этом диапазоне нет неархивированных активностей.",
    INVALID_PERIOD: "Выберите корректный диапазон до 366 дней без будущих дат.",
    PERIOD_CLOSED:
      "В выбранных датах есть закрытый финансовый период. Выберите другой диапазон.",
    REQUEST_CONFLICT: "Обновите страницу и повторите архивацию.",
    FORBIDDEN: "Недостаточно прав для архивации активностей.",
    ACTIVITY_ARCHIVED:
      "Часть активностей уже архивирована. Обновите список и повторите попытку.",
    REPORT_TOO_LARGE:
      "Выбрано слишком много активностей. Уменьшите диапазон дат.",
  };
  if (error.message && known[error.message]) return known[error.message];
  if (error.code === "57014")
    return "Превышено время ожидания базы данных. Архивация отменена. Повторите попытку.";
  if (error.code === "55P03" || error.code === "40P01")
    return "Активности сейчас изменяются другой операцией. Подождите и повторите архивацию.";
  if (error.code === "42501")
    return "База данных отказала в доступе к архивации. Сообщите администратору. Код: 42501.";
  if (error.code === "PGRST202")
    return "Функция архивации недоступна в API базы данных. Сообщите администратору. Код: PGRST202.";
  const code = /^[A-Z0-9]{5,12}$/.test(error.code ?? "")
    ? error.code
    : "UNKNOWN";
  return `Архивация не выполнена. Сообщите администратору код: ${code}.`;
}
