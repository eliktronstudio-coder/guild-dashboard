export type PoolPreview = {
  amount_units: string;
  events: {
    id: string;
    title: string;
    boss: string;
    weight: number;
    present: string[];
  }[];
  sales: { id: string; amount_units: string }[];
  recipients: {
    id: string;
    nickname: string;
    weight: string;
    amount_units: string;
  }[];
};
export function poolError(s: string) {
  const errors: Record<string, string> = {
    ALLOCATION_VOIDED: "Этот расчёт уже отменён. Создайте новый расчёт.",
    CALCULATION_CHANGED:
      "Состав, коэффициенты или продажи изменились. Обновите предварительный расчёт.",
    NO_FREE_SALES: "Для выбранных событий нет нераспределённых продаж.",
    ATTENDANCE_REQUIRED:
      "Выберите завершённые события «Прайм» с рейд-боссом и подтверждённой посещаемостью.",
    NO_PRESENT_MEMBERS: "В выбранных событиях нет присутствовавших игроков.",
    AMOUNT_TOO_SMALL: "Фонд слишком мал для начисления каждому участнику.",
    TOO_MANY_SALES: "В расчёте больше 500 продаж. Выберите меньше событий.",
    TOO_MANY_RECIPIENTS: "В расчёте больше 500 игроков.",
    INSUFFICIENT_FUNDS: "В фонде недостаточно свободных средств.",
    INVALID_AMOUNT: "Сумма фонда превышает допустимый предел.",
    USE_POOL: "Для рейд-босса откройте «Распределить фонд по РБ».",
    FORBIDDEN: "Недостаточно прав.",
    REQUEST_CONFLICT: "Этот запрос уже сохранён с другими данными.",
  };
  return (
    errors[s] ??
    "Расчёт не выполнен. Проверьте выбранные события и обновите страницу."
  );
}
