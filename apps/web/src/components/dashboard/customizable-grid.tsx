"use client";

import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
const clsx = (...values: unknown[]) => values.filter(Boolean).join(" ");

import {
  MAX_HEIGHT,
  MAX_SPAN,
  MIN_HEIGHT,
  MIN_SPAN,
  getServerSnapshot,
  getSnapshot,
  reconcileLayout,
  resetLayout,
  saveLayout,
  subscribe,
  type PanelLayout,
} from "@/lib/dashboardLayout";

export type GridPanel = {
  id: string;
  /** Подпись панели в режиме настройки. */
  label: string;
  content: ReactNode;
  /** Ширина по умолчанию в колонках из 12. */
  defaultSpan: number;
};

type ResizeKind = "width" | "height" | "both";

export default function CustomizableGrid({ panels }: { panels: GridPanel[] }) {
  const defaults: PanelLayout[] = panels.map((p) => ({
    id: p.id,
    span: p.defaultSpan,
    height: null,
  }));
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const layout = reconcileLayout(raw, defaults);

  const [editing, setEditing] = useState(false);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const draggingId = useRef<string | null>(null);

  const byId = new Map(panels.map((p) => [p.id, p]));

  /** Пишет патч поверх свежей раскладки из хранилища, а не из замыкания рендера. */
  function update(id: string, patch: Partial<PanelLayout>) {
    const current = reconcileLayout(getSnapshot(), defaults);
    saveLayout(current.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function reorder(fromId: string, toId: string) {
    if (fromId === toId) return;
    const next = reconcileLayout(getSnapshot(), defaults);
    const from = next.findIndex((l) => l.id === fromId);
    const to = next.findIndex((l) => l.id === toId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    saveLayout(next);
  }

  /**
   * Слушатели вешаются на window, а не на саму ручку: курсор почти сразу уходит
   * с узкой полоски, и события pointermove на элементе приходить перестают.
   */
  function beginResize(
    event: React.PointerEvent,
    entry: PanelLayout,
    kind: ResizeKind,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const cell = (event.currentTarget as HTMLElement).closest(
      "[data-panel-cell]",
    ) as HTMLElement | null;
    const startX = event.clientX;
    const startY = event.clientY;
    const startSpan = entry.span;
    const startHeight =
      entry.height ?? cell?.getBoundingClientRect().height ?? MIN_HEIGHT;
    const gridWidth = gridRef.current?.getBoundingClientRect().width ?? 0;
    const columnWidth = gridWidth > 0 ? gridWidth / MAX_SPAN : 0;

    const onMove = (e: PointerEvent) => {
      const patch: Partial<PanelLayout> = {};
      if (kind !== "height" && columnWidth > 0) {
        const delta = Math.round((e.clientX - startX) / columnWidth);
        patch.span = Math.min(MAX_SPAN, Math.max(MIN_SPAN, startSpan + delta));
      }
      if (kind !== "width") {
        const next = startHeight + (e.clientY - startY);
        patch.height = Math.min(
          MAX_HEIGHT,
          Math.max(MIN_HEIGHT, Math.round(next)),
        );
      }
      update(entry.id, patch);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        {editing && (
          <button
            type="button"
            onClick={resetLayout}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted hover:text-foreground"
          >
            <span aria-hidden="true">↶</span> Сбросить
          </button>
        )}
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className={clsx(
            "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
            editing
              ? "border-accent/40 bg-accent-soft text-accent"
              : "border-border text-muted hover:text-foreground",
          )}
        >
          {editing ? (
            <span aria-hidden="true">✓</span>
          ) : (
            <span aria-hidden="true">⚙</span>
          )}
          {editing ? "Готово" : "Настроить"}
        </button>
      </div>

      {editing && (
        <div className="flex flex-wrap gap-2" aria-label="Видимость панелей">
          {layout.map((entry) => (
            <label
              key={entry.id}
              className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-xs"
            >
              <input
                type="checkbox"
                checked={!entry.hidden}
                onChange={(e) =>
                  update(entry.id, { hidden: !e.target.checked })
                }
              />
              {byId.get(entry.id)?.label}
            </label>
          ))}
        </div>
      )}
      <div ref={gridRef} className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
        {layout.map((entry) => {
          const panel = byId.get(entry.id);
          if (!panel || entry.hidden) return null;
          return (
            <div
              key={entry.id}
              data-panel-cell
              data-panel-id={entry.id}
              className={clsx(
                "panel-cell relative min-w-0",
                editing && "rounded-2xl ring-1 ring-accent/30",
                dragOverId === entry.id && "ring-2 ring-accent",
              )}
              style={
                {
                  "--panel-span": entry.span,
                  "--panel-height": entry.height ? `${entry.height}px` : "auto",
                } as React.CSSProperties
              }
              onDragOver={(e) => {
                if (!editing || !draggingId.current) return;
                e.preventDefault();
                setDragOverId(entry.id);
              }}
              onDragLeave={() =>
                setDragOverId((id) => (id === entry.id ? null : id))
              }
              onDrop={(e) => {
                e.preventDefault();
                if (draggingId.current) reorder(draggingId.current, entry.id);
                draggingId.current = null;
                setDragOverId(null);
              }}
            >
              <div className="h-full [&>*]:h-full">{panel.content}</div>

              {editing && (
                <>
                  <div className="absolute right-2 top-12 z-30 flex flex-wrap gap-1 rounded-lg bg-background/95 p-1">
                    <button
                      type="button"
                      aria-label={`Выше: ${panel.label}`}
                      className="min-h-11 min-w-11 border border-border"
                      onClick={() => {
                        const index = layout.findIndex(
                          (p) => p.id === entry.id,
                        );
                        if (index > 0) reorder(entry.id, layout[index - 1].id);
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Ниже: ${panel.label}`}
                      className="min-h-11 min-w-11 border border-border"
                      onClick={() => {
                        const index = layout.findIndex(
                          (p) => p.id === entry.id,
                        );
                        if (index < layout.length - 1)
                          reorder(entry.id, layout[index + 1].id);
                      }}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`Увеличить: ${panel.label}`}
                      className="min-h-11 min-w-11 border border-border"
                      onClick={() =>
                        update(entry.id, {
                          height: Math.min(
                            MAX_HEIGHT,
                            (entry.height ?? MIN_HEIGHT) + 50,
                          ),
                        })
                      }
                    >
                      +
                    </button>
                    <button
                      type="button"
                      aria-label={`Уменьшить: ${panel.label}`}
                      className="min-h-11 min-w-11 border border-border"
                      onClick={() =>
                        update(entry.id, {
                          height: Math.max(
                            MIN_HEIGHT,
                            (entry.height ?? MIN_HEIGHT) - 50,
                          ),
                        })
                      }
                    >
                      −
                    </button>
                  </div>
                  {/* Перетаскивание только за эту метку — иначе ресайз случайно
                      запускал бы drag всей панели. */}
                  <div
                    draggable
                    onDragStart={() => {
                      draggingId.current = entry.id;
                    }}
                    onDragEnd={() => {
                      draggingId.current = null;
                      setDragOverId(null);
                    }}
                    className="absolute left-3 top-3 z-20 flex cursor-grab items-center gap-1.5 rounded-md border border-accent/30 bg-background/90 px-2 py-1 text-[11px] text-accent active:cursor-grabbing"
                  >
                    <span aria-hidden="true">↕</span> {panel.label} ·{" "}
                    {entry.span}/12
                  </div>
                  <div
                    role="separator"
                    aria-label="Изменить ширину"
                    onPointerDown={(e) => beginResize(e, entry, "width")}
                    className="absolute inset-y-4 -right-1 z-10 w-2 touch-none cursor-ew-resize rounded-full bg-accent/40 hover:bg-accent"
                  />
                  <div
                    role="separator"
                    aria-label="Изменить высоту"
                    onPointerDown={(e) => beginResize(e, entry, "height")}
                    className="absolute inset-x-4 -bottom-1 z-10 h-2 touch-none cursor-ns-resize rounded-full bg-accent/40 hover:bg-accent"
                  />
                  <div
                    role="separator"
                    aria-label="Изменить размер"
                    onPointerDown={(e) => beginResize(e, entry, "both")}
                    className="absolute -bottom-1 -right-1 z-20 h-4 w-4 touch-none cursor-nwse-resize rounded-full border-2 border-background bg-accent"
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
