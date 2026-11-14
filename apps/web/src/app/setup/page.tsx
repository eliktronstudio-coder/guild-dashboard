import Link from "next/link";
import { PublicFrame } from "@/components/shell";
export const metadata = { title: "Подключение гильдии" };
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ problem?: string }>;
}) {
  const { problem } = await searchParams;
  if (problem === "database")
    return (
      <PublicFrame
        eyebrow="XD · ВОССТАНОВЛЕНИЕ СОЕДИНЕНИЯ"
        title="Не удалось\nзагрузить данные"
        subtitle="Повторите загрузку командного центра."
      >
        <h2>Соединение временно недоступно</h2>
        <p className="muted">
          Не удалось связаться с базой данных. Повторите попытку; если ошибка
          сохраняется, сообщите администрации.
        </p>
        <Link className="button primary" href="/dashboard" prefetch={false}>
          Повторить загрузку <span>↗</span>
        </Link>
      </PublicFrame>
    );
  return (
    <PublicFrame
      title={"Новая глава\nгильдии XD"}
      subtitle="Основа командного центра готовится к первому запуску."
    >
      <p className="eyebrow">ПОДГОТОВКА К ЗАПУСКУ</p>
      <h2>Гильдия скоро откроется</h2>
      <p className="muted">
        Администратор подключает хранение данных и вход в аккаунт. После этого
        вы сможете отправить заявку со своим игровым ником.
      </p>
      <ol className="steps">
        <li>
          <span>01</span>
          <div>
            <strong>Подтверждённый вход</strong>
            <p>Через Telegram или электронную почту.</p>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <strong>Ваш игровой ник</strong>
            <p>Администрация должна узнать вас в игре.</p>
          </div>
        </li>
        <li>
          <span>03</span>
          <div>
            <strong>Добро пожаловать в XD</strong>
            <p>Доступ после одобрения заявки.</p>
          </div>
        </li>
      </ol>
      <Link className="button primary" href="/login">
        К странице входа <span>↗</span>
      </Link>
    </PublicFrame>
  );
}
