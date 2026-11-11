import Link from "next/link";
import { getConfig } from "@/lib/config";
import { PublicFrame } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { login, signUp, telegramLogin } from "@/app/actions";
import { PlayerClassField } from "@/components/members/player-class-field";
export const metadata = { title: "Вход в гильдию" };
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; notice?: string }>;
}) {
  const { mode, notice } = await searchParams;
  const c = getConfig(),
    register = mode === "register";
  const notices: Record<string, string> = {
    callback: "Ссылка недействительна или истекла. Попробуйте войти снова.",
    provider: "Telegram пока не подключён или временно недоступен.",
    access:
      "Сессия завершена или доступ ограничен. Войдите заново; если это не поможет, обратитесь к администрации.",
    password: "Пароль обновлён. Войдите с новым паролем.",
    password_sessions:
      "Пароль обновлён. Проверьте завершение сессий в аккаунте.",
  };
  return (
    <PublicFrame
      title={"Ваша гильдия.\nВаш следующий горизонт."}
      subtitle="Состав, события и общие цели — в одном пространстве гильдии XD."
    >
      <p className="eyebrow">ДОБРО ПОЖАЛОВАТЬ В XD</p>
      <h2>{register ? "Начните свой путь" : "С возвращением"}</h2>
      <p className="muted">
        {register
          ? "Создайте аккаунт и получите доступ сразу — без ожидания одобрения."
          : "Войдите, чтобы продолжить путь вместе с гильдией."}
      </p>
      {notice && (
        <p role="status" className="notice">
          {notices[notice] ?? "Повторите вход."}
        </p>
      )}
      {!c.configured && (
        <p className="notice">
          Подключение гильдии ещё настраивается. Вход станет доступен после
          подключения базы и авторизации. <Link href="/setup">Подробнее</Link>
        </p>
      )}
      <form action={telegramLogin}>
        <button className="button telegram" disabled={!c.telegram}>
          Войти через Telegram <span aria-hidden="true">↗</span>
        </button>
      </form>
      {!c.telegram && <p className="caption">Telegram ещё не подключён</p>}
      <div className="divider">
        <span>или по почте</span>
      </div>
      {c.email ? (
        <ActionForm
          action={register ? signUp : login}
          label={register ? "Создать аккаунт" : "Войти"}
        >
          <label>
            {register ? "Электронная почта" : "Email или логин"}
            <input
              name={register ? "email" : "identifier"}
              type={register ? "email" : "text"}
              autoComplete={register ? "email" : "username"}
              required
              maxLength={254}
              placeholder={register ? "you@example.com" : "Email или логин"}
            />
          </label>
          {register && (
            <label>
              Логин
              <input
                name="login"
                autoComplete="username"
                required
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z][A-Za-z0-9_.\-]{2,31}"
                placeholder="Например, dragon_xd"
                aria-describedby="login-help"
              />
              <span id="login-help" className="caption">
                3–32 символа: латинские буквы, цифры, точка, дефис,
                подчёркивание.
              </span>
            </label>
          )}
          <label>
            Пароль
            <input
              name="password"
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              required
              minLength={register ? 12 : 1}
              maxLength={128}
              placeholder={register ? "Не менее 12 символов" : "Ваш пароль"}
            />
          </label>
          {register && (
            <>
              <label>
                Повторите пароль
                <input
                  name="confirmation"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                />
              </label>
              <label>
                Ник в игре
                <input
                  name="nickname"
                  required
                  minLength={2}
                  maxLength={32}
                  autoComplete="off"
                  placeholder="Ваш ник в ArcheAge"
                />
              </label>
              <p className="caption">
                Ник: 2–32 символа. Русские или латинские буквы, без смешивания
                алфавитов.
              </p>
              <PlayerClassField />
              <label className="check">
                <input type="checkbox" name="rules" required />
                <span>
                  Принимаю{" "}
                  <Link href="/rules" target="_blank">
                    правила гильдии
                  </Link>
                </span>
              </label>
              <label className="check">
                <input type="checkbox" name="privacy" required />
                <span>
                  Согласен на{" "}
                  <Link href="/privacy" target="_blank">
                    обработку необходимых данных
                  </Link>
                </span>
              </label>
              <label className="registration-honeypot" aria-hidden="true">
                Сайт
                <input name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </>
          )}
        </ActionForm>
      ) : (
        <p className="notice subtle">
          {register
            ? "Регистрация временно недоступна."
            : "Вход по почте ещё не подключён."}
        </p>
      )}
      <div className="form-links">
        <Link href={register ? "/login" : "/login?mode=register"}>
          {register ? "Уже есть аккаунт" : "Создать аккаунт"}
        </Link>
        {!register && c.emailDelivery && (
          <Link href="/forgot-password">Забыли пароль?</Link>
        )}
      </div>
      <p className="caption auth-foot">
        Свободная регистрация без подтверждения email. Указывайте свой адрес и
        сохраняйте пароль: восстановление письмом пока не подключено.
      </p>
    </PublicFrame>
  );
}
