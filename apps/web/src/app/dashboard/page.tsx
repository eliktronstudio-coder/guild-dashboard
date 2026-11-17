import { ActivitySchedule } from "@/components/dashboard/activity-schedule";
import Link from "next/link";
import { GuildShell } from "@/components/shell";
import { SeriesChart } from "@/components/dashboard/series-chart";
import { StatCard } from "@/components/dashboard/stat-card";
import CustomizableGrid from "@/components/dashboard/customizable-grid";
import { loadCommandReport } from "@/lib/command-report";
import { dashboardDate } from "@/lib/dashboard";
import { formatGold } from "@/lib/treasury";
import { GUILD_ID } from "@/lib/config";
export const metadata = { title: "Главная" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const result = await loadCommandReport(await searchParams),
    { access, report: data, summary } = result;
  const recent = await access.client
    .from("events")
    .select("id,title,starts_at,attendance_finalized_at")
    .eq("guild_id", GUILD_ID)
    .is("activity_archive_id", null)
    .eq("status", "completed")
    .eq("inventory_receipt", false)
    .lte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: false })
    .order("id")
    .limit(5);
  const personal = "personalSummary" in result ? result.personalSummary : null;
  const own = personal?.rows[0];
  const money = (units: string) => formatGold(units) + " зол.";
  const ranking = (field: "prime" | "mini") =>
    (summary?.rows ?? [])
      .filter((p) => p[field] !== null)
      .sort(
        (a, b) =>
          (b[field] ?? 0) - (a[field] ?? 0) ||
          a.nickname.localeCompare(b.nickname, "ru"),
      )
      .slice(0, 5);
  const board = (field: "prime" | "mini", title: string) => (
    <section className="panel section-panel command-leaderboard">
      <div className="section-heading">
        <h2>{title}</h2>
        <Link
          href={
            "/statistics?category=" + (field === "prime" ? "Прайм" : "Мини-РБ")
          }
        >
          Все →
        </Link>
      </div>
      {ranking(field).length ? (
        <ol>
          {ranking(field).map((row, i) => (
            <li key={row.id}>
              <span className="rank-number">{i + 1}</span>
              <Link href={"/members/" + row.id}>
                <strong>{row.nickname}</strong>
                <small>{row.characterClass}</small>
              </Link>
              <span className="command-percent">
                {row[field]}%
                <small>
                  {field === "prime"
                    ? `${row.primePresent}/${row.primeAvailable}`
                    : `${row.miniPresent}/${row.miniAvailable}`}
                </small>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Нет проведённых активностей за период.</p>
      )}
    </section>
  );
  return (
    <GuildShell current="/dashboard">
      <div className="dashboard-title sr-only">
        <h1>Главная</h1>
      </div>
      {result.error && (
        <p className="notice" role="alert">
          {result.error}
        </p>
      )}
      {data && (
        <>
          <CustomizableGrid
            panels={[
              {
                id: "personal-summary",
                label: "Моя посещаемость",
                defaultSpan: 6,
                content: (
                  <section className="panel section-panel personal-attendance">
                    <div className="section-heading">
                      <h2>Моя посещаемость</h2>
                      <Link href={`/members/${access.membership!.id}`}>
                        Мой профиль →
                      </Link>
                    </div>
                    {own ? (
                      <>
                        <div className="personal-attendance-grid">
                          {[
                            [
                              "Общая",
                              own?.percentage ?? 0,
                              own?.present ?? 0,
                              own?.available ?? 0,
                            ],
                            [
                              "Прайм",
                              own?.prime ?? 0,
                              own?.primePresent ?? 0,
                              own?.primeAvailable ?? 0,
                            ],
                            [
                              "Мини РБ",
                              own?.mini ?? 0,
                              own?.miniPresent ?? 0,
                              own?.miniAvailable ?? 0,
                            ],
                          ].map(([label, percent, present, total]) => (
                            <div
                              key={label}
                              className="personal-attendance-stat"
                            >
                              <span>{label}</span>
                              <strong>{percent}%</strong>
                              <span className="attendance-track">
                                <span style={{ width: `${percent}%` }} />
                              </span>
                              <small>
                                {present} из {total} активностей
                              </small>
                            </div>
                          ))}
                        </div>
                        <p className="caption">
                          Все сохранённые активности · Прайм учитывает
                          коэффициенты
                        </p>
                      </>
                    ) : (
                      <p className="muted">
                        Данные посещаемости пока недоступны. Повторите загрузку
                        страницы.
                      </p>
                    )}
                  </section>
                ),
              },
              {
                id: "personal-chart",
                label: "Мой график посещаемости",
                defaultSpan: 6,
                content: (
                  <SeriesChart
                    title="Мой график посещаемости"
                    description="Ваши участия по дням выбранного периода"
                    points={(personal?.daily ?? []).map((d) => ({
                      label: dashboardDate(d.label),
                      values: [String(d.prime), String(d.mini)],
                      display: [String(d.prime), String(d.mini)],
                    }))}
                    series={[
                      { label: "Прайм", color: "var(--gold)" },
                      { label: "Мини РБ", color: "var(--info)" },
                    ]}
                  />
                ),
              },
              {
                id: "schedule",
                label: "До активностей",
                defaultSpan: 6,
                content: <ActivitySchedule />,
              },
              {
                id: "treasury",
                label: "Динамика казны",
                defaultSpan: 6,
                content: data.finance ? (
                  <SeriesChart
                    title="Динамика казны"
                    description="Остаток золота на конец интервала. Имущество не включено."
                    points={data.finance.weeks.map((w) => ({
                      label: dashboardDate(w.from),
                      values: [w.balance_units],
                      display: [money(w.balance_units)],
                    }))}
                    series={[{ label: "Золото", color: "var(--gold)" }]}
                  />
                ) : (
                  <section className="panel section-panel">
                    <h2>Казна</h2>
                    <p>Нет права просмотра общих финансов.</p>
                  </section>
                ),
              },
              {
                id: "attendance",
                label: "Посещаемость",
                defaultSpan: 6,
                content: (
                  <SeriesChart
                    title="Посещаемость участников"
                    description="Фактические присутствия по дням. Категории определяются правилами учёта посещаемости."
                    points={(summary?.daily ?? []).map((d) => ({
                      label: dashboardDate(d.label),
                      values: [String(d.prime), String(d.mini)],
                      display: [String(d.prime), String(d.mini)],
                    }))}
                    series={[
                      { label: "Прайм", color: "var(--gold)" },
                      { label: "Мини-РБ", color: "var(--info)" },
                    ]}
                  />
                ),
              },
              {
                id: "income",
                label: "Продажи и отмены",
                defaultSpan: 6,
                content: (
                  <SeriesChart
                    title="Продажи и отмены"
                    description="Денежные операции в дату их записи; отмены показаны отдельно."
                    points={(data.finance?.weeks ?? []).map((w) => ({
                      label: dashboardDate(w.from),
                      values: [w.sales_units, w.reversed_units],
                      display: [money(w.sales_units), money(w.reversed_units)],
                    }))}
                    series={[
                      { label: "Продажи", color: "var(--success)" },
                      { label: "Отмены продаж", color: "var(--red)" },
                    ]}
                  />
                ),
              },
              {
                id: "upcoming",
                label: "Ближайшие события",
                defaultSpan: 6,
                content: (
                  <section className="panel section-panel">
                    <div className="section-heading">
                      <h2>Ближайшие активности</h2>
                      <Link href="/events">Календарь →</Link>
                    </div>
                    {data.upcoming.length ? (
                      <ul className="command-event-list">
                        {data.upcoming.map((event) => (
                          <li key={event.id}>
                            <Link href={"/events/" + event.id}>
                              {event.title}
                            </Link>
                            <time dateTime={event.starts_at}>
                              {dashboardDate(event.starts_at)} ·{" "}
                              {new Date(event.starts_at)
                                .toISOString()
                                .slice(11, 16)}{" "}
                              UTC
                            </time>
                            <span className="badge gold">Запланировано</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">Пока нет запланированных событий.</p>
                    )}
                  </section>
                ),
              },
              {
                id: "prime-top",
                label: "Топ Прайма",
                defaultSpan: 6,
                content: board("prime", "Посещаемость: Прайм"),
              },
              {
                id: "mini-top",
                label: "Топ Мини-РБ",
                defaultSpan: 6,
                content: board("mini", "Посещаемость: Мини РБ"),
              },
              {
                id: "recent",
                label: "Последние события",
                defaultSpan: 6,
                content: (
                  <section className="panel section-panel">
                    <div className="section-heading">
                      <h2>Последние активности</h2>
                      <Link href="/events?status=completed">Все →</Link>
                    </div>
                    {recent.error ? (
                      <p role="alert">Не удалось загрузить события.</p>
                    ) : recent.data?.length ? (
                      <ul className="command-event-list">
                        {recent.data.map((event) => (
                          <li key={event.id}>
                            <Link href={"/events/" + event.id}>
                              {event.title}
                            </Link>
                            <time dateTime={event.starts_at}>
                              {dashboardDate(event.starts_at)}
                            </time>
                            <span className="badge gold">Состав сохранён</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">Состоявшихся событий пока нет.</p>
                    )}
                  </section>
                ),
              },
            ].sort(
              (a, b) =>
                [
                  "personal-summary",
                  "personal-chart",
                  "schedule",
                  "recent",
                  "prime-top",
                  "mini-top",
                  "upcoming",
                  "treasury",
                  "attendance",
                  "income",
                ].indexOf(a.id) -
                [
                  "personal-summary",
                  "personal-chart",
                  "schedule",
                  "recent",
                  "prime-top",
                  "mini-top",
                  "upcoming",
                  "treasury",
                  "attendance",
                  "income",
                ].indexOf(b.id),
            )}
          />
          <div className="stats-grid command-stats">
            {data.finance && (
              <>
                <StatCard
                  title="Казна Прайма"
                  value={money(data.finance.current.prime_units)}
                  note="70% — фонд зарплат · текущий остаток"
                  href="/treasury"
                  art="/command/art/kpi-prime.webp"
                />
                <StatCard
                  title="Казна Мини-РБ"
                  value={money(data.finance.current.mini_units)}
                  note="100% — фонд Мини-РБ · текущий остаток"
                  href="/treasury?inventory=mini_rb"
                  art="/command/art/kpi-minirb.webp"
                />
                <StatCard
                  title="Казна гильдии"
                  value={money(data.finance.current.guild_units)}
                  note="30% Прайма · резерв после расходов"
                  href="/treasury"
                  art="/command/art/kpi-guild.webp"
                />
                <StatCard
                  title="Непроданный дроп"
                  value={
                    data.finance.current.unpriced_count &&
                    data.finance.current.priced_count === 0
                      ? "Нет оценки"
                      : money(data.finance.current.inventory_units)
                  }
                  note={
                    data.finance.current.unpriced_count
                      ? `Без цены партий: ${data.finance.current.unpriced_count}`
                      : "Имущество не прибавляется к золоту"
                  }
                  href="/treasury"
                  art="/command/art/kpi-drop.webp"
                />
              </>
            )}
            <StatCard
              title="Посещаемость"
              value={
                data.attendance === null ? "Нет данных" : data.attendance + "%"
              }
              note={`${data.completed_events} проведённых учитываемых активностей`}
              href="/statistics"
              art="/command/art/kpi-attendance.webp"
            />
            <StatCard
              title="Вам начислено"
              value={money(data.own_earned_units)}
              note="Сохранённые начисления за всю историю"
              href="/payments"
              art="/command/art/kpi-payout.webp"
            />
            <StatCard
              title="Вам осталось выплатить"
              value={money(data.own_finance.pending_units)}
              note={`Всего выплачено: ${money(data.own_finance.paid_units)}`}
              href="/payments"
            />
          </div>
          <p className="caption">
            Казна и задолженность показывают текущие остатки. Посещаемость — по
            всем сохранённым активностям. Запись на будущее событие не считается
            присутствием.
          </p>
        </>
      )}
    </GuildShell>
  );
}
