"use client";
import { useEffect, useState } from "react";
export function PeriodCountdown({ until }: { until: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (now === null) return <span>Расчёт времени…</span>;
  const seconds = Math.max(0, Math.floor((Date.parse(until) - now) / 1000));
  if (!seconds) return <span>Расчётный диапазон завершён</span>;
  return (
    <span role="timer">
      Осталось: {Math.floor(seconds / 86400)} д.{" "}
      {Math.floor(seconds / 3600) % 24} ч. {Math.floor(seconds / 60) % 60} мин.{" "}
      {seconds % 60} сек. (UTC)
    </span>
  );
}
