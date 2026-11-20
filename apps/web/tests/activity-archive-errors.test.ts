import { test } from "node:test";
import assert from "node:assert/strict";
import { archiveErrorMessage } from "../src/lib/activity-archive-errors";
test("archive errors distinguish timeouts, locking and access failures", () => {
  assert.match(archiveErrorMessage({ code: "57014" }), /время ожидания/);
  for (const code of ["55P03", "40P01"])
    assert.match(archiveErrorMessage({ code }), /другой операцией/);
  assert.match(archiveErrorMessage({ code: "42501" }), /отказала в доступе/);
  assert.match(archiveErrorMessage({ code: "PGRST202" }), /недоступна/);
  assert.match(
    archiveErrorMessage({ message: "NO_ACTIVITIES", code: "P0001" }),
    /нет неархивированных/,
  );
});
test("archive diagnostics expose only a validated error code, never database detail", () => {
  const message = "private sensitive database content";
  assert.equal(
    archiveErrorMessage({ code: "23503", message }),
    "Архивация не выполнена. Сообщите администратору код: 23503.",
  );
  assert.match(archiveErrorMessage({ code: message, message }), /UNKNOWN/);
  assert.ok(!archiveErrorMessage({ code: message, message }).includes(message));
});
