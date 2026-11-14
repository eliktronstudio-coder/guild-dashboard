import { PeriodPayroll } from "@/components/settlements/period-payroll";
import { RegistryInventory } from "@/components/treasury/registry-inventory";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/access";
import { GUILD_ID } from "@/lib/config";
import { monthRange, queryValue } from "@/lib/events";
import {
  formatGold,
  sourceName,
  type Loot,
  type TreasurySale,
  type TreasuryTotals,
  type InventoryAuction,
} from "@/lib/treasury";
import { GuildShell } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { TreasurySummary } from "@/components/treasury/summary";
import { InventoryList } from "@/components/treasury/inventory";
import { SettlePendingAuctions } from "@/components/treasury/settle-pending-auctions";
import { addLoot, voidSale } from "./actions";
import { SettlementPanel } from "@/components/settlements/panel";
export const metadata = { title: "Казна" };
const pageNumber = (s?: string) =>
  Math.max(1, Math.min(10000, parseInt(s ?? "1", 10) || 1));
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const a = await requirePermission("treasury.read"),
    p = await searchParams;
  const gp = pageNumber(queryValue(p.gp)),
    xp = pageNumber(queryValue(p.xp)),
    spage = pageNumber(queryValue(p.spage)),
    epage = pageNumber(queryValue(p.epage));
  const auctionSales = queryValue(p.channel) === "auction";
  const range = monthRange(queryValue(p.eventMonth));
  const [manage, canAllocate, canPay, canSpend] = await Promise.all([
    a.permission("treasury.manage"),
    a.permission("treasury.allocate"),
    a.permission("treasury.pay"),
    a.permission("treasury.spend"),
  ]);
  const href = (changes: Record<string, string | number>) => {
    const params = new URLSearchParams({
      gp: String(gp),
      xp: String(xp),
      spage: String(spage),
      epage: String(epage),
      channel: auctionSales ? "auction" : "all",
      eventMonth: range.month,
    });
    for (const [k, v] of Object.entries(changes)) params.set(k, String(v));
    return `/treasury?${params}`;
  };
  const inventoryQuery = (
    position: "general_quantity" | "xd_quantity",
    page: number,
  ) =>
    a.client
      .from("treasury_inventory")
      .select("*", { count: "exact" })
      .eq("guild_id", GUILD_ID)
      .gt(position, 0)
      .order(position === "xd_quantity" ? "xd_received_at" : "created_at", {
        ascending: false,
      })
      .order("id")
      .range((page - 1) * 20, page * 20 - 1);
  let salesQuery = a.client
    .from("treasury_sales_log")
    .select("*", { count: "exact" })
    .eq("guild_id", GUILD_ID);
  if (auctionSales) salesQuery = salesQuery.eq("sale_channel", "auction");
  const [summary, general, xd, sales, events] = await Promise.all([
    a.client.rpc("treasury_summary"),
    inventoryQuery("general_quantity", gp),
    inventoryQuery("xd_quantity", xp),
    salesQuery
      .order("created_at", { ascending: false })
      .order("id")
      .range((spage - 1) * 10, spage * 10 - 1),
    manage
      ? a.client
          .from("events")
          .select("id,title,starts_at,treasury_source", { count: "exact" })
          .eq("guild_id", GUILD_ID)
          .eq("status", "completed")
          .neq("treasury_source", "none")
          .gte("starts_at", range.from)
          .lt("starts_at", range.until)
          .order("starts_at", { ascending: false })
          .order("id")
          .range((epage - 1) * 50, epage * 50 - 1)
      : Promise.resolve({ data: [], error: null, count: 0 }),
  ]);
  if (
    summary.error ||
    !summary.data ||
    general.error ||
    xd.error ||
    sales.error ||
    events.error
  )
    redirect("/setup?problem=database");
  const registry = manage
    ? await a.client
        .from("guild_drop_registry")
        .select("id,name,price_units::text,version")
        .eq("guild_id", GUILD_ID)
        .order("name")
        .limit(500)
    : { data: [], error: null };
  if (registry.error) throw new Error("REGISTRY_READ_FAILED");
  const items = [...(general.data ?? []), ...(xd.data ?? [])];
  const [auctionRows, buyerRows, pendingAuto] = await Promise.all([
    items.length
      ? a.client
          .from("inventory_auctions")
          .select(
            "id,loot_id,quantity,quantity_remaining,unit_price_units::text,status,version,created_at",
          )
          .eq("guild_id", GUILD_ID)
          .eq("status", "active")
          .in(
            "loot_id",
            items.map((item) => item.id),
          )
          .order("created_at")
      : Promise.resolve({ data: [], error: null }),
    manage && (await a.permission("members.read"))
      ? a.client
          .from("member_directory")
          .select("nickname")
          .eq("guild_id", GUILD_ID)
          .eq("status", "active")
          .order("nickname")
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
    manage
      ? a.client
          .from("inventory_auctions")
          .select("id,version")
          .eq("guild_id", GUILD_ID)
          .eq("status", "active")
          .order("created_at")
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (auctionRows.error || buyerRows.error || pendingAuto.error)
    throw new Error("INVENTORY_OPTIONS_READ_FAILED");
  const epages = Math.max(1, Math.ceil((events.count ?? 0) / 50));
  if (epage > epages) redirect(href({ epage: epages }));
  const gpages = Math.max(1, Math.ceil((general.count ?? 0) / 20)),
    xpages = Math.max(1, Math.ceil((xd.count ?? 0) / 20)),
    spages = Math.max(1, Math.ceil((sales.count ?? 0) / 10));
  if (gp > gpages || xp > xpages || spage > spages)
    redirect(
      href({
        gp: Math.min(gp, gpages),
        xp: Math.min(xp, xpages),
        spage: Math.min(spage, spages),
      }),
    );
  const panes = [
    {
      warehouse: "general" as const,
      title: "Общий инвентарь",
      rows: general.data ?? [],
      count: general.count ?? 0,
      page: gp,
      pages: gpages,
      pageKey: "gp",
    },
    {
      warehouse: "xd" as const,
      title: "Инвентарь ХД",
      rows: xd.data ?? [],
      count: xd.count ?? 0,
      page: xp,
      pages: xpages,
      pageKey: "xp",
    },
  ];
  const totals = summary.data as TreasuryTotals;
  return (
    <GuildShell current="/treasury">
      <Link href="/exports" className="text-button">
        Экспорт CSV →
      </Link>
      <div className="page-heading">
        <p className="eyebrow">XD · ЗОЛОТО И ДРОП</p>
        <h1>Экономика гильдии</h1>
        <p className="muted">
          Прайм, мини РБ, доля гильдии и имущество — в одном месте.
        </p>
      </div>
      <nav className="form-links">
        <Link href="/rb-purchase">Расчёт покупки РБ →</Link>
        <Link href="/treasury#settlements">Начисления и выплаты →</Link>
        <Link href="/archive">История периодов →</Link>
        <Link href="/statistics">Финансовая статистика →</Link>
      </nav>
      <TreasurySummary totals={totals} />
      {totals.archive_prime_units !== undefined && (
        <section className="panel section-panel">
          <h2>Остатки прошлых периодов</h2>
          <p>
            Прайм: {formatGold(totals.archive_prime_units)} · Мини РБ:{" "}
            {formatGold(totals.archive_mini_units ?? "0")} · Накопления гильдии:{" "}
            {formatGold(totals.archive_guild_units ?? "0")} зол.
          </p>
          <p>
            Золото сохраняется для выплат и расходов. Непроданный дроп остаётся
            на складе.
          </p>
          <Link href="/archive">Закрытие периода и выплаты из архива →</Link>
        </section>
      )}
      <p className="caption treasury-explanation">
        Первые три казны — остатки золота после продаж, выплат, расходов и
        отмен. Общая казна — оценка оставшегося имущества; она не складывается с
        золотом. Фильтры ниже не меняют эти итоги.
      </p>
      {manage && (
        <section className="panel section-panel">
          <h2>Добавить полученный дроп</h2>
          <p className="muted">
            Новый дроп поступает в общий инвентарь. Для продажи перенесите
            нужное количество в инвентарь ХД.
          </p>
          <form className="search-form treasury-month">
            <label>
              Месяц завершённой активности
              <input
                type="month"
                name="eventMonth"
                min="2000-01"
                max="2100-12"
                defaultValue={range.month}
              />
            </label>
            <button className="button secondary">Найти активности</button>
          </form>
          {epages > 1 && (
            <nav className="pagination" aria-label="Страницы выбора активности">
              {epage > 1 && (
                <Link href={href({ epage: epage - 1 })}>
                  ← Предыдущие активности
                </Link>
              )}
              <span>
                {epage} / {epages}
              </span>
              {epage < epages && (
                <Link href={href({ epage: epage + 1 })}>
                  Другие активности →
                </Link>
              )}
            </nav>
          )}
          <details>
            <summary>Добавить предмет</summary>
            <RegistryInventory
              requestId={randomUUID()}
              items={registry.data ?? []}
              events={events.data ?? []}
            />
          </details>
        </section>
      )}
      <section className="panel section-panel" id="inventory">
        <div className="section-heading">
          <h2>Инвентарь</h2>
          <Link href={`${href({ channel: "auction", spage: 1 })}#sales`}>
            Продажи аукциона →
          </Link>
        </div>
        <p className="caption">
          Наведите на иконку для просмотра свойств, нажмите для действий.
          Категория Прайм/Мини РБ сохраняется при переносе.
        </p>
        {manage && !!pendingAuto.data?.length && (
          <SettlePendingAuctions
            pending={pendingAuto.data.map((row) => ({
              id: row.id,
              version: row.version,
            }))}
          />
        )}
        <div className="inventory-columns">
          {panes.map((pane) => (
            <section
              className="inventory-column"
              key={pane.warehouse}
              aria-labelledby={`warehouse-${pane.warehouse}-title`}
            >
              <div className="inventory-column-heading">
                <h3 id={`warehouse-${pane.warehouse}-title`}>{pane.title}</h3>
                <span className="caption">{pane.count} поз.</span>
              </div>
              <p className="caption">
                {pane.warehouse === "general"
                  ? "Полученный дроп · удаление и перенос в ХД"
                  : "Дроп для продажи · игрокам и на аукционе"}
              </p>
              <InventoryList
                items={pane.rows as Loot[]}
                warehouse={pane.warehouse}
                manage={manage}
                auctions={(auctionRows.data ?? []) as InventoryAuction[]}
                buyers={(buyerRows.data ?? []).map((row) => row.nickname)}
              />
              <nav
                className="pagination"
                aria-label={`Страницы: ${pane.title}`}
              >
                {pane.page > 1 && (
                  <Link
                    href={`${href({ [pane.pageKey]: pane.page - 1 })}#inventory`}
                  >
                    ← Назад
                  </Link>
                )}
                <span>
                  {pane.page} / {pane.pages}
                </span>
                {pane.page < pane.pages && (
                  <Link
                    href={`${href({ [pane.pageKey]: pane.page + 1 })}#inventory`}
                  >
                    Далее →
                  </Link>
                )}
              </nav>
            </section>
          ))}
        </div>
      </section>
      <section className="panel section-panel" id="sales">
        <div className="section-heading">
          <h2>{auctionSales ? "Продажи с аукциона" : "История продаж"}</h2>
          <span className="caption">
            Оба инвентаря · {sales.count ?? 0} записей
          </span>
        </div>
        <nav className="form-links" aria-label="Фильтр истории продаж">
          <Link href={`${href({ channel: "all", spage: 1 })}#sales`}>
            Все продажи
          </Link>
          <Link href={`${href({ channel: "auction", spage: 1 })}#sales`}>
            Только аукцион
          </Link>
        </nav>
        {!sales.data?.length && (
          <p className="muted">
            Продаж пока нет. Они появятся после регистрации продажи из партии.
          </p>
        )}
        <div className="treasury-sales">
          {((sales.data ?? []) as TreasurySale[]).map((s) => (
            <article className="character-card" key={s.id}>
              <div className="section-heading">
                <h3>
                  {s.item_name} × {s.quantity}
                </h3>
                <span className="badge gold">
                  {s.voided_at ? "Отменена" : sourceName(s.source)}
                </span>
              </div>
              <p className="caption">
                {new Date(s.created_at).toLocaleString("ru-RU", {
                  timeZone: "UTC",
                })}{" "}
                UTC ·{" "}
                <Link href={`/events/${s.event_id}`}>{s.event_title}</Link>
              </p>
              <dl className="character-details">
                {s.buyer_name && (
                  <>
                    <dt>Кому</dt>
                    <dd>
                      {s.buyer_name}
                      {s.sale_channel === "auction" ? " · аукцион" : ""}
                    </dd>
                  </>
                )}
                <dt>Сумма продажи</dt>
                <dd>{formatGold(s.gross_units)} зол.</dd>
                <dt>{s.source === "prime" ? "В прайм" : "В мини РБ"}</dt>
                <dd>{formatGold(s.fund_units)} зол.</dd>
                <dt>В гильдию</dt>
                <dd>{formatGold(s.guild_units)} зол.</dd>
              </dl>
              {s.note && <p className="profile-about">{s.note}</p>}
              {canAllocate && !s.voided_at && s.source === "prime" && (
                <Link
                  className="text-button"
                  href={`${href({ allocationSale: s.id })}#allocation`}
                >
                  Рассчитать доли по присутствовавшим →
                </Link>
              )}
              {s.voided_at ? (
                <p className="notice">
                  Поступления сняты, товар возвращён. Причина: {s.void_reason}
                </p>
              ) : (
                manage && (
                  <details>
                    <summary>Отменить ошибочную продажу</summary>
                    <ActionForm action={voidSale} label="Отменить продажу">
                      <input type="hidden" name="saleId" value={s.id} />
                      <label>
                        Причина
                        <textarea
                          name="reason"
                          minLength={3}
                          maxLength={500}
                          required
                        />
                      </label>
                      <label className="check">
                        <input type="checkbox" name="confirm" required />
                        <span>
                          Подтверждаю возврат предметов в учёт и снятие всей
                          суммы продажи, включая долю гильдии.
                        </span>
                      </label>
                    </ActionForm>
                  </details>
                )
              )}
            </article>
          ))}
        </div>
        <nav className="pagination" aria-label="Страницы продаж">
          {spage > 1 && <Link href={href({ spage: spage - 1 })}>← Назад</Link>}
          <span>
            {spage} / {spages}
          </span>
          {spage < spages && (
            <Link href={href({ spage: spage + 1 })}>Далее →</Link>
          )}
        </nav>
      </section>
      <PeriodPayroll />
      <SettlementPanel
        client={a.client}
        permissions={{ allocate: false, pay: canPay, spend: canSpend }}
        p={p}
      />
      <p className="caption">
        Все суммы в золоте, точность до 0,0001. При дробном отчислении доля
        гильдии округляется вниз до этой единицы, остаток сохраняется в прайме.
        Передача золота происходит в игре; здесь ведётся учёт начислений,
        фактических выплат и расходов.
      </p>
    </GuildShell>
  );
}
