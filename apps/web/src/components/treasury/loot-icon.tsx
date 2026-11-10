"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatGold, type Loot } from "@/lib/treasury";
import type { DropDescription } from "@/lib/drop-descriptions";

export function LootIcon({
  item,
  description,
  onActivate,
}: {
  item: Loot;
  description: DropDescription | null;
  onActivate: () => void;
}) {
  const [visible, setVisible] = useState(false),
    [missing, setMissing] = useState(false),
    [position, setPosition] = useState({ left: 16, top: 16, maxHeight: 420 });
  const button = useRef<HTMLButtonElement>(null),
    tip = useRef<HTMLDivElement>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = `loot-description-${item.id}`;
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
  };
  const show = () => {
    clear();
    const r = button.current?.getBoundingClientRect();
    if (r) {
      const height = Math.min(420, window.innerHeight - 32),
        width = Math.min(340, window.innerWidth - 32);
      setPosition({
        left: Math.max(16, Math.min(r.left, window.innerWidth - width - 16)),
        top:
          r.bottom + height + 8 > window.innerHeight
            ? Math.max(16, r.top - height - 8)
            : r.bottom + 8,
        maxHeight: height,
      });
    }
    setVisible(true);
  };
  const hide = () => {
    clear();
    timer.current = setTimeout(() => setVisible(false), 150);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (!visible) return;
    const close = (event: Event) => {
      if (
        event.type === "scroll" &&
        event.target instanceof Node &&
        tip.current?.contains(event.target)
      )
        return;
      setVisible(false);
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [visible]);
  return (
    <div className="loot-icon-wrap" onMouseEnter={show} onMouseLeave={hide}>
      <button
        ref={button}
        type="button"
        className="loot-icon-button"
        aria-label={`${item.name}: в наличии ${item.quantity_remaining}. Открыть предмет`}
        aria-haspopup="dialog"
        aria-describedby={visible ? id : undefined}
        onFocus={show}
        onBlur={(e) => {
          if (!tip.current?.contains(e.relatedTarget as Node | null)) hide();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            clear();
            setVisible(false);
          }
        }}
        onClick={() => {
          clear();
          setVisible(false);
          onActivate();
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
        {!!item.auction_quantity && (
          <span className="loot-auction-badge" aria-hidden="true">
            А
          </span>
        )}
        <span className="loot-icon-quantity" aria-hidden="true">
          {item.quantity_remaining.toLocaleString("ru-RU")}
        </span>
      </button>
      {visible &&
        createPortal(
          <div
            ref={tip}
            id={id}
            role="tooltip"
            className="loot-icon-description inventory-tooltip"
            style={position}
            onMouseEnter={clear}
            onMouseLeave={hide}
            onFocus={clear}
            onBlur={hide}
            onKeyDown={(e) => {
              if (e.key === "Escape") setVisible(false);
            }}
          >
            <strong>{item.name}</strong>
            {description ? (
              <>
                <p className="codex-description">{description.text}</p>
                <p className="caption">
                  Базовые свойства из базы. Значения зависят от качества и
                  улучшений предмета.
                </p>
                <a
                  href={description.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="codex-source"
                >
                  ArcheAge Codex ↗
                </a>
              </>
            ) : (
              <p>Описание из базы пока не найдено для этого предмета.</p>
            )}
            <dl>
              <dt>На складе</dt>
              <dd>{item.quantity_remaining} шт.</dd>
              <dt>Доступно</dt>
              <dd>{item.available_quantity ?? item.quantity_remaining} шт.</dd>
              <dt>На аукционе</dt>
              <dd>{item.auction_quantity ?? 0} шт.</dd>
              <dt>Учётная цена</dt>
              <dd>
                {item.estimated_unit_units === null
                  ? "Без оценки"
                  : `${formatGold(item.estimated_unit_units)} зол.`}
              </dd>
            </dl>
          </div>,
          document.body,
        )}
    </div>
  );
}
