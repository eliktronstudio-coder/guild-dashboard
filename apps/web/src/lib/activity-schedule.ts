/**
 * Weekly boss/activity schedule, times in MSK (UTC+3, no DST).
 * Kept as static data — it is a fixed in-game rotation, not something the guild
 * edits per week, so it does not live in the database.
 */

export type ScheduleSlot = {
  /** JS day index: 0 = Sunday … 6 = Saturday. */
  day: number;
  /** Minutes from MSK midnight. */
  minutes: number;
  name: string;
};

export const DAY_NAMES = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
];

const RAW: Record<number, string[]> = {
  1: [
    "3:20 АГЛ",
    "7:20 АГЛ",
    "10:00 Кошка",
    "11:20 АГЛ",
    "15:20 АГЛ",
    "19:20 АГЛ",
    "19:30 Кракен",
    "20:00 Алтарь",
    "20:30 Калидис",
    "21:30 Анталлон",
    "22:00 Кошка",
    "23:20 АГЛ",
  ],
  2: [
    "3:20 АГЛ",
    "7:20 АГЛ",
    "10:00 Кошка",
    "11:20 АГЛ",
    "15:00 Око Бури",
    "15:20 АГЛ",
    "19:20 АГЛ",
    "19:30 Ксанатос",
    "20:30 Левиафан",
    "21:30 Фесаникс",
    "22:00 Кошка",
    "23:20 АГЛ",
  ],
  3: [
    "3:20 АГЛ",
    "7:20 АГЛ",
    "10:00 Кошка",
    "11:20 АГЛ",
    "15:20 АГЛ",
    "19:20 АГЛ",
    "20:00 Алтарь",
    "21:00 Осада Замка",
    "22:00 Кошка",
    "23:20 АГЛ",
  ],
  4: [
    "3:20 АГЛ",
    "7:20 АГЛ",
    "10:00 Кошка",
    "11:20 АГЛ",
    "15:00 Око Бури",
    "15:20 АГЛ",
    "19:20 АГЛ",
    "19:30 Кракен",
    "20:00 Алтарь",
    "20:30 Левиафан",
    "22:00 Кошка",
    "23:20 АГЛ",
  ],
  5: [
    "3:20 АГЛ",
    "7:20 АГЛ",
    "10:00 Кошка",
    "11:20 АГЛ",
    "15:20 АГЛ",
    "19:20 АГЛ",
    "19:30 Ксанатос",
    "20:00 Алтарь",
    "20:30 Калидис",
    "21:30 Анталлон",
    "22:00 Оборона Ифнира",
    "22:00 Кошка",
    "23:20 АГЛ",
  ],
  6: [
    "3:20 АГЛ",
    "7:20 АГЛ",
    "10:00 Кошка",
    "11:20 АГЛ",
    "15:00 Око Бури",
    "15:20 АГЛ",
    "16:00 Оборона Ифнира",
    "18:00 Великий Луг",
    "19:20 АГЛ",
    "19:30 Кракен",
    "20:00 Алтарь",
    "20:30 Калидис",
    "22:00 Кошка",
    "23:20 АГЛ",
  ],
  0: [
    "3:20 АГЛ",
    "7:20 АГЛ",
    "10:00 Кошка",
    "11:20 АГЛ",
    "15:20 АГЛ",
    "18:00 Великий Луг",
    "18:30 Фесаникс",
    "19:20 АГЛ",
    "19:30 Ксанатос",
    "19:50 Анталлон",
    "20:30 Левиафан",
    "22:00 Кошка",
    "23:20 АГЛ",
  ],
};

export const SCHEDULE: ScheduleSlot[] = Object.entries(RAW).flatMap(
  ([day, rows]) =>
    rows.map((row) => {
      const spaceAt = row.indexOf(" ");
      const [hours, minutes] = row.slice(0, spaceAt).split(":").map(Number);
      return {
        day: Number(day),
        minutes: hours * 60 + minutes,
        name: row.slice(spaceAt + 1),
      };
    }),
);

const WEEK_MINUTES = 7 * 24 * 60;

/** Current MSK wall clock, derived from UTC so the viewer's own timezone never matters. */
export function mskNow(now: Date) {
  const msk = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return {
    day: msk.getUTCDay(),
    minutes: msk.getUTCHours() * 60 + msk.getUTCMinutes(),
    seconds: msk.getUTCSeconds(),
  };
}

export type UpcomingSlot = ScheduleSlot & { inMinutes: number };

/** The next `count` slots, ordered by how soon they start. */
export function upcomingSlots(now: Date, count: number): UpcomingSlot[] {
  const { day, minutes, seconds } = mskNow(now);
  const nowAt = day * 24 * 60 + minutes;
  return SCHEDULE.map((slot) => {
    const slotAt = slot.day * 24 * 60 + slot.minutes;
    let delta = slotAt - nowAt;
    // A slot earlier in the week has already passed this week — take next week's.
    if (delta < 0 || (delta === 0 && seconds > 0)) delta += WEEK_MINUTES;
    return { ...slot, inMinutes: delta };
  })
    .sort((a, b) => a.inMinutes - b.inMinutes)
    .slice(0, count);
}

export function formatSlotTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function formatCountdown(inMinutes: number) {
  if (inMinutes <= 0) return "сейчас";
  const days = Math.floor(inMinutes / (24 * 60));
  const hours = Math.floor((inMinutes % (24 * 60)) / 60);
  const mins = inMinutes % 60;
  if (days > 0) return `${days} д ${hours} ч`;
  if (hours > 0) return `${hours} ч ${mins} мин`;
  return `${mins} мин`;
}
