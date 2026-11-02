import Link from "next/link";
import { getConfig } from "@/lib/config";
import { PublicFrame } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { login, signUp, telegramLogin } from "@/app/actions";
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
          ? "Подтвердите аккаунт, укажите игровой ник и отправьте заявку."
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
      {c.email && (!register || c.emailDelivery) ? (
        <ActionForm
          action={register ? signUp : login}
          label={register ? "Создать аккаунт" : "Войти"}
        >
          <label>
            Электронная почта
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              placeholder="you@example.com"
            />
          </label>
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
        </ActionForm>
      ) : (
        <p className="notice subtle">
          {register
            ? "Регистрация по почте появится после проверки отправки писем."
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
        Доступ в гильдию открывается после проверки игрового ника
        администрацией.
      </p>
    </PublicFrame>
  );
}
