import { PERIOD_CLOSING_ENABLED } from "@/lib/config";
import { formatGold, type TreasuryTotals } from "@/lib/treasury";
export function TreasurySummary({ totals: t }: { totals: TreasuryTotals }) {
  return (
    <div className="treasury-totals">
      <article className="panel treasury-total">
        <h2>Казна прайм</h2>
        <p className="caption">70% выручки Прайма — фонд зарплат</p>
        <strong>
          {formatGold(t.prime_units)} <small>зол.</small>
        </strong>
        <p>
          {PERIOD_CLOSING_ENABLED
            ? "Текущий период · остаток после выплат"
            : "Вся история · остаток после выплат"}
        </p>
        <p className="caption">
          К выплате: {formatGold(t.prime_reserved_units)} · свободно:{" "}
          {formatGold(t.prime_free_units)} зол.
        </p>
        <span className="caption">
          Продано прайм-дропа на {formatGold(t.prime_gross_units)} зол.
        </span>
      </article>
      <article className="panel treasury-total">
        <h2>Казна мини РБ</h2>
        <p className="caption">100% выручки Мини РБ — фонд зарплат</p>
        <strong>
          {formatGold(t.mini_units)} <small>зол.</small>
        </strong>
        <p>
          {PERIOD_CLOSING_ENABLED
            ? "Текущий период · выручка после выплат"
            : "Вся история · выручка после выплат"}
        </p>
      </article>
      <article className="panel treasury-total">
        <h2>Казна гильдии</h2>
        <p className="caption">30% выручки Прайма — доля гильдии</p>
        <strong>
          {formatGold(t.guild_units)} <small>зол.</small>
        </strong>
        <p>
          {PERIOD_CLOSING_ENABLED
            ? "Текущий период · отчисления от прайма"
            : "Вся история · отчисления за вычетом расходов"}
        </p>
        <span className="caption">
          Расходы: {formatGold(t.guild_expense_units)} зол.
        </span>
      </article>
      <article className="panel treasury-total stock">
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
        <p>Оценка непроданного дропа в обоих инвентарях</p>
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
