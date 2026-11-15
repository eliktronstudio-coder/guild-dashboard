"use client";
import { useState } from "react";
import {
  formatGold,
  goldInput,
  inventorySaleTotal,
  splitSale,
  type TreasurySource,
} from "@/lib/treasury";
export function AuctionPrice({
  available,
  price,
  source,
  priceLabel = "Цена за единицу, золото",
}: {
  priceLabel?: string;
  available: number;
  price: string | null;
  source: TreasurySource;
}) {
  const [quantity, setQuantity] = useState("1"),
    [unit, setUnit] = useState(goldInput(price));
  const total = inventorySaleTotal(quantity, unit),
    valid = total !== null && Number(quantity) <= available,
    split = valid ? splitSale(total, source) : null;
  return (
    <>
      <label>
        Количество
        <input
          name="quantity"
          type="number"
          min={1}
          max={available}
          step={1}
          required
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </label>
      <label>
        {priceLabel}
        <input
          name="unitPrice"
          inputMode="decimal"
          pattern="[0-9]+([.,][0-9]{1,4})?"
          maxLength={16}
          required
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        />
      </label>
      <p className="notice" aria-live="polite">
        {split && total !== null ? (
          <>
            Сумма продажи: {formatGold(total)} зол.
            <br />
            {source === "prime"
              ? `В прайм: ${formatGold(split.fund)} · гильдии: ${formatGold(split.guild)} зол.`
              : `В мини РБ: ${formatGold(split.fund)} зол.`}
          </>
        ) : (
          "Укажите доступное количество и положительную цену. Сумма — не больше 10 000 000 000 золота."
        )}
      </p>
    </>
  );
}
