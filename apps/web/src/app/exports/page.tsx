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
      <section className="panel section-panel">
        <h2>Начисления и выплаты</h2>
        <p>
          Ваши записи; сотрудники с финансовыми полномочиями получают доступные
          им записи гильдии.
        </p>
        {(
          [
            ["awards", "Скачать начисления"],
            ["payouts", "Скачать выплаты"],
          ] as const
        ).map(([kind, label]) => (
          <form key={kind} action={`/exports/${kind}`}>
            <label>
              Месяц создания записи UTC
              <input
                type="month"
                name="month"
                required
                min="2000-01"
                max="2100-12"
                defaultValue={monthRange(undefined).month}
              />
            </label>
            <button className="button secondary">{label}</button>
          </form>
        ))}
        <p className="caption">
          Отменённые записи включены с датой отмены. Выплачено и к выплате в
          отчёте начислений — текущие суммы по этим начислениям за всё время.
          Золото записано точно, десятичный разделитель — запятая. Максимум 5000
          строк.
        </p>
      </section>
    </GuildShell>
  );
}
