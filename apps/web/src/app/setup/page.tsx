import Link from "next/link";
import { PublicFrame } from "@/components/shell";
export const metadata = { title: "Подключение гильдии" };
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ problem?: string }>;
}) {
  const { problem } = await searchParams;
  return (
    <PublicFrame
      title={"Новая глава\nгильдии XD"}
      subtitle="Основа командного центра готовится к первому запуску."
    >
      <p className="eyebrow">ПОДГОТОВКА К ЗАПУСКУ</p>
      <h2>
        {problem === "database"
          ? "Сервис временно недоступен"
          : "Гильдия скоро откроется"}
      </h2>
      <p className="muted">
        {problem === "database"
          ? "Не удалось получить данные. Повторите попытку позже или сообщите администратору."
          : "Администратор подключает хранение данных и вход в аккаунт. После этого вы сможете отправить заявку со своим игровым ником."}
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
