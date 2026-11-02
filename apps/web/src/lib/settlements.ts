export type AllocationPreview = {
  sale_id: string;
  source: "prime" | "mini_rb";
  amount_units: string;
  recipients: { id: string; nickname: string; amount_units: string }[];
};
export type AwardAccount = {
  id: string;
  allocation_id: string;
  membership_id: string;
  nickname: string;
  nickname_snapshot: string;
  amount_units: string;
  paid_units: string;
  pending_units: string;
  version: number;
  allocation_voided_at: string | null;
  source: "prime" | "mini_rb";
  event_title: string;
  reason: string;
};
export type AllocationLog = {
  id: string;
  sale_id: string;
  reason: string;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
  recipient_count: number;
  source: string;
  amount_units: string;
  item_name: string;
  event_title: string;
};
export type PayoutLog = {
  id: string;
  nickname_snapshot: string;
  amount_units: string;
  reference: string;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
  source: string;
};
export type ExpenseLog = {
  id: string;
  amount_units: string;
  purpose: string;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
};
export type PersonalTreasury = {
  allocated_units: string;
  paid_units: string;
  pending_units: string;
};
export function settlementError(message: string) {
  const messages: Record<string, string> = {
    ATTENDANCE_REQUIRED:
      "Сначала подтвердите отчёт посещаемости активности. Непроверенный состав не используется для начислений и выплат.",
    ATTENDANCE_CHANGED:
      "Состав присутствовавших изменился. Проверьте актуальный расчёт; ранее начисленное и выплаченное автоматически не меняется.",
    NO_PRESENT_MEMBERS: "В подтверждённом отчёте нет присутствовавших игроков.",
    SOURCE_NOT_DISTRIBUTED:
      "Выручка мини РБ пока остаётся в своей казне и не распределяется.",
    TOO_MANY_RECIPIENTS:
      "В этой версии можно начислить доли максимум 500 участникам одной продажи.",
    ALREADY_ALLOCATED:
      "Эта продажа уже распределена. Откройте существующие начисления.",
    INVALID_RECIPIENTS:
      "Список получателей не прошёл проверку. Обновите расчёт.",
    AMOUNT_TOO_SMALL:
      "Суммы недостаточно для минимальной доли каждому присутствовавшему.",
    INSUFFICIENT_FUNDS:
      "В выбранной казне недостаточно доступного золота. Другие казны не используются.",
    OVERPAYMENT: "Выплата превышает остаток обязательства перед игроком.",
    HAS_PAYOUTS:
      "По начислению есть выплаты. Сначала проверьте их; отмена начисления не возвращает переданное игрокам золото.",
    ALLOCATION_VOIDED: "Начисление отменено; новая выплата по нему невозможна.",
    PAYOUT_VOIDED:
      "Эта выплата уже отменена. Для новой записи используйте новый запрос.",
    EXPENSE_VOIDED:
      "Этот расход уже отменён. Для новой записи используйте новый запрос.",
    ALLOCATION_EXISTS:
      "Продажа уже распределена. Сначала разберите связанные начисления и выплаты.",
    FUNDS_SPENT:
      "Часть поступления уже потрачена или зарезервирована. Отмена продажи сейчас нарушит остатки казны.",
  };
  return messages[message];
}
