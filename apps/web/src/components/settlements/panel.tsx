import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GUILD_ID } from "@/lib/config";
import { isUuid } from "@/lib/members";
import { queryValue } from "@/lib/events";
import {
  formatGold,
  goldInput,
  sourceName,
  treasuryError,
} from "@/lib/treasury";
import {
  settlementError,
  type AllocationPreview,
  type AwardAccount,
  type AllocationLog,
  type PayoutLog,
  type ExpenseLog,
  type PersonalTreasury,
} from "@/lib/settlements";
import { ActionForm } from "@/components/action-form";
import {
  allocateSale,
  recordPayout,
  recordExpense,
  cancelAllocation,
  cancelPayout,
  cancelExpense,
} from "@/app/treasury/settlement-actions";
import type { FormState } from "@/lib/identity";
type Params = Record<string, string | string[] | undefined>;
const pageOf = (s?: string) =>
  Math.max(1, Math.min(10000, parseInt(s ?? "1", 10) || 1));
const stamp = (s: string) =>
  new Date(s).toLocaleString("ru-RU", { timeZone: "UTC" }) + " UTC";
function CancelRecord({
  id,
  action,
  description,
}: {
  id: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  description: string;
}) {
  return (
    <details>
      <summary>Исправить: отменить запись</summary>
      <ActionForm action={action} label="Отменить запись">
        <input type="hidden" name="recordId" value={id} />
        <label>
          Причина исправления
          <textarea name="reason" minLength={3} maxLength={500} required />
        </label>
        <label className="check">
          <input name="confirm" type="checkbox" required />
          <span>{description}</span>
        </label>
      </ActionForm>
    </details>
  );
}
export async function SettlementPanel({
  client,
  permissions,
  p,
}: {
  client: SupabaseClient;
  permissions: { allocate: boolean; pay: boolean; spend: boolean };
  p: Params;
}) {
  const apage = pageOf(queryValue(p.apage)),
    ppage = pageOf(queryValue(p.ppage)),
    xpage = pageOf(queryValue(p.xpage)),
    bpage = pageOf(queryValue(p.bpage));
  const selected = queryValue(p.allocationSale);
  const href = (key: string, page: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) {
      const value = queryValue(v);
      if (value) q.set(k, value);
    }
    q.set(key, String(page));
    return `/treasury?${q}#settlements`;
  };
  const [personal, awards, payouts, expenses, batches, preview] =
    await Promise.all([
      client.rpc("my_treasury_summary"),
      client
        .from("treasury_award_accounts")
        .select("*", { count: "exact" })
        .eq("guild_id", GUILD_ID)
        .order("created_at", { ascending: false })
        .order("id")
        .range((apage - 1) * 10, apage * 10 - 1),
      client
        .from("treasury_payout_log")
        .select("*", { count: "exact" })
        .eq("guild_id", GUILD_ID)
        .order("created_at", { ascending: false })
        .order("id")
        .range((ppage - 1) * 10, ppage * 10 - 1),
      client
        .from("treasury_expense_log")
        .select("*", { count: "exact" })
        .eq("guild_id", GUILD_ID)
        .order("created_at", { ascending: false })
        .order("id")
        .range((xpage - 1) * 10, xpage * 10 - 1),
      permissions.allocate
        ? client
            .from("treasury_allocation_log")
            .select("*", { count: "exact" })
            .eq("guild_id", GUILD_ID)
            .order("created_at", { ascending: false })
            .order("id")
            .range((bpage - 1) * 10, bpage * 10 - 1)
        : Promise.resolve({ data: [], error: null, count: 0 }),
      selected && isUuid(selected) && permissions.allocate
        ? client.rpc("treasury_allocation_preview", { p_sale_id: selected })
        : Promise.resolve({ data: null, error: null }),
    ]);
  if (
    personal.error ||
    !personal.data ||
    awards.error ||
    payouts.error ||
    expenses.error ||
    batches.error
  )
    redirect("/setup?problem=database");
  for (const [key, page, count] of [
    ["apage", apage, awards.count],
    ["ppage", ppage, payouts.count],
    ["xpage", xpage, expenses.count],
    ["bpage", bpage, batches.count],
  ] as const) {
    const max = Math.max(1, Math.ceil((count ?? 0) / 10));
    if (page > max) redirect(href(key, max));
  }
  const pagination = (key: string, page: number, count: number | null) => (
    <nav className="pagination" aria-label="Страницы финансовых записей">
      {page > 1 && <Link href={href(key, page - 1)}>← Назад</Link>}
      <span>
        {page} / {Math.max(1, Math.ceil((count ?? 0) / 10))}
      </span>
      {page * 10 < (count ?? 0) && (
        <Link href={href(key, page + 1)}>Далее →</Link>
      )}
    </nav>
  );
  const me = personal.data as PersonalTreasury,
    calculation = preview.data as AllocationPreview | null;
  return (
    <div id="settlements">
      {permissions.allocate && selected && (
        <section className="panel section-panel" id="allocation">
          <h2>Расчёт по присутствовавшим</h2>
          {preview.error || !calculation ? (
            <p className="notice error" role="alert">
              {preview.error
                ? (settlementError(preview.error.message) ??
                  treasuryError(preview.error.message))
                : "Выберите продажу из истории."}
            </p>
          ) : (
            <>
              <p>
                Из казны {sourceName(calculation.source)} к начислению:{" "}
                <strong>{formatGold(calculation.amount_units)} зол.</strong>
              </p>
              <p className="caption">
                Поровну между присутствовавшими в подтверждённом отчёте.
                Минимальный остаток распределяется по стабильному ID; сумма
                долей совпадает с суммой продажи для игроков.
              </p>
              <ul className="allocation-preview">
                {calculation.recipients.map((r) => (
                  <li key={r.id}>
                    <span>{r.nickname}</span>
                    <strong>{formatGold(r.amount_units)} зол.</strong>
                  </li>
                ))}
              </ul>
              <ActionForm
                key={calculation.sale_id}
                action={allocateSale}
                label="Подтвердить начисление"
              >
                <input type="hidden" name="requestId" value={randomUUID()} />
                <input
                  type="hidden"
                  name="saleId"
                  value={calculation.sale_id}
                />
                <input
                  type="hidden"
                  name="expectedMembers"
                  value={JSON.stringify(
                    calculation.recipients.map((r) => r.id),
                  )}
                />
                <label>
                  Основание начисления
                  <textarea
                    name="reason"
                    minLength={3}
                    maxLength={500}
                    required
                    defaultValue="По подтверждённой посещаемости активности"
                  />
                </label>
                <label className="check">
                  <input name="confirm" type="checkbox" required />
                  <span>
                    Проверил список и доли. Начисление создаёт обязательства;
                    золото ещё не выплачено.
                  </span>
                </label>
              </ActionForm>
            </>
          )}
        </section>
      )}
      <section className="panel section-panel" id="my-payments">
        <h2>Мои начисления</h2>
        <div className="personal-finance">
          {[
            ["Начислено", me.allocated_units],
            ["Выплачено", me.paid_units],
            ["К выплате", me.pending_units],
          ].map(([label, value]) => (
            <div key={label}>
              <span className="caption">{label}</span>
              <strong>{formatGold(value)} зол.</strong>
            </div>
          ))}
        </div>
        <p className="caption">
          Итоги активных начислений за всё время. Отменённые операции остаются в
          истории.
        </p>
      </section>
      <section className="panel section-panel">
        <h2>
          {permissions.allocate || permissions.pay
            ? "Начисления участникам"
            : "Мои доли по активностям"}
        </h2>
        <p className="muted">
          Выплата списывается из казны своей активности. Подтверждайте только
          фактически переданное золото.
        </p>
        {!awards.data?.length && <p className="notice">Начислений пока нет.</p>}
        <div className="treasury-items">
          {((awards.data ?? []) as AwardAccount[]).map((w) => (
            <article className="character-card" key={w.id}>
              <h3>{w.nickname}</h3>
              <p className="caption">
                {w.event_title} · {sourceName(w.source)}
                {w.allocation_voided_at ? " · Начисление отменено" : ""}
              </p>
              <dl className="character-details">
                <dt>Начислено</dt>
                <dd>{formatGold(w.amount_units)} зол.</dd>
                <dt>Выплачено</dt>
                <dd>{formatGold(w.paid_units)} зол.</dd>
                <dt>К выплате</dt>
                <dd>{formatGold(w.pending_units)} зол.</dd>
              </dl>
              {permissions.pay &&
                !w.allocation_voided_at &&
                BigInt(w.pending_units) > 0n && (
                  <details>
                    <summary>Записать выплату</summary>
                    <ActionForm
                      action={recordPayout}
                      revision={w.version}
                      label="Записать выплату"
                    >
                      <input
                        name="requestId"
                        type="hidden"
                        value={randomUUID()}
                      />
                      <input name="awardId" type="hidden" value={w.id} />
                      <input name="version" type="hidden" value={w.version} />
                      <label>
                        Передано золота
                        <input
                          name="amount"
                          inputMode="decimal"
                          pattern="[0-9]+([.,][0-9]{1,4})?"
                          maxLength={16}
                          required
                          defaultValue={goldInput(w.pending_units)}
                        />
                      </label>
                      <label>
                        Подтверждение или примечание
                        <textarea
                          name="reference"
                          minLength={3}
                          maxLength={500}
                          required
                          placeholder="Дата и способ передачи в игре"
                        />
                      </label>
                      <label className="check">
                        <input type="checkbox" name="confirm" required />
                        <span>
                          Золото уже передано этому игроку. Подтверждаю сумму.
                        </span>
                      </label>
                    </ActionForm>
                  </details>
                )}
            </article>
          ))}
        </div>
        {pagination("apage", apage, awards.count)}
      </section>
      {permissions.allocate && (
        <details className="panel section-panel">
          <summary>История распределения продаж</summary>
          {!batches.data?.length && <p>Распределений пока нет.</p>}
          <div className="treasury-sales">
            {((batches.data ?? []) as AllocationLog[]).map((a) => (
              <article className="character-card" key={a.id}>
                <h3>{a.item_name}</h3>
                <p className="caption">
                  {stamp(a.created_at)} · {a.recipient_count} получателей
                </p>
                <p>
                  {formatGold(a.amount_units)} зол. · {a.reason}
                </p>
                {a.voided_at ? (
                  <p className="notice">Отменено: {a.void_reason}</p>
                ) : (
                  <CancelRecord
                    id={a.id}
                    action={cancelAllocation}
                    description="Подтверждаю отмену начислений. Если по ним уже есть выплаты, операция будет отклонена."
                  />
                )}
              </article>
            ))}
          </div>
          {pagination("bpage", bpage, batches.count)}
        </details>
      )}
      <details className="panel section-panel">
        <summary>История выплат</summary>
        {!payouts.data?.length && <p>Выплат пока нет.</p>}
        <div className="treasury-sales">
          {((payouts.data ?? []) as PayoutLog[]).map((payout) => (
            <article className="character-card" key={payout.id}>
              <h3>
                {payout.nickname_snapshot} · {formatGold(payout.amount_units)}{" "}
                зол.
              </h3>
              <p className="caption">
                {stamp(payout.created_at)} · {sourceName(payout.source)}
              </p>
              <p className="profile-about">{payout.reference}</p>
              {payout.voided_at ? (
                <p className="notice">Отменено: {payout.void_reason}</p>
              ) : (
                permissions.pay && (
                  <CancelRecord
                    id={payout.id}
                    action={cancelPayout}
                    description="Проверил фактический возврат золота или ошибочность записи. Отмена восстановит казну и долг игроку."
                  />
                )
              )}
            </article>
          ))}
        </div>
        {pagination("ppage", ppage, payouts.count)}
      </details>
      <section className="panel section-panel">
        <h2>Расходы гильдии</h2>
        <p className="muted">
          Списываются только из казны гильдии. Прайм, мини РБ и имущество не
          используются.
        </p>
        {permissions.spend && (
          <details>
            <summary>Записать расход</summary>
            <ActionForm action={recordExpense} label="Записать расход">
              <input type="hidden" name="requestId" value={randomUUID()} />
              <label>
                Сумма, золото
                <input
                  name="amount"
                  inputMode="decimal"
                  pattern="[0-9]+([.,][0-9]{1,4})?"
                  maxLength={16}
                  required
                />
              </label>
              <label>
                Назначение расхода
                <textarea
                  name="purpose"
                  minLength={3}
                  maxLength={500}
                  required
                />
              </label>
              <label className="check">
                <input name="confirm" type="checkbox" required />
                <span>Подтверждаю фактический расход и его назначение.</span>
              </label>
            </ActionForm>
          </details>
        )}
        {!expenses.data?.length && <p className="notice">Расходов пока нет.</p>}
        <div className="treasury-sales">
          {((expenses.data ?? []) as ExpenseLog[]).map((x) => (
            <article className="character-card" key={x.id}>
              <h3>{formatGold(x.amount_units)} зол.</h3>
              <p className="caption">{stamp(x.created_at)}</p>
              <p className="profile-about">{x.purpose}</p>
              {x.voided_at ? (
                <p className="notice">Отменено: {x.void_reason}</p>
              ) : (
                permissions.spend && (
                  <CancelRecord
                    id={x.id}
                    action={cancelExpense}
                    description="Проверил возврат золота или ошибочность записи. Подтверждаю восстановление суммы в казне гильдии."
                  />
                )
              )}
            </article>
          ))}
        </div>
        {pagination("xpage", xpage, expenses.count)}
      </section>
    </div>
  );
}
