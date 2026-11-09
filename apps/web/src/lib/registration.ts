import { nicknameError, normalizeNickname } from "./identity";
export function normalizeLogin(value: string) {
  return value.trim().toLowerCase();
}
export function loginError(value: string): string | null {
  return /^[a-z][a-z0-9_.-]{2,31}$/.test(value)
    ? null
    : "Логин: от 3 до 32 символов, латинские буквы, цифры, точка, дефис или подчёркивание. Начните с буквы.";
}
export function registrationInput(form: FormData) {
  const value = (key: string) =>
    typeof form.get(key) === "string" ? String(form.get(key)) : "";
  const email = value("email").trim().toLowerCase(),
    login = normalizeLogin(value("login")),
    nickname = normalizeNickname(value("nickname")),
    password = value("password");
  const error =
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254
      ? "Укажите корректный email."
      : (loginError(login) ??
        nicknameError(nickname) ??
        (password.length < 12 || password.length > 128
          ? "Пароль должен содержать от 12 до 128 символов."
          : password !== value("confirmation")
            ? "Пароли не совпадают."
            : value("rules") !== "on" || value("privacy") !== "on"
              ? "Подтвердите правила и обработку данных."
              : value("website")
                ? "Не удалось зарегистрироваться."
                : null));
  return { email, login, nickname, password, error };
}
