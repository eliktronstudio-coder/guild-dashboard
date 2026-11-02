import { test } from "node:test";
import assert from "node:assert/strict";
import { utcInput, monthRange } from "../src/lib/events";
test("event input rejects invalid rolled-over dates and preserves explicit UTC", () => {
  assert.equal(utcInput("2026-02-31T12:00"), null);
  assert.equal(utcInput("2026-10-31T24:00"), null);
  assert.equal(utcInput("2026-10-31T12:30"), "2026-10-31T12:30:00.000Z");
  assert.equal(utcInput("2026-10-31T12:30:25"), "2026-10-31T12:30:25.000Z");
  assert.equal(utcInput("2026-10-31T12:30+03:00"), null);
});
test("monthly UTC period rolls correctly over leap day and year end", () => {
  assert.equal(monthRange("2028-02").until, "2028-03-01T00:00:00.000Z");
  assert.equal(monthRange("2026-12").until, "2027-01-01T00:00:00.000Z");
  assert.equal(monthRange("bad").month, new Date().toISOString().slice(0, 7));
});
