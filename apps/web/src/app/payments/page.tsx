import { requireMember } from "@/lib/access";
import { GuildShell } from "@/components/shell";
import { SettlementPanel } from "@/components/settlements/panel";
export const metadata = { title: "Выплаты" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const a = await requireMember(),
    p = await searchParams;
  const [pay, spend] = await Promise.all([
    a.permission("treasury.pay"),
    a.permission("treasury.spend"),
  ]);
  return (
    <GuildShell current="/payments">
      <div className="page-heading">
        <h1>Выплаты</h1>
        <p className="muted">
          Начисления, проведённые выплаты и остаток к выплате.
        </p>
      </div>
      <SettlementPanel
        client={a.client}
        permissions={{ allocate: false, pay, spend }}
        p={p}
        basePath="/payments"
      />
    </GuildShell>
  );
}
