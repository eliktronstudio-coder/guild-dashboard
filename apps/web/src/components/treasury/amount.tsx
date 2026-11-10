"use client";
import { useState } from "react";
import {
  parseGold,
  splitSale,
  formatGold,
  type TreasurySource,
} from "@/lib/treasury";
export function SaleAmount({
  source,
  label = "Общая сумма этой продажи, золото",
}: {
  source: TreasurySource;
  label?: string;
}) {
  const [value, setValue] = useState("");
  const amount = parseGold(value),
    split = amount === null ? null : splitSale(amount, source);
  return (
    <>
      <label>
        {label}
        <input
          name="amount"
          inputMode="decimal"
          required
          maxLength={16}
          pattern="[0-9]+([.,][0-9]{1,4})?"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Например, 100000"
        />
      </label>
      <p className="notice" aria-live="polite">
        {split
          ? source === "prime"
            ? `В прайм: ${formatGold(split.fund)} · гильдии: ${formatGold(split.guild)} золота`
            : `В мини РБ: ${formatGold(split.fund)} золота`
          : source === "prime"
            ? "70% — казне прайма, 30% — казне гильдии."
            : "100% — казне мини РБ. Отчисления гильдии нет."}
      </p>
    </>
  );
}
