"use client";
import { useState } from "react";
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
      <label>
        Предмет из реестра дропа
        <select
          name="catalogId"
          value={catalog}
          required
          onChange={(e) => {
            setCatalog(e.target.value);
            setPrice(
              goldInput(
                items.find((i) => i.id === e.target.value)?.price_units ?? null,
              ),
            );
          }}
        >
          <option value="" disabled>
            Выберите предмет
          </option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} · {formatGold(i.price_units)} зол.
            </option>
          ))}
        </select>
      </label>
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
