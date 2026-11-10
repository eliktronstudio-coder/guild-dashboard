"use client";
import { useRef, useState, type ReactNode } from "react";
import { LootIcon } from "./loot-icon";
import type { Loot } from "@/lib/treasury";
import type { DropDescription } from "@/lib/drop-descriptions";
export function InventoryItem({
  item,
  description,
  manage,
  sale,
  auction,
  discard,
  transfer,
}: {
  item: Loot;
  description: DropDescription | null;
  manage: boolean;
  sale: ReactNode;
  auction: ReactNode;
  discard: ReactNode;
  transfer: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [mode, setMode] = useState("sale");
  const common = item.warehouse === "general",
    titleId = `inventory-title-${item.warehouse}-${item.id}`;
  return (
    <div className="inventory-slot">
      <LootIcon
        item={item}
        description={description}
        onActivate={() => {
          setMode(
            common
              ? "transfer"
              : (item.available_quantity ?? item.quantity_remaining) > 0
                ? "sale"
                : "auction",
          );
          dialog.current?.showModal();
        }}
      />
      <dialog
        ref={dialog}
        className="inventory-dialog"
        aria-labelledby={titleId}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            const r = e.currentTarget.getBoundingClientRect();
            if (
              e.clientX < r.left ||
              e.clientX > r.right ||
              e.clientY < r.top ||
              e.clientY > r.bottom
            )
              dialog.current?.close();
          }
        }}
      >
        <div className="inventory-dialog-header">
          <div>
            <p className="eyebrow">
              {common ? "ОБЩИЙ ИНВЕНТАРЬ" : "ИНВЕНТАРЬ ХД"} ·{" "}
              {item.source === "prime" ? "ПРАЙМ" : "МИНИ РБ"}
            </p>
            <h2 id={titleId}>{item.name}</h2>
          </div>
          <button
            type="button"
            className="button secondary"
            aria-label="Закрыть предмет"
            onClick={() => dialog.current?.close()}
          >
            ✕
          </button>
        </div>
        <p className="inventory-stock-line">
          На складе: <strong>{item.quantity_remaining}</strong> · доступно:{" "}
          <strong>{item.available_quantity ?? item.quantity_remaining}</strong>{" "}
          · на аукционе: <strong>{item.auction_quantity ?? 0}</strong>
        </p>
        {description && (
          <details className="inventory-codex">
            <summary>Свойства предмета · ArcheAge Codex</summary>
            <p className="codex-description">{description.text}</p>
            <p className="caption">
              Базовые свойства; характеристики зависят от качества и улучшений.
            </p>
            <a href={description.url} target="_blank" rel="noopener noreferrer">
              Открыть источник ↗
            </a>
          </details>
        )}
        {manage ? (
          <>
            <nav
              className="inventory-action-tabs"
              aria-label="Действия с предметом"
              style={
                common
                  ? { gridTemplateColumns: "repeat(2,minmax(0,1fr))" }
                  : undefined
              }
            >
              {(common
                ? [
                    ["transfer", "В инвентарь ХД"],
                    ["discard", "Удалить"],
                  ]
                : [
                    ["sale", "Продать"],
                    ["auction", "Аукцион"],
                    ["discard", "Удалить"],
                  ]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`button ${mode === key ? "primary" : "secondary"}`}
                  aria-pressed={mode === key}
                  onClick={() => setMode(key)}
                >
                  {label}
                </button>
              ))}
            </nav>
            {common ? (
              <div hidden={mode !== "transfer"}>{transfer}</div>
            ) : (
              <>
                <div hidden={mode !== "sale"}>{sale}</div>
                <div hidden={mode !== "auction"}>{auction}</div>
              </>
            )}
            <div hidden={mode !== "discard"}>{discard}</div>
          </>
        ) : (
          <p className="caption">
            Действия с предметами доступны управляющим казной.
          </p>
        )}
      </dialog>
    </div>
  );
}
