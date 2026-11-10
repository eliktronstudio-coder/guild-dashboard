import { randomUUID } from "node:crypto";
import { ActionForm } from "@/components/action-form";
import { SaleAmount } from "./amount";
import { InventoryItem } from "./inventory-item";
import { dropDescription } from "@/lib/drop-descriptions";
import { reviseLoot } from "@/app/treasury/actions";
import {
  recordInventorySale,
  listInventoryAuction,
  completeInventoryAuction,
  cancelInventoryAuction,
  discardInventoryStock,
} from "@/app/treasury/inventory-actions";
import {
  formatGold,
  goldInput,
  type Loot,
  type InventoryAuction,
} from "@/lib/treasury";
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
        Примечание к партии
        <textarea
          name="note"
          rows={2}
          maxLength={1000}
          defaultValue={item?.note}
          placeholder="Для внутреннего учёта. Свойства предмета берутся из ArcheAge Codex."
        />
      </label>
    </>
  );
}
function StockFields({ item }: { item: Loot }) {
  return (
    <>
      <input type="hidden" name="requestId" value={randomUUID()} />
      <input type="hidden" name="lootId" value={item.id} />
      <input type="hidden" name="version" value={item.version} />
    </>
  );
}
function Buyer({
  id,
  buyers,
  auction = false,
}: {
  id: string;
  buyers: string[];
  auction?: boolean;
}) {
  return (
    <label>
      Кому продано
      <input
        name="buyer"
        list={id}
        required
        minLength={2}
        maxLength={80}
        defaultValue={auction ? "Аукцион" : ""}
        placeholder="Ник покупателя"
      />
      <datalist id={id}>
        {buyers.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </label>
  );
}
function Quantity({ max }: { max: number }) {
  return (
    <label>
      Количество
      <input
        name="quantity"
        type="number"
        min={1}
        max={max}
        step={1}
        required
        defaultValue={1}
      />
    </label>
  );
}
export function InventoryList({
  items,
  manage,
  auctions = [],
  buyers = [],
}: {
  items: Loot[];
  manage: boolean;
  auctions?: InventoryAuction[];
  buyers?: string[];
}) {
  if (!items.length)
    return (
      <div className="empty-state">
        <h3>Здесь пока нет дропа</h3>
        <p>Добавьте предметы или измените фильтр.</p>
      </div>
    );
  return (
    <div className="inventory-bag">
      {items.map((item) => {
        const available = item.available_quantity ?? item.quantity_remaining,
          lots = auctions.filter(
            (a) => a.loot_id === item.id && a.status === "active",
          );
        return (
          <InventoryItem
            key={item.id}
            item={item}
            description={dropDescription(item)}
            manage={manage}
            sale={
              <>
                <h3>Продать игроку</h3>
                {available > 0 ? (
                  <ActionForm
                    action={recordInventorySale}
                    revision={item.version}
                    label="Записать продажу"
                  >
                    <StockFields item={item} />
                    <Quantity max={available} />
                    <Buyer id={`buyer-${item.id}`} buyers={buyers} />
                    <SaleAmount key={item.version} source={item.source} />
                    <label className="check">
                      <input type="checkbox" name="confirm" required />
                      <span>
                        Золото получено. Подтверждаю передачу предметов
                        покупателю.
                      </span>
                    </label>
                  </ActionForm>
                ) : (
                  <p>
                    Свободного остатка нет. Снимите лот с аукциона или
                    подтвердите его продажу во вкладке «Аукцион».
                  </p>
                )}
                {item.note && (
                  <p className="caption">Примечание партии: {item.note}</p>
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
            }
            auction={
              <>
                <h3>На аукционе</h3>
                <p className="caption">
                  Здесь учитываются лоты игрового аукциона. Золото начисляется
                  только после подтверждения продажи.
                </p>
                {lots.length ? (
                  lots.map((lot) => (
                    <section key={lot.id} className="inventory-auction-lot">
                      <h4>Лот · осталось {lot.quantity_remaining} шт.</h4>
                      <p>
                        Цена за единицу: {formatGold(lot.unit_price_units)} зол.
                      </p>
                      <details>
                        <summary>Подтвердить продажу с аукциона</summary>
                        <ActionForm
                          action={completeInventoryAuction}
                          revision={`${item.version}-${lot.version}`}
                          label="Записать продажу с аукциона"
                        >
                          <input
                            type="hidden"
                            name="requestId"
                            value={randomUUID()}
                          />
                          <input
                            type="hidden"
                            name="auctionId"
                            value={lot.id}
                          />
                          <input
                            type="hidden"
                            name="auctionVersion"
                            value={lot.version}
                          />
                          <input
                            type="hidden"
                            name="version"
                            value={item.version}
                          />
                          <Quantity max={lot.quantity_remaining} />
                          <Buyer
                            id={`auction-buyer-${lot.id}`}
                            buyers={buyers}
                            auction
                          />
                          <SaleAmount
                            key={`${item.version}-${lot.version}`}
                            source={item.source}
                            label="Получено всего, золото (после комиссии)"
                          />
                          <label className="check">
                            <input type="checkbox" name="confirm" required />
                            <span>
                              Указанное количество продано, золото с аукциона
                              получено.
                            </span>
                          </label>
                        </ActionForm>
                      </details>
                      <details>
                        <summary>Снять непроданный лот</summary>
                        <ActionForm
                          action={cancelInventoryAuction}
                          revision={lot.version}
                          label="Вернуть на склад"
                        >
                          <input
                            type="hidden"
                            name="auctionId"
                            value={lot.id}
                          />
                          <input
                            type="hidden"
                            name="auctionVersion"
                            value={lot.version}
                          />
                          <label className="check">
                            <input type="checkbox" name="confirm" required />
                            <span>
                              Непроданные предметы сняты с аукциона и
                              возвращены.
                            </span>
                          </label>
                        </ActionForm>
                      </details>
                    </section>
                  ))
                ) : (
                  <p>Активных лотов нет.</p>
                )}
                {available > 0 && (
                  <details open={!lots.length}>
                    <summary>Выставить новое количество</summary>
                    <ActionForm
                      action={listInventoryAuction}
                      revision={item.version}
                      label="Записать выставление на аукцион"
                    >
                      <StockFields item={item} />
                      <Quantity max={available} />
                      <label>
                        Цена за единицу, золото
                        <input
                          name="unitPrice"
                          inputMode="decimal"
                          required
                          pattern="[0-9]+([.,][0-9]{1,4})?"
                          maxLength={16}
                          defaultValue={goldInput(item.estimated_unit_units)}
                        />
                      </label>
                      <label className="check">
                        <input type="checkbox" name="confirm" required />
                        <span>
                          Предметы выставлены на игровом аукционе.
                          Зарезервировать это количество.
                        </span>
                      </label>
                    </ActionForm>
                  </details>
                )}
              </>
            }
            discard={
              <>
                <h3>Удалить количество со склада</h3>
                <p>
                  Списывается только свободный остаток. Это не продажа: золото
                  не начисляется, причина остаётся в журнале.
                </p>
                {available > 0 ? (
                  <ActionForm
                    action={discardInventoryStock}
                    revision={item.version}
                    label="Списать указанное количество"
                  >
                    <StockFields item={item} />
                    <Quantity max={available} />
                    <label>
                      Причина удаления
                      <textarea
                        name="reason"
                        required
                        minLength={3}
                        maxLength={500}
                      />
                    </label>
                    <label className="check">
                      <input type="checkbox" name="confirm" required />
                      <span>Подтверждаю списание указанного количества.</span>
                    </label>
                  </ActionForm>
                ) : (
                  <p>
                    Свободного остатка нет. Сначала снимите предметы с аукциона.
                  </p>
                )}
              </>
            }
          />
        );
      })}
    </div>
  );
}
