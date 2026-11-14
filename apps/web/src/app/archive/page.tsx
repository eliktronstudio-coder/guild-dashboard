import Link from "next/link";
import { GuildShell } from "@/components/shell";
import { requireMember } from "@/lib/access";
import { dashboardPeriod } from "@/lib/dashboard";
import { GUILD_ID } from "@/lib/config";
import { formatGold } from "@/lib/treasury";
import { payrollDue, type PayrollReport } from "@/lib/payroll";
import { PeriodRoster } from "@/components/settlements/period-roster";
import { PeriodPayroll } from "@/components/settlements/period-payroll";
import { ActionForm } from "@/components/action-form";
import { closePeriod } from "./actions";
export const metadata = { title: "Закрытие периода и архив" };
type Stock = { id: string; name: string; source: string; quantity: number };
type Activity = {
  id: string;
  title: string;
  starts_at: string;
  roster: { mark: string }[];
};
type Archive = {
  id: string;
  period_from: string;
  closed_at: string;
  snapshot: {
    payroll: PayrollReport;
    inventory: Stock[];
    activities: Activity[];
  };
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const a = await requireMember(),
    p = await searchParams,
    range = dashboardPeriod({ period: "current" });
  const canClose = await a.permission("periods.close"),
    finance = await a.permission("treasury.allocate");
  if (!canClose && !finance)
    return (
      <GuildShell current="/archive">
        <h1>Архив периодов</h1>
        <p>
          Закрытие и финансовый архив доступны администратору, гильд мастеру и
          казначею.
        </p>
      </GuildShell>
    );
  const from =
    p.from && /^20\d{2}-\d{2}-15$/.test(p.from) && p.from <= range.from
      ? p.from
      : range.from;
  const [history, result, selected] = await Promise.all([
    a.client
      .from("period_archives")
      .select("id,period_from,closed_at")
      .eq("guild_id", GUILD_ID)
      .order("period_from", { ascending: false })
      .limit(120),
    a.client.rpc("period_payroll_report", { p_from: from }),
    a.client
      .from("period_archives")
      .select("id,period_from,closed_at,snapshot")
      .eq("guild_id", GUILD_ID)
      .eq("period_from", from)
      .maybeSingle(),
  ]);
  if (history.error || result.error || selected.error)
    return (
      <GuildShell current="/archive">
        <h1>Архив периодов</h1>
        <p role="alert">Архив временно недоступен. Обновите страницу позже.</p>
      </GuildShell>
    );
  const archives = history.data as Omit<Archive, "snapshot">[],
    archived = selected.data as Archive | null,
    report = result.data as PayrollReport,
    shown = archived?.snapshot.payroll ?? report;
  const sum = (key: "prime" | "mini") =>
    shown.rows.reduce(
      (s, r) => s + BigInt(payrollDue(r, key)) + BigInt(r[`${key}_paid`]),
      0n,
    );
  const paid = shown.rows.reduce(
      (s, r) => s + BigInt(r.prime_paid) + BigInt(r.mini_paid),
      0n,
    ),
    total = sum("prime") + sum("mini");
  const end = new Date(from + "T00:00:00Z");
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(end.getUTCDate() - 1);
  const closingDay = end.toISOString().slice(0, 10),
    today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Yekaterinburg",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  const previous = new Date(range.from + "T00:00:00Z");
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  return (
    <GuildShell current="/archive">
      <div className="page-heading">
        <p className="eyebrow">XD · РАСЧЁТ И АРХИВ</p>
        <h1>{archived ? "Закрытый период" : "Закрытие периода"}</h1>
        <p>
          {from} — {closingDay} включительно. Новый период начинается 15-го.
        </p>
      </div>
      <nav className="form-links">
        <Link href="/archive">Текущий период</Link>
        <Link href={`/archive?from=${previous.toISOString().slice(0, 10)}`}>
          Предыдущий период
        </Link>
        <Link href="/treasury">Казна и склад</Link>
      </nav>
      <section className="panel section-panel">
        <h2>
          {archived ? "Состав в архиве" : "Состав, который попадёт в архив"}
        </h2>
        <p>
          Общий допуск к новым начислениям — посещаемость от 20%. Все суммы
          указаны в золоте.
        </p>
        <PeriodRoster report={shown} />
      </section>
      <section className="panel section-panel">
        <h2>Итог к закрытию</h2>
        <p>
          Прайм: {formatGold(String(sum("prime")))} · Мини РБ:{" "}
          {formatGold(String(sum("mini")))} · Всего начислено:{" "}
          {formatGold(String(total))} зол.
        </p>
        <p>
          Выплачено к закрытию: {formatGold(String(paid))} · Оставалось
          выплатить: {formatGold(String(total - paid))} зол.
        </p>
        <p className="caption">
          Остаток — начислено минус проведённые выплаты. Он сохраняется для
          выплаты из архива. Непроданный дроп не считается золотом.
        </p>
        {archived ? (
          <p>
            Архив создан{" "}
            {new Date(archived.closed_at).toLocaleString("ru-RU", {
              timeZone: "Asia/Yekaterinburg",
            })}
            . Состав, проценты и суммы выше зафиксированы.
          </p>
        ) : canClose && today >= closingDay ? (
          <ActionForm action={closePeriod} label="Архивировать период">
            <input type="hidden" name="from" value={from} />
            <input
              type="hidden"
              name="signature"
              value={report.signature ?? ""}
            />
            <label>
              <input type="checkbox" name="confirm" required /> Проверил состав
              и начисления. Зафиксировать расчёт и закрыть период.
            </label>
            <p>
              Перед закрытием разберите{" "}
              <Link href="/admin/participation">заявки на участие</Link>. После
              закрытия состав и активности этого периода редактировать нельзя.
            </p>
          </ActionForm>
        ) : (
          <p>
            Закрытие доступно с {closingDay}. Перед закрытием внесите последние
            рейды 14-го числа.
          </p>
        )}
      </section>
      {archived && (
        <>
          <section className="panel section-panel">
            <h2>Полученный дроп · остаток на момент закрытия</h2>
            <p>
              Склад периода без привязки к конкретному рейду. Продать можно в
              следующем месяце; выручка образует доплату по архивному расчёту.
            </p>
            <ul>
              {archived.snapshot.inventory.map((x) => (
                <li key={x.id}>
                  {x.name} · {x.quantity} шт. ·{" "}
                  {x.source === "prime" ? "Прайм" : "Мини РБ"} · получен
                </li>
              ))}
            </ul>
            <Link href="/treasury">Открыть склад и записать продажу →</Link>
          </section>
          <section className="panel section-panel">
            <h2>Активности в архиве ({archived.snapshot.activities.length})</h2>
            <ul>
              {archived.snapshot.activities.map((e) => (
                <li key={e.id}>
                  <Link href={`/events/${e.id}`}>{e.title}</Link> ·{" "}
                  {new Date(e.starts_at).toLocaleDateString("ru-RU")} ·
                  участников:{" "}
                  {e.roster.filter((r) => r.mark === "present").length}
                </li>
              ))}
            </ul>
            <p>
              Записи сохранены. Посещаемость нового периода считается отдельно с
              15-го.
            </p>
          </section>
        </>
      )}
      {archived && (
        <Link href={`/archive/export?from=${from}`} className="text-button">
          Скачать исходный архив JSON →
        </Link>
      )}
      <PeriodPayroll from={from} />
      <section className="panel section-panel">
        <h2>Сохранённые периоды</h2>
        {archives.length ? (
          <ul>
            {archives.map((x) => (
              <li key={x.id}>
                <Link href={`/archive?from=${x.period_from}`}>
                  {x.period_from} · закрыт
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p>Закрытых периодов пока нет.</p>
        )}
      </section>
    </GuildShell>
  );
}
