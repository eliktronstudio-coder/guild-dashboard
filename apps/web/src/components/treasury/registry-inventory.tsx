"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { addRegistryInventory } from "@/app/treasury/actions";
import { goldInput, formatGold } from "@/lib/treasury";
type Item = { id: string; name: string; price_units: string; version: number };
type Event = { id: string; title: string; treasury_source: string };
export function RegistryInventory({
  items,
  events,
  requestId,
}: {
  items: Item[];
  events: Event[];
  requestId: string;
}) {
  const [catalog, setCatalog] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const picker = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const pickerId = useId();
  useEffect(() => {
    if (!open) return;
    searchInput.current?.focus();
    const dismiss = (e: PointerEvent) => {
      if (!picker.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${pickerId}-option-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open, pickerId]);
  const matchingItems = items.filter((item) =>
    item.name
      .toLocaleLowerCase("ru")
      .replace(/ё/g, "е")
      .includes(search.trim().toLocaleLowerCase("ru").replace(/ё/g, "е")),
  );
  const [price, setPrice] = useState("");
  const [event, setEvent] = useState("");
  const [source, setSource] = useState("prime");
  const item = items.find((i) => i.id === catalog);
  return (
    <ActionForm action={addRegistryInventory} label="Добавить в инвентарь">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="catalogVersion" value={item?.version ?? 0} />
      <label>
        Источник
        <select
          name="eventId"
          value={event}
          onChange={(e) => {
            setEvent(e.target.value);
            const activity = events.find((a) => a.id === e.target.value);
            if (activity) setSource(activity.treasury_source);
          }}
        >
          <option value="">Из Сундука</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title} · {e.treasury_source === "prime" ? "Прайм" : "Мини РБ"}
            </option>
          ))}
        </select>
      </label>
      <div
        className="registry-picker"
        ref={picker}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            trigger.current?.focus();
          }
        }}
      >
        <label id={`${pickerId}-label`}>Предмет из реестра дропа</label>
        <button
          type="button"
          ref={trigger}
          className="registry-picker-trigger"
          aria-labelledby={`${pickerId}-label ${pickerId}-value`}
          aria-expanded={open}
          aria-controls={`${pickerId}-popup`}
          aria-haspopup="dialog"
          onClick={() => {
            setSearch("");
            setActive(0);
            setOpen(!open);
          }}
        >
          <span id={`${pickerId}-value`}>
            {item
              ? `${item.name} · ${formatGold(item.price_units)} зол.`
              : "Выберите предмет"}
          </span>
          <span aria-hidden="true">⌄</span>
        </button>
        <select
          className="registry-picker-validation"
          name="catalogId"
          value={catalog}
          required
          tabIndex={-1}
          aria-label="Предмет из реестра дропа"
          onInvalid={(e) => {
            e.preventDefault();
            setSearch("");
            setActive(0);
            setOpen(true);
            searchInput.current?.focus();
          }}
          onChange={(e) => {
            setCatalog(e.target.value);
            setPrice(
              goldInput(
                items.find((i) => i.id === e.target.value)?.price_units ?? null,
              ),
            );
          }}
        >
          <option value="">Выберите предмет</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        {open && (
          <div
            className="registry-picker-popup"
            id={`${pickerId}-popup`}
            role="dialog"
            aria-label="Выбор предмета"
          >
            <label>
              Быстрый поиск
              <input
                ref={searchInput}
                type="search"
                role="combobox"
                value={search}
                aria-expanded="true"
                aria-controls={`${pickerId}-options`}
                aria-autocomplete="list"
                aria-activedescendant={
                  matchingItems[active]
                    ? `${pickerId}-option-${active}`
                    : undefined
                }
                placeholder="Начните вводить название…"
                autoComplete="off"
                onChange={(e) => {
                  setSearch(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((n) =>
                      Math.max(
                        0,
                        Math.min(
                          matchingItems.length - 1,
                          n + (e.key === "ArrowDown" ? 1 : -1),
                        ),
                      ),
                    );
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const chosen = matchingItems[active];
                    if (chosen) {
                      setCatalog(chosen.id);
                      setPrice(goldInput(chosen.price_units));
                      setOpen(false);
                      trigger.current?.focus();
                    }
                  }
                }}
              />
            </label>
            <div
              className="registry-picker-options"
              id={`${pickerId}-options`}
              role="listbox"
              aria-label="Предметы из реестра дропа"
            >
              {matchingItems.map((i, index) => (
                <button
                  type="button"
                  role="option"
                  tabIndex={-1}
                  id={`${pickerId}-option-${index}`}
                  key={i.id}
                  aria-selected={catalog === i.id}
                  className={index === active ? "is-active" : ""}
                  onClick={() => {
                    setCatalog(i.id);
                    setPrice(goldInput(i.price_units));
                    setOpen(false);
                    trigger.current?.focus();
                  }}
                >
                  {i.name} · {formatGold(i.price_units)} зол.
                </button>
              ))}
            </div>
            <p className="caption" role="status">
              {matchingItems.length
                ? `Найдено предметов: ${matchingItems.length}`
                : "Ничего не найдено. Измените название."}
            </p>
          </div>
        )}
      </div>
      <label>
        Категория
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          disabled={!!event}
        >
          <option value="prime">Прайм</option>
          <option value="mini_rb">Мини РБ</option>
        </select>
        <input name="source" type="hidden" value={source} />
      </label>
      <label>
        Цена за единицу, золото
        <input
          name="price"
          required
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          pattern="[0-9]+([.,][0-9]{1,4})?"
        />
      </label>
      <label>
        Количество
        <input
          name="quantity"
          type="number"
          required
          min="1"
          max="1000000"
          step="1"
          defaultValue="1"
        />
      </label>
      <label>
        Примечание
        <textarea name="note" maxLength={1000} />
      </label>
    </ActionForm>
  );
}
