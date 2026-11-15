import Link from "next/link";
import { getAccess } from "@/lib/access";
import { getConfig } from "@/lib/config";
import { canAttachEmailLogin } from "@/lib/email-login";
import { GuildShell } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { connectEmailLogin } from "./actions";
export const metadata = { title: "Альтернативный вход по email" };
export default async function Page() {
  const { user, membership } = await getAccess();
  const canConnect = getConfig().email && canAttachEmailLogin(user);
  return (
    <GuildShell current="/account">
      <div className="page-heading">
        <p className="eyebrow">МОЙ АККАУНТ</p>
        <h1>Вход без Telegram</h1>
      </div>
      <section className="panel section-panel narrow">
        <h2>{membership?.nickname ?? "Ваш существующий аккаунт"}</h2>
        <p>
          Подключите email и пароль к этому аккаунту. Игровой ник, роль,
          посещаемость, дроп, начисления и выплаты сохранятся. Вход через
          Telegram останется доступен.
        </p>
        {canConnect ? (
          <>
            <p className="notice">
              Подтверждение email письмом и восстановление пароля письмом пока
              не подключены. Укажите свой адрес и сохраните пароль.
            </p>
            <ActionForm
              action={connectEmailLogin}
              label="Подключить вход по email"
            >
              <label>
                Email
                <input
                  type="email"
                  name="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  defaultValue={user.email ?? ""}
                />
              </label>
              <label>
                Пароль
                <input
                  type="password"
                  name="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </label>
              <label>
                Повторите пароль
                <input
                  type="password"
                  name="confirmation"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </label>
              <label className="check">
                <input type="checkbox" name="confirm" required />
                <span>
                  Подключить email к моему текущему аккаунту. Адрес принадлежит
                  мне; пароль сохранён.
                </span>
              </label>
            </ActionForm>
          </>
        ) : (
          <p className="notice">
            {user.identities?.some((i) => i.provider === "email")
              ? `Вход по email уже подключён: ${user.email}. Используйте этот адрес и пароль на странице входа.`
              : "Подключение email для этого аккаунта сейчас недоступно. Обратитесь к администратору."}
          </p>
        )}
        <Link href="/account" className="text-button">
          ← Мой аккаунт
        </Link>
      </section>
    </GuildShell>
  );
}
