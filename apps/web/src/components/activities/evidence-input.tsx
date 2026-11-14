"use client";
import { useRef, useState } from "react";
import type { Evidence } from "@/lib/activity-workspace";
export function EvidenceInput({
  kind,
  onChange,
  onBusyChange,
}: {
  kind: "roster" | "loot";
  onChange: (images: Evidence[]) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const generation = useRef(0),
    [items, setItems] = useState<Evidence[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="activity-evidence-input">
      <label className="button secondary inline">
        ＋ Добавить
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          disabled={busy}
          aria-label={
            kind === "roster"
              ? "Добавить скрины состава"
              : "Добавить скрины дропа"
          }
          onChange={async (event) => {
            const token = ++generation.current,
              files = Array.from(event.target.files ?? []);
            event.target.value = "";
            setError("");
            if (files.length + items.length > 4) {
              setError("До четырёх новых скриншотов этого вида.");
              return;
            }
            setBusy(true);
            onBusyChange?.(true);
            try {
              const next: Evidence[] = [];
              for (const file of files) {
                if (file.size > 12 * 1024 * 1024)
                  throw Error("Выберите изображения до 12 МБ.");
                const bitmap = await createImageBitmap(file),
                  canvas = document.createElement("canvas");
                const scale = Math.min(
                  1,
                  1600 / bitmap.width,
                  1200 / bitmap.height,
                );
                canvas.width = Math.max(1, Math.round(bitmap.width * scale));
                canvas.height = Math.max(1, Math.round(bitmap.height * scale));
                const ctx = canvas.getContext("2d");
                if (!ctx) {
                  bitmap.close();
                  throw Error("Не удалось подготовить изображение.");
                }
                ctx.fillStyle = "#fff";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                bitmap.close();
                let image = "";
                for (const quality of [0.85, 0.7, 0.55, 0.4]) {
                  image = canvas.toDataURL("image/jpeg", quality);
                  if (image.length <= 500000) break;
                }
                if (image.length > 500000)
                  throw Error(
                    "Изображение слишком тяжёлое. Уменьшите размер скриншота.",
                  );
                next.push({ id: crypto.randomUUID(), kind, image });
              }
              if (token === generation.current) {
                const value = [...items, ...next];
                setItems(value);
                onChange(value);
              }
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Не удалось открыть изображение.",
              );
            } finally {
              if (token === generation.current) {
                setBusy(false);
                onBusyChange?.(false);
              }
            }
          }}
        />
      </label>
      {busy && <p role="status">Подготавливаем скриншоты…</p>}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <div className="activity-evidence-previews">
        {items.map((item, i) => (
          <figure key={item.id}>
            <img
              src={item.image}
              alt={`${kind === "roster" ? "Скрин состава" : "Скрин дропа"} ${i + 1}`}
              width={160}
              height={100}
            />
            <button
              type="button"
              className="text-button"
              onClick={() => {
                const next = items.filter((x) => x.id !== item.id);
                setItems(next);
                onChange(next);
              }}
            >
              Убрать
            </button>
          </figure>
        ))}
      </div>
      {!items.length && !busy && (
        <p className="activity-evidence-empty">Фото не выбраны</p>
      )}
    </div>
  );
}
