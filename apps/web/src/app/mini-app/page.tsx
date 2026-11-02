import { botConfig } from "@/lib/telegram/server";
import { MiniApp } from "@/components/telegram/mini-app";
export const metadata = { title: "Личный кабинет в Telegram" };
export default function Page() {
  const c = botConfig();
  const enabled = c.ready && process.env.TELEGRAM_MINI_APP_ENABLED === "true";
  return (
    <main id="main" className="mini-app">
      <header className="mini-heading">
        <p className="eyebrow">XD · TELEGRAM</p>
        <h1>Мой кабинет</h1>
        <p className="muted">Ваша гильдия — рядом.</p>
      </header>
      {enabled ? (
        <MiniApp origin={c.origin} botName={c.username} />
      ) : (
        <section
          className="panel section-panel"
          aria-labelledby="mini-unavailable"
        >
          <h2 id="mini-unavailable">Мини-приложение ещё не подключено</h2>
          <p>
            Администратор готовит доступ. Пока пользуйтесь сайтом и доступными
            командами бота.
          </p>
          <a href="/account" className="text-button">
            Открыть кабинет на сайте →
          </a>
        </section>
      )}
      <noscript>
        Для кабинета в Telegram включите JavaScript. Также доступен сайт XD.
      </noscript>
    </main>
  );
}
