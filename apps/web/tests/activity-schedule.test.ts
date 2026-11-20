import { test } from "node:test";
import assert from "node:assert/strict";
import {
  upcomingSlots,
  mskNow,
  formatSlotTime,
  formatCountdown,
} from "../src/lib/activity-schedule";
test("reference activity countdown follows Moscow time and rolls across Sunday and midnight", () => {
  assert.deepEqual(mskNow(new Date("2026-11-15T23:30:00Z")), {
    day: 1,
    minutes: 150,
    seconds: 0,
  });
  const slots = upcomingSlots(new Date("2026-11-15T23:30:00Z"), 14);
  assert.equal(slots[0].name, "АГЛ");
  assert.equal(slots[0].day, 1);
  assert.equal(formatSlotTime(slots[0].minutes), "03:20");
  assert.equal(slots[0].inMinutes, 50);
  assert.ok(
    slots.every(
      (s, i) =>
        s.inMinutes >= 0 && (!i || s.inMinutes >= slots[i - 1].inMinutes),
    ),
  );
  assert.equal(
    upcomingSlots(new Date("2026-11-16T00:20:01Z"), 1)[0].minutes,
    7 * 60 + 20,
  );
  assert.equal(formatCountdown(65), "1 ч 5 мин");
  assert.equal(formatCountdown(0), "сейчас");
});
