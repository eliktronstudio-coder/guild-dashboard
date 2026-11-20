import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nicknameError,
  normalizeNickname,
  safeNext,
} from "../src/lib/identity";
test("normalization is stable for fullwidth, NBSP and repeated spaces", () => {
  assert.equal(
    normalizeNickname("  Ｓａｋｕｒａ\u00a0  Wolf  "),
    "Sakura Wolf",
  );
  assert.equal(normalizeNickname(" Лунная\tЛиса "), "Лунная Лиса");
});
test("invisible characters, mixed scripts and invalid lengths are rejected", () => {
  for (const nick of [
    "",
    "X",
    "a".repeat(33),
    "ли\u200bса",
    "ХD",
    "<script>",
    "1234",
  ])
    assert.ok(nicknameError(nick), nick);
  for (const nick of ["ХД", "Sakura", "Лунная Лиса", "Ронин_2", "Wolf-1"])
    assert.equal(nicknameError(nick), null, nick);
});
test("auth redirects accept only exact local destinations", () => {
  for (const value of [
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/admin",
    "/dashboard?next=evil",
    null,
  ])
    assert.equal(safeNext(value), "/onboarding");
  assert.equal(safeNext("/account/password"), "/account/password");
});
