import { formatGold, type TreasuryTotals } from "@/lib/treasury";
export function TreasurySummary({ totals: t }: { totals: TreasuryTotals }) {
  return (
    <div className="treasury-totals">
      <article className="panel treasury-total">
        <span className="eyebrow">ПРАЙМ · 70%</span>
        <h2>Казна прайм</h2>
        <strong>
          {formatGold(t.prime_units)} <small>зол.</small>
        </strong>
        <p>Текущий период · остаток после выплат</p>
        <p className="caption">
          К выплате: {formatGold(t.prime_reserved_units)} · свободно:{" "}
          {formatGold(t.prime_free_units)} зол.
        </p>
        <span className="caption">
          Продано прайм-дропа на {formatGold(t.prime_gross_units)} зол.
        </span>
      </article>
      <article className="panel treasury-total">
        <span className="eyebrow">МИНИ РБ · 100%</span>
        <h2>Казна мини РБ</h2>
        <strong>
          {formatGold(t.mini_units)} <small>зол.</small>
        </strong>
        <p>Текущий период · выручка после выплат</p>
      </article>
      <article className="panel treasury-total">
        <span className="eyebrow">ДОЛЯ ГИЛЬДИИ · 30%</span>
        <h2>Казна гильдии</h2>
        <strong>
          {formatGold(t.guild_units)} <small>зол.</small>
        </strong>
        <p>Текущий период · отчисления от прайма</p>
        <span className="caption">
          Расходы: {formatGold(t.guild_expense_units)} зол.
        </span>
      </article>
      <article className="panel treasury-total stock">
        <span className="eyebrow">ДРОП В ДВУХ ИНВЕНТАРЯХ</span>
        <h2>Общая казна</h2>
        <strong>
          {t.unpriced_count > 0 && t.priced_count === 0 ? (
            "Нет оценки"
          ) : (
            <>
              {formatGold(t.inventory_units)} <small>зол.</small>
            </>
          )}
        </strong>
        <p>Оценка непроданного дропа</p>
        {t.unpriced_count > 0 ? (
          <span className="caption">
            Неполная оценка: без цены {t.unpriced_count} поз.
          </span>
        ) : (
          <span className="caption">Остаток × оценочная цена единицы</span>
        )}
      </article>
    </div>
  );
}
