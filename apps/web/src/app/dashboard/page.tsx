import { PeriodCountdown } from "@/components/dashboard/period-countdown";
import Link from "next/link";
import { GuildShell } from "@/components/shell";
import { SeriesChart } from "@/components/dashboard/series-chart";
import { PeriodFilter } from "@/components/dashboard/period-filter";
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
    { access, range, report: data, summary } = result;
  const recent = await access.client
    .from("events")
    .select("id,title,starts_at,attendance_finalized_at")
    .eq("guild_id", GUILD_ID)
    .eq("status", "completed")
    .eq("inventory_receipt", false)
    .lte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: false })
    .order("id")
    .limit(5);
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
              <span className="command-percent">{row[field]}%</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Нет подтверждённых данных за период.</p>
      )}
    </section>
  );
  return (
    <GuildShell current="/dashboard">
      <section className="command-hero">
        <p className="eyebrow">XD / ХД · GUILD COMMAND CENTER</p>
        <h1>
          Одна гильдия.
          <br />
          <em>Общий путь.</em>
        </h1>
        <p>С возвращением, {access.membership!.nickname}.</p>
        <div className="command-hero-foot">
          <span>Состав · Активности · Экономика</span>
          <Link className="button secondary" href="/statistics">
            Открыть аналитику →
          </Link>
        </div>
      </section>
      <PeriodFilter range={range} />
      {result.error && (
        <p className="notice" role="alert">
          {result.error}
        </p>
      )}
      {data && (
        <>
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
              note={`${data.completed_events} подтверждённых событий за период`}
              href="/statistics"
              art="/command/art/kpi-attendance.webp"
            />
            <StatCard
              title="Вам начислено"
              value={money(data.own_earned_units)}
              note="Начисления за выбранный период"
              href="/payments"
              art="/command/art/kpi-payout.webp"
            />
            <StatCard
              title="Вам осталось выплатить"
              value={money(data.own_finance.pending_units)}
              note={`Всего выплачено: ${money(data.own_finance.paid_units)}`}
              href="/payments"
            />
            <StatCard
              title="Конец расчётного диапазона"
              value={dashboardDate(range.until)}
              note={<PeriodCountdown until={range.until} />}
            />
          </div>
          <p className="caption">
            Казна и задолженность показывают текущие остатки. Посещаемость и
            начисления — выбранный диапазон. Запись на будущее событие не
            считается присутствием.
          </p>
          <CustomizableGrid
            panels={[
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
                content: board("prime", "Топ-5 · Прайм"),
              },
              {
                id: "mini-top",
                label: "Топ Мини-РБ",
                defaultSpan: 6,
                content: board("mini", "Топ-5 · Мини-РБ"),
              },
              {
                id: "recent",
                label: "Последние события",
                defaultSpan: 12,
                content: (
                  <section className="panel section-panel">
                    <div className="section-heading">
                      <h2>Последние состоявшиеся активности</h2>
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
                            <span className="badge gold">
                              {event.attendance_finalized_at
                                ? "Отчёт подтверждён"
                                : "Ожидается отчёт"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">Состоявшихся событий пока нет.</p>
                    )}
                  </section>
                ),
              },
            ]}
          />
        </>
      )}
    </GuildShell>
  );
}
