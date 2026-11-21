import { test } from "node:test";
import assert from "node:assert/strict";
import {
  directoryFilters,
  directoryHref,
  literalSearch,
  parseVersion,
} from "../src/lib/members";
test("member filters tolerate repeated query parameters and reject unknown sorting/roles", () => {
  const f = directoryFilters({
    q: ["Лиса", "Ронин"],
    sort: "nickname;drop table",
    role: "superadmin",
    page: "-5",
  });
  assert.equal(f.q, "Лиса");
  assert.equal(f.sort, "nickname");
  assert.equal(f.role, "");
  assert.equal(f.page, 1);
});
test("pagination keeps the full filter and treats SQL pattern characters literally", () => {
  const f = directoryFilters({
    q: "Лиса 100%",
    role: "officer",
    characterClass: "Целитель",
    server: "Ария",
    sort: "joined_new",
  });
  const url = new URL(directoryHref(f, 2), "https://guild.test");
  for (const key of ["q", "role", "characterClass", "server", "sort"] as const)
    assert.equal(url.searchParams.get(key), f[key]);
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(literalSearch("Лиса_%\\"), "%" + "Лиса\\_\\%\\\\" + "%");
});
test("optimistic version accepts only bounded integers", () => {
  for (const value of ["", "-1", "1e2", "2.5", "2147483648", "NaN"])
    assert.equal(parseVersion(value, true), null);
  assert.equal(parseVersion("0"), null);
  assert.equal(parseVersion("0", true), 0);
  assert.equal(parseVersion("12"), 12);
});
