import { requirePermission } from "@/lib/access";
import { dashboardDate, dashboardPeriod } from "@/lib/dashboard";
import { GuildShell } from "@/components/shell";
import { RbPurchaseCalculator } from "@/components/rb-purchase/calculator";
import type { RbPurchaseReport } from "@/lib/rb-purchase";
export const metadata = { title: "Расчёт покупки РБ" };
export default async function Page() {
  const a = await requirePermission("members.read"),
    period = dashboardPeriod({ period: "current" });
  const { data, error } = await a.client.rpc("rb_purchase_candidates", {
    p_from: period.from,
  });
  return (
    <GuildShell current="/rb-purchase">
      <div className="page-heading">
        <p className="eyebrow">XD · МИНИ РБ</p>
        <h1>Расчёт покупки РБ</h1>
        <p className="muted">
          Расчётный период: {dashboardDate(period.from)} →{" "}
          {dashboardDate(period.until)} (UTC). Минимальная посещаемость Мини РБ
          — 20%.
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
