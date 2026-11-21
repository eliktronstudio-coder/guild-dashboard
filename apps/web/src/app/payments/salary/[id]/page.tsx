import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/access";
import { isUuid } from "@/lib/members";
import { GuildShell } from "@/components/shell";
import {
  AttendanceLines,
  SalaryLines,
} from "@/components/members/payroll-cells";
import { formatGold } from "@/lib/treasury";
import { payrollDue, type PayrollRow } from "@/lib/payroll";
type Explanation = {
  row: PayrollRow;
  statement: { id: string; created_at: string } | null;
  guild_joined_on: string | null;
  activities: {
    id: string;
    title: string;
    starts_at: string;
    source: string;
    weight: number;
    present: boolean;
  }[];
  points: Record<string, number>;
  allocation_weights: { prime: number; mini: number };
  cash: { prime: string; mini: string };
};
export const metadata = { title: "Расшифровка зарплаты" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const a = await requireMember(),
    { id } = await params;
  if (!isUuid(id)) notFound();
  const { data, error } = await a.client.rpc("salary_breakdown", {
    p_member: id,
  });
  if (error || !data)
    return (
      <GuildShell current="/payments">
        <h1>Расшифровка недоступна</h1>
        <p role="alert">
          Не удалось загрузить расчёт. Проверьте доступ и обновите страницу.
        </p>
        <Link href="/members">К составу →</Link>
      </GuildShell>
    );
  const d = data as Explanation;
  return (
    <GuildShell current="/payments">
      <div className="page-heading">
        <Link href={`/members/${id}`} className="text-button">
          ← Профиль
        </Link>
        <h1>Зарплата · {d.row.nickname}</h1>
        <p>
          {d.statement
            ? "Суммы и активности зафиксированы в ведомости"
            : "Открытый расчёт — обновляется по текущим данным"}
        </p>
      </div>
      <section className="panel section-panel">
        <h2>Как получилась сумма</h2>
        <p>
          Дата вступления:{" "}
          {d.guild_joined_on || "не указана, учитывается вся история"}. Личный
          коэффициент: {d.row.payout_weight / 100}.
        </p>
        <p>
          Посещаемость — вес посещённых активностей / вес всех учитываемых
          активностей категории. Допуск к зарплате проверяется отдельно от
          округления процента: от 20%.
        </p>
        <p>
          Зарплата распределяется по баллам посещённых активностей, умноженным
          на личный коэффициент. Сложность входит в баллы один раз.
        </p>
        <AttendanceLines row={d.row} />
        <SalaryLines row={d.row} />
      </section>
      <div className="stats-grid">
        {(["prime", "mini"] as const).map((source) => (
          <section className="panel section-panel" key={source}>
            <h2>{source === "prime" ? "Прайм" : "Мини РБ"}</h2>
            <p>
              {d.row[`${source}_eligible`]
                ? "Допущен к распределению"
                : "Не допущен: ниже 20% или нет учитываемых активностей"}
            </p>
            <dl>
              <dt>Баллы посещения / доступно</dt>
              <dd>
                {Number(d.points[`${source}_present`] ?? 0) / 100} /{" "}
                {Number(d.points[`${source}_total`] ?? 0) / 100}
              </dd>
              <dt>Баллы с личным коэффициентом</dt>
              <dd>
                {(Number(d.points[`${source}_present`] ?? 0) *
                  d.row.payout_weight) /
                  10000}
              </dd>
              <dt>Баллы допущенных игроков</dt>
              <dd>{Number(d.allocation_weights[source]) / 100}</dd>
              <dt>Остаток казны сейчас</dt>
              <dd>{formatGold(d.cash[source])} зол.</dd>
              <dt>Уже выплачено</dt>
              <dd>{formatGold(d.row[`${source}_paid`])} зол.</dd>
              <dt>Осталось выдать</dt>
              <dd>{formatGold(payrollDue(d.row, source))} зол.</dd>
            </dl>
          </section>
        ))}
      </div>
      <p className="notice">
        Уже выданное золото сохраняется. При открытом расчёте оно учитывается
        при распределении остатка, поэтому выплата одному игроку не уменьшает
        начисления остальных сама по себе. Исторические начисления включены
        отдельно в остаток к выплате.
      </p>
      <section className="panel section-panel">
        <h2>Учтённые активности · {d.activities.length}</h2>
        <p className="caption">
          Пропуск даёт 0 баллов. Активности до даты вступления, будущие,
          отменённые и уже архивированные записи не входят в открытый расчёт.
          Зафиксированная ведомость сохраняет список на момент фиксации.
        </p>
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Учтённые активности"
        >
          <table>
            <thead>
              <tr>
                <th>Дата · UTC</th>
                <th>Активность</th>
                <th>Категория</th>
                <th>Коэффициент</th>
                <th>Участие</th>
              </tr>
            </thead>
            <tbody>
              {d.activities.map((e) => (
                <tr key={e.id}>
                  <td>
                    {new Date(e.starts_at).toLocaleDateString("ru-RU", {
                      timeZone: "UTC",
                    })}
                  </td>
                  <td>{e.title}</td>
                  <td>{e.source === "prime" ? "Прайм" : "Мини РБ"}</td>
                  <td>{e.weight / 100}</td>
                  <td>{e.present ? "Был" : "Пропуск"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </GuildShell>
  );
}
