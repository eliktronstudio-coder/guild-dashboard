import Link from "next/link";
import { requireMember } from "@/lib/access";
import { GuildShell } from "@/components/shell";
import { BarChart } from "@/components/dashboard/charts";
import {
  dashboardPeriod,
  dashboardDate,
  type DashboardReport,
} from "@/lib/dashboard";
import { formatGold } from "@/lib/treasury";
export const metadata = { title: "Обзор гильдии" };
const percent = (v: number | null) =>
  v === null ? "Нет данных" : `${v.toLocaleString("ru-RU")}%`;
function Stat({
  title,
  value,
  note,
}: {
  title: string;
  value: string | number;
  note: string;
}) {
  return (
    <article className="panel stat">
      <p>{title}</p>
      <strong className="dashboard-value">{value}</strong>
      <span className="caption">{note}</span>
    </article>
  );
}
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { client, membership } = await requireMember();
  const range = dashboardPeriod(await searchParams);
  const response = range.error
    ? null
    : await client.rpc("dashboard_report", {
        p_from: range.from + "T00:00:00.000Z",
        p_until: range.until,
      });
  const data = response?.error
    ? null
    : (response?.data as DashboardReport | null);
  const money = (units: string) => `${formatGold(units)} зол.`;
  return (
    <GuildShell current="/dashboard">
      <section className="welcome dashboard-welcome">
        <p className="eyebrow">XD / ХД · КОМАНДНЫЙ ЦЕНТР</p>
        <h1>
          Наш общий путь,
          <br />
          <em>{membership!.nickname}</em>
        </h1>
        <p>События, вклад участников и золото гильдии.</p>
      </section>
      <section className="panel section-panel" aria-label="Период статистики">
        <form method="get" className="dashboard-filters">
          <label>
            Период
            <select name="period" defaultValue={range.period}>
              <option value="week">Эта неделя</option>
              <option value="month">Этот месяц</option>
              <option value="custom">Свои даты</option>
              <option value="season" disabled>
                Сезон — даты не заданы
              </option>
            </select>
          </label>
          <label>
            С
            <input
              type="date"
              name="from"
              defaultValue={range.from}
              min="2000-01-01"
              max="2099-12-31"
            />
          </label>
          <label>
            По
            <input
              type="date"
              name="to"
              defaultValue={range.to}
              min="2000-01-01"
              max="2099-12-31"
            />
          </label>
          <button className="button primary" type="submit">
            Показать
          </button>
        </form>
        <p className="caption">
          Поля дат применяются в режиме «Свои даты». Обе даты включены; время
          UTC. Сезон пока без дат.
        </p>
        {range.error ? (
          <p role="alert">{range.error}</p>
        ) : (
          <p className="caption">
            Период: {dashboardDate(range.from)} — {dashboardDate(range.to)}.
            Неделя начинается в понедельник.
          </p>
        )}
      </section>
      {response?.error && (
        <section className="panel section-panel" role="alert">
          <h2>Статистика недоступна</h2>
          <p>
            Не удалось загрузить показатели. Повторите попытку или обратитесь к
            администратору.
          </p>
          <Link href="/dashboard">Повторить загрузку →</Link>
        </section>
      )}
      {data && (
        <>
          <div className="stats-grid dashboard-stats">
            <Stat
              title="Состав сейчас"
              value={data.members ?? "—"}
              note={
                data.members === null
                  ? "Нет права просмотра состава"
                  : "Активные членства в гильдии"
              }
            />
            <Stat
              title="Участвовали за период"
              value={data.active_members}
              note="Хотя бы одно подтверждённое учитываемое событие"
            />
            <Stat
              title="Завершено событий"
              value={data.completed_events}
              note="По дате начала события в выбранном периоде"
            />
            <Stat
              title="Посещаемость гильдии"
              value={percent(data.attendance)}
              note="Присутствия / (присутствия + отсутствия)"
            />
          </div>
          <p className="caption">
            Посещаемость и активность: только подтверждённые завершённые
            учитываемые события. Уважительные причины и неприменимые события
            исключены. Отсутствие отчётов не означает 0%.
          </p>
          <div className="dashboard-columns">
            <section className="panel section-panel">
              <div className="section-heading">
                <h2>Впереди</h2>
                <Link href="/events">Все события →</Link>
              </div>
              <p className="caption">
                Ближайшие пять событий от текущего момента, независимо от
                фильтра.
              </p>
              {data.upcoming.length ? (
                <ul className="dashboard-events">
                  {data.upcoming.map((e) => (
                    <li key={e.id}>
                      <Link href={`/events/${e.id}`}>{e.title}</Link>
                      <time dateTime={e.starts_at}>
                        {dashboardDate(e.starts_at)} ·{" "}
                        {new Date(e.starts_at).toLocaleTimeString("ru-RU", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "UTC",
                        })}{" "}
                        UTC
                      </time>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Предстоящих событий пока нет.</p>
              )}
              {data.pending_applications !== null && (
                <p>
                  <Link href="/admin">
                    Заявок на рассмотрении: {data.pending_applications} →
                  </Link>
                </p>
              )}
            </section>
            <section className="panel section-panel">
              <h2>Ваш вклад</h2>
              <div className="personal-finance">
                <div>
                  <span className="caption">Посещено за период</span>
                  <strong>{data.own_present}</strong>
                </div>
                <div>
                  <span className="caption">Ваша посещаемость</span>
                  <strong>{percent(data.own_attendance)}</strong>
                </div>
                <div>
                  <span className="caption">Начислено за период</span>
                  <strong>{money(data.own_earned_units)}</strong>
                </div>
              </div>
              <p>
                К выплате сейчас:{" "}
                <strong>{money(data.own_finance.pending_units)}</strong>
              </p>
              <p className="caption">
                Начисления по дате распределения, с учётом текущих отмен. Долг —
                за всё время.
              </p>
              <Link href="/treasury#settlements">
                Ваши начисления и выплаты →
              </Link>
            </section>
          </div>
          <div className="dashboard-columns">
            <BarChart
              title="Посещаемость по неделям"
              description="Доля присутствий в применимых отметках. Неполные недели ограничены выбранными датами."
              maximum="1000"
              rows={data.weeks.map((w) => ({
                label: dashboardDate(w.from),
                value:
                  w.attendance === null
                    ? null
                    : String(Math.round(w.attendance * 10)),
                display: percent(w.attendance),
              }))}
            />
            <BarChart
              title="Активность участников"
              description="Уникальные участники с подтверждённым присутствием за неделю; один игрок может участвовать в нескольких неделях."
              rows={data.weeks.map((w) => ({
                label: dashboardDate(w.from),
                value: String(w.active),
                display: String(w.active),
              }))}
            />
          </div>
          {data.finance ? (
            <>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">НА ТЕКУЩИЙ МОМЕНТ · НЕ ЗА ПЕРИОД</p>
                  <h2>Казна XD</h2>
                </div>
                <Link href="/treasury">Открыть казну →</Link>
              </div>
              <div className="stats-grid dashboard-stats">
                <Stat
                  title="Казна прайм"
                  value={money(data.finance.current.prime_units)}
                  note={`После выплат; к выплате ${money(data.finance.current.prime_reserved_units)}`}
                />
                <Stat
                  title="Казна мини РБ"
                  value={money(data.finance.current.mini_units)}
                  note="100% продаж мини РБ; распределение не включено"
                />
                <Stat
                  title="Казна гильдии"
                  value={money(data.finance.current.guild_units)}
                  note="30% прайма, за вычетом расходов"
                />
                <Stat
                  title="Общая казна · имущество"
                  value={money(data.finance.current.inventory_units)}
                  note={
                    data.finance.current.unpriced_count
                      ? `Неполная оценка: без цены партий — ${data.finance.current.unpriced_count}`
                      : "Оценка непроданного дропа двух инвентарей"
                  }
                />
              </div>
              <p className="caption">
                Стоимость имущества не прибавляется к золоту. Продажи за период:{" "}
                {money(data.finance.sales_units)}. Отмены продаж за период:{" "}
                {money(data.finance.reversed_units)}.
              </p>
              <div className="dashboard-columns">
                <BarChart
                  title="Продажи по неделям"
                  description="Сумма записанных продаж до отмен. Суммы отмен показаны отдельно под графиками."
                  rows={data.finance.weeks.map((w) => ({
                    label: dashboardDate(w.from),
                    value: w.sales_units,
                    display: money(w.sales_units),
                  }))}
                />
                <BarChart
                  title="Динамика золота"
                  description={`Общий денежный остаток прайма, мини РБ и гильдии на конец каждого интервала. На начало периода: ${money(data.finance.opening_units)}. Имущество не включено.`}
                  rows={data.finance.weeks.map((w) => ({
                    label: dashboardDate(w.from),
                    value: w.balance_units,
                    display: money(w.balance_units),
                  }))}
                />
              </div>
              {data.finance.weeks.some((w) => w.reversed_units !== "0") && (
                <details className="panel section-panel">
                  <summary>Отмены продаж по неделям</summary>
                  <ul>
                    {data.finance.weeks
                      .filter((w) => w.reversed_units !== "0")
                      .map((w) => (
                        <li key={w.from}>
                          {dashboardDate(w.from)}: {money(w.reversed_units)}
                        </li>
                      ))}
                  </ul>
                </details>
              )}
              <p className="caption">
                График золота учитывает продажи, выплаты, расходы и обратные
                операции в дату их записи. Последний интервал заканчивается
                текущим моментом либо концом выбранного периода.
              </p>
            </>
          ) : (
            <section className="panel section-panel">
              <h2>Казна</h2>
              <p className="muted">
                Для общих финансовых показателей необходимо право просмотра
                казны.
              </p>
            </section>
          )}
          <section className="panel section-panel">
            <h2>Рейтинг участия</h2>
            <p className="caption">
              По количеству подтверждённых присутствий за период; при равенстве
              — по посещаемости. До 10 участников.
            </p>
            {data.ranking === null ? (
              <p className="muted">
                Именной рейтинг доступен ответственным за посещаемость. Ваши
                показатели — в разделе «Ваш вклад».
              </p>
            ) : data.ranking.length ? (
              <ol className="dashboard-ranking">
                {data.ranking.map((r) => (
                  <li key={r.membership_id}>
                    <span>{r.nickname}</span>
                    <strong>
                      {r.present} · {percent(r.percentage)}
                    </strong>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">
                Нет подтверждённых присутствий за этот период.
              </p>
            )}
            <Link href="/attendance">Открыть отчёт посещаемости →</Link>
          </section>
        </>
      )}
    </GuildShell>
  );
}
