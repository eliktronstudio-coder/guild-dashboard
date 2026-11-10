"use client";
import { useState } from "react";
import {
  formatGold,
  goldInput,
  parseGold,
  splitSale,
  MAX_AMOUNT_UNITS,
  type TreasurySource,
} from "@/lib/treasury";
export function AuctionPrice({
  available,
  price,
  source,
}: {
  available: number;
  price: string | null;
  source: TreasurySource;
}) {
  const [quantity, setQuantity] = useState("1"),
    [unit, setUnit] = useState(goldInput(price));
  const units = parseGold(unit),
    count = /^\d{1,7}$/.test(quantity) ? BigInt(quantity) : 0n;
  const total = units === null ? 0n : BigInt(units) * count,
    valid =
      count > 0n &&
      count <= BigInt(available) &&
      total > 0n &&
      total <= MAX_AMOUNT_UNITS,
    split = valid ? splitSale(String(total), source) : null;
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
        Цена за единицу, золото
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
        {split ? (
          <>
            Сумма продажи: {formatGold(String(total))} зол.
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
