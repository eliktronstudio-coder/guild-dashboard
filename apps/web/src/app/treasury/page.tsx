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
  inventoryName,
  sourceName,
  type Loot,
  type TreasurySale,
  type TreasuryTotals,
  type TreasurySource,
} from "@/lib/treasury";
import { GuildShell } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { TreasurySummary } from "@/components/treasury/summary";
import { InventoryList } from "@/components/treasury/inventory";
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
  const inventory: TreasurySource =
    queryValue(p.inventory) === "mini_rb" ? "mini_rb" : "prime";
  const stock = queryValue(p.stock) === "all" ? "all" : "available";
  const ipage = pageNumber(queryValue(p.ipage)),
    spage = pageNumber(queryValue(p.spage)),
    epage = pageNumber(queryValue(p.epage));
  const range = monthRange(queryValue(p.eventMonth));
  const [manage, canAllocate, canPay, canSpend] = await Promise.all([
    a.permission("treasury.manage"),
    a.permission("treasury.allocate"),
    a.permission("treasury.pay"),
    a.permission("treasury.spend"),
  ]);
  const href = (changes: Record<string, string | number>) => {
    const params = new URLSearchParams({
      inventory,
      stock,
      ipage: String(ipage),
      spage: String(spage),
      epage: String(epage),
      eventMonth: range.month,
    });
    for (const [k, v] of Object.entries(changes)) params.set(k, String(v));
    return `/treasury?${params}`;
  };
  let inventoryQuery = a.client
    .from("treasury_inventory")
    .select("*", { count: "exact" })
    .eq("guild_id", GUILD_ID)
    .eq("source", inventory);
  if (stock === "available")
    inventoryQuery = inventoryQuery.gt("quantity_remaining", 0);
  const [summary, items, sales, events] = await Promise.all([
    a.client.rpc("treasury_summary"),
    inventoryQuery
      .order("created_at", { ascending: false })
      .order("id")
      .range((ipage - 1) * 20, ipage * 20 - 1),
    a.client
      .from("treasury_sales_log")
      .select("*", { count: "exact" })
      .eq("guild_id", GUILD_ID)
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
    items.error ||
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
  const epages = Math.max(1, Math.ceil((events.count ?? 0) / 50));
  if (epage > epages) redirect(href({ epage: epages }));
  const ipages = Math.max(1, Math.ceil((items.count ?? 0) / 20)),
    spages = Math.max(1, Math.ceil((sales.count ?? 0) / 10));
  if (ipage > ipages || spage > spages)
    redirect(
      href({ ipage: Math.min(ipage, ipages), spage: Math.min(spage, spages) }),
    );
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
          <h2>Внести дроп с активности</h2>
          <p className="muted">
            Прайм → общий инвентарь. Мини РБ → инвентарь ХД. Направление
            определяется пометкой события.
          </p>
          <form className="search-form treasury-month">
            <input type="hidden" name="inventory" value={inventory} />
            <input type="hidden" name="stock" value={stock} />
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
          <span className="caption">{items.count ?? 0} поз. по фильтру</span>
        </div>
        <nav className="treasury-tabs" aria-label="Разделы инвентаря">
          {(["prime", "mini_rb"] as const).map((source) => (
            <Link
              key={source}
              href={href({ inventory: source, ipage: 1 })}
              aria-current={inventory === source ? "page" : undefined}
            >
              {inventoryName(source)}
              <span>{sourceName(source)}</span>
            </Link>
          ))}
        </nav>
        <div className="treasury-filters">
          <span className="caption">
            {inventory === "prime"
              ? "Только дроп прайма"
              : "Только дроп мини РБ"}
          </span>
          <Link
            href={href({
              stock: stock === "all" ? "available" : "all",
              ipage: 1,
            })}
          >
            {stock === "all"
              ? "Показать только в наличии"
              : "Показать все партии"}
          </Link>
        </div>
        <InventoryList items={(items.data ?? []) as Loot[]} manage={manage} />
        <nav className="pagination" aria-label="Страницы инвентаря">
          {ipage > 1 && <Link href={href({ ipage: ipage - 1 })}>← Назад</Link>}
          <span>
            {ipage} / {ipages}
          </span>
          {ipage < ipages && (
            <Link href={href({ ipage: ipage + 1 })}>Далее →</Link>
          )}
        </nav>
      </section>
      <section className="panel section-panel" id="sales">
        <div className="section-heading">
          <h2>История продаж</h2>
          <span className="caption">
            Оба инвентаря · {sales.count ?? 0} записей
          </span>
        </div>
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
