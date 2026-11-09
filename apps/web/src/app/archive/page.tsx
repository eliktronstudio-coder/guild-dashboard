import Link from "next/link";
import { GuildShell } from "@/components/shell";
import { requireMember } from "@/lib/access";
export const metadata = { title: "История периодов" };
export default async function Page() {
  await requireMember();
  const now = new Date(),
    year = now.getUTCFullYear(),
    month = now.getUTCMonth() - (now.getUTCDate() < 15 ? 1 : 0);
  const periods = Array.from({ length: 12 }, (_, index) => {
    const from = new Date(Date.UTC(year, month - index - 1, 15)),
      end = new Date(
        Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 15),
      ),
      to = new Date(end.getTime() - 86400000);
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    };
  });
  return (
    <GuildShell current="/statistics">
      <div className="page-heading">
        <p className="eyebrow">XD · ИСТОРИЯ</p>
        <h1>Прошлые периоды</h1>
        <p className="muted">
          История подтверждённых активностей, начислений, выплат и обратных
          операций. Доступ определяется вашими правами.
        </p>
      </div>
      <section className="panel section-panel">
        <h2>Расчётные диапазоны 15 → 15</h2>
        <p className="caption">
          Отчёты показывают сохранённые записи за даты. Это история операций, а
          не новый неизменяемый снимок всей базы.
        </p>
        <ul className="command-event-list">
          {periods.map((period) => (
            <li key={period.from}>
              <Link
                href={`/statistics?period=custom&from=${period.from}&to=${period.to}`}
              >
                {new Date(period.from).toLocaleDateString("ru-RU", {
                  timeZone: "UTC",
                })}{" "}
                —{" "}
                {new Date(period.to).toLocaleDateString("ru-RU", {
                  timeZone: "UTC",
                })}
              </Link>
              <span className="caption">Открыть отчёт →</span>
            </li>
          ))}
        </ul>
        <Link href="/exports">Выгрузить начисления и выплаты CSV →</Link>
      </section>
    </GuildShell>
  );
}
