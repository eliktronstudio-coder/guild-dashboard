export function normalizeNickname(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}
export function nicknameError(value: string): string | null {
  const nick = normalizeNickname(value);
  if (nick.length < 2 || nick.length > 32)
    return "Ник должен содержать от 2 до 32 символов.";
  if (
    !/^[A-Za-zА-Яа-яЁё0-9 _-]+$/u.test(nick) ||
    !/[A-Za-zА-Яа-яЁё]/u.test(nick)
  )
    return "Используйте русские или латинские буквы, цифры, пробел, дефис и подчёркивание.";
  if (/[A-Za-z]/u.test(nick) && /[А-Яа-яЁё]/u.test(nick))
    return "Не смешивайте русские и латинские буквы в одном нике.";
  return null;
}
export function safeNext(value: string | null) {
  return ["/onboarding", "/dashboard", "/account/password"].includes(
    value ?? "",
  )
    ? value!
    : "/onboarding";
}
export type FormState = { error?: string; success?: string };
export function messageFor(error: { message: string }): string {
  const messages: Record<string, string> = {
    NICKNAME_UNAVAILABLE:
      "Этот ник или визуально похожий вариант уже занят. Свяжитесь с администрацией, если это ваш персонаж.",
    CONSENT_REQUIRED: "Подтвердите оба согласия.",
    INVALID_NICKNAME: "Проверьте игровой ник.",
    FORBIDDEN: "Недостаточно прав. Обновите страницу.",
    AUTH_REQUIRED: "Войдите заново.",
    SELF_REVIEW_FORBIDDEN: "Нельзя рассматривать собственную заявку.",
    ALREADY_REVIEWED:
      "По заявке уже принято другое решение. Обновите страницу.",
    OWNER_PROTECTED: "Эта операция недоступна для главного администратора.",
    REASON_REQUIRED: "Укажите причину отказа: от 3 до 500 символов.",
    ACCOUNT_BLOCKED: "Аккаунт заблокирован.",
    TRY_LATER: "Повторную заявку можно отправить через минуту.",
    ALREADY_MEMBER: "Вы уже состоите в гильдии.",
  };
  return (
    messages[error.message] ??
    "Операция не выполнена. Повторите позже; если ошибка сохранится, сообщите администратору."
  );
}
