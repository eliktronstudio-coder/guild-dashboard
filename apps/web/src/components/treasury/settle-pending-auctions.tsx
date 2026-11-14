"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { settlePendingAuctions } from "@/app/treasury/inventory-actions";
export function SettlePendingAuctions({
  pending,
}: {
  pending: { id: string; version: number }[];
}) {
  const attempted = useRef(new Set<string>()),
    router = useRouter(),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const batch = pending
      .filter((x) => !attempted.current.has(`${x.id}:${x.version}`))
      .slice(0, 20);
    if (!batch.length) return;
    batch.forEach((x) => attempted.current.add(`${x.id}:${x.version}`));
    void settlePendingAuctions(batch)
      .then((result) => {
        if (result.error) setError(result.error);
        if (result.settled) router.refresh();
      })
      .catch(() =>
        setError(
          "Не удалось завершить ранее выставленные лоты. Обновите страницу.",
        ),
      );
  }, [pending, router]);
  return (
    <p
      className={`notice${error ? " error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {error ??
        "Применяем новое правило: ранее выставленные лоты автоматически записываются проданными по сохранённой цене."}
    </p>
  );
}
