import Link from "next/link";
import { getAccess } from "@/lib/access";
import { getConfig } from "@/lib/config";
import { GuildShell } from "@/components/shell";
import { signOut } from "@/app/actions";
export const metadata = { title: "Мой аккаунт" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const a = await getAccess();
  const { notice } = await searchParams;
  return (
    <GuildShell current="/account">
      <div className="page-heading">
        <p className="eyebrow">ЛИЧНЫЙ КАБИНЕТ</p>
        <h1>Мой аккаунт</h1>
        <p className="muted">Данные, по которым гильдия узнаёт вас.</p>
      </div>
      <section className="panel section-panel narrow">
        <h2>{a.membership?.nickname ?? "Игровой ник ещё не выбран"}</h2>
        <dl className="account-details">
          <dt>Почта</dt>
          <dd>{a.user.email ?? "Не привязана"}</dd>
          <dt>Вход через Telegram</dt>
          <dd>
            {a.user.identities?.some((i) => i.provider === "custom:telegram")
              ? "Подключён через подтверждённый аккаунт"
              : "Не подключён"}
          </dd>
          <dt>Статус</dt>
          <dd>
            {a.membership?.status === "active"
              ? "Участник гильдии"
              : "Ожидает вступления"}
          </dd>
        </dl>
        {!a.membership && (
          <Link className="button secondary inline" href="/onboarding">
            Указать игровой ник
          </Link>
        )}
        {getConfig().email && a.user.email && (
          <Link className="button secondary inline" href="/account/password">
            Изменить пароль
          </Link>
        )}
        {a.membership?.status === "active" && (
          <Link
            className="button secondary inline"
            href={`/members/${a.membership.id}`}
          >
            Мой профиль и персонажи
          </Link>
        )}
        {a.membership?.status === "active" && (
          <p>
            <Link href="/account/telegram" className="text-button">
              Telegram-бот и уведомления →
            </Link>
          </p>
        )}
        {a.membership?.status === "active" && (
          <Link href="/treasury#my-payments" className="text-button">
            Мои начисления и выплаты →
          </Link>
        )}
      </section>
      <section className="panel section-panel narrow">
        <h2>Сессии</h2>
        <p className="muted">
          Выход на всех устройствах немедленно закрывает доступ к данным гильдии
          на сайте. Потребуется повторный вход. Привязка Telegram-бота
          отключается отдельно в его настройках.
        </p>
        {notice === "revoke_failed" && (
          <p className="notice error" role="alert">
            Не удалось завершить все сессии. Повторите попытку.
          </p>
        )}
        <form action={signOut} className="form-stack">
          <input type="hidden" name="scope" value="global" />
          <label className="check">
            <input name="confirm" type="checkbox" required />
            <span>Завершить все мои сессии</span>
          </label>
          <button className="button secondary">
            Выйти на всех устройствах
          </button>
        </form>
      </section>
    </GuildShell>
  );
}
