import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import {
  allocateRbExperience,
  parseRbExperience,
  MAX_RB_EXPERIENCE,
  type RbPurchaseReport,
} from "../src/lib/rb-purchase";
import { dashboardPeriod } from "../src/lib/dashboard";
import { memberDatabase } from "./support/database";
const people = [
  { id: "a", nickname: "Первый", attendance_tenths: 200 },
  { id: "b", nickname: "Второй", attendance_tenths: 400 },
  { id: "c", nickname: "Третий", attendance_tenths: 600 },
];
test("RB experience divides by selected Mini RB percentages, conserves whole units, and resolves ties independently of order", () => {
  assert.deepEqual(
    allocateRbExperience(300n, people).map((p) => p.units),
    [50n, 100n, 150n],
  );
  assert.deepEqual(
    allocateRbExperience(300n, [people[0], people[2]]).map((p) => p.units),
    [75n, 225n],
  );
  const equal = people.map((p) => ({ ...p, attendance_tenths: 200 }));
  const shares = allocateRbExperience(1n, [...equal].reverse());
  assert.equal(shares.find((p) => p.id === "a")!.units, 1n);
  assert.equal(
    shares.reduce((s, p) => s + p.units, 0n),
    1n,
  );
  for (const total of [1n, 2n, 101n, 999999999999999999n, MAX_RB_EXPERIENCE]) {
    const rows = allocateRbExperience(total, people),
      denom = 1200n;
    assert.equal(
      rows.reduce((sum, p) => sum + p.units, 0n),
      total,
    );
    for (const row of rows) {
      const idealFloor = (total * BigInt(row.attendance_tenths)) / denom;
      assert.ok(row.units === idealFloor || row.units === idealFloor + 1n);
    }
  }
  assert.deepEqual(allocateRbExperience(1n, []), []);
  assert.throws(() => allocateRbExperience(0n, people));
  assert.throws(() =>
    allocateRbExperience(10n, [{ ...people[0], attendance_tenths: 199 }]),
  );
  assert.throws(() => allocateRbExperience(10n, [people[0], people[0]]));
});
test("experience input preserves large integers and rejects fractions, zero, signs and exponent notation", () => {
  assert.equal(parseRbExperience("1 000"), 1000n);
  assert.equal(parseRbExperience("1\u202f000"), 1000n);
  assert.equal(
    parseRbExperience(MAX_RB_EXPERIENCE.toString()),
    MAX_RB_EXPERIENCE,
  );
  for (const value of [
    "",
    "0",
    "-10",
    "1.5",
    "1,5",
    "1e8",
    "1000000000000000001",
    "Infinity",
  ])
    assert.equal(parseRbExperience(value), null);
});
test("candidate RPC uses Mini RB only, exact 20% eligibility, confirmed current-period attendance and active readable members", async () => {
  const c = await memberDatabase();
  const { db, members: m } = c;
  try {
    await db.exec("create role service_role");
    for (const f of (await readdir("supabase/migrations"))
      .sort()
      .filter(
        (f) =>
          f.endsWith(".sql") &&
          f > "202610310002_members.sql" &&
          !/^20261103001[78]/.test(f),
      ))
      await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
    await db.exec("update public.memberships set joined_at='2020-01-01'");
    await c.as(1);
    const period = dashboardPeriod({ period: "current" }),
      events: string[] = [];
    async function event(present: string[], source = "mini_rb") {
      const id = randomUUID();
      await db.query("select public.record_activity($1,$2::jsonb)", [
        id,
        JSON.stringify({
          title: "Тест покупки РБ",
          status: "completed",
          starts_at: new Date(
            Math.max(Date.parse(period.from + "T00:00:00Z"), Date.now() - 1000),
          ).toISOString(),
          kind: "raid",
          source,
          weight: 100,
          reward_units: "0",
          difficulty: "normal",
          night: false,
          counts: true,
          members: present,
          confirm_roster: true,
          guests: [],
          facts: {},
          evidence: [],
          loot: [],
        }),
      ]);
      return id;
    }
    for (let i = 0; i < 5; i++)
      events.push(
        await event([
          m[1],
          ...(i < 2 ? [m[2]] : []),
          ...(i === 0 ? [m[3]] : []),
        ]),
      );
    await event([m[4]], "prime");
    const read = () =>
      c.scalar<RbPurchaseReport>("select public.rb_purchase_candidates($1)", [
        period.from,
      ]);
    let report = await read();
    assert.equal(report.participants.length, 3);
    assert.equal(
      report.participants.find((p) => p.id === m[1])!.attendance_tenths,
      1000,
    );
    assert.equal(
      report.participants.find((p) => p.id === m[2])!.attendance_tenths,
      400,
    );
    assert.equal(
      report.participants.find((p) => p.id === m[3])!.attendance_tenths,
      200,
    );
    assert.equal(
      report.participants.some((p) => p.id === m[4]),
      false,
    );
    const unconfirmed = await event([m[4]]);
    await db.exec("reset role");
    await db.query(
      "update public.events set attendance_finalized_at=null where id=$1",
      [unconfirmed],
    );
    await c.as(1);
    assert.equal((await read()).participants.length, 3);
    await db.exec("reset role");
    await db.query("update public.events set activity_weight=101 where id=$1", [
      events[4],
    ]);
    await c.as(1);
    assert.equal(
      (await read()).participants.some((p) => p.id === m[3]),
      false,
      "19.96% must not pass through rounded 20%",
    );
    await db.exec("reset role");
    await db.query("update public.memberships set status='left' where id=$1", [
      m[2],
    ]);
    await c.as(1);
    assert.equal(
      (await read()).participants.some((p) => p.id === m[2]),
      false,
    );
    await db.query("select public.assign_member_role($1,'guest')", [m[4]]);
    await c.as(4);
    await assert.rejects(read(), /FORBIDDEN/);
    await c.as(1);
    await assert.rejects(
      c.scalar("select public.rb_purchase_candidates($1)", ["2026-01-14"]),
      /INVALID_PERIOD/,
    );
    assert.equal(
      await c.scalar("select count(*)::int from public.treasury_payouts"),
      0,
    );
    assert.equal(
      await c.scalar("select count(*)::int from public.treasury_sales"),
      0,
    );
  } finally {
    await db.close();
  }
});
