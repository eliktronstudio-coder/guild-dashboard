import { requireMember } from "@/lib/access";
import { GuildShell } from "@/components/shell";
import { monthRange } from "@/lib/events";
export const metadata = { title: "Экспорт данных" };
export default async function Page() {
  const a = await requireMember();
  const members = await a.permission("members.read");
  const manage = await a.permission("attendance.manage");
  return (
    <GuildShell current="/account">
      <div className="page-heading">
        <h1>Экспорт данных</h1>
        <p className="muted">
          CSV для таблиц. Выгружаются только доступные вам данные.
        </p>
      </div>
      {members && (
        <section className="panel section-panel">
          <h2>Активный состав</h2>
          <p>
            Полный активный состав, персонажи и роли. Поиск и фильтры списка
            здесь не применяются.
          </p>
          <a className="button secondary inline" href="/exports/members">
            Скачать состав
          </a>
        </section>
      )}
      <section className="panel section-panel">
        <h2>{manage ? "Посещаемость гильдии" : "Моя посещаемость"}</h2>
        <form action="/exports/attendance">
          <label>
            Месяц UTC
            <input
              type="month"
              name="month"
              required
              min="2000-01"
              max="2100-12"
              defaultValue={monthRange(undefined).month}
            />
          </label>
          <button className="button secondary">Скачать посещаемость</button>
        </form>
        <p className="caption">
          Только подтверждённые отчёты. Пустой процент означает «Нет данных».
          Максимум 5000 строк; больший отчёт не выгружается частично.
        </p>
      </section>
    </GuildShell>
  );
}
