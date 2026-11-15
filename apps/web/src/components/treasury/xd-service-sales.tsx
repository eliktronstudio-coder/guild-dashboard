import { randomUUID } from "node:crypto";
import { ActionForm } from "@/components/action-form";
import { recordXdServiceSale } from "@/app/treasury/inventory-actions";
import { SaleAmount } from "./amount";
export function XdServiceSales() {
  return (
    <div className="form-stack">
      {(
        [
          ["rb_experience", "Продажа РБ опыта"],
          ["trash", "Продажа мусора"],
        ] as const
      ).map(([kind, title]) => (
        <details key={kind}>
          <summary>{title}</summary>
          <p className="caption">
            100% полученного золота — в казну Мини РБ. Учитывается в начислениях
            текущего периода.
          </p>
          <ActionForm action={recordXdServiceSale} label="Записать продажу">
            <input type="hidden" name="requestId" value={randomUUID()} />
            <input type="hidden" name="kind" value={kind} />
            <label>
              Кому продано
              <input
                name="buyer"
                required
                minLength={2}
                maxLength={80}
                defaultValue={kind === "trash" ? "Торговец" : ""}
                placeholder="Ник покупателя"
              />
            </label>
            <SaleAmount source="mini_rb" />
            <label>
              {kind === "rb_experience"
                ? "Объём опыта и примечание"
                : "Что продано и примечание"}
              <textarea
                name="note"
                maxLength={400}
                placeholder={
                  kind === "rb_experience"
                    ? "Например, 500 000 ед. опыта"
                    : "Описание проданного мусора"
                }
              />
            </label>
            <label className="check">
              <input type="checkbox" name="confirm" required />
              <span>Золото получено. Подтверждаю запись продажи.</span>
            </label>
          </ActionForm>
        </details>
      ))}
    </div>
  );
}
