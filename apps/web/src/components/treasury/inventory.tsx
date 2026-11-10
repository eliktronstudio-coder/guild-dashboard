import { randomUUID } from "node:crypto";
import { ActionForm } from "@/components/action-form";
import { SaleAmount } from "./amount";
import { AuctionPrice } from "./auction-price";
import { InventoryItem } from "./inventory-item";
import { dropDescription } from "@/lib/drop-descriptions";
import {
  inventoryPosition,
  type InventoryWarehouse,
} from "@/lib/inventory-position";
import {
  recordInventorySale,
  listInventoryAuction,
  completeInventoryAuction,
  cancelInventoryAuction,
  discardInventoryStock,
  transferInventoryToXd,
} from "@/app/treasury/inventory-actions";
import { formatGold, type Loot, type InventoryAuction } from "@/lib/treasury";
function StockFields({ item }: { item: Loot }) {
  return (
    <>
      <input type="hidden" name="requestId" value={randomUUID()} />
      <input type="hidden" name="lootId" value={item.id} />
      <input type="hidden" name="version" value={item.version} />
      <input
        type="hidden"
        name="warehouse"
        value={item.warehouse ?? "general"}
      />
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
  warehouse,
  manage,
  auctions = [],
  buyers = [],
}: {
  items: Loot[];
  warehouse: InventoryWarehouse;
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
      {items.map((raw) => {
        const item = inventoryPosition(raw, warehouse);
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
            transfer={
              <>
                <h3>Перенести в инвентарь ХД</h3>
                <p>
                  Переносится выбранное количество. Категория Прайм/Мини РБ и
                  расчётный период сохраняются; золото не начисляется.
                </p>
                <ActionForm
                  action={transferInventoryToXd}
                  revision={item.version}
                  label="Перенести в инвентарь ХД"
                >
                  <StockFields item={item} />
                  <Quantity max={available} />
                </ActionForm>
              </>
            }
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
              </>
            }
            auction={
              <>
                <h3>Продажа на аукционе</h3>
                <p className="caption">
                  Выставление сразу считается продажей. Количество списывается,
                  сумма «количество × цена за единицу» сразу начисляется в
                  казны. Отдельное подтверждение продажи не требуется. Комиссия
                  автоматически не вычитается.
                </p>
                {!!lots.length && <h4>Ожидающие лоты, созданные ранее</h4>}
                {lots.length
                  ? lots.map((lot) => (
                      <section key={lot.id} className="inventory-auction-lot">
                        <h4>Лот · осталось {lot.quantity_remaining} шт.</h4>
                        <p>
                          Цена за единицу: {formatGold(lot.unit_price_units)}{" "}
                          зол.
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
                  : null}
                {available > 0 && (
                  <details open={!lots.length}>
                    <summary>Выставить и сразу продать</summary>
                    <ActionForm
                      action={listInventoryAuction}
                      revision={item.version}
                      label="Выставить и записать продажу"
                    >
                      <StockFields item={item} />
                      <AuctionPrice
                        key={item.version}
                        available={available}
                        price={item.estimated_unit_units}
                        source={item.source}
                      />
                      <label className="check">
                        <input type="checkbox" name="confirm" required />
                        <span>
                          Считать выставление продажей: списать количество и
                          начислить указанную сумму в казны.
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
