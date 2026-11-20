"use client";
import { useSyncExternalStore } from "react";
import {
  DAY_NAMES,
  upcomingSlots,
  mskNow,
  formatSlotTime,
  formatCountdown,
} from "@/lib/activity-schedule";
const subscribe = (fn: () => void) => {
  const id = setInterval(fn, 15000);
  return () => clearInterval(id);
};
const snapshot = () => Math.floor(Date.now() / 15000) * 15000;
const serverSnapshot = () => null;
export function ActivitySchedule() {
  const now = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const today = now === null ? 0 : mskNow(new Date(now)).day;
  const slots = now === null ? [] : upcomingSlots(new Date(now), 14);
  return (
    <section className="panel section-panel activity-schedule-panel">
      <div className="section-heading">
        <h2>До активностей</h2>
        <span className="caption">по МСК</span>
      </div>
      <p className="caption schedule-note">Расписание игры · UTC+3</p>
      <div
        className="schedule-scroll"
        tabIndex={0}
        aria-label="Ближайшие активности по расписанию"
      >
        {now === null ? (
          <p className="muted">Загрузка расписания…</p>
        ) : (
          slots.map((slot, i) => (
            <div key={`${slot.day}-${slot.minutes}-${slot.name}`}>
              {(i === 0 || slot.day !== slots[i - 1].day) && (
                <p className="schedule-day">
                  {slot.day === today
                    ? "Сегодня"
                    : slot.day === (today + 1) % 7
                      ? "Завтра"
                      : DAY_NAMES[slot.day]}
                </p>
              )}
              <div className="schedule-row">
                <time>{formatSlotTime(slot.minutes)}</time>
                <div>
                  <strong>{slot.name}</strong>
                  <span>
                    {slot.inMinutes <= 0
                      ? "Сейчас"
                      : `через ${formatCountdown(slot.inMinutes)}`}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
