import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseGold,
  formatGold,
  goldInput,
  splitSale,
} from "../src/lib/treasury";
test("gold parsing is exact, accepts comma, rejects precision loss and invalid values", () => {
  assert.equal(parseGold("100000"), "1000000000");
  assert.equal(parseGold("0,0001"), "1");
  assert.equal(parseGold("10.205"), "102050");
  assert.equal(parseGold("10000000000"), "100000000000000");
  for (const v of [
    "",
    "-1",
    "1e5",
    "1.00001",
    "NaN",
    "1 000",
    "10000000000.0001",
    "Infinity",
    "1,2.3",
  ])
    assert.equal(parseGold(v), null, v);
});
test("large totals format without floating point; prime split is exactly conserved", () => {
  assert.equal(goldInput("100000000000000000001"), "10000000000000000.0001");
  assert.equal(formatGold("1000000000"), "100\u202f000");
  assert.deepEqual(splitSale("1000000000", "prime"), {
    guild: "300000000",
    fund: "700000000",
  });
  assert.deepEqual(splitSale("1000000000", "mini_rb"), {
    guild: "0",
    fund: "1000000000",
  });
  for (const n of [1n, 7n, 10001n, 99999999999999n]) {
    const s = splitSale(n.toString(), "prime");
    assert.equal(BigInt(s.guild) + BigInt(s.fund), n);
  }
});
