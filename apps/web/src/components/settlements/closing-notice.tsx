import Link from "next/link";
import { requireMember } from "@/lib/access";
import { dashboardPeriod } from "@/lib/dashboard";
import { GUILD_ID } from "@/lib/config";
export async function ClosingNotice() {
  const a = await requireMember();
  if (!(await a.permission("periods.close"))) return null;
  const today = new Date(),
    day = Number(
      new Intl.DateTimeFormat("en-US", {
        day: "numeric",
        timeZone: "Asia/Yekaterinburg",
      }).format(today),
    );
  const current = dashboardPeriod({ period: "current" }),
    target = new Date(current.from + "T00:00:00Z");
  if (day !== 14) target.setUTCMonth(target.getUTCMonth() - 1);
  const from = target.toISOString().slice(0, 10),
    { data, error } = await a.client
      .from("period_archives")
      .select("id")
      .eq("guild_id", GUILD_ID)
      .eq("period_from", from)
      .maybeSingle();
  if (error || data) return null;
  return (
    <section className="panel section-panel" role="status">
      <h2>
        {day === 14
          ? "Сегодня — закрытие расчётного периода"
          : "Предыдущий период ожидает архивации"}
      </h2>
      <p>
        Проверьте последние активности, заявки участников и суммы начислений.
        Новый период начинается 15-го.
      </p>
      <Link href={`/archive?from=${from}`} className="text-button">
        Перейти к закрытию периода →
      </Link>
    </section>
  );
}
