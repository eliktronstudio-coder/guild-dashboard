import { randomUUID } from "node:crypto";
import { ActionForm } from "@/components/action-form";
import { SaleAmount } from "./amount";
import { LootIcon } from "./loot-icon";
import { reviseLoot, sellLoot } from "@/app/treasury/actions";
import { formatGold, goldInput, type Loot } from "@/lib/treasury";
export function LootFields({ item }: { item?: Loot }) {
  return (
    <>
      <label>
        Название предмета
        <input
          name="name"
          required
          minLength={2}
          maxLength={120}
          defaultValue={item?.name}
        />
      </label>
      <label>
        Категория
        <input
          name="category"
          maxLength={80}
          defaultValue={item?.category}
          placeholder="Оружие, материалы…"
        />
      </label>
      <div className="field-grid">
        <label>
          {item ? "Общее количество партии" : "Количество"}
          <input
            name="quantity"
            type="number"
            min={item ? item.quantity_total - item.quantity_remaining : 1}
            max={1000000}
            step="1"
            required
            defaultValue={item?.quantity_total}
          />
        </label>
        <label>
          Оценка за единицу, золото
          <input
            name="estimate"
            inputMode="decimal"
            pattern="[0-9]+([.,][0-9]{1,4})?"
            maxLength={16}
            defaultValue={goldInput(item?.estimated_unit_units ?? null)}
            placeholder="Можно оставить без оценки"
          />
        </label>
      </div>
      <label>
        Описание предмета / примечание
        <textarea
          name="note"
          rows={2}
          maxLength={1000}
          defaultValue={item?.note}
          placeholder="Это описание появится при наведении на иконку предмета"
        />
      </label>
    </>
  );
}
export function InventoryList({
  items,
  manage,
}: {
  items: Loot[];
  manage: boolean;
}) {
  if (!items.length)
    return (
      <div className="empty-state">
        <h3>Здесь пока нет дропа</h3>
        <p>Добавьте предметы из завершённой активности или измените фильтр.</p>
      </div>
    );
  return (
    <div className="treasury-items">
      {items.map((item) => (
        <article className="character-card treasury-item" key={item.id}>
          <div className="inventory-item-heading">
            <LootIcon item={item} />
            <div className="section-heading">
              <h3>{item.name}</h3>
              <span className="badge gold">
                {item.quantity_remaining > 0 ? "В наличии" : "Нет остатка"}
              </span>
            </div>
          </div>
          <p className="caption">
            {item.category || "Без категории"} · Получен на склад
            {item.archived_period ? ` · архив с ${item.archived_period}` : ""}
          </p>
          <dl className="character-details">
            <dt>Осталось</dt>
            <dd>
              {item.quantity_remaining} из {item.quantity_total}
            </dd>
            <dt>Оценка единицы</dt>
            <dd>
              {item.estimated_unit_units === null
                ? "Без оценки"
                : `${formatGold(item.estimated_unit_units)} зол.`}
            </dd>
            <dt>Стоимость остатка</dt>
            <dd>
              {item.estimated_total_units === null
                ? "Без оценки"
                : `${formatGold(item.estimated_total_units)} зол.`}
            </dd>
          </dl>
          {item.note && <p className="profile-about">{item.note}</p>}
          {manage && (
            <>
              {item.quantity_remaining > 0 && (
                <details>
                  <summary>Записать продажу</summary>
                  <ActionForm
                    action={sellLoot}
                    revision={item.version}
                    label="Записать продажу"
                  >
                    <input
                      type="hidden"
                      name="requestId"
                      value={randomUUID()}
                    />
                    <input type="hidden" name="lootId" value={item.id} />
                    <input type="hidden" name="version" value={item.version} />
                    <label>
                      Проданное количество
                      <input
                        name="quantity"
                        type="number"
                        min={1}
                        max={item.quantity_remaining}
                        step="1"
                        required
                        defaultValue={1}
                      />
                    </label>
                    <SaleAmount key={item.version} source={item.source} />
                    <label>
                      Примечание к продаже
                      <textarea name="note" rows={2} maxLength={500} />
                    </label>
                    <label className="check">
                      <input type="checkbox" name="confirm" required />
                      <span>
                        Золото получено. Подтверждаю количество и общую сумму
                        продажи.
                      </span>
                    </label>
                  </ActionForm>
                </details>
              )}
              <details>
                <summary>Исправить партию или оценку</summary>
                <ActionForm
                  action={reviseLoot}
                  revision={item.version}
                  label="Сохранить исправление"
                >
                  <input type="hidden" name="lootId" value={item.id} />
                  <input type="hidden" name="version" value={item.version} />
                  <LootFields item={item} />
                  <p className="caption">
                    Общее количество включает уже проданное. Ноль убирает
                    ошибочную непроданную партию из наличия; история остаётся.
                  </p>
                  <label>
                    Причина исправления
                    <textarea
                      name="reason"
                      minLength={3}
                      maxLength={500}
                      required
                    />
                  </label>
                </ActionForm>
              </details>
            </>
          )}
        </article>
      ))}
    </div>
  );
}
