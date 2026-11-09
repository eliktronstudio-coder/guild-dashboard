"use client";
import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { addActivityDrop } from "@/app/events/workspace-actions";
import { formatGold } from "@/lib/treasury";
import type { DropOption } from "@/lib/activity-workspace";
export function AddDropForm({
  catalog,
  eventId,
  requestId,
}: {
  catalog: DropOption[];
  eventId: string;
  requestId: string;
}) {
  const [id, setId] = useState(catalog[0]?.id ?? ""),
    selected = catalog.find((x) => x.id === id);
  return (
    <ActionForm action={addActivityDrop} label="Добавить предмет">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="requestId" value={requestId} />
      <input
        type="hidden"
        name="catalogVersion"
        value={selected?.version ?? 0}
      />
      <label>
        Предмет из реестра
        <select
          name="catalog"
          required
          value={id}
          onChange={(e) => setId(e.target.value)}
        >
          {catalog.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · {formatGold(d.price_units)} зол. / ед.
            </option>
          ))}
        </select>
      </label>
      <label>
        Количество
        <input
          type="number"
          name="quantity"
          required
          defaultValue={1}
          min={1}
          max={1000000}
        />
      </label>
    </ActionForm>
  );
}
