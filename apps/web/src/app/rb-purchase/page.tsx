import { historyPayroll } from "@/lib/history-report";
import { PERIOD_CLOSING_ENABLED } from "@/lib/config";
import { requirePermission } from "@/lib/access";
import { dashboardPeriod } from "@/lib/dashboard";
import { GuildShell } from "@/components/shell";
import { RbPurchaseCalculator } from "@/components/rb-purchase/calculator";
import type { RbPurchaseReport } from "@/lib/rb-purchase";
export const metadata = { title: "Расчёт покупки РБ" };
export default async function Page() {
  const a = await requirePermission("members.read"),
    period = dashboardPeriod({ period: "current" });
  const { data, error } = PERIOD_CLOSING_ENABLED
    ? await a.client.rpc("rb_purchase_candidates", { p_from: period.from })
    : await historyPayroll()
        .then(({ rows }) => ({
          data: {
            participants: rows
              .filter((r) => r.status === "active" && r.mini_eligible === true)
              .map((r) => ({
                id: r.id,
                nickname: r.nickname,
                attendance_tenths: Math.round((r.mini_percentage ?? 0) * 10),
              })),
          },
          error: null,
        }))
        .catch(() => ({ data: null, error: true }));
  return (
    <GuildShell current="/rb-purchase">
      <div className="page-heading">
        <p className="eyebrow">XD · МИНИ РБ</p>
        <h1>Расчёт покупки РБ</h1>
        <p className="muted">
          Все сохранённые активности. Минимальная посещаемость Мини РБ — 20% с
          учётом сложности активностей.
        </p>
      </div>
      {error || !data ? (
        <p className="notice error" role="alert">
          Не удалось загрузить состав для расчёта. Обновите страницу.
        </p>
      ) : (
        <RbPurchaseCalculator
          participants={(data as RbPurchaseReport).participants}
        />
      )}
    </GuildShell>
  );
}
