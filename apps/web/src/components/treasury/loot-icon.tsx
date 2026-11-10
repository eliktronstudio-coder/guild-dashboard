"use client";
import { useState } from "react";
import { formatGold, type Loot } from "@/lib/treasury";

export function LootIcon({ item }: { item: Loot }) {
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const descriptionId = `loot-description-${item.id}`;
  return (
    <div
      className="loot-icon-wrap"
      data-dismissed={dismissed}
      onMouseEnter={() => setDismissed(false)}
      onFocus={() => setDismissed(false)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          setDismissed(true);
        }
      }}
    >
      <button
        type="button"
        className="loot-icon-button"
        aria-label={`${item.name}: в наличии ${item.quantity_remaining}. Описание предмета`}
        aria-expanded={open}
        aria-describedby={descriptionId}
        onClick={() => {
          setOpen(!open);
          setDismissed(open);
        }}
      >
        {missing ? (
          <span className="loot-icon-placeholder" aria-hidden="true">
            ◇
          </span>
        ) : (
          <img
            src={`/events/${item.event_id}/media?kind=item&item=${item.id}`}
            alt=""
            width={64}
            height={64}
            loading="lazy"
            onError={() => setMissing(true)}
          />
        )}
        <span className="loot-icon-quantity" aria-hidden="true">
          {item.quantity_remaining.toLocaleString("ru-RU")}
        </span>
      </button>
      <div
        id={descriptionId}
        role="tooltip"
        className={`loot-icon-description${open ? " is-open" : ""}`}
      >
        <strong>{item.name}</strong>
        <span className="caption">
          {item.source === "prime" ? "Прайм" : "Мини РБ"}
          {item.category ? ` · ${item.category}` : ""}
        </span>
        {item.note && <p className="loot-description-note">{item.note}</p>}
        <dl>
          <dt>В наличии</dt>
          <dd>{item.quantity_remaining.toLocaleString("ru-RU")} шт.</dd>
          <dt>Цена за единицу</dt>
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
        <small className="caption">
          {item.archived_period
            ? `Получен · архив с ${item.archived_period}`
            : "Получен на склад"}
        </small>
      </div>
    </div>
  );
}
